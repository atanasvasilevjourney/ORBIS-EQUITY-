import { describe, expect, it } from "vitest";
import { forecastFill, rungsFromForecast } from "@/lib/carverDesk";

describe("carver desk", () => {
  it("unlocks a rung at each forecast edge", () => {
    expect(rungsFromForecast(4.9)).toBe(0);
    expect(rungsFromForecast(5)).toBe(1);
    expect(rungsFromForecast(-10)).toBe(2);
    expect(rungsFromForecast(15)).toBe(3);
    expect(rungsFromForecast(20)).toBe(4);
    expect(rungsFromForecast(null)).toBe(0);
  });

  it("fills the forecast bar against the ±20 cap", () => {
    expect(forecastFill(10)).toBe(50);
    expect(forecastFill(-20)).toBe(100);
    expect(forecastFill(0)).toBe(0);
  });
});
