import { describe, expect, it } from "vitest";
import { multiSortRows, nextSortLevels } from "@/lib/deskMultiSort";

type Row = { sym: string; day: number; rank: number };

const rows: Row[] = [
  { sym: "A", day: 5, rank: 80 },
  { sym: "B", day: 5, rank: 90 },
  { sym: "C", day: 10, rank: 70 },
];

const acc = {
  sym: (r: Row) => r.sym,
  day: (r: Row) => r.day,
  rank: (r: Row) => r.rank,
};

describe("deskMultiSort", () => {
  it("sorts by single column", () => {
    const out = multiSortRows(rows, [{ key: "day", dir: "desc" }], acc);
    expect(out.map((r) => r.sym)).toEqual(["C", "A", "B"]);
  });

  it("tie-breaks with secondary column", () => {
    const out = multiSortRows(
      rows,
      [{ key: "day", dir: "desc" }, { key: "rank", dir: "desc" }],
      acc
    );
    expect(out.map((r) => r.sym)).toEqual(["C", "B", "A"]);
  });

  it("shift append adds level", () => {
    const next = nextSortLevels([{ key: "day", dir: "desc" }], "rank", { append: true });
    expect(next).toEqual([{ key: "day", dir: "desc" }, { key: "rank", dir: "desc" }]);
  });

  it("plain click replaces stack", () => {
    const next = nextSortLevels(
      [{ key: "day", dir: "desc" }, { key: "rank", dir: "asc" }],
      "sym",
      { append: false }
    );
    expect(next).toEqual([{ key: "sym", dir: "desc" }]);
  });
});
