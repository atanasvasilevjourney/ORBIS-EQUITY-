type BiasChipProps = {
  state: 1 | 0 | -1;
  rank: number;
  entryTiming?: string | null;
};

function getLabel(state: number, entryTiming?: string | null) {
  if (entryTiming === "hot") return "HOT";
  if (entryTiming === "watch" || state === 1) return "WATCH";
  if (state === -1) return "OFF";
  return "UP";
}

function getColor(state: number) {
  if (state === 1) return "var(--accent-bull)";
  if (state === -1) return "var(--accent-bear)";
  return "var(--accent-neutral)";
}

export function BiasChip({ state, rank, entryTiming }: BiasChipProps) {
  const label = getLabel(state, entryTiming);
  const color = getColor(state);

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-terminal font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
    >
      {label} {rank}
    </span>
  );
}
