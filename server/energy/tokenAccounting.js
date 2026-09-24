/** Optional minute-bucket extension. Legacy energy is never backfilled with guessed tokens. */
export function emptyAccounting() {
  return { wattMs: 0, coverageMs: 0, promptTokens: 0, cachedTokens: 0, outputTokens: 0 };
}

export function accountingDelta(previous, current) {
  const keys = ["totalPromptTokens", "totalCachedTokens", "totalOutputTokens"];
  if (!keys.every((key) => Number.isSafeInteger(previous?.[key]) && previous[key] >= 0 &&
      Number.isSafeInteger(current?.[key]) && current[key] >= previous[key])) return null;
  const [promptTokens, cachedTokens, outputTokens] = keys.map((key) => current[key] - previous[key]);
  // Cache hits must be a subset of prompt, never inflate prompt to accommodate inconsistent counters.
  if (cachedTokens > promptTokens || Math.max(promptTokens, cachedTokens, outputTokens) > 1e9) return null;
  return { promptTokens, cachedTokens, outputTokens };
}

export function validAccounting(value, bucket) {
  return value && Object.keys(emptyAccounting()).every((key) =>
    Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= Number.MAX_SAFE_INTEGER) &&
    value.coverageMs <= bucket.fleetCoverageMs + 1e-6 &&
    value.wattMs <= bucket.fleetWattMs + Math.max(1, bucket.fleetWattMs) * 1e-9 &&
    value.cachedTokens <= value.promptTokens + 1e-6 &&
    (value.coverageMs > 0 || Object.values(value).every((n) => n === 0));
}

export function addAccounting(target, source) {
  for (const key of Object.keys(emptyAccounting())) {
    target[key] = Math.min(Number.MAX_SAFE_INTEGER, target[key] + source[key]);
  }
}

export function accountingWindow(value) {
  if (value.coverageMs <= 0) return null;
  return {
    energyKwh: value.wattMs / 3_600_000_000,
    coverageMs: value.coverageMs,
    promptTokens: value.promptTokens,
    cachedTokens: Math.min(value.cachedTokens, value.promptTokens),
    outputTokens: value.outputTokens,
  };
}
