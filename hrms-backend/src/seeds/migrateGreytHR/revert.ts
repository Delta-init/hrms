import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { MigrationJournal, MigrationRun } from "../../models/MigrationJournal.js";

/**
 * Put everything back the way it was.
 *
 * Works from the journal the import wrote, not from guesswork: each entry names
 * one document and holds it as it stood beforehand. `before: null` means the run
 * created it, so reverting deletes it; anything else is restored verbatim.
 *
 * Deleting by tag would not have worked. Two thirds of the import is enrichment
 * of people who already existed, and their previous department, salary and
 * manager live nowhere except that snapshot.
 *
 * Dry by default, like the import.
 *
 *   bun run migrate:greythr:revert                      # list the runs
 *   bun run migrate:greythr:revert -- --run=<id>        # preview the undo
 *   bun run migrate:greythr:revert -- --run=<id> --apply
 */

const args = process.argv.slice(2);
const arg = (k: string): string | undefined =>
  args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const RUN = arg("run");

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`); };

/**
 * The order documents are put back in.
 *
 * Reverse of how they were made: the things that point at employees go first,
 * then the employees, then the reference data they pointed at. Deleting a
 * department while ninety-nine people still reference it leaves the database
 * describing a job that does not exist.
 */
const ORDER = [
  "leaverequests", "leaveadjustments", "salaryincrements",
  "employmenthistories", "resignations",
  "employees", "users",
  "leavepolicies", "workschedules", "departments",
];

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  if (!RUN) {
    head("Import runs");
    const runs = await MigrationRun.find({}).sort({ startedAt: -1 }).limit(20).lean();
    if (!runs.length) {
      log("  None recorded. Nothing has been imported by a version that keeps a journal.");
    }
    for (const r of runs) {
      const entries = await MigrationJournal.countDocuments({ run: r.run });
      log(`  ${r.run}`);
      log(`      ${r.organizationName ?? "—"} · ${entries} documents · ${r.created} created, ${r.updated} changed`);
      log(`      ran ${new Date(r.startedAt as Date).toISOString().slice(0, 19).replace("T", " ")}${r.revertedAt ? `  ALREADY REVERTED ${new Date(r.revertedAt as Date).toISOString().slice(0, 10)}` : ""}`);
    }
    log(`\n  Undo one with:  bun run migrate:greythr:revert -- --run=<id>\n`);
    await mongoose.disconnect();
    return;
  }

  const run = await MigrationRun.findOne({ run: RUN });
  if (!run) throw new Error(`No import run called "${RUN}" — run without --run to list them`);
  if (run.revertedAt && !FORCE) {
    throw new Error(`That run was already reverted on ${new Date(run.revertedAt).toISOString().slice(0, 10)}. Pass --force to do it again.`);
  }

  log(`\n${APPLY ? "REVERTING" : "DRY RUN — nothing will be changed"}`);
  log(`  run          : ${RUN}`);
  log(`  organisation : ${run.organizationName ?? "—"}`);

  const entries = await MigrationJournal.find({ run: RUN }).lean();
  const byColl = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byColl.get(e.collectionName) ?? [];
    list.push(e);
    byColl.set(e.collectionName, list);
  }

  let deleted = 0, restored = 0, missing = 0, changedSince = 0, editedThenDeleted = 0;
  const conflicts: string[] = [];

  const collections = [
    ...ORDER.filter((c) => byColl.has(c)),
    ...[...byColl.keys()].filter((c) => !ORDER.includes(c)),
  ];

  for (const coll of collections) {
    const list = byColl.get(coll) ?? [];
    const db = mongoose.connection.db;
    if (!db) throw new Error("No database connection");
    const c = db.collection(coll);

    let d = 0, r = 0, m = 0, x = 0;
    for (const e of list) {
      const current = await c.findOne({ _id: e.documentId as never });

      if (!e.before) {
        // The run created it. Somebody deleting it since is not a problem — the
        // end state is the same either way.
        if (!current) { m++; continue; }
        // Undoing the import has to remove what the import made, so an edit
        // somebody has since made to one of those records goes with it. That is
        // the only coherent answer, but it is not one to discover afterwards.
        if (
          current.updatedAt instanceof Date && run.finishedAt instanceof Date &&
          current.updatedAt.getTime() > run.finishedAt.getTime()
        ) {
          editedThenDeleted++;
          if (conflicts.length < 12) {
            conflicts.push(`${coll} ${String(e.documentId)} — created by the import and edited since; deleting it loses that edit`);
          }
        }
        d++;
        if (APPLY) await c.deleteOne({ _id: e.documentId as never });
        continue;
      }

      if (!current) {
        // It existed, the run changed it, and it is gone now. Putting it back is
        // still the right answer — the journal holds the whole document.
        r++;
        if (APPLY) await c.insertOne(e.before as never);
        continue;
      }

      // Anything edited since the import is not ours to overwrite. Restoring it
      // would silently throw away work done after the import, which is a worse
      // outcome than an incomplete revert.
      //
      // Compared with no grace period on purpose. `finishedAt` is stamped after
      // the last write, and both timestamps come from the same process clock, so
      // anything later genuinely happened afterwards. An earlier version allowed
      // a second of slack and swallowed an edit made 885ms after the import —
      // which is exactly the edit this guard exists to protect.
      const touchedSince =
        current.updatedAt instanceof Date &&
        run.finishedAt instanceof Date &&
        current.updatedAt.getTime() > run.finishedAt.getTime();

      if (touchedSince && !FORCE) {
        x++;
        if (conflicts.length < 12) {
          conflicts.push(`${coll} ${String(e.documentId)} — changed ${current.updatedAt.toISOString().slice(0, 19).replace("T", " ")}, after the import`);
        }
        continue;
      }
      r++;
      if (APPLY) await c.replaceOne({ _id: e.documentId as never }, e.before as never);
    }

    deleted += d; restored += r; missing += m; changedSince += x;
    log(`  ${coll.padEnd(22)} delete ${String(d).padStart(5)} · restore ${String(r).padStart(5)}` +
        `${m ? ` · already gone ${m}` : ""}${x ? ` · SKIPPED ${x} (edited since)` : ""}`);
  }

  head("Summary");
  log(`  ${deleted} documents to delete`);
  log(`  ${restored} documents to restore to their previous state`);
  if (missing) log(`  ${missing} already gone — nothing to do`);
  if (changedSince) {
    log(`  ${changedSince} left alone because they were edited after the import`);
    log(`      (pass --force to overwrite those too — it discards whatever was done since)`);
  }
  if (editedThenDeleted) {
    log(`  ${editedThenDeleted} of the deletions were edited after the import — that work goes with them`);
  }

  if (conflicts.length) {
    head("Edited since the import");
    for (const c of conflicts) log(`  ! ${c}`);
    if (changedSince > conflicts.length) log(`  … and ${changedSince - conflicts.length} more`);
  }

  if (APPLY) {
    await MigrationRun.updateOne({ run: RUN }, { $set: { revertedAt: new Date() } });
    // The journal is kept. It is the record of what the import did, and a
    // revert is a thing that happened too — deleting it would make the next
    // question ("what did that import actually change?") unanswerable.
    log(`\nReverted. The journal is kept as the record of what happened.\n`);
  } else {
    log(`\nNothing was changed. Re-run with --apply to undo it.\n`);
  }

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error("\nRevert failed:", e instanceof Error ? e.message : e);
  await mongoose.disconnect();
  process.exit(1);
});
