import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dial } from "./ui";

/**
 * The dial is the one control here that is drawn rather than composed, so it is the one that can
 * silently stop being a slider. These check the two things that would make it unusable without
 * looking broken: that it is a real range input underneath (keyboard, screen readers, and the
 * hardware bindings all depend on that) and that the ring is drawn from the same value it reports.
 */
let root: Root | null = null;
let host: HTMLDivElement | null = null;

const render = (ui: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(ui); });
  return host;
};

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null; host = null;
});

const input = (el: HTMLElement) => el.querySelector("input[type=range]") as HTMLInputElement;

describe("Dial", () => {
  it("is a real range input, not a drawing that looks like one", () => {
    const el = render(<Dial label="Volume" value={0.5} onChange={() => {}} />);
    const range = input(el);
    expect(range).toBeTruthy();
    expect(range.getAttribute("aria-label")).toBe("Volume");
    expect(range.min).toBe("0");
    expect(range.max).toBe("1");
    expect(range.value).toBe("0.5");
  });

  it("reports its reading as text, so it is not announced as a bare number", () => {
    const el = render(<Dial label="Reverb" value={0.25} getValue={v => `${Math.round(v * 100)}%`} onChange={() => {}} />);
    expect(input(el).getAttribute("aria-valuetext")).toBe("25%");
    expect(el.textContent).toContain("25%");
  });

  it("passes the new value up when it is moved", () => {
    const onChange = vi.fn();
    const el = render(<Dial label="Volume" value={0.5} onChange={onChange} />);
    const range = input(el);
    act(() => {
      // React keeps its own copy of the value, so a plain assignment looks like no change at all
      // and the handler never runs. Going through the prototype setter is what a real edit does.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(range, "0.75");
      range.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(0.75);
  });

  it("draws more ring the higher it is set, from the same value it reports", () => {
    const ratio = (value: number) => {
      const el = render(<Dial label="Volume" value={value} onChange={() => {}} />);
      const fill = el.querySelector(".dial__fill") as SVGCircleElement;
      const drawn = Number((fill.getAttribute("stroke-dasharray") || "0").split(" ")[0]);
      act(() => { root!.unmount(); });
      host!.remove();
      return drawn;
    };
    const low = ratio(0.1);
    const mid = ratio(0.5);
    const high = ratio(0.9);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(ratio(0)).toBe(0);
  });

  it("honours a range that does not start at zero, which the tone controls need", () => {
    // Bass, mids and treble run -12..12, so a dial that assumed 0..1 would sit pinned at one end.
    const el = render(<Dial label="Bass" value={0} minValue={-12} maxValue={12} step={0.5} onChange={() => {}} />);
    const range = input(el);
    expect(range.min).toBe("-12");
    expect(range.max).toBe("12");
    const fill = el.querySelector(".dial__fill") as SVGCircleElement;
    const total = el.querySelector(".dial__track") as SVGCircleElement;
    const drawn = Number((fill.getAttribute("stroke-dasharray") || "0").split(" ")[0]);
    const whole = Number((total.getAttribute("stroke-dasharray") || "0").split(" ")[0]);
    // Flat is the middle of the sweep, not the start of it.
    expect(drawn).toBeGreaterThan(whole * 0.4);
    expect(drawn).toBeLessThan(whole * 0.6);
  });

  it("can be switched off without losing its label", () => {
    const el = render(<Dial label="Speed" value={1} isDisabled onChange={() => {}} />);
    expect(input(el).disabled).toBe(true);
    expect(el.textContent).toContain("Speed");
  });
});
