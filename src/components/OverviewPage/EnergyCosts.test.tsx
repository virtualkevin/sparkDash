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
    expect([...container.querySelectorAll("strong")].map((el) => el.textContent)).toEqual(["$3.00", "$6.00", "$6.20", "$3.20"]);
    expect(container.textContent).toContain("1.00 / 24 hours");
    expect(container.textContent).toContain("1M cached input");
  });
  it("switches matching windows and shows negative savings, not zero", () => {
    const { container } = render(<EnergyCosts data={data} pricing={pricing} />);
    const select = container.querySelector("select")!;
    act(() => { select.value = "31d"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.textContent).toContain("1.00 / 744 hours");
    expect(container.textContent).toContain("-$23.80");
  });
  it("does not show misleading zero prices for missing rates or unmatched telemetry", () => {
    const unpriced = render(<EnergyCosts data={data} />);
    expect(unpriced.container.textContent).toContain("Enter electricity");
    expect(unpriced.container.textContent).not.toContain("$0.00");
    const unavailable = render(<EnergyCosts data={{ ...data, membershipChanged: true }} pricing={pricing} />);
    expect(unavailable.container.textContent).toContain("Waiting for matched telemetry");
    expect(unavailable.container.textContent).not.toContain("$3.20");
  });
  it("rounds every monetary value to exactly two decimal places", () => {
    const { container } = render(<EnergyCosts data={data} pricing={{ ...pricing, electricityPerKwh: 0.01049 }} />);
    expect([...container.querySelectorAll("strong")].map((el) => el.textContent)).toEqual(["$0.10", "$0.21", "$6.20", "$6.10"]);
  });
  it("uses the selected currency and keeps zero values at two decimals", () => {
    const { container } = render(<EnergyCosts data={data} pricing={{ ...pricing, currency: "EUR", electricityPerKwh: 0 }} />);
    expect([...container.querySelectorAll("strong")].map((el) => el.textContent)).toEqual(["€0.00", "€0.00", "€6.20", "€6.20"]);
  });
});
