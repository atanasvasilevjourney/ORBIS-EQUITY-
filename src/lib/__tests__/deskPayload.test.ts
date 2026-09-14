import { describe, expect, it } from "vitest";
import { deskList, parseDesk, pickNamed } from "@/lib/deskPayload";

type Row = { ticker: string };

describe("deskPayload", () => {
  it("does not throw when the API returns { error }", () => {
    const body = { error: "Internal server error" };
    const names = deskList<Row>(body, "names");
    expect(names).toEqual([]);
    expect(parseDesk(body, "names")).toBeNull();
    expect(pickNamed(names, "AAPL")).toBeNull();
    expect(pickNamed(undefined, "AAPL")).toBeNull();
  });

  it("reads a names desk", () => {
    const body = { names: [{ ticker: "MSFT" }, { ticker: "AAPL" }], headline: "ok" };
    expect(parseDesk(body, "names")).toEqual(body);
    expect(pickNamed(deskList<Row>(body, "names"), "AAPL")).toEqual({ ticker: "AAPL" });
  });

  it("reads an ORB watch desk", () => {
    const body = { watch: [{ ticker: "XYZ" }], orders: [] };
    expect(parseDesk(body, "watch")?.watch).toHaveLength(1);
    expect(pickNamed(deskList<Row>(body, "watch"), "NOPE")).toEqual({ ticker: "XYZ" });
  });
});
