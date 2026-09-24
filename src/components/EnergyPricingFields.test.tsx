import { act, useState } from "react";
import { expect, it } from "vitest";
import { render } from "../testing/render";
import { EnergyPricingFields } from "./EnergyPricingFields";
import { DEFAULT_ENERGY_PRICING } from "../shared/energyPricing";

it("edits prices, preserves zero vs blank, and rejects negative prices", () => {
  function Form() {
    const [value, setValue] = useState({ ...DEFAULT_ENERGY_PRICING });
    return <><EnergyPricingFields value={value} onChange={setValue} /><output>{JSON.stringify(value)}</output></>;
  }
  const { container } = render(<Form />);
  const input = container.querySelector<HTMLInputElement>('[aria-label="Electricity / kWh"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  const change = (value: string) => act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  change("0.25");
  expect(container.querySelector("output")!.textContent).toContain('"electricityPerKwh":0.25');
  change("0");
  expect(container.querySelector("output")!.textContent).toContain('"electricityPerKwh":0,');
  change("-1");
  expect(container.querySelector("output")!.textContent).toContain('"electricityPerKwh":0,');
  change("");
  expect(container.querySelector("output")!.textContent).toContain('"electricityPerKwh":null');
  expect(container.querySelectorAll('input[type="number"]')).toHaveLength(4);
});
