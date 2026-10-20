import { NextRequest, NextResponse } from "next/server";
import { decideApiAccess } from "@/lib/apiAuth";

/**
 * Protect external /api/* access with a shared API secret.
 * Browser fetches from our UI are recognised via Sec-Fetch-Site.
 *
 * External clients must send: x-api-key: <API_SECRET>
 */
export function middleware(req: NextRequest) {
  const decision = decideApiAccess({
    secret: process.env.API_SECRET,
    isProduction: process.env.NODE_ENV === "production",
    secFetchSite: req.headers.get("sec-fetch-site"),
    apiKey: req.headers.get("x-api-key"),
  });

  if (decision === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
