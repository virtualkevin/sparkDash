import { DEFAULT_ENERGY_PRICING, type EnergyPricing } from "../shared/energyPricing";

const FIELDS = [
  ["electricityPerKwh", "Electricity / kWh"],
  ["inputPerMillion", "Uncached input / million tokens"],
  ["cachedInputPerMillion", "Cached input / million tokens"],
  ["outputPerMillion", "Output / million tokens"],
] as const;

export function EnergyPricingFields({ value = DEFAULT_ENERGY_PRICING, onChange }: {
  value?: EnergyPricing;
  onChange: (value: EnergyPricing) => void;
}) {
  return <fieldset className="space-y-3 border-t border-border pt-3">
    <legend className="text-xs font-semibold text-text">Electricity &amp; API comparison prices</legend>
    <p className="text-[10px] text-muted">Used in Fleet Energy. One comparison tariff for all models; enter every price in the same currency. Blank = not configured; zero = free.</p>
    <label className="block text-xs text-muted">
      Currency code
      <input aria-label="Currency code" className="mt-1 w-full rounded border border-border bg-surface-elevated p-2 text-text"
        value={value.currency} maxLength={3} placeholder="USD"
        onChange={(e) => onChange({ ...value, currency: e.target.value.replace(/[^a-z]/gi, "").toUpperCase() })} />
    </label>
    {FIELDS.map(([key, label]) => <label key={key} className="block text-xs text-muted">
      {label} ({value.currency || "currency"})
      <input type="number" min={0} max={1e9} step="any" inputMode="decimal" aria-label={label}
        className="mt-1 w-full rounded border border-border bg-surface-elevated p-2 text-text"
        value={value[key] ?? ""} placeholder="Not configured"
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange({ ...value, [key]: null });
          else if (Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 1e9) onChange({ ...value, [key]: Number(raw) });
        }} />
    </label>)}
    <p className="text-[10px] text-muted">Current rates reprice the selected history. Estimates exclude hardware, cooling outside the measured fleet, taxes, and other fees.</p>
  </fieldset>;
}
