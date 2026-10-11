import { BadRequestError } from "../../platform/errors.js";

/**
 * Run-history cursor: base64url of `<ran_at ISO>|<run id>`. The pair is the
 * sort key (ran_at DESC, id DESC) of the last row of the previous page, so a
 * run created meanwhile can neither duplicate nor skip a row. Opaque to clients.
 */

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RunCursor {
  /** Full-precision (microsecond) UTC ISO string as produced by the repository. */
  ranAt: string;
  id: string;
}

export function encodeCursor(c: RunCursor): string {
  return Buffer.from(`${c.ranAt}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): RunCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw new BadRequestError("Invalid cursor");
  }
  const sep = decoded.indexOf("|");
  const ranAt = sep === -1 ? "" : decoded.slice(0, sep);
  const id = sep === -1 ? "" : decoded.slice(sep + 1);
  if (!ISO.test(ranAt) || !UUID.test(id) || Number.isNaN(Date.parse(ranAt))) {
    throw new BadRequestError("Invalid cursor");
  }
  return { ranAt, id };
}
