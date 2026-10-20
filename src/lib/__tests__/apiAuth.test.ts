import { describe, expect, it } from "vitest";
import { decideApiAccess } from "@/lib/apiAuth";

const base = { secret: "s3cret", isProduction: true, secFetchSite: null, apiKey: null };

describe("decideApiAccess", () => {
  it("accepts the right key from a non-browser client", () => {
    expect(decideApiAccess({ ...base, apiKey: "s3cret" })).toBe("allow");
  });

  it("rejects a wrong or missing key from a non-browser client", () => {
    expect(decideApiAccess({ ...base, apiKey: "nope" })).toBe("unauthorized");
    expect(decideApiAccess(base)).toBe("unauthorized");
  });

  it("rejects cross-site browser requests without a key", () => {
    expect(decideApiAccess({ ...base, secFetchSite: "cross-site" })).toBe("unauthorized");
  });

  it("lets the UI through via same-origin fetches", () => {
    expect(decideApiAccess({ ...base, secFetchSite: "same-origin" })).toBe("allow");
  });

  it("with no secret in production, refuses clients that do not look like a browser", () => {
    const open = { ...base, secret: undefined };
    expect(decideApiAccess(open)).toBe("unauthorized");
    expect(decideApiAccess({ ...open, secFetchSite: "cross-site" })).toBe("unauthorized");
    expect(decideApiAccess({ ...open, secFetchSite: "same-origin" })).toBe("allow");
  });

  it("with no secret outside production, stays open for local dev and tests", () => {
    expect(
      decideApiAccess({ ...base, secret: undefined, isProduction: false })
    ).toBe("allow");
  });
});
