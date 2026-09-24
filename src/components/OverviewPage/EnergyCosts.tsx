import { useState } from "react";
import type { FleetEnergy } from "../../api/types";
import { calculateEnergyCosts, normalizeEnergyPricing, type EnergyPricing } from "../../shared/energyPricing";
import { formatTokensCompact } from "../../shared/tokenFormat";

export function EnergyCosts({ data, pricing }: { data: FleetEnergy | null; pricing?: EnergyPricing }) {
  const [range, setRange] = useState<"24h" | "31d">("24h");
  const window = data?.membershipChanged ? null : range === "24h" ? data?.accounting24h : data?.accounting31d;
  const rates = normalizeEnergyPricing(pricing);
  const costs = calculateEnergyCosts(window, rates);
  const money = (n: number | null) => n == null ? "—" : `${rates.currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  return <div className="mt-4 border-t border-border pt-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold text-text-strong">Power cost &amp; API savings</h3>
      <select aria-label="Energy cost time range" value={range} onChange={(e) => setRange(e.target.value as "24h" | "31d")}
        className="rounded border border-border bg-surface-elevated p-1 text-xs text-text">
        <option value="24h">Last 24 hours</option><option value="31d">Last 31 days</option>
      </select>
    </div>
    <p className="mt-1 text-[10px] text-muted">Matched power + token coverage: {((window?.coverageMs ?? 0) / 3_600_000).toFixed(2)} / {range === "24h" ? 24 : 744} hours.
      Includes idle power during matched intervals; unobserved periods are excluded.</p>
    {!window && <p role="status" className="mt-2 text-xs text-warning">Waiting for matched telemetry: all fleet nodes and exactly one head endpoint with input, cached-input, and output counters. Older energy history cannot be backfilled.</p>}
    {[rates.electricityPerKwh, rates.inputPerMillion, rates.cachedInputPerMillion, rates.outputPerMillion].some((v) => v == null) &&
      <p className="mt-2 text-xs text-muted">Enter electricity and token comparison prices in Settings to calculate costs and savings.</p>}
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div><div className="text-[10px] text-muted">Electricity cost</div><strong className="font-tabular text-sm">{money(costs.powerCost)}</strong></div>
      <div title="All matched fleet electricity cost divided by generated tokens in millions, including prefill and idle power."><div className="text-[10px] text-muted">Power / M output tokens</div><strong className="font-tabular text-sm">{money(costs.effectivePerMillionOutput)}</strong></div>
      <div><div className="text-[10px] text-muted">Equivalent API cost</div><strong className="font-tabular text-sm">{money(costs.apiCost)}</strong></div>
      <div><div className="text-[10px] text-muted">Savings after electricity</div><strong className={`font-tabular text-sm${costs.savings != null && costs.savings < 0 ? " text-warning" : ""}`}>{money(costs.savings)}</strong></div>
    </div>
    {window && <p className="mt-2 text-[10px] text-muted">Priced usage: {formatTokensCompact(window.promptTokens - window.cachedTokens)} uncached input · {formatTokensCompact(window.cachedTokens)} cached input · {formatTokensCompact(window.outputTokens)} output · {window.energyKwh.toFixed(4)} kWh.</p>}
    <p className="mt-2 text-[10px] text-muted">Estimated, not wall-metered. API cost = uncached input × input rate + cached input × cached rate + output × output rate (rates per million). Negative savings mean electricity exceeded the comparison API cost. No hardware or other costs included.</p>
  </div>;
}
