import { describe, expect, it } from "vitest";
import { rateLimitAllowed } from "@/lib/rateLimit";

describe("rateLimitAllowed", () => {
  it("allows up to the limit within a window", () => {
    const key = `test-${Date.now()}`;
    expect(rateLimitAllowed(key, 2, 60_000)).toBe(true);
    expect(rateLimitAllowed(key, 2, 60_000)).toBe(true);
    expect(rateLimitAllowed(key, 2, 60_000)).toBe(false);
  });
});
