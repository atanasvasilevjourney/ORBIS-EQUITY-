import { NextRequest, NextResponse } from "next/server";

/**
 * Protect external /api/* access with a shared API secret.
 * Same-origin browser requests (our UI) are exempt via Sec-Fetch-Site.
 *
 * External clients must send: x-api-key: <API_SECRET>
 */
export function middleware(req: NextRequest) {
  const secret = process.env.API_SECRET;

  if (!secret) {
    return NextResponse.next();
  }

  // Same-origin / same-site browser fetches from our UI
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "same-site" || site === "none") {
    return NextResponse.next();
  }

  const token = req.headers.get("x-api-key");
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
