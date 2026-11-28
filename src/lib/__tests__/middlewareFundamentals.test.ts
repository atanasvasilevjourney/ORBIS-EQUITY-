import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

describe("middleware fundamentals ticker", () => {
  it("allows GET /api/fundamentals/TICKER without API key", () => {
    const req = new NextRequest("http://localhost/api/fundamentals/AAPL", { method: "GET" });
    const res = middleware(req);
    expect(res.status).not.toBe(401);
  });
});