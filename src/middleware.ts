import { NextRequest, NextResponse } from "next/server";

/**
 * Protect all /api/* routes with a shared API secret.
 * Clients must send the header: x-api-key: <API_SECRET>
 *
 * If API_SECRET is not configured, middleware is permissive (dev mode).
 */
export function middleware(req: NextRequest) {
  const secret = process.env.API_SECRET;

  // If no API_SECRET is set, skip auth (development mode)
  if (!secret) {
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
