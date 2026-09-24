import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FleetEnergyTracker } from "../../energy/FleetEnergyTracker.js";
import { accountingDelta } from "../../energy/tokenAccounting.js";
import { calculateEnergyCosts, normalizeEnergyPricing, millionTokensPerKwh } from "../../../src/shared/energyPricing.js";

const T0 = Date.UTC(2026, 8, 24, 12);
const rates = { currency: "USD", electricityPerKwh: 0.3, inputPerMillion: 2, cachedInputPerMillion: 0.2, outputPerMillion: 8 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function snapshots(output = 0, prompt = 0, cached = 0, { fresh = true, available = true, model = "a" } = {}) {
  return ["head", "worker"].map((id) => ({
    id, role: id, telemetryFresh: id === "head" || fresh, llmPorts: id === "head" ? [8000] : [],
    metrics: { gpu: { power: { draw: 71.8 } }, cpu: { usage: 0 }, llm: id === "head" ? [{
      available, modelId: model, totalOutputTokens: output, totalPromptTokens: prompt, totalCachedTokens: cached,
    }] : [] },
  }));
}
const tracker = (options = {}) => new FleetEnergyTracker({ nodeIds: ["head", "worker"], load: false, now: () => T0 + 10_000, ...options });

test("pricing: output efficiency units, split API billing, effective cost and negative savings", () => {
  assert.equal(millionTokensPerKwh(0.002), 0.5);
  for (const value of [0, -1, null, NaN, Infinity]) assert.equal(millionTokensPerKwh(value), null);
  const result = calculateEnergyCosts({ coverageMs: 1000, energyKwh: 10, promptTokens: 2e6, cachedTokens: 1e6, outputTokens: 0.5e6 }, rates);
  assert.deepEqual(result, { powerCost: 3, effectivePerMillionOutput: 6, apiCost: 6.2, savings: 3.2 });
  assert.equal(calculateEnergyCosts({ coverageMs: 1000, energyKwh: 100, promptTokens: 0, cachedTokens: 0, outputTokens: 0 }, rates).savings, -30);
});

test("pricing: unknown vs zero, validation and undefined cost with no output", () => {
  const zero = { coverageMs: 1000, energyKwh: 1, promptTokens: 0, cachedTokens: 0, outputTokens: 0 };
  assert.equal(calculateEnergyCosts(zero, rates).effectivePerMillionOutput, null);
  assert.equal(calculateEnergyCosts(zero, {}).savings, null);
  const free = { ...rates, electricityPerKwh: 0, inputPerMillion: 0, cachedInputPerMillion: 0, outputPerMillion: 0 };
  assert.equal(calculateEnergyCosts(zero, free).savings, 0);
  for (const value of [null, { ...zero, coverageMs: 0 }, { ...zero, energyKwh: NaN }, { ...zero, cachedTokens: 1 }]) {
    assert.equal(calculateEnergyCosts(value, rates).powerCost, null);
  }
  const invalid = normalizeEnergyPricing({ currency: "eur", electricityPerKwh: -1, inputPerMillion: "3", cachedInputPerMillion: Infinity, outputPerMillion: 1e10 });
  assert.deepEqual(invalid, { currency: "EUR", electricityPerKwh: null, inputPerMillion: null, cachedInputPerMillion: null, outputPerMillion: null });
  assert.equal(normalizeEnergyPricing({ currency: "<script>" }).currency, "USD");
});

test("accounting: counts exact matched fleet intervals, including idle power", () => {
  const t = tracker();
  t.record(snapshots(), T0);
  t.record(snapshots(200, 1000, 600), T0 + 2000);
  t.record(snapshots(200, 1000, 600), T0 + 4000); // idle, not free
  const window = t.snapshot(T0 + 4000).accounting24h;
  close(window.energyKwh, 200 * 4000 / 3_600_000_000);
  assert.equal(window.coverageMs, 4000);
  assert.equal(window.outputTokens, 200);
  assert.equal(window.promptTokens, 1000);
  assert.equal(window.cachedTokens, 600);
});

test("accounting: missing power/counters, counter reset, model switch and long gaps do not invent savings", () => {
  for (const scenario of ["power", "cached", "reset", "model", "gap", "source", "headless"]) {
    const t = tracker();
    t.record(snapshots(100, 100, 50), T0);
    const next = snapshots(scenario === "reset" ? 1 : 200, 200, scenario === "cached" ? null : 100,
      { fresh: scenario !== "power", model: scenario === "model" ? "b" : "a", available: scenario !== "headless" });
    if (scenario === "source") next[0].llmPorts = [8001];
    const at = T0 + (scenario === "gap" ? 20_000 : 2000);
    t.record(next, at);
    assert.equal(t.snapshot(at).accounting24h, null, scenario);
  }
});

test("accounting: resumed token telemetry cannot bill a multi-sample delta against one power interval", () => {
  const t = tracker();
  t.record(snapshots(), T0);
  t.record(snapshots(100, 100, 10, { available: false }), T0 + 2000);
  t.record(snapshots(200, 200, 20), T0 + 4000);
  assert.equal(t.snapshot(T0 + 4000).accounting24h, null);
  t.record(snapshots(300, 300, 30), T0 + 6000);
  assert.equal(t.snapshot(T0 + 6000).accounting24h.outputTokens, 100);
  t.invalidateMembership(["head"]);
  assert.equal(t.snapshot(T0 + 6000).accounting24h, null);
});

test("accounting: invalid cached deltas are rejected rather than inflating prompt totals", () => {
  assert.equal(accountingDelta({ totalOutputTokens: 0, totalPromptTokens: 0, totalCachedTokens: 0 },
    { totalOutputTokens: 1, totalPromptTokens: 10, totalCachedTokens: 20 }), null);
});

test("accounting: minute splits persist, reload without double counting, and legacy history stays unpriced", (ctx) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "energy-costs-"));
  ctx.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "energy.json");
  const opts = { filePath, now: () => T0 + 61_000, setIntervalFn: () => 1, clearIntervalFn: () => {} };
  const t = tracker(opts);
  t.record(snapshots(), T0 + 59_000);
  t.record(snapshots(200, 1000, 600), T0 + 61_000);
  t.close();
  const saved = JSON.parse(fs.readFileSync(filePath));
  assert.deepEqual(saved.buckets.map((b) => b.accounting.coverageMs), [1000, 1000]);
  assert.deepEqual(saved.buckets.map((b) => b.accounting.outputTokens), [100, 100]);
  const restored = tracker({ ...opts, load: true });
  assert.deepEqual(restored.snapshot(T0 + 61_000).accounting24h, t.snapshot(T0 + 61_000).accounting24h);
  restored.record(snapshots(300, 2000, 700), T0 + 62_000); // first after load rebases
  assert.equal(restored.snapshot(T0 + 62_000).accounting24h.outputTokens, 200);
  assert.equal(restored.snapshot(T0 + 2 * 86_400_000).accounting24h, null);
  assert.equal(restored.snapshot(T0 + 2 * 86_400_000).accounting31d.outputTokens, 200);
  for (const bucket of saved.buckets) delete bucket.accounting;
  fs.writeFileSync(filePath, JSON.stringify(saved));
  const legacy = tracker({ ...opts, load: true });
  assert.equal(legacy.snapshot(T0 + 61_000).accounting24h, null);
  assert.ok(legacy.snapshot(T0 + 61_000).energy24hKwh > 0);
});

test("settings: pricing round-trips and invalid values remain unconfigured", async (ctx) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "energy-pricing-"));
  const before = process.env.SETTINGS_JSON_PATH;
  process.env.SETTINGS_JSON_PATH = path.join(dir, "settings.json");
  ctx.after(() => { if (before === undefined) delete process.env.SETTINGS_JSON_PATH; else process.env.SETTINGS_JSON_PATH = before; fs.rmSync(dir, { recursive: true, force: true }); });
  const settings = await import(`../../settings.js?pricing=${Date.now()}`);
  settings.loadSettings();
  settings.updateSettings({ energyPricing: rates });
  assert.deepEqual(settings.loadSettings().energyPricing, rates);
  settings.updateSettings({ energyPricing: { ...rates, electricityPerKwh: -0.1 } });
  assert.equal(settings.getSettings().energyPricing.electricityPerKwh, null);
});
