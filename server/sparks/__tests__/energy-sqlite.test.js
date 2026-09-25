import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { FleetEnergyTracker } from "../../energy/FleetEnergyTracker.js";
import { SqliteEnergyStore } from "../../energy/SqliteEnergyStore.js";

const T = Date.UTC(2026, 8, 25);
const storeModule = new URL("../../energy/SqliteEnergyStore.js", import.meta.url).href;
const noTimer = { setIntervalFn: () => null, clearIntervalFn: () => {} };

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "energy-sqlite-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { filePath: path.join(dir, "energy.sqlite"), legacyPath: path.join(dir, "energy.json") };
}

function sample(n) {
  return [{ id: "one", role: "head", online: true, telemetryFresh: true,
    llmPorts: [8000], metrics: { gpu: { power: { draw: 71.8 } }, cpu: { usage: 0 },
      llm: [{ available: true, modelId: "model", totalOutputTokens: n,
        totalPromptTokens: n * 4, totalCachedTokens: n * 2 }] } }];
}

function legacy(t, count = 5) {
  const files = fixture(t);
  const buckets = Array.from({ length: count }, (_, i) => ({
    minuteStartMs: T - (count - i) * 60_000,
    nodeWh: { one: 100 / 60 }, nodeCoverageMs: { one: 60_000 },
    fleetWattMs: 6_000_000, fleetCoverageMs: 60_000,
    outputTokens: 120, coveredOutputTokens: 120,
    accounting: { wattMs: 6_000_000, coverageMs: 60_000,
      promptTokens: 480, cachedTokens: 240, outputTokens: 120 },
  }));
  fs.writeFileSync(files.legacyPath, JSON.stringify({ version: 1, nodeIds: ["one"],
    savedAt: T, integrationHighWaterMs: T, tokenCounter: null, buckets }));
  return files;
}

function tracker(files, now = () => T, nodeIds = ["one"]) {
  const storage = new SqliteEnergyStore(files);
  const value = new FleetEnergyTracker({ nodeIds, now, storage, ...noTimer });
  return { value, storage };
}

