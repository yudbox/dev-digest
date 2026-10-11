/** Pure display formatters for the stats screens. */

export function formatUsd(value: number | null | undefined, digits = 2): string {
  return value == null ? "—" : `$${value.toFixed(digits)}`;
}

/** 16000 → "16k", 950 → "950", null → "—". */
export function formatTokens(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(value);
}

/** Milliseconds → "6.2s"; null → "—". */
export function formatSeconds(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = ms / 1000;
  return `${s >= 10 ? s.toFixed(0) : s.toFixed(1).replace(/\.0$/, "")}s`;
}

/** "4m ago", "2h ago", "3d ago"; "just now" under a minute. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Local "YYYY-MM-DD HH:mm" in the given zone (run-history timestamp column). */
export function formatTimestamp(iso: string, tz: string): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const get = (type: string) => f.formatToParts(new Date(iso)).find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** accepted/resolved → "75% (30/40)"; no decisions → "—". */
export function formatAccept(accepted: number, resolved: number): string {
  if (resolved <= 0) return "—";
  return `${Math.round((accepted / resolved) * 100)}% (${accepted}/${resolved})`;
}
