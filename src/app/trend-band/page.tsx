import { redirect } from "next/navigation";

export default function TrendBandRedirectPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const q = new URLSearchParams();
  q.set("view", "pullback");
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === "view") continue;
    if (typeof v === "string") q.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
  }
  redirect(`/ema200?${q.toString()}`);
}