import { describe, expect, it } from "vitest";
import { tagEarningsHeadlines } from "@/lib/earningsCalendar";
import type { BriefNewsItem } from "@/lib/briefNews";
import {
  calendarDates,
  eventsFromDesk,
  eventsFromNasdaq,
  mergeEarnings,
  parseUsd,
  summarizeEarnings,
} from "@/lib/earningsCalendar";

const headline = (ticker: string, title: string): BriefNewsItem => ({
  id: title,
  headline: title,
  source: "Yahoo",
  url: `https://example.com/${title}`,
  publishedAt: null,
  ticker,
  tone: null,
  origin: "yahoo",
});

describe("earnings calendar", () => {
  it("parses dollar prints, including losses", () => {
    expect(parseUsd("$1.68")).toBe(1.68);
    expect(parseUsd("($0.12)")).toBe(-0.12);
    expect(parseUsd("N/A")).toBeNull();
  });

  it("turns a reported Nasdaq row into a beat and an upcoming row into an estimate", () => {
    const reported = eventsFromNasdaq("2026-10-30", [
      {
        symbol: "XOM",
        name: "Exxon",
        eps: "$4.23",
        epsForecast: "$3.90",
        surprise: "8.46",
        marketCap: "$100",
      },
    ]);
    const upcoming = eventsFromNasdaq("2026-11-03", [
      { symbol: "amd", name: "Advanced Micro Devices", epsForecast: "$1.68", marketCap: "$10" },
    ]);
    expect(reported[0]).toMatchObject({
      ticker: "XOM",
      confirmed: true,
      epsActual: 4.23,
      surprisePct: 8.46,
      source: "nasdaq",
    });
    expect(upcoming[0]).toMatchObject({ ticker: "AMD", confirmed: false, epsEst: 1.68 });
    const summary = summarizeEarnings([...reported, ...upcoming], "2026-11-03");
    expect(summary.beats).toBe(1);
    expect(summary.misses).toBe(0);
    expect(summary.upcoming).toBe(1);
    expect(summary.source).toBe("nasdaq");
  });

  it("keeps the desk row when Nasdaq repeats the same print", () => {
    const desk = eventsFromDesk([
      {
        ticker: "AAPL",
        event_date: "2026-10-30",
        confirmed: true,
        eps_est: 1.5,
        eps_actual: 1.7,
        surprise_pct: 13.3,
      },
    ]);
    const merged = mergeEarnings(
      desk,
      eventsFromNasdaq("2026-10-30", [{ symbol: "AAPL", eps: "$1.00", epsForecast: "$1.00", surprise: "0" }])
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].surprisePct).toBe(13.3);
    expect(merged[0].source).toBe("desk");
  });

  it("builds a session window that skips the weekend", () => {
    expect(calendarDates("2026-11-01", 1, 1)).toEqual(["2026-10-30", "2026-11-02", "2026-11-03"]);
  });

  it("keeps a past row without an actual out of the upcoming count", () => {
    const summary = summarizeEarnings(
      [
        {
          ticker: "OLD",
          name: null,
          eventDate: "2026-10-27",
          confirmed: false,
          epsEst: 1,
          epsActual: null,
          surprisePct: null,
          marketCap: 9_000_000_000,
          revenueEst: null,
          revenueActual: null,
          source: "nasdaq",
        },
        {
          ticker: "AMD",
          name: "AMD",
          eventDate: "2026-11-03",
          confirmed: false,
          epsEst: 1.68,
          epsActual: null,
          surprisePct: null,
          marketCap: 80_000_000_000,
          revenueEst: null,
          revenueActual: null,
          source: "nasdaq",
        },
      ],
      "2026-11-03"
    );
    expect(summary.upcoming).toBe(1);
    expect(summary.reported).toBe(1);
  });

  it("puts the earnings name ahead of a general headline", () => {
    const ranked = tagEarningsHeadlines(
      [headline("SPY", "Futures steady"), headline("AMD", "AMD reports after the close")],
      ["AMD"]
    );
    expect(ranked.map((row) => row.ticker)).toEqual(["AMD", "SPY"]);
    expect(ranked[0].badge).toBe("earnings");
    expect(ranked[1].badge).toBeUndefined();
  });
});
