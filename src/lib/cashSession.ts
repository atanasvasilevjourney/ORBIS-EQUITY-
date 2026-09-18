/** America/New_York cash-session clock — paper watch, not a broker clock. */

export type SessionPhase =
  | "WEEKEND"
  | "OVERNIGHT"
  | "PREMARKET"
  | "REGULAR"
  | "AFTERHOURS"
  | "CLOSED";

export type CashClock = {
  phase: SessionPhase;
  et: string;
  weekday: string;
  minutes: number;
  minsToOpen: number | null;
  next: string;
  watchOvernight: boolean;
};

const NY = "America/New_York";

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

export function cashClock(nowMs = Date.now()): CashClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const weekday = part(parts, "weekday");
  const hour = Number(part(parts, "hour"));
  const minute = Number(part(parts, "minute"));
  const minutes = hour * 60 + minute;
  const et = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`;
  const weekend = weekday === "Sat" || weekday === "Sun";

  if (weekend) {
    return {
      phase: "WEEKEND",
      et,
      weekday,
      minutes,
      minsToOpen: null,
      next: "Mon 09:30 ET cash open",
      watchOvernight: false,
    };
  }

  const open = 9 * 60 + 30;
  let phase: SessionPhase;
  if (minutes < 4 * 60) phase = "OVERNIGHT";
  else if (minutes < open) phase = "PREMARKET";
  else if (minutes < 16 * 60) phase = "REGULAR";
  else if (minutes < 20 * 60) phase = "AFTERHOURS";
  else phase = "CLOSED";

  const minsToOpen = minutes < open ? open - minutes : null;
  const next =
    phase === "PREMARKET" || phase === "OVERNIGHT"
      ? `cash open 09:30 ET${minsToOpen != null ? ` · ${minsToOpen}m` : ""}`
      : phase === "REGULAR"
        ? "OR window 09:30–09:45 · cash close 16:00 ET"
        : phase === "AFTERHOURS"
          ? "AH until 20:00 ET"
          : "next cash open 09:30 ET";

  return {
    phase,
    et,
    weekday,
    minutes,
    minsToOpen,
    next,
    watchOvernight: phase === "OVERNIGHT" || phase === "PREMARKET" || phase === "AFTERHOURS",
  };
}

export function overnightWatchStep(clock: CashClock): number {
  if (clock.phase === "WEEKEND" || clock.phase === "CLOSED") return 0;
  if (clock.phase === "OVERNIGHT" || (clock.phase === "PREMARKET" && clock.minutes < 9 * 60 + 25)) return 1;
  if (clock.phase === "PREMARKET") return 2;
  if (clock.phase === "REGULAR" && clock.minutes < 9 * 60 + 45) return 3;
  if (clock.phase === "REGULAR") return 4;
  return 1;
}
