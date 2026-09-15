import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Singleton server-side Supabase client (uses service key for API routes)
let _client: SupabaseClient | null = null;

function looksPlaceholder(url: string, key: string): string | null {
  const host = url.replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase() ?? "";
  if (!url || !key) {
    return "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY";
  }
  if (
    host === "example.supabase.co" ||
    host === "your-project.supabase.co" ||
    host.startsWith("example.")
  ) {
    return `SUPABASE_URL looks like a placeholder (${host}). Set real Supabase credentials on Vercel.`;
  }
  if (key.includes("your_service") || key.endsWith("placeholder") || key.length < 40) {
    return "Supabase key looks like a placeholder. Use the service_role (or anon) key from the Supabase dashboard.";
  }
  return null;
}

export function createServerClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  // Prefer service role; accept dashboard alias; fall back to anon for RLS-only deploys
  const key =
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";
  const bad = looksPlaceholder(url, key);
  if (bad) {
    throw new Error(bad);
  }
  _client = createClient(url, key);
  return _client;
}
