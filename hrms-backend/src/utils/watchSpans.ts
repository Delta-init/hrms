/**
 * Which parts of a video somebody has actually watched.
 *
 * Kept as stretches of seconds — sorted, never overlapping — rather than a
 * running total. A total counted the same part every time it was played, so it
 * could read "100%" for somebody who had never got past the first minute, and
 * nothing in it said how far they had got. Stretches answer both: what they
 * add up to is how much of the video has been seen, once, and where the last
 * one ends is the furthest point reached.
 */

export interface Span {
  from: number;
  to: number;
}

/** `spans` with `from`–`to` added. Stretches that overlap or touch become one. */
export function addSpan(spans: Span[], from: number, to: number): Span[] {
  const all = spans.map((s) => ({ from: s.from, to: s.to }));
  if (to > from) all.push({ from, to });
  all.sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push(s);
  }
  return out;
}

/** Seconds of the video seen, each counted once. */
export const coveredSeconds = (spans: Span[]): number => spans.reduce((n, s) => n + (s.to - s.from), 0);

/** The furthest point they have played to. */
export const furthestReached = (spans: Span[]): number => spans.reduce((n, s) => Math.max(n, s.to), 0);

/**
 * Where the first part they have not seen begins, before `until` — ignoring
 * gaps of `min` seconds or less. Null when there is none.
 */
export function firstGap(spans: Span[], until: number, min = 0): number | null {
  let at = 0;
  for (const s of spans) {
    if (at >= until) return null;
    if (s.from - at > min) return at;
    at = Math.max(at, s.to);
  }
  return until - at > min ? at : null;
}

/**
 * The stretch one heartbeat shows was played.
 *
 * Between two beats the playhead went from `last` to `position` while
 * `elapsed` seconds passed. If the clock accounts for the move, all of it was
 * watched. If not, it jumped, and only the seconds just before where it landed
 * can have been played — so only those count, and `outran` says it happened.
 * Going backwards plays nothing.
 */
export function playedSpan(last: number, position: number, elapsed: number, grace: number): (Span & { outran: boolean }) | null {
  const advance = position - last;
  if (advance <= 0) return null;
  const allowed = Math.max(0, elapsed + grace);
  return advance <= allowed
    ? { from: last, to: position, outran: false }
    : { from: position - allowed, to: position, outran: true };
}
