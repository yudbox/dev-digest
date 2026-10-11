import type { StatsBucket, StatsWindow } from "@devdigest/shared";
import { BadRequestError } from "../../platform/errors.js";
import { MAX_DAY_BUCKET_DAYS, MAX_PERIOD_DAYS, SLOT_HOURS, SLOTS_PER_DAY } from "./constants.js";

/**
 * Period resolution — the ONE place that turns (preset | from/to, time zone,
 * now) into a window with its buckets and its previous window. Every KPI, table,
 * breakdown and chart of the three stats screens reads this result, so they can
 * never disagree on bounds. Pure: Intl only, no I/O, no library.
 *
 * Rules (spec AC-4…AC-12):
 *  - "30d"  = rolling [now − 30×24h, now); weekly buckets counted from `from`.
 *  - "1d"   = six fixed 4-hour slots aligned to 00/04/08/12/16/20 in the user's
 *             local time; the sixth is the current, incomplete slot.
 *  - custom = [D1 00:00, (D2+1) 00:00) local, capped at `now`, ≤ 30 days:
 *             1 day → H1…H6, 2–14 days → D1…Dn, 15–30 days → W1…Wn.
 *  - buckets are [start, end); empty buckets are returned (zero-filled upstream).
 */

const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/** Wall-clock components in some time zone (month is 1-12). */
interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall-clock reading of an instant in `tz`. */
export function zonedParts(date: Date, tz: string): Wall {
  const parts = formatterFor(tz).formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h: get("hour") % 24,
    mi: get("minute"),
    s: get("second"),
  };
}

/** A wall reading expressed as UTC ms (a pure number line for wall arithmetic). */
function wallMs(w: Wall): number {
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
}

function wallFromMs(ms: number): Wall {
  const d = new Date(ms);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
  };
}

/** Wall-clock arithmetic: add whole hours to a wall reading (no DST involved). */
function addWallHours(w: Wall, hours: number): Wall {
  return wallFromMs(wallMs(w) + hours * MS_HOUR);
}

