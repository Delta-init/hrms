import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/**
 * A letter as a PDF: the issuing company across the top, the date, a subject
 * line, then the body — the same plain text a letter template holds, with
 * blank lines as paragraph breaks. Laid out like the printed letters, so an
 * offer sent by email and one printed from Letters look alike.
 *
 * The standard fonts only cover Western European text. Anything outside that
 * is swapped for its nearest plain form (₹ → Rs., curly quotes → straight) or
 * dropped, rather than failing the whole letter over one character.
 */
export async function letterPdf(input: { issuer: string; date: string; subject: string; body: string; footer?: string }): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.subject || "Letter");
  doc.setCreator(input.issuer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28, H = 841.89, M = 56;
  const width = W - M * 2;
  const indigo = rgb(0.31, 0.27, 0.9), slate = rgb(0.06, 0.09, 0.16), grey = rgb(0.39, 0.45, 0.55);

  let page = doc.addPage([W, H]);
  let y = H - M;

  const head = () => {
    page.drawText(clean(input.issuer, bold), { x: M, y: y - 16, size: 16, font: bold, color: indigo });
    const date = clean(input.date, font);
    page.drawText(date, { x: W - M - font.widthOfTextAtSize(date, 10), y: y - 14, size: 10, font, color: grey });
    y -= 28;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: indigo });
    y -= 30;
  };
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const line = (text: string, f: PDFFont, size: number, gap: number) => {
    if (y - size < M + 30) newPage();
    page.drawText(text, { x: M, y: y - size, size, font: f, color: slate });
    y -= size + gap;
  };

  head();
  if (input.subject) {
    for (const l of wrap(clean(input.subject, bold), bold, 12, width)) line(l, bold, 12, 4);
    y -= 12;
  }
  for (const para of input.body.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    for (const raw of para.split("\n")) {
      const text = clean(raw, font);
      if (!text.trim()) { y -= 8; continue; }
      for (const l of wrap(text, font, 11, width)) line(l, font, 11, 5);
    }
    y -= 9;
  }

  const footer = clean(input.footer ?? `${input.issuer} · system-generated letter`, font);
  for (const p of doc.getPages()) {
    p.drawText(footer, { x: (W - font.widthOfTextAtSize(footer, 8)) / 2, y: 28, size: 8, font, color: grey });
  }
  return Buffer.from(await doc.save());
}

const SWAPS: Record<string, string> = {
  "₹": "Rs.", "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "•": "-", "\t": "    ", " ": " ",
};

/** Text the font can draw: known swaps first, then anything it cannot encode dropped. */
function clean(text: string, font: PDFFont): string {
  let out = "";
  for (const ch of text) {
    const swapped = SWAPS[ch] ?? ch;
    try {
      font.encodeText(swapped);
      out += swapped;
    } catch {
      /* not in the font — left out */
    }
  }
  return out;
}

/** Break one line of text into lines that fit `width`, at spaces where it can. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/(\s+)/)) {
    const next = cur + word;
    if (font.widthOfTextAtSize(next, size) <= width) { cur = next; continue; }
    if (cur.trim()) out.push(cur.trimEnd());
    cur = word.trimStart();
    // A single word wider than the line — broken by characters.
    while (font.widthOfTextAtSize(cur, size) > width) {
      let i = cur.length;
      while (i > 1 && font.widthOfTextAtSize(cur.slice(0, i), size) > width) i--;
      out.push(cur.slice(0, i));
      cur = cur.slice(i);
    }
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out;
}
