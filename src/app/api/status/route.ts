import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { buildSystemStatus } from "@/lib/systemStatus";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const sb = createServerClient();
    const status = await buildSystemStatus(sb);
    return NextResponse.json(status);
  } catch (err) {
    console.error("Status API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
