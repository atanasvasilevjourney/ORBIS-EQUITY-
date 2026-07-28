type BiasChipProps = {
  state: 1 | 0 | -1;
  rank: number;
};

function getLabel(state: number, rank: number) {
  if (state === 0) return "NEUTRAL";
  if (state === 1) return rank >= 70 ? "BULLISH" : "SLIGHT BULL";
  return rank >= 70 ? "BEARISH" : "SLIGHT BEAR";
}

function getColor(state: number) {
  if (state === 1) return "var(--accent-bull)";
  if (state === -1) return "var(--accent-bear)";
  return "var(--accent-neutral)";
}

export function BiasChip({ state, rank }: BiasChipProps) {
  const label = getLabel(state, rank);
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
