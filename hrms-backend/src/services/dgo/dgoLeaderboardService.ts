import { DgoLedgerEntry } from "../../models/DgoLedgerEntry.js";
import { Employee } from "../../models/Employee.js";
import { Department } from "../../models/Department.js";
import { publicUrl } from "../uploadService.js";
import { ELITE_RULE_PREFIX } from "./dgoDefaults.js";
import { dayIn, isMonth } from "./dgoMath.js";
import { httpError } from "./dgoErrors.js";
import { programSettings } from "./dgoSettingsService.js";
import { assertCanUse, isObjectId, isOpen, oid, seesWholeLeaderboard, type DgoViewer } from "./dgoAccess.js";

/**
 * The points leaderboard: everyday points earned in a month (credits less
 * reversals dated in it), monthly achiever prizes left out so one prize can't
 * bury everybody's month.
 *
 * Who sees what is the program's setting — everyone, own department, or only
 * managers — and DGO staff always see every department. A head always sees the
 * departments they head (once DGO is open). Everyone always sees their own line.
 */

const NOTE = "Everyday points earned in the month: points credited less points taken back. Monthly achiever prizes aren't counted here.";

export async function leaderboard(v: DgoViewer, q: { month?: string; department?: string }) {
  await assertCanUse(v);
  const thisMonth = dayIn(v.tz).slice(0, 7);
  const month = q.month && isMonth(q.month) && q.month <= thisMonth ? q.month : thisMonth;
  const program = await programSettings(v.orgId);
  const visibility = program.leaderboardVisibility;
  const staff = seesWholeLeaderboard(v);
  const heads = (await isOpen(v.orgId)) ? v.headOf : [];
  const ownDept = v.employee?.department ?? null;

  // Departments this viewer may look at: null = all of them.
  let allowed: string[] | null;
  if (staff || visibility === "everyone") allowed = null;
  else if (visibility === "department") allowed = [...new Set([...(ownDept ? [ownDept] : []), ...heads])];
  else allowed = [...heads];

  const scope: "company" | "department" | "own" = allowed === null ? "company" : allowed.length ? "department" : "own";
  let department: string | null = null;
  if (q.department && isObjectId(q.department)) {
    if (allowed !== null && !allowed.includes(q.department)) throw httpError("You can't see that department's ranking", 403);
    department = q.department;
  } else if (allowed !== null && allowed.length) {
    department = ownDept && allowed.includes(ownDept) ? ownDept : allowed[0];
  }

  const deptList = allowed === null
    ? await Department.find({ organization: v.orgId }).select("name").sort({ name: 1 }).lean<Array<{ _id: unknown; name: string }>>()
    : allowed.length ? await Department.find({ _id: { $in: allowed } }).select("name").sort({ name: 1 }).lean<Array<{ _id: unknown; name: string }>>() : [];
  const deptName = new Map(deptList.map((d) => [String(d._id), d.name]));

  // Everyone's month, then narrowed: the viewer's own rank is counted against the same set they see.
  const sums = await DgoLedgerEntry.aggregate<{ _id: unknown; p: number }>([
    { $match: { organization: oid(v.orgId), month, type: { $in: ["credit", "reverse"] }, ruleCode: { $not: new RegExp(`^${ELITE_RULE_PREFIX}`) } } },
    { $group: { _id: "$employee", p: { $sum: "$delta" } } },
    { $match: { p: { $gt: 0 } } },
  ]);
  const ids = sums.map((s) => s._id);
  const people = ids.length
    ? await Employee.find({ _id: { $in: ids } }).select("name department photo").lean<Array<{ _id: unknown; name: string; department?: unknown; photo?: string }>>()
    : [];
  const byId = new Map(people.map((p) => [String(p._id), p]));
  if (allowed === null && people.some((p) => p.department && !deptName.has(String(p.department)))) {
    const more = await Department.find({ _id: { $in: people.map((p) => p.department).filter(Boolean) } }).select("name").lean<Array<{ _id: unknown; name: string }>>();
    for (const d of more) deptName.set(String(d._id), d.name);
  }

  const inView = (empDept: unknown) => (department ? String(empDept ?? "") === department : allowed === null);
  const lines = sums
    .map((s) => ({ id: String(s._id), points: s.p, emp: byId.get(String(s._id)) }))
    .filter((l) => l.emp && inView(l.emp.department))
    .sort((a, b) => b.points - a.points || a.emp!.name.localeCompare(b.emp!.name));

  // Ties share a rank (1, 1, 3).
  let rank = 0;
  let last: number | null = null;
  const ranked = lines.map((l, i) => {
    if (l.points !== last) { rank = i + 1; last = l.points; }
    return { ...l, rank };
  });
  const meId = v.employee?._id ?? null;
  let mine: { rank: number; points: number } | undefined = meId ? ranked.find((l) => l.id === meId) : undefined;
  const myPoints = meId ? sums.find((s) => String(s._id) === meId)?.p ?? 0 : 0;
  if (scope === "own" && meId && myPoints > 0) {
    // Only your own line is shown, ranked against everybody.
    mine = { rank: sums.filter((s) => s.p > myPoints).length + 1, points: myPoints };
  }

  const visible = scope === "own" ? [] : ranked.slice(0, 100);
  return {
    month,
    visibility,
    scope,
    departments: allowed === null ? deptList.map((d) => ({ id: String(d._id), name: d.name })) : allowed.length > 1 ? deptList.map((d) => ({ id: String(d._id), name: d.name })) : [],
    department,
    rows: visible.map((l) => ({
      rank: l.rank,
      employeeId: l.id,
      name: l.emp!.name,
      department: l.emp!.department ? deptName.get(String(l.emp!.department)) ?? null : null,
      points: l.points,
      photoUrl: l.emp!.photo ? publicUrl(l.emp!.photo) : null,
      me: l.id === meId,
    })),
    me: meId ? { rank: mine?.rank ?? null, points: mine?.points ?? myPoints, of: scope === "own" ? sums.length : ranked.length } : null,
    note: NOTE,
  };
}
