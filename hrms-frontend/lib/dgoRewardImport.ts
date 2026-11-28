import type { DgoRewardInput } from "@/types";

/**
 * Rewards from a spreadsheet (2026-11-28: "dgo rewards need to add from the sheet"). The columns are the Add reward
 * form's own labels — Name, Description, Category, Photo, Price in points, What it costs us (AED), Stock, Buy one for
 * each redemption — in any order, any case. Each row is checked here the way the form checks it, and saved through
 * the same endpoint, so the server checks it again.
 *
 * A blank cost is filled with what the points are worth (40,000 points at AED 0.05 = AED 2,000), marked so on the
 * preview and changeable before saving: with "buy one for each redemption" on, a blank cost would send finance a
 * purchase request for AED 0. A photo named in the sheet can't come with it — it's uploaded on the reward afterwards.
 */

export interface ImportRow {
  /** Row number as in the spreadsheet (header is row 1). */
  line: number;
  input: DgoRewardInput;
  /** Why it can't be saved; null when it can. */
  problem: string | null;
  /** A reward of that name is already in the catalogue: skipped. */
  duplicate: boolean;
  costFromPoints: boolean;
  /** Photo file named in the sheet, which isn't brought in. */
  photoName: string | null;
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const COLUMNS: Record<string, keyof typeof FIELD> = {
  "name": "name",
  "description": "description",
  "category": "category",
  "photo": "photo",
  "price in points": "points",
  "points": "points",
  "what it costs us aed": "cost",
  "what it costs us": "cost",
  "cost aed": "cost",
  "cost": "cost",
  "stock": "stock",
  "buy one for each redemption": "buy",
};
const FIELD = { name: 0, description: 0, category: 0, photo: 0, points: 0, cost: 0, stock: 0, buy: 0 };
type Field = keyof typeof FIELD;

const text = (v: unknown) => (v == null ? "" : String(v).trim());
const number = (v: unknown): number | null => {
  if (v == null || text(v) === "") return null;
  const n = typeof v === "number" ? v : Number(text(v).replace(/,/g, "").replace(/^aed\s*/i, ""));
  return Number.isFinite(n) ? n : NaN;
};

export function readRewardRows(
  rows: Record<string, unknown>[],
  o: { minRedemption: number; pointValueAed: number; existingNames: string[] },
): ImportRow[] {
  const existing = new Set(o.existingNames.map(norm));
  const seen = new Set<string>();
  const out: ImportRow[] = [];
  rows.forEach((raw, i) => {
    const f: Partial<Record<Field, unknown>> = {};
    for (const [k, v] of Object.entries(raw)) {
      const field = COLUMNS[norm(k)];
      if (field && f[field] === undefined) f[field] = v;
    }
    if (Object.values(f).every((v) => text(v) === "")) return; // blank line

    const name = text(f.name);
    const category = text(f.category);
    const points = number(f.points);
    let cost = number(f.cost);
    const costFromPoints = cost === null && points != null && Number.isInteger(points);
    if (costFromPoints) cost = Math.round(points! * o.pointValueAed * 100) / 100;

    const stockText = norm(f.stock);
    const stockNum = number(f.stock);
    const limited = stockText !== "" && !/^(no limit|unlimited|none)$/.test(stockText);
    const buyText = norm(f.buy);
    const buy = /^(yes|y|true|1)$/.test(buyText) ? true : /^(no|n|false|0)$/.test(buyText) ? false : undefined;

    const problem =
      name.length < 2 ? "No name"
        : name.length > 80 ? "Name longer than 80 letters"
          : category.length < 2 ? "No category"
            : category.length > 40 ? "Category longer than 40 letters"
              : text(f.description).length > 500 ? "Description longer than 500 letters"
                : points == null || !Number.isInteger(points) ? "Price in points isn't a whole number"
                  : points < o.minRedemption ? `Price under the ${o.minRedemption.toLocaleString("en-US")}-point minimum`
                    : cost !== null && !(cost >= 0) ? "Cost isn't a number"
                      : limited && (stockNum == null || !Number.isInteger(stockNum) || stockNum < 0) ? "Stock is neither \"No limit\" nor a number"
                        : buyText !== "" && buy === undefined ? "\"Buy one for each redemption\" isn't Yes or No"
                          : seen.has(norm(name)) ? "Twice in the sheet"
                            : null;
    seen.add(norm(name));

    out.push({
      line: i + 2,
      input: {
        name, description: text(f.description), category, photoKey: null,
        points: points ?? 0, costAed: cost, stockMode: limited ? "limited" : "unlimited", stock: limited ? stockNum : null,
        status: "hidden",
        buyPerRedemption: buy ?? (cost ?? 0) > 0,
      },
      problem,
      duplicate: existing.has(norm(name)),
      costFromPoints,
      photoName: text(f.photo) || null,
    });
  });
  return out;
}

/** The first sheet of an .xlsx/.xls/.csv file as rows keyed by its header row. */
export async function readSheet(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return ws ? XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null }) : [];
}
