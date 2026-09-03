/**
 * The Kerala public holiday calendar, for staff who work from home.
 *
 * Written for the people it applies to and nobody else. Every holiday in this
 * system used to belong to the whole organisation, which for a Kerala calendar
 * would mean seventy-four people in the Dubai office being paid for days they
 * worked, having their leave requests shortened, and being excused from punches
 * they were expected to make. Each of those is a separate reader, and each one
 * now asks whose calendar a holiday is on.
 *
 * The table below is the source. Next year's list is an edit here rather than a
 * rewrite, which is the point of keeping it in one place.
 *
 *     bun src/seeds/importKeralaHolidays.ts                       # report only
 *     bun src/seeds/importKeralaHolidays.ts --apply
 *     bun src/seeds/importKeralaHolidays.ts --year=2027 --apply
 *     bun src/seeds/importKeralaHolidays.ts --org="Delta Banglore" --apply
 *
 * Safe to re-run: a holiday already present on that date, for that calendar, is
 * left where it is rather than added again.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Holiday } from "../models/Holiday.js";
import { Organization } from "../models/Organization.js";
import { Employee } from "../models/Employee.js";

/**
 * `provisional` marks the dates the source itself says may move.
 *
 * The calendar carries a note that Islamic holidays are subject to moon
 * sighting. Storing that alongside the date is the difference between somebody
 * planning around a fact and planning around a best guess.
 */
const HOLIDAYS_2026: Array<{ date: string; name: string; national?: boolean; provisional?: boolean }> = [
  { date: "01-26", name: "Republic Day", national: true },
  { date: "03-20", name: "Id-Ul-Fitr (Ramzan)", provisional: true },
  { date: "04-03", name: "Good Friday" },
  { date: "04-05", name: "Easter" },
  { date: "04-15", name: "Vishu" },
  { date: "05-01", name: "May Day", national: true },
  { date: "05-27", name: "Id-Ul-Adha (Bakrid)", provisional: true },
  { date: "06-25", name: "Muharram", provisional: true },
  { date: "08-15", name: "Independence Day", national: true },
  { date: "08-25", name: "First Onam" },
  { date: "08-26", name: "Thiruvonam" },
  { date: "08-27", name: "Third Onam" },
  { date: "08-28", name: "Fourth Onam / Sree Narayana Guru Jayanthi / Ayyankali Jayanthi" },
  { date: "09-04", name: "Sree Krishna Jayanthi" },
  { date: "09-21", name: "Sree Narayana Guru Samadhi" },
  { date: "10-02", name: "Gandhi Jayanthi", national: true },
  { date: "10-20", name: "Maha Navami" },
  { date: "10-21", name: "Vijayadasami" },
  { date: "11-08", name: "Deepavali" },
  { date: "12-25", name: "Christmas" },
];

/** Kerala. Stored so the region is on the record rather than only in its name. */
const TIME_ZONE = "Asia/Kolkata";
const WORK_MODE = "wfh" as const;
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const arg = (k: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : undefined;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const year = Number(arg("year") ?? 2026);
  await connectDB();
  console.log(`Kerala ${year}, for work-from-home staff. Mode: ${apply ? "APPLY" : "dry run"}\n`);

  /**
   * One organisation, named, rather than every one with somebody working from home.
   *
   * This is a Kerala calendar, and Kerala is not Karnataka — the Bangalore
   * tenant keeps different regional days, so writing this into it would be
   * wrong in a way nobody would notice until somebody was marked absent on a
   * day their state does not observe. Defaults to the organisation this
   * calendar is for; another has to be asked for by name.
   */
  const wanted = arg("org") ?? "Delta International";
  const all = await Organization.find({ status: "active" }).select("_id name").lean();
  const orgs = all.filter((o) => o.name.toLowerCase().includes(wanted.toLowerCase()));
  const skipped = all.filter((o) => !orgs.includes(o));
  if (!orgs.length) {
    console.log(`No active organisation matching "${wanted}".`);
    console.log(`Available: ${all.map((o) => o.name).join(" | ")}`);
    await mongoose.disconnect();
    return;
  }
  if (skipped.length) {
    console.log(`Not touched (a Kerala calendar is not theirs): ${skipped.map((o) => o.name).join(", ")}\n`);
  }
  for (const org of orgs) {
    const reach = await Employee.countDocuments({
      organization: org._id, status: { $ne: "terminated" }, workMode: WORK_MODE,
    });
    console.log(`━━━ ${org.name} — reaches ${reach} work-from-home employee(s)`);
    if (!reach) {
      console.log("    nobody works from home here, so nothing is added.\n");
      continue;
    }

    let added = 0, present = 0;
    for (const h of HOLIDAYS_2026) {
      const date = new Date(`${year}-${h.date}T00:00:00.000Z`);
      // Matched on the calendar as well as the day: the same date can be a
      // holiday for one group and an ordinary working day for another.
      const exists = await Holiday.findOne({ organization: org._id, date, workMode: WORK_MODE }).lean();
      const dow = DOW[date.getUTCDay()];
      if (exists) {
        present++;
        console.log(`    · ${h.date} ${dow.padEnd(9)} ${h.name} — already there`);
        continue;
      }
      added++;
      console.log(`    + ${h.date} ${dow.padEnd(9)} ${h.name}${h.provisional ? "  (date may move)" : ""}`);
      if (apply) {
        await Holiday.create({
          organization: org._id,
          name: h.name,
          date,
          timeZone: TIME_ZONE,
          type: "public",
          workMode: WORK_MODE,
          provisional: !!h.provisional,
          description: h.provisional
            ? "Set by moon sighting — the date may move. Confirm nearer the time."
            : h.national
              ? "National holiday"
              : "Kerala regional holiday",
        });
      }
    }
    console.log(`    → ${added} to add, ${present} already present\n`);
  }

  if (!apply) console.log("Dry run — re-run with --apply to write them.");
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
