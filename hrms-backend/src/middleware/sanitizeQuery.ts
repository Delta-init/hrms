import type { Request, Response, NextFunction } from "express";

/** Keys Mongo would interpret as operators or as a nested-path selector. */
const isOperatorKey = (k: string) => k.startsWith("$") || k.includes(".");

/**
 * Depth cap bounds work on adversarially nested input. Express's `qs` parser
 * defaults to depth 5, so this is comfortably above anything it will produce.
 */
const MAX_DEPTH = 10;

/**
 * Recursively delete operator keys in place. Returns true when this value was
 * emptied by the scrub, so the caller can drop the now-meaningless container:
 * `?status[$ne]=x` would otherwise leave `status: {}`, which is truthy and
 * reaches Mongo as an uncastable filter instead of simply being absent.
 */
function scrub(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (const item of value) scrub(item, depth + 1);
    return false;
  }
  const obj = value as Record<string, unknown>;
  let removedAny = false;
  for (const key of Object.keys(obj)) {
    if (isOperatorKey(key)) {
      delete obj[key];
      removedAny = true;
      continue;
    }
    if (scrub(obj[key], depth + 1)) {
      delete obj[key];
      removedAny = true;
    }
  }
  return removedAny && Object.keys(obj).length === 0;
}

/**
 * Strip Mongo operators out of request input.
 *
 * Express parses `?status[$ne]=approved` into `{status: {$ne: "approved"}}`,
 * and services assign query values straight into Mongo filters — TypeScript's
 * `req.query as Record<string, string>` is a compile-time assertion with no
 * runtime effect. Without this, a caller can smuggle real query operators past
 * the intended filter.
 *
 * Mutates in place rather than reassigning `req.query`, which is a getter-only
 * property from Express 5 onward.
 */
export const sanitizeQuery = (req: Request, _res: Response, next: NextFunction): void => {
  scrub(req.query);
  scrub(req.body);
  scrub(req.params);
  next();
};
