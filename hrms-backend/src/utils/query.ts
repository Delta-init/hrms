/** Regex metacharacters that must be neutralised before user input is used as a pattern. */
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** Longest search term we'll turn into a regex — a cheap ceiling on match cost. */
const MAX_SEARCH_LENGTH = 100;

/**
 * Build a case-insensitive "contains" regex from user input.
 *
 * Search terms arrive straight off the query string, so they are escaped before
 * being compiled: unescaped, a term like `(a+)+$` is a catastrophic-backtracking
 * pattern (ReDoS), and metacharacters silently change which rows match.
 */
export function searchRegex(term: string): RegExp {
  const escaped = String(term).slice(0, MAX_SEARCH_LENGTH).replace(REGEX_SPECIALS, "\\$&");
  return new RegExp(escaped, "i");
}

/**
 * Parse page/limit from a query string.
 *
 * Values are coerced defensively: Express's `qs` parser will happily produce an
 * object for `?limit[$gt]=0`, and `parseInt` on a non-string yields NaN, which
 * flows through Math.min/Math.max unchanged and defeats the page-size cap
 * entirely (the Mongo driver accepts NaN because `typeof NaN === "number"`).
 */
export function parsePagination(
  query: { page?: unknown; limit?: unknown },
  defaultLimit = 20,
  maxLimit = 200
): { page: number; limit: number; skip: number } {
  const page = toPositiveInt(query.page, 1);
  const limit = Math.min(maxLimit, toPositiveInt(query.limit, defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}
