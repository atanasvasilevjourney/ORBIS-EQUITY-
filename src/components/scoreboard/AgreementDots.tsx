type AgreementDotsProps = {
  signals: boolean[];
};

export function AgreementDots({ signals }: AgreementDotsProps) {
  return (
    <span className="inline-flex gap-0.5 items-center">
      {signals.map((lit, i) => (
        <span
          key={i}
          className="inline-block w-2.5 h-2.5 rounded-full border"
          style={{
            backgroundColor: lit ? "var(--accent-bull)" : "transparent",
            borderColor: lit ? "var(--accent-bull)" : "var(--text-muted)",
          }}
        />
      ))}
    </span>
  );
}
