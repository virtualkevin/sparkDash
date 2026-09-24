/** User-supplied comparison rates; no provider pricing or exchange-rate assumptions. */
export const DEFAULT_ENERGY_PRICING = Object.freeze({
  currency: "USD",
  electricityPerKwh: null,
  inputPerMillion: null,
  cachedInputPerMillion: null,
  outputPerMillion: null,
});

export function normalizeEnergyPricing(value) {
  const rates = { ...DEFAULT_ENERGY_PRICING };
  if (!value || typeof value !== "object" || Array.isArray(value)) return rates;
  if (typeof value.currency === "string" && /^[A-Za-z]{3}$/.test(value.currency.trim())) {
    rates.currency = value.currency.trim().toUpperCase();
  }
  for (const key of ["electricityPerKwh", "inputPerMillion", "cachedInputPerMillion", "outputPerMillion"]) {
    const n = value[key];
    rates[key] = typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : null;
  }
  return rates;
}

export function millionTokensPerKwh(whPerToken) {
  return Number.isFinite(whPerToken) && whPerToken > 0 ? 1 / (1000 * whPerToken) : null;
}

/** Everything in a window represents the same measured intervals, including idle. */
export function calculateEnergyCosts(window, pricing) {
  const rates = normalizeEnergyPricing(pricing);
  const empty = { powerCost: null, effectivePerMillionOutput: null, apiCost: null, savings: null };
  if (!window || !Number.isFinite(window.coverageMs) || window.coverageMs <= 0 ||
      ![window.energyKwh, window.promptTokens, window.cachedTokens, window.outputTokens]
        .every((n) => Number.isFinite(n) && n >= 0) || window.cachedTokens > window.promptTokens) return empty;
  const powerCost = rates.electricityPerKwh == null ? null : window.energyKwh * rates.electricityPerKwh;
  const apiCost = [rates.inputPerMillion, rates.cachedInputPerMillion, rates.outputPerMillion].some((n) => n == null)
    ? null
    : ((window.promptTokens - window.cachedTokens) * rates.inputPerMillion +
       window.cachedTokens * rates.cachedInputPerMillion + window.outputTokens * rates.outputPerMillion) / 1e6;
  return {
    powerCost,
    effectivePerMillionOutput: powerCost != null && window.outputTokens > 0 ? powerCost * 1e6 / window.outputTokens : null,
    apiCost,
    savings: apiCost != null && powerCost != null ? apiCost - powerCost : null,
  };
}
