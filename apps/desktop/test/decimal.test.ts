import { describe, expect, it } from "vitest";
import {
  canonicalDecimal,
  isMultipleOf,
  notional,
  parseDecimal,
  validateContractStep,
  validateOrderInput,
} from "../src/lib/decimal";

describe("exact decimal input validation", () => {
  it("normalizes without binary floating point", () => {
    const value = parseDecimal("002.5000");
    expect(value).toEqual({ digits: "25", scale: 1 });
    expect(canonicalDecimal(value)).toBe("2.5");
    expect(isMultipleOf(value, parseDecimal("0.5"))).toBe(true);
    expect(isMultipleOf(value, parseDecimal("0.04"))).toBe(false);
  });

  it("rejects exponent, signs and malformed decimals", () => {
    for (const input of ["1e3", "-1", "+1", "1.", ".5", "1.2.3", "NaN", "１"]) {
      expect(() => parseDecimal(input)).toThrow();
    }
  });

  it("handles values beyond Number.MAX_SAFE_INTEGER", () => {
    const big = "99999999999999999999999999999999999999";
    const value = parseDecimal(big);
    expect(value.digits).toBe(big);
    expect(isMultipleOf(value, parseDecimal("0.01"))).toBe(true);
  });

  it("validates contract steps and order limits", () => {
    expect(
      validateContractStep(parseDecimal("153.22"), "0.01", "价格"),
    ).toBeNull();
    expect(
      validateContractStep(parseDecimal("153.221"), "0.01", "价格"),
    ).toContain("步进");
    expect(
      validateOrderInput({
        quantity: "100",
        price: "153.22",
        priceIncrement: "0.01",
        sizeIncrement: "1",
        pricePrecision: 2,
      }),
    ).toEqual([]);
    expect(
      validateOrderInput({
        quantity: "1.5",
        price: "153.221",
        priceIncrement: "0.01",
        sizeIncrement: "1",
        pricePrecision: 2,
      }).length,
    ).toBeGreaterThan(0);
  });

  it("computes a display notional with BigInt-backed decimal multiplication", () => {
    expect(notional("101", "153.22")).toBe("15475.22");
    expect(notional("0.1", "0.2")).toBe("0.02");
    expect(notional("bad", "1")).toBeNull();
  });
});
