import { createRequire } from "node:module";

/**
 * Where a piece of text sits on a page.
 *
 * The agreements are flat PDFs — no form fields, nothing to fill — so the only
 * way to put a signature on the signature line is to find the words "Signature:"
 * and draw beside them. Coordinates are returned in pdf-lib's space, measured
 * from the bottom-left, because that is what the caller draws in.
 */
export interface TextHit {
  /** Zero-based, as pdf-lib indexes pages. */
  pageIndex: number;
  text: string;
  /** Left edge and baseline of the matched run, from the bottom-left. */
  x: number;
  y: number;
  /** Right edge, so a value can be placed after the label. */
  xEnd: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

/**
 * Every text run on every page, positioned.
 *
 * pdfjs is loaded through createRequire and the legacy build: it ships as ESM
 * with a browser-first entry point, and the Node build is the one that does not
 * reach for a DOM. Loaded lazily so a service that never signs anything does not
 * pay for it at boot.
 */
export async function extractPositionedText(pdf: Buffer): Promise<TextHit[]> {
  const require = createRequire(import.meta.url);
  const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs") as typeof import("pdfjs-dist");

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    // Nothing here renders; this only exists to stop it reaching for system
    // fonts it will never draw with.
    useSystemFonts: false,
  }).promise;

  const hits: TextHit[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      const it = item as { str?: string; transform?: number[]; width?: number; height?: number };
      const str = (it.str ?? "").trim();
      if (!str || !it.transform) continue;
      // transform is [a, b, c, d, e, f]; e and f are the origin, already in
      // PDF user space with y from the bottom — the same space pdf-lib draws in.
      const [, , , , x, y] = it.transform;
      hits.push({
        pageIndex: p - 1,
        text: str,
        x,
        y,
        xEnd: x + (it.width ?? 0),
        height: it.height ?? 10,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      });
    }
  }
  await doc.cleanup();
  return hits;
}

/** Normalised for comparison — case, punctuation and runs of spaces removed. */
const key = (s: string) => s.toLowerCase().replace(/[:\s]+/g, " ").trim().replace(/\s+/g, " ");

/**
 * Find a label, optionally preferring the rightmost match on its line.
 *
 * The NDA signs in two columns — the company on the left, the employee on the
 * right — and both say "Signature:". Taking the first would sign on the
 * company's behalf, so the caller says which side it wants.
 */
/**
 * Matches for a label, exact ones preferred.
 *
 * The prefix fallback exists because a run is sometimes the label and its rule
 * together — "Signature: ______". But it must never win over an exact match:
 * "Date:" would otherwise also match "Date of Joining:", which is a different
 * field, and the signing date landed in it while the real one stayed blank.
 */
function matchesFor(hits: TextHit[], label: string): TextHit[] {
  const want = key(label);
  const exact = hits.filter((h) => key(h.text) === want);
  if (exact.length) return exact;
  return hits.filter((h) => key(h.text).startsWith(`${want} `));
}

/** Every occurrence of a label, earliest page first. */
export function findAllLabels(hits: TextHit[], label: string): TextHit[] {
  return [...matchesFor(hits, label)].sort(
    (a, b) => a.pageIndex - b.pageIndex || b.y - a.y || a.x - b.x
  );
}

export function findLabel(
  hits: TextHit[],
  label: string,
  opts: { preferRight?: boolean; minX?: number; pageIndex?: number } = {}
): TextHit | null {
  let matches = matchesFor(hits, label);
  if (opts.pageIndex !== undefined) matches = matches.filter((h) => h.pageIndex === opts.pageIndex);
  if (opts.minX !== undefined) matches = matches.filter((h) => h.x >= opts.minX!);
  if (!matches.length) return null;
  // Latest page first: a signature block lives at the end of a document, and a
  // phrase like "Name:" also appears in the body of one.
  matches.sort((a, b) => b.pageIndex - a.pageIndex || (opts.preferRight ? b.x - a.x : a.x - b.x));
  return matches[0];
}