/** The instant at which `tz` shows the given wall reading. */
export function zonedToUtc(w: Wall, tz: string): Date {
  const target = wallMs(w);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const offset = wallMs(zonedParts(new Date(guess), tz)) - guess;
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** `date` shifted by `n` local days (wall-clock, so DST-safe). */
export function addLocalDays(date: Date, n: number, tz: string): Date {
  return zonedToUtc(addWallHours(zonedParts(date, tz), n * 24), tz);
}

export type WindowRequest =
  | { kind: "1d" }
  | { kind: "30d" }
  | { kind: "custom"; from: Date; to: Date };

const iso = (d: Date) => d.toISOString();

/** Six 4-hour slots of the local day that starts at `dayStart`. */
function hourBuckets(slotStarts: Wall[], tz: string, to: Date): StatsBucket[] {
  return slotStarts.map((startW, i) => {
    const start = zonedToUtc(startW, tz);
    const end = zonedToUtc(addWallHours(startW, SLOT_HOURS), tz);
    return {
      label: `H${i + 1}`,
      start: iso(start),
      end: iso(end),
      partial: start.getTime() < to.getTime() && end.getTime() > to.getTime(),
    };
  });
}

/**
 * Consecutive buckets of `stepDays` local days from `fromW`. The bucket end is
 * clipped to `to` when `to` falls inside it; a bucket that lies entirely after
 * `to` keeps its nominal end and is never "partial".
 */
function spanBuckets(
  fromW: Wall,
  count: number,
  stepDays: number,
  prefix: "D" | "W",
  tz: string,
  to: Date,
): StatsBucket[] {
  const out: StatsBucket[] = [];
  for (let i = 0; i < count; i++) {
    const start = zonedToUtc(addWallHours(fromW, 24 * stepDays * i), tz);
    const nominalEnd = zonedToUtc(addWallHours(fromW, 24 * stepDays * (i + 1)), tz);
    const started = start.getTime() < to.getTime();
    const partial = started && nominalEnd.getTime() > to.getTime();
    out.push({
      label: `${prefix}${i + 1}`,
      start: iso(start),
      end: iso(partial ? to : nominalEnd),
      partial,
    });
  }
  return out;
}

export function resolveWindow(req: WindowRequest, tz: string, now: Date): StatsWindow {
  if (!isValidTimeZone(tz)) throw new BadRequestError(`Invalid time zone: ${tz}`);

  if (req.kind === "30d") {
    const from = new Date(now.getTime() - 30 * MS_DAY);
    // Rolling windows are measured in absolute time, so buckets are too.
    const buckets: StatsBucket[] = [];
    for (let i = 0; i < Math.ceil(30 / 7); i++) {
      const start = new Date(from.getTime() + i * 7 * MS_DAY);
      const nominalEnd = new Date(start.getTime() + 7 * MS_DAY);
      const partial = nominalEnd.getTime() > now.getTime();
      buckets.push({
        label: `W${i + 1}`,
        start: iso(start),
        end: iso(partial ? now : nominalEnd),
        partial,
      });
    }
    return {
      kind: "30d",
      from: iso(from),
      to: iso(now),
      tz,
      days: 30,
      bucketKind: "week",
      buckets,
      previous: { from: iso(new Date(from.getTime() - 30 * MS_DAY)), to: iso(from) },
    };
  }

  if (req.kind === "1d") {
    const nowW = zonedParts(now, tz);
    const currentSlot: Wall = {
      ...nowW,
      h: Math.floor(nowW.h / SLOT_HOURS) * SLOT_HOURS,
      mi: 0,
      s: 0,
    };
    const slotStarts: Wall[] = [];
    for (let k = 0; k < SLOTS_PER_DAY; k++) {
      slotStarts.push(addWallHours(currentSlot, -(SLOTS_PER_DAY - 1 - k) * SLOT_HOURS));
    }
    const from = zonedToUtc(slotStarts[0]!, tz);
    return {
      kind: "1d",
      from: iso(from),
      to: iso(now),
      tz,
      days: 1,
      bucketKind: "hour",
      buckets: hourBuckets(slotStarts, tz, now),
      previous: { from: iso(addLocalDays(from, -1, tz)), to: iso(from) },
    };
  }

  // ---- custom ------------------------------------------------------------
  const { from, to } = req;
  if (!(to.getTime() > from.getTime())) throw new BadRequestError("`to` must be after `from`");
  if (from.getTime() >= now.getTime()) throw new BadRequestError("`from` must not be in the future");

  const fromW = zonedParts(from, tz);
  const wallDiff = wallMs(zonedParts(to, tz)) - wallMs(fromW);
  if (wallDiff > MAX_PERIOD_DAYS * MS_DAY) {
    throw new BadRequestError(`A custom range may span at most ${MAX_PERIOD_DAYS} days`);
  }
  const days = Math.max(1, Math.ceil(wallDiff / MS_DAY));
  const effectiveTo = new Date(Math.min(to.getTime(), now.getTime()));

  let bucketKind: StatsWindow["bucketKind"];
  let buckets: StatsBucket[];
  if (days <= 1) {
    bucketKind = "hour";
    const dayStart: Wall = { ...fromW, h: 0, mi: 0, s: 0 };
    const slotStarts = Array.from({ length: SLOTS_PER_DAY }, (_, k) =>
      addWallHours(dayStart, k * SLOT_HOURS),
    );
    buckets = hourBuckets(slotStarts, tz, effectiveTo);
  } else if (days <= MAX_DAY_BUCKET_DAYS) {
    bucketKind = "day";
    buckets = spanBuckets(fromW, days, 1, "D", tz, effectiveTo);
  } else {
    bucketKind = "week";
    buckets = spanBuckets(fromW, Math.ceil(days / 7), 7, "W", tz, effectiveTo);
  }

  return {
    kind: "custom",
    from: iso(from),
    to: iso(effectiveTo),
    tz,
    days,
    bucketKind,
    buckets,
    previous: { from: iso(addLocalDays(from, -days, tz)), to: iso(from) },
  };
}
