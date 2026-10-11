import type { StatsBucket, StatsWindow } from "@devdigest/shared";

/**
 * Global stats period (Agent Performance, Agent Stats, Skill Stats share it).
 * Pure helpers — no React. The server owns window resolution; the client only
 * stores the user's choice and turns it into a request.
 *
 * Custom ranges hold calendar DATES (`YYYY-MM-DD`, inclusive), at most 30 days.
 */

export const MAX_PERIOD_DAYS = 30;
export const PERIOD_STORAGE_KEY = "dd-period";

export type Period =
  | { kind: "1d" }
  | { kind: "30d" }
  | { kind: "custom"; from: string; to: string };

export const DEFAULT_PERIOD: Period = { kind: "30d" };

/** Translation function shape used by the formatters (next-intl compatible). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` into a UTC-midnight day number, or null when not a real date. */
function dayNumber(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / 86_400_000;
}

/** Inclusive number of calendar days in a custom range, or null when invalid. */
export function customRangeDays(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a === null || b === null || b < a) return null;
  return b - a + 1;
}

export function isValidCustomRange(from: string, to: string): boolean {
  const days = customRangeDays(from, to);
  return days !== null && days <= MAX_PERIOD_DAYS;
}

const toDateString = (dayNum: number): string => new Date(dayNum * 86_400_000).toISOString().slice(0, 10);

/** Latest allowed `to` for a given `from` (30 days max, never in the future). */
export function maxToFor(from: string, today: string): string {
  const a = dayNumber(from);
  const t = dayNumber(today);
  if (a === null || t === null) return today;
  return toDateString(Math.min(a + MAX_PERIOD_DAYS - 1, t));
}

/** Earliest allowed `from` for a given `to` (30 days max). */
export function minFromFor(to: string): string | undefined {
  const b = dayNumber(to);
  return b === null ? undefined : toDateString(b - (MAX_PERIOD_DAYS - 1));
}

/** Default custom range offered when the user picks "Custom range": the last 7 days. */
export function defaultCustomRange(today: string): { from: string; to: string } {
  const t = dayNumber(today);
  return t === null ? { from: today, to: today } : { from: toDateString(t - 6), to: today };
}

/**
 * Keep a custom range valid after the user edits one end: never reversed, never
 * longer than 30 days, never in the future. The edited end wins; the other end
 * moves.
 */
export function adjustRange(
  range: { from: string; to: string },
  edited: "from" | "to",
  today: string,
): { from: string; to: string } {
  let { from, to } = range;
  if (dayNumber(from) === null || dayNumber(to) === null) return { from: today, to: today };
  if (from > today) from = today;
  if (to > today) to = today;
  if (edited === "from") {
    if (to < from) to = from;
    if ((customRangeDays(from, to) ?? 0) > MAX_PERIOD_DAYS) to = maxToFor(from, today);
  } else {
    if (from > to) from = to;
    if ((customRangeDays(from, to) ?? 0) > MAX_PERIOD_DAYS) from = minFromFor(to) ?? from;
  }
  return { from, to };
}

/** Today's date (YYYY-MM-DD) in the user's local time zone. */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Read a stored period. Anything missing, unreadable or invalid — including a
 * custom range longer than 30 days — falls back to the default. A valid PAST
 * custom range is kept as is.
 */
export function parseStoredPeriod(raw: string | null | undefined): Period {
  if (!raw) return DEFAULT_PERIOD;
  try {
    const v = JSON.parse(raw) as { kind?: unknown; from?: unknown; to?: unknown };
    if (v.kind === "1d" || v.kind === "30d") return { kind: v.kind };
    if (v.kind === "custom" && typeof v.from === "string" && typeof v.to === "string") {
      return isValidCustomRange(v.from, v.to) ? { kind: "custom", from: v.from, to: v.to } : DEFAULT_PERIOD;
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_PERIOD;
}

export const serializePeriod = (p: Period): string => JSON.stringify(p);

/** IANA zone of the browser (what the server cuts buckets in). */
export function localTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Query string for the stats endpoints. Presets send `range`; a custom range
 * sends the local-midnight bounds [D1 00:00, D2+1 00:00) as ISO instants. The
 * server caps `to` at "now".
 */
export function periodToQuery(p: Period, tz: string): string {
  const q = new URLSearchParams();
  if (p.kind === "custom") {
    const [fy, fm, fd] = p.from.split("-").map(Number) as [number, number, number];
    const [ty, tm, td] = p.to.split("-").map(Number) as [number, number, number];
    q.set("from", new Date(fy, fm - 1, fd).toISOString());
    q.set("to", new Date(ty, tm - 1, td + 1).toISOString());
  } else {
    q.set("range", p.kind);
  }
  q.set("tz", tz);
  return q.toString();
}

// ---- display ---------------------------------------------------------------

function partsIn(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const get = (type: string) => f.formatToParts(date).find((x) => x.type === type)?.value ?? "";
  return { month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

const fmtDate = (iso: string, tz: string): string => {
  const p = partsIn(new Date(iso), tz);
  return `${p.month} ${p.day}`;
};
const fmtDateTime = (iso: string, tz: string): string => {
  const p = partsIn(new Date(iso), tz);
  return `${p.month} ${p.day} ${p.hour}:${p.minute}`;
};
/** Clock time; midnight at the END of a range reads "24:00". */
const fmtClock = (iso: string, tz: string, asEnd = false): string => {
  const p = partsIn(new Date(iso), tz);
  return asEnd && p.hour === "00" && p.minute === "00" ? "24:00" : `${p.hour}:${p.minute}`;
};

/**
 * Caption shown next to the period selector, e.g. "1 day · Oct 10 16:00 – now".
 * Keys: `stats.caption.oneDay|thirtyDays|custom` (values {from}, {to}).
 */
export function formatWindowCaption(window: StatsWindow, t: Translate): string {
  if (window.kind === "1d") return t("caption.oneDay", { from: fmtDateTime(window.from, window.tz) });
  if (window.kind === "30d") return t("caption.thirtyDays", { from: fmtDate(window.from, window.tz) });
  return t("caption.custom", {
    from: fmtDate(window.from, window.tz),
    to: fmtDate(new Date(new Date(window.to).getTime() - 1).toISOString(), window.tz),
  });
}

/**
 * Tooltip for one bucket (chart bar / sparkline point), with its exact local
 * range, e.g. "H2: Oct 10 20:00–24:00", "W5: Oct 9 12:22 – now, partial".
 * Keys: `stats.bucket.inProgress|partial|now`.
 */
export function formatBucketTooltip(
  bucket: StatsBucket,
  bucketKind: StatsWindow["bucketKind"],
  tz: string,
  t: Translate,
): string {
  const suffix = bucket.partial
    ? ` · ${t(bucketKind === "hour" ? "bucket.inProgress" : "bucket.partial")}`
    : "";
  if (bucketKind === "hour") {
    const day = fmtDate(bucket.start, tz);
    if (bucket.partial) {
      return `${bucket.label}: ${day} ${fmtClock(bucket.start, tz)} – ${t("bucket.now")}${suffix}`;
    }
    return `${bucket.label}: ${day} ${fmtClock(bucket.start, tz)}–${fmtClock(bucket.end, tz, true)}`;
  }
  if (bucketKind === "day") {
    return `${bucket.label}: ${fmtDate(bucket.start, tz)}${suffix}`;
  }
  const end = bucket.partial ? t("bucket.now") : fmtDateTime(bucket.end, tz);
  return `${bucket.label}: ${fmtDateTime(bucket.start, tz)} – ${end}${suffix}`;
}
