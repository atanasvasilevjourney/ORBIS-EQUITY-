export type PosturePillars = {
  trend: number;
  breadth: number;
  leadership: number;
  participation: number;
  vol: number;
  heat_cap_pct?: number;
  guidance?: string;
};

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px] font-terminal tracking-wider">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span style={{ color }}>{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--gauge-track)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </div>
    </div>
  );
}

function barColor(v: number): string {
  if (v >= 60) return "var(--accent-bull)";
  if (v <= 40) return "var(--accent-bear)";
  return "var(--accent-warning)";
}

export function PostureBreakdown({ pillars }: { pillars: PosturePillars | null | undefined }) {
  if (!pillars) return null;
  return (
    <div className="space-y-2 mt-3">
      <Bar label="TREND" value={pillars.trend} color={barColor(pillars.trend)} />
      <Bar label="BREADTH" value={pillars.breadth} color={barColor(pillars.breadth)} />
      <Bar label="LEADERSHIP" value={pillars.leadership} color={barColor(pillars.leadership)} />
      <Bar label="ON LIST" value={pillars.participation} color="var(--accent-info)" />
      <Bar label="VOL (NEUTRAL)" value={pillars.vol} color="var(--text-muted)" />
      {pillars.heat_cap_pct != null && (
        <p className="text-[10px] font-terminal text-[var(--text-secondary)] pt-1">
          Suggested heat cap {pillars.heat_cap_pct}%
          {pillars.guidance ? ` · ${pillars.guidance}` : ""}
        </p>
      )}
    </div>
  );
}
