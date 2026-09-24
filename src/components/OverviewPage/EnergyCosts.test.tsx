import { act } from "react";
import { describe, expect, it } from "vitest";
import { render } from "../../testing/render";
import type { FleetEnergy } from "../../api/types";
import { EnergyCosts } from "./EnergyCosts";

const pricing = { currency: "USD", electricityPerKwh: 0.3, inputPerMillion: 2, cachedInputPerMillion: 0.2, outputPerMillion: 8 };
const window = { energyKwh: 10, coverageMs: 3_600_000, promptTokens: 2e6, cachedTokens: 1e6, outputTokens: 0.5e6 };
const data = { membershipChanged: false, accounting24h: window,
  accounting31d: { ...window, energyKwh: 100 } } as FleetEnergy;

describe("EnergyCosts", () => {
  it("displays effective generated-token costs and net savings using separate cached pricing", () => {
    const { container } = render(<EnergyCosts data={data} pricing={pricing} />);
    expect(container.textContent).toContain("USD 3.00");
    expect(container.textContent).toContain("USD 6.00");
    expect(container.textContent).toContain("USD 6.20");
    expect(container.textContent).toContain("USD 3.20");
    expect(container.textContent).toContain("1.00 / 24 hours");
    expect(container.textContent).toContain("1M cached input");
  });
  it("switches matching windows and shows negative savings, not zero", () => {
    const { container } = render(<EnergyCosts data={data} pricing={pricing} />);
    const select = container.querySelector("select")!;
    act(() => { select.value = "31d"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.textContent).toContain("1.00 / 744 hours");
    expect(container.textContent).toContain("USD -23.80");
  });
  it("does not show misleading zero prices for missing rates or unmatched telemetry", () => {
    const unpriced = render(<EnergyCosts data={data} />);
    expect(unpriced.container.textContent).toContain("Enter electricity");
    expect(unpriced.container.textContent).not.toContain("USD 0.00");
    const unavailable = render(<EnergyCosts data={{ ...data, membershipChanged: true }} pricing={pricing} />);
    expect(unavailable.container.textContent).toContain("Waiting for matched telemetry");
    expect(unavailable.container.textContent).not.toContain("USD 3.20");
  });
});
