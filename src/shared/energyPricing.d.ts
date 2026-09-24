export interface EnergyPricing {
  currency: string;
  electricityPerKwh: number | null;
  inputPerMillion: number | null;
  cachedInputPerMillion: number | null;
  outputPerMillion: number | null;
}
export interface EnergyCostWindow {
  energyKwh: number;
  coverageMs: number;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
}
export const DEFAULT_ENERGY_PRICING: Readonly<EnergyPricing>;
export function normalizeEnergyPricing(value: unknown): EnergyPricing;
export function millionTokensPerKwh(whPerToken: number | null): number | null;
export function calculateEnergyCosts(window: EnergyCostWindow | null | undefined, pricing: unknown): {
  powerCost: number | null;
  effectivePerMillionOutput: number | null;
  apiCost: number | null;
  savings: number | null;
};
