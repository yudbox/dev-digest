import type { StatsQuery, StatsWindow } from "@devdigest/shared";
import { BadRequestError } from "../../platform/errors.js";
import { RUN_PAGE_DEFAULT, RUN_PAGE_MAX } from "./constants.js";
import { decodeCursor, type RunCursor } from "./cursor.js";
import { resolveWindow } from "./window.js";

/**
 * Strict parsing of the (deliberately permissive) stats querystring. Route
 * schemas accept any optional strings so that a bad value reaches this code and
 * becomes a 400 `bad_request`, not the framework's 422 validation error.
 */

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function parseInstant(name: string, value: string): Date {
  if (!ISO_INSTANT.test(value)) throw new BadRequestError(`\`${name}\` must be an ISO-8601 instant`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new BadRequestError(`\`${name}\` is not a valid date`);
  return new Date(ms);
}

/** Resolve the stats window from the request, or throw 400. */
export function parseStatsQuery(raw: StatsQuery, now: Date = new Date()): StatsWindow {
  const tz = raw.tz?.trim();
  if (!tz) throw new BadRequestError("`tz` (IANA time zone) is required");

  const hasRange = raw.range !== undefined;
  const hasFrom = raw.from !== undefined;
  const hasTo = raw.to !== undefined;

  if (hasRange && (hasFrom || hasTo)) {
    throw new BadRequestError("Provide either `range` or `from`/`to`, not both");
  }
  if (hasRange) {
    if (raw.range !== "1d" && raw.range !== "30d") {
      throw new BadRequestError("`range` must be '1d' or '30d'");
    }
    return resolveWindow({ kind: raw.range }, tz, now);
  }
  if (hasFrom && hasTo) {
    return resolveWindow(
      { kind: "custom", from: parseInstant("from", raw.from!), to: parseInstant("to", raw.to!) },
      tz,
      now,
    );
  }
  throw new BadRequestError("Provide `range` or both `from` and `to`");
}

export interface PageQuery {
  limit: number;
  cursor: RunCursor | null;
}

/** Run-history paging: limit 1..50 (default 10) and an opaque cursor. */
export function parsePageQuery(raw: StatsQuery): PageQuery {
  let limit = RUN_PAGE_DEFAULT;
  if (raw.limit !== undefined) {
    if (!/^\d+$/.test(raw.limit)) throw new BadRequestError("`limit` must be an integer");
    limit = Number(raw.limit);
    if (limit < 1 || limit > RUN_PAGE_MAX) {
      throw new BadRequestError(`\`limit\` must be between 1 and ${RUN_PAGE_MAX}`);
    }
  }
  return { limit, cursor: raw.cursor ? decodeCursor(raw.cursor) : null };
}
