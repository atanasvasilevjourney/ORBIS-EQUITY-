import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/paginate";
import { evaluateFreshness, lastExpectedEodDate, nyCalendarDate } from "@/lib/freshness";

type PipelineRunRow = {
  run_id: string;
  source: string;
  status: string;
  row_counts: Record<string, unknown> | null;
  asof_date: string | null;
  started_at: string;
  finished_at: string | null;
  headline: string | null;
  error: string | null;
};

export type ModuleStatus = {
  source: string;
  status: string;
  asOfDate: string | null;
  startedAt: string;
  finishedAt: string | null;
  headline: string | null;
  error: string | null;
  rowCounts: Record<string, unknown> | null;
};

export type TriangleDeskHealth = {
  migrationApplied: boolean;
  asOfDate: string | null;
  names: number | null;
  headline: string | null;
};

export type SystemStatus = {
  nowNy: string;
  expectedEodDate: string;
  pricesAsOf: string | null;
  dailyBriefAsOf: string | null;
  loopAsOf: string | null;
  freshness: ReturnType<typeof evaluateFreshness>;
  modules: ModuleStatus[];
  ingestRuns: { module: string; asof_date: string | null; headline: string | null }[];
  triangleDesk: TriangleDeskHealth;
};

export async function buildSystemStatus(sb: SupabaseClient): Promise<SystemStatus> {
  const [priceRow, brief, loopRun, pipelineRuns, ingestRuns, triangleRun] = await Promise.all([
    sb.from("prices_daily").select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("daily_brief").select("asof_date").order("asof_date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("paper_loop_runs").select("asof_date").order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    fetchAll<PipelineRunRow>(
      sb,
      "pipeline_runs",
      "run_id, source, status, row_counts, asof_date, started_at, finished_at, headline, error",
      (q) => q.order("started_at", { ascending: false })
    ).catch(() => [] as PipelineRunRow[]),
    fetchAll<{ module: string; asof_date: string | null; headline: string | null }>(
      sb,
      "ingest_runs",
      "module, asof_date, headline, started_at",
      (q) => q.order("started_at", { ascending: false })
    ).catch(() => []),
    (async () => {
      try {
        return await sb
          .from("triangle_scan_runs")
          .select("asof_date, names, headline")
          .order("asof_date", { ascending: false })
          .limit(1)
          .maybeSingle();
      } catch {
        return { data: null, error: { message: "triangle_scan_runs unavailable" } };
      }
    })(),
  ]);

  const pricesAsOf = priceRow.data?.date?.slice?.(0, 10) ?? (priceRow.data?.date as string | null) ?? null;
  const dailyBriefAsOf = brief.data?.asof_date?.slice?.(0, 10) ?? null;
  const loopAsOf = loopRun.data?.asof_date?.slice?.(0, 10) ?? null;

  const latestBySource = new Map<string, PipelineRunRow>();
  for (const r of pipelineRuns) {
    if (!latestBySource.has(r.source)) latestBySource.set(r.source, r);
  }

  const modules: ModuleStatus[] = Array.from(latestBySource.values()).map((r) => ({
    source: r.source,
    status: r.status,
    asOfDate: r.asof_date?.slice(0, 10) ?? null,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    headline: r.headline,
    error: r.error,
    rowCounts: r.row_counts,
  }));

  const freshness = evaluateFreshness(dailyBriefAsOf ?? loopAsOf, pricesAsOf);

  const ingestLatest = new Map<string, { module: string; asof_date: string | null; headline: string | null }>();
  for (const r of ingestRuns) {
    if (!ingestLatest.has(r.module)) ingestLatest.set(r.module, r);
  }

  const triErr = triangleRun.error;
  const triData = triangleRun.data;
  const triangleDesk: TriangleDeskHealth = {
    migrationApplied: !triErr,
    asOfDate: triData?.asof_date?.slice?.(0, 10) ?? (triData?.asof_date as string | null) ?? null,
    names: triData?.names ?? null,
    headline: triData?.headline ?? null,
  };

  return {
    nowNy: nyCalendarDate(),
    expectedEodDate: lastExpectedEodDate(),
    pricesAsOf,
    dailyBriefAsOf,
    loopAsOf,
    freshness,
    modules: modules.sort((a, b) => a.source.localeCompare(b.source)),
    ingestRuns: Array.from(ingestLatest.values()).slice(0, 12),
    triangleDesk,
  };
}
