import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { SqliteEnergyStore } from "../../energy/SqliteEnergyStore.js";
import { SqliteTokenStore } from "../SqliteTokenStore.js";
import { LlmTokenLedger } from "../LlmTokenLedger.js";

const T = Date.UTC(2026, 8, 25);
const obs = (n) => [{ sparkId: "spark1", port: 8000, modelId: "model", output: n, prompt: 4*n, cached: 3*n }];
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-sqlite-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const legacyPath = path.join(dir, "tokens.json");
  const filePath = path.join(dir, "energy.sqlite");
  const open = () => {
    const energy = new SqliteEnergyStore({ filePath });
    const storage = new SqliteTokenStore({ db: energy.db, legacyPath });
    const ledger = new LlmTokenLedger(legacyPath, { storage });
    return { energy, storage, ledger, close() { ledger.close(); energy.close(); } };
  };
  return { legacyPath, filePath, open };
}

test("token SQLite imports once, preserves all ranges and counters, coexists with energy", (t) => {
  const f = fixture(t);
  const old = new LlmTokenLedger(f.legacyPath);
  old.record(obs(0), T); old.record(obs(100), T+1000); old.close();
  const original = fs.readFileSync(f.legacyPath, "utf8");
  let s = f.open();
  for (const range of ["all", "today", "7d", "14d", "30d"]) assert.deepEqual(s.ledger.snapshot(range), old.snapshot(range));
  s.energy.write({ version: 1, nodeIds: ["spark1"] }, [{minuteStartMs: T}], []);
  s.ledger.record(obs(200), T+2000); s.ledger.flush();
  assert.equal(s.energy.read().buckets[0].minuteStartMs, T);
  assert.equal(fs.readFileSync(f.legacyPath, "utf8"), original);
  const expected = s.ledger.snapshot(); s.close();
  fs.writeFileSync(f.legacyPath, "corrupt legacy should no longer be read");
  s = f.open();
  assert.deepEqual(s.ledger.snapshot(), expected);
  s.ledger.record(obs(200), T+3000);
  assert.equal(s.ledger.snapshot().series[0].totals.completionTokens, 200);
  s.close();
});

test("token SQLite only updates changed records, prunes old days, and retries atomic failures", (t) => {
  const f = fixture(t); const s = f.open(); t.after(() => s.close());
  s.ledger.record(obs(0), T); s.ledger.record(obs(100), T+1000); s.ledger.flush();
  s.energy.db.exec("CREATE TABLE touches(kind TEXT, item TEXT); CREATE TRIGGER touch AFTER UPDATE ON token_records BEGIN INSERT INTO touches VALUES(new.kind,new.item_key); END;");
  s.ledger.record(obs(200), T+86400000); s.ledger.flush();
  assert.deepEqual(s.energy.db.prepare("SELECT item FROM touches WHERE kind='day'").all(), []);
  const changes = s.energy.db.prepare("SELECT total_changes() n").get().n;
  s.ledger.flush(); assert.equal(s.energy.db.prepare("SELECT total_changes() n").get().n, changes);
  const persisted = s.energy.db.prepare("SELECT * FROM token_records ORDER BY kind,series_key,item_key").all();
  s.energy.db.exec("CREATE TRIGGER fail BEFORE UPDATE ON token_records WHEN new.kind='model' BEGIN SELECT RAISE(ABORT,'injected'); END;");
  s.ledger.record(obs(300), T+86401000);
  assert.throws(() => s.ledger.flush(), /injected/);
  assert.deepEqual(s.energy.db.prepare("SELECT * FROM token_records ORDER BY kind,series_key,item_key").all(), persisted);
  assert.equal(s.ledger._dirty, true);
  s.energy.db.exec("DROP TRIGGER fail"); s.ledger.flush();
  for (let day=2; day<40; day++) s.ledger.record(obs(300+day), T+day*86400000);
  s.ledger.flush();
  assert.equal(s.energy.db.prepare("SELECT count(*) n FROM token_records WHERE kind='day'").get().n, 35);
  assert.equal(s.energy.db.prepare("SELECT count(*) n FROM token_records WHERE kind='day' AND item_key='2026-09-25'").get().n, 0);
});

test("token SQLite fails closed on invalid legacy imports; empty initialization is permanent", (t) => {
  const f = fixture(t); const energy = new SqliteEnergyStore({ filePath: f.filePath });
  t.after(() => energy.close());
  for (const text of ["not json", '{"version":2,"series":{}}', '{"version":1,"series":[]}']) {
    fs.writeFileSync(f.legacyPath, text);
    assert.throws(() => new LlmTokenLedger(f.legacyPath, { storage: new SqliteTokenStore({ db: energy.db, legacyPath:f.legacyPath }) }));
    assert.equal(energy.db.prepare("SELECT count(*) n FROM token_state").get().n, 0);
  }
  fs.unlinkSync(f.legacyPath);
  new LlmTokenLedger(f.legacyPath, { storage: new SqliteTokenStore({db:energy.db, legacyPath:f.legacyPath}) }).close();
  fs.writeFileSync(f.legacyPath, "bad");
  new LlmTokenLedger(f.legacyPath, { storage: new SqliteTokenStore({db:energy.db, legacyPath:f.legacyPath}) }).close();
});

test("schema v1 upgrades without changing existing energy data", (t) => {
  const f = fixture(t); const db = new DatabaseSync(f.filePath);
  db.exec(`CREATE TABLE energy_state(id INTEGER PRIMARY KEY, payload TEXT);
    CREATE TABLE energy_minutes(minute_start_ms INTEGER PRIMARY KEY, payload TEXT);
    INSERT INTO energy_state VALUES(1,'{"version":1,"nodeIds":["spark1"]}');
    PRAGMA user_version=1;`); db.close();
  const s=f.open();
  assert.equal(s.energy.db.prepare("PRAGMA user_version").get().user_version, 2);
  assert.deepEqual(s.energy.read(), {version:1,nodeIds:["spark1"],buckets:[]});
  s.close();
});

test("token SQLite keeps committed usage and rolls back interrupted transactions after SIGKILL", (t) => {
  const f=fixture(t); let s=f.open();
  s.ledger.record(obs(0),T); s.ledger.record(obs(100),T+1000); s.ledger.flush();
  const expected=s.ledger.snapshot(); s.close();
  const child=spawnSync(process.execPath,["--input-type=module","-e",`
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(${JSON.stringify(f.filePath)});
    db.exec("BEGIN IMMEDIATE; DELETE FROM token_records;");
    process.kill(process.pid,'SIGKILL');
  `]);
  assert.equal(child.signal,"SIGKILL");
  s=f.open(); assert.deepEqual(s.ledger.snapshot(),expected); s.close();
});
