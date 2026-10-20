export type ApiAuthDecision = "allow" | "unauthorized";

export type ApiAuthInput = {
  secret: string | undefined;
  isProduction: boolean;
  secFetchSite: string | null;
  apiKey: string | null;
};

const BROWSER_SITES = new Set(["same-origin", "same-site", "none"]);

/**
 * `Sec-Fetch-Site` is set by browsers and is how our own UI is recognised, but any
 * non-browser client can send it. It keeps the UI working without a login; it is not
 * a security boundary. With no secret in production, anything that does not claim to
 * be a browser fetch is refused instead of being served openly.
 */
export function decideApiAccess(input: ApiAuthInput): ApiAuthDecision {
  const browser = input.secFetchSite !== null && BROWSER_SITES.has(input.secFetchSite);

  if (!input.secret) {
    if (!input.isProduction) return "allow";
    return browser ? "allow" : "unauthorized";
  }

  if (browser) return "allow";
  return input.apiKey === input.secret ? "allow" : "unauthorized";
}