test("SQLite migration preserves history/accounting and leaves the source JSON untouched", (t) => {
  const files = legacy(t);
  const original = fs.readFileSync(files.legacyPath, "utf8");
  const reference = new FleetEnergyTracker({ nodeIds: ["one"], filePath: files.legacyPath, now: () => T, ...noTimer });
  const { value, storage } = tracker(files);
  assert.deepEqual(value.snapshot(T), reference.snapshot(T));
  assert.equal(storage.db.prepare("PRAGMA synchronous").get().synchronous, 2);
  assert.equal(storage.db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(fs.statSync(files.filePath).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(files.legacyPath, "utf8"), original);
  value.close();
  // The JSON is never reimported after a successful migration.
  fs.writeFileSync(files.legacyPath, "not JSON anymore");
  const second = tracker(files);
  assert.deepEqual(second.value.snapshot(T), reference.snapshot(T));
  assert.equal(second.value.flush(), false);
  second.value.close();
  reference.close();
});

test("SQLite minute updates match JSON including rollover, accounting, reset, and restart", (t) => {
  const files = legacy(t);
  let now = T;
  const reference = new FleetEnergyTracker({ nodeIds: ["one"], filePath: files.legacyPath, now: () => now, ...noTimer });
  let { value, storage } = tracker(files, () => now);
  for (let n = 0; n <= 70; n += 2) {
    now = T + n * 1000;
    for (const v of [reference, value]) { v.record(sample(n), now); v.flush(); }
    assert.deepEqual(value.snapshot(now), reference.snapshot(now));
  }
  const expected = reference.snapshot(now);
  value.close();
  ({ value, storage } = tracker(files, () => now));
  assert.equal(value.snapshot(now).energy24hKwh, expected.energy24hKwh);
  assert.deepEqual(value.snapshot(now).accounting24h, expected.accounting24h);
  const before = value.snapshot(now).outputTokens24h;
  now += 2000;
  value.record(sample(5000), now); // restart must seed counters, not credit the gap
  assert.equal(value.snapshot(now).outputTokens24h, before);
  now += 2000;
  value.record(sample(2), now); // model reset also must not credit negative tokens
  value.flush();
  assert.equal(value.snapshot(now).outputTokens24h, before);
  assert.equal(storage.read().buckets.length, 7);
  value.close(); reference.close();
});

test("SQLite writes only changed minutes; a clean flush writes nothing", (t) => {
  const files = legacy(t, 1440);
  let now = T;
  const { value, storage } = tracker(files, () => now);
  storage.db.exec("CREATE TABLE touches (minute INTEGER); CREATE TRIGGER track_changes AFTER UPDATE ON energy_minutes BEGIN INSERT INTO touches VALUES (new.minute_start_ms); END;");
  value.record(sample(0), now);
  now += 2000; value.record(sample(2), now); value.flush();
  now += 2000; value.record(sample(4), now); value.flush();
  assert.deepEqual(storage.db.prepare("SELECT minute FROM touches").all().map((r) => r.minute), [T]);
  const before = storage.db.prepare("SELECT total_changes() AS n").get().n;
  assert.equal(value.flush(), false);
  assert.equal(storage.db.prepare("SELECT total_changes() AS n").get().n, before);
  value.close();
});

test("SQLite transaction failure rolls back metadata and minutes; dirty updates retry", (t) => {
  const files = legacy(t);
  let now = T;
  const { value, storage } = tracker(files, () => now);
  const before = storage.read();
  storage.db.exec("CREATE TRIGGER fail_state BEFORE UPDATE ON energy_state BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
  value.record(sample(0), now);
  now += 2000; value.record(sample(2), now);
  assert.throws(() => value.flush(), /injected failure/);
  assert.deepEqual(storage.read(), before);
  storage.db.exec("DROP TRIGGER fail_state");
  assert.equal(value.flush(), true);
  assert.equal(storage.read().buckets.at(-1).outputTokens, 2);
  assert.equal(storage.read().tokenCounter.totalOutputTokens, 2);
  value.close();
});

test("SQLite prunes expired minutes and cannot resurrect old fleet data on restart", (t) => {
  const files = legacy(t, 10);
  let now = T;
  const { value, storage } = tracker(files, () => now);
  now += 32 * 86_400_000;
  value.record(sample(0), now); value.flush();
  assert.equal(storage.read().buckets.length, 0);
  value.close();
  const changed = tracker(files, () => now, ["two"]);
  assert.deepEqual(changed.storage.read().nodeIds, ["two"]);
  assert.deepEqual(changed.storage.read().buckets, []);
  changed.value.close();
});

test("SQLite refuses corrupt migration/database and unknown versions instead of erasing history", (t) => {
  const files = fixture(t);
  fs.writeFileSync(files.legacyPath, "truncated JSON");
  assert.throws(() => tracker(files));
  assert.equal(fs.readFileSync(files.legacyPath, "utf8"), "truncated JSON");
  fs.writeFileSync(files.legacyPath, JSON.stringify({ version: 1, buckets: [], nodeIds: ["one"] }));
  const { value, storage } = tracker(files);
  storage.db.exec("PRAGMA user_version=99");
  value.close();
  assert.throws(() => tracker(files), /Unsupported energy SQLite schema/);
  const bad = fixture(t);
  fs.writeFileSync(bad.filePath, "not a database");
  assert.throws(() => tracker(bad));
});

test("SQLite survives SIGKILL: committed state survives; an open transaction is rolled back", (t) => {
  const files = legacy(t);
  const initial = tracker(files); initial.value.close();
  for (const commit of [true, false]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { SqliteEnergyStore } from ${JSON.stringify(storeModule)};
      const store = new SqliteEnergyStore(${JSON.stringify(files)});
      const state = store.read(); delete state.buckets;
      state.savedAt = ${commit ? T + 1 : T + 2};
      store.db.exec('BEGIN IMMEDIATE');
      store.upsertState.run(JSON.stringify(state));
      ${commit ? "store.db.exec('COMMIT');" : ""}
      process.kill(process.pid, 'SIGKILL');
    `], { encoding: "utf8", timeout: 10_000 });
    assert.equal(child.signal, "SIGKILL", child.stderr);
    const store = new SqliteEnergyStore(files);
    assert.equal(store.read().savedAt, T + 1);
    assert.equal(store.read().buckets.length, 5);
    store.close();
  }
});

test("SQLite steady-state writes stay small with a full 31-day history", (t) => {
  const files = legacy(t, 44_640);
  let now = T;
  const { value, storage } = tracker(files, () => now);
  storage.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint=0;");
  const baseline = fs.statSync(files.filePath + "-wal").size;
  const processWrites = () => Number(fs.readFileSync("/proc/self/io", "utf8").match(/^write_bytes: (\d+)$/m)[1]);
  const writeBaseline = processWrites();
  const jsonSize = fs.statSync(files.legacyPath).size;
  value.record(sample(0), now);
  for (let n = 1; n <= 60; n++) {
    for (let tick = 0; tick < 15; tick++) {
      now += 2000; value.record(sample((now - T) / 1000), now);
    }
    value.flush();
  }
  const walBytes = fs.statSync(files.filePath + "-wal").size - baseline;
  assert.ok(walBytes < 60 * 64 * 1024, `Unexpected WAL growth: ${walBytes}`);
  assert.ok(walBytes < jsonSize * 60 / 100, `Not at least 100x smaller: ${walBytes}`);
  storage.db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  console.log(`SQLite write-volume fixture: 60 saves, ${walBytes} WAL bytes vs ${jsonSize * 60} full-JSON bytes; process write_bytes including final checkpoint: ${processWrites() - writeBaseline} (not SSD NAND writes)`);
  assert.ok(storage.db.prepare("SELECT count(*) AS n FROM energy_minutes").get().n <= 44_641);
  value.close();
});
