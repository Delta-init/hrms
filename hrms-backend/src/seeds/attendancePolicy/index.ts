import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { AttendancePenaltyPolicy } from "../../models/AttendancePenaltyPolicy.js";
import { computeLatePenaltyDays } from "../../services/attendancePenaltyService.js";

/**
 * Switch on the attendance rules.
 *
 * Three late arrivals a month are free; every one after that costs half a day
 * of pay, and it keeps costing — the fourth is half a day, the fifth a full
 * day, and so on. Three attendance corrections a month go through as normal;
 * the fourth onward cannot be approved by anybody except the person's own
 * reporting manager.
 *
 * Dry by default, because this is the one setting in the system that takes
 * money off a payslip. `--apply` writes it.
 *
 * `unrecordedDaysUnpaid` is deliberately left alone. A working day with no
 * attendance record usually means nobody ran attendance that day rather than
 * that somebody stayed home, and with the register as sparse as it currently
 * is, turning that on would dock almost everybody for a gap in the data.
 *
 *   bun src/seeds/attendancePolicy/index.ts
 *   bun src/seeds/attendancePolicy/index.ts --apply
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";

const WANT = {
  enabled: true,
  graceLates: Number(arg("grace") ?? 3),
  lateBlockSize: Number(arg("block") ?? 1),
  monthlyRegularizationLimit: Number(arg("corrections") ?? 3),
};

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 58 - s.length))}`); };

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).lean();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);

  log(`Organisation : ${org.name}`);
  log(`Mode         : ${APPLY ? "APPLY — this writes" : "DRY RUN — nothing is written"}`);

  const before = await AttendancePenaltyPolicy.findOne({ organization: org._id }).lean();

  head("Setting");
  const rows: Array<[string, unknown, unknown]> = [
    ["Penalties enabled", before?.enabled ?? false, WANT.enabled],
    ["Grace lates / month", before?.graceLates ?? 3, WANT.graceLates],
    ["Lates per half-day", before?.lateBlockSize ?? 3, WANT.lateBlockSize],
    ["Corrections / month", (before as { monthlyRegularizationLimit?: number } | null)?.monthlyRegularizationLimit ?? "(unset)", WANT.monthlyRegularizationLimit],
    ["Unrecorded days unpaid", before?.unrecordedDaysUnpaid ?? false, "unchanged"],
  ];
  log(`  ${"".padEnd(24)} ${"now".padEnd(12)} ${APPLY ? "becomes" : "would become"}`);
  for (const [label, from, to] of rows) {
    const changed = String(from) !== String(to) && to !== "unchanged";
    log(`  ${label.padEnd(24)} ${String(from).padEnd(12)} ${String(to)}${changed ? "   ←" : ""}`);
  }

  head("What that costs");
  log(`  lates : ` + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => String(n).padStart(5)).join(""));
  log(`  cut   : ` + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((n) => String(computeLatePenaltyDays(n, { ...WANT } as never)).padStart(5)).join(""));
  log(`\n  Three free, then half a day for every late after that.`);

  if (!APPLY) {
    head("Nothing was written");
    log(`  re-run with --apply to switch this on`);
    await mongoose.disconnect();
    return;
  }

  await AttendancePenaltyPolicy.findOneAndUpdate(
    { organization: org._id },
    { $set: WANT, $setOnInsert: { organization: org._id } },
    { upsert: true, new: true }
  );

  const after = await AttendancePenaltyPolicy.findOne({ organization: org._id }).lean();
  head("Applied");
  log(`  enabled=${after?.enabled} grace=${after?.graceLates} block=${after?.lateBlockSize} corrections=${(after as { monthlyRegularizationLimit?: number } | null)?.monthlyRegularizationLimit}`);
  log(`  unrecordedDaysUnpaid left at ${after?.unrecordedDaysUnpaid} — untouched`);
  log();
  log(`  To undo: Work Schedules → attendance penalties → switch Enabled off,`);
  log(`  or: bun src/seeds/attendancePolicy/index.ts --apply --grace=3 --block=3`);
  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
