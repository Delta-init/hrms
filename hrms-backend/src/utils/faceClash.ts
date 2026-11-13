/**
 * Deciding whether a new face is too close to somebody already enrolled.
 *
 * The question that matters is the kiosk's, not "are these two alike": once
 * both are enrolled, will a frame of either person score clearly higher
 * against their own captures than against the other's? The kiosk punches only
 * when the top score clears the threshold AND beats the runner-up by its
 * margin, so two people who are merely alike — 0.38 against each other while
 * each matches themselves at 0.9 — are told apart every time.
 *
 * The rule this replaced refused anything 0.35 or more against anyone, which
 * turned away a new joiner (Althaf Noushad, 2026-11-13) whose face sat in that
 * band against one of the two Midlajs. Refusing was also the less safe answer:
 * an unenrolled look-alike is the one person the kiosk can mistake for the
 * enrolled one, because there is nobody else for the frame to match.
 */

/**
 * How much less a kiosk frame on another day matches somebody's enrolment than
 * the enrolment captures — taken seconds apart, same light — match each other.
 * Added to the kiosk's own margin so the gap is judged with room to spare.
 */
export const KIOSK_DRIFT = 0.15;

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * How alike the new captures are to each other — the worst pair, so the
 * estimate of "how much this person looks like themselves" is the cautious one.
 * Null with fewer than two captures, where there is nothing to compare.
 */
export function selfSimilarity(embeddings: number[][]): number | null {
  let worst: number | null = null;
  for (let i = 0; i < embeddings.length; i += 1) {
    for (let j = i + 1; j < embeddings.length; j += 1) {
      const s = cosine(embeddings[i]!, embeddings[j]!);
      worst = worst === null ? s : Math.min(worst, s);
    }
  }
  return worst;
}

export type ClashVerdict =
  /** Nowhere near anybody. */
  | "clear"
  /** Alike, but the person matches themselves by far more than the kiosk needs. */
  | "separable"
  /** Scores as the other person — usually the wrong account open. */
  | "same_person"
  /** Too close for the kiosk to tell apart. */
  | "too_similar";

export function judgeClash(input: {
  /** Best score of the new captures against the closest other person. */
  clash: number;
  /** selfSimilarity of the new captures. */
  self: number | null;
  /** The kiosk's minimum score to match. */
  threshold: number;
  /** The kiosk's minimum lead over the runner-up. */
  margin: number;
  /** How far under the threshold a score starts counting as a clash. */
  band: number;
}): ClashVerdict {
  const { clash, self, threshold, margin, band } = input;
  if (clash < threshold - band) return "clear";
  // The epsilon is for float subtraction (0.6 - 0.4 is 0.19999…), not leniency.
  if (self !== null && self - clash >= margin + KIOSK_DRIFT - 1e-9) return "separable";
  return clash >= threshold ? "same_person" : "too_similar";
}
