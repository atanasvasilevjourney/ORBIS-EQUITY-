import { describe, expect, it } from "vitest";
import { dedupeNews, deskNewsFromRows, newsSource, yahooNewsItems } from "@/lib/briefNews";

describe("brief news", () => {
  it("keeps desk headlines ahead of a repeated Yahoo link", () => {
    const desk = deskNewsFromRows([
      {
        id: 3,
        ticker: "nvda",
        published_at: "2026-11-02T15:00:00Z",
        source: "Reuters",
        headline: "Chip demand holds",
        url: "https://example.com/nvda",
        tone: 1.4,
      },
      { id: 4, headline: "", url: "https://example.com/empty" },
    ]);
    const live = yahooNewsItems({
      news: [
        {
          uuid: "abc",
          title: "Chip demand holds",
          publisher: "Yahoo",
          link: "https://example.com/nvda",
          providerPublishTime: 1793627040,
          relatedTickers: ["NVDA"],
        },
        {
          uuid: "def",
          title: "Futures steady",
          publisher: "Bloomberg",
          link: "https://example.com/futures",
          providerPublishTime: 1793620000,
          relatedTickers: ["SPY"],
        },
      ],
    });
    const rows = dedupeNews([...desk, ...live], 6);
    expect(rows.map((row) => row.origin)).toEqual(["desk", "yahoo"]);
    expect(rows[0].ticker).toBe("NVDA");
    expect(rows[0].tone).toBe(1.4);
    expect(rows[1].headline).toBe("Futures steady");
    expect(newsSource(rows)).toBe("mixed");
  });

  it("drops links that are not http", () => {
    const rows = yahooNewsItems({
      news: [{ uuid: "x", title: "Note", publisher: "Desk", link: "javascript:alert(1)" }],
    });
    expect(rows[0].url).toBeNull();
    expect(newsSource([])).toBe("none");
  });
});
