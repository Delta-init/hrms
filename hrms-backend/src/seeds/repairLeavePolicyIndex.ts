import "dotenv/config";
import mongoose from "mongoose";
import { LeavePolicy } from "../models/LeavePolicy.js";
import { env } from "../config/env.js";

/**
 * Replace the leave-policy uniqueness rule with the current one.
 *
 * The rule has widened twice. It was (organization, type), which stopped a
 * second Annual policy existing for another work schedule; then
 * (organization, type, workSchedule), which stops one existing for office or
 * remote staff. Declaring the new index in the schema is not enough: Mongo
 * keeps the old one until it is dropped, and it goes on rejecting the writes —
 * so a work-mode policy fails with a duplicate-key error that names an index
 * nobody remembers creating.
 *
 *   bun src/seeds/repairLeavePolicyIndex.ts          # report only
 *   bun src/seeds/repairLeavePolicyIndex.ts --apply  # swap the index
 *
 * Deliberately unscoped — the index is collection-wide — and safe to re-run:
 * once the old index is gone there is nothing left to drop.
 */
/**
 * Every uniqueness rule this collection has outgrown.
 *
 * Listed rather than inferred: `syncIndexes()` below would drop them anyway,
 * but only under --apply, and a dry run that says "nothing to drop" about an
 * index that is actively rejecting writes is worse than no dry run at all.
 */
const STALE: Array<Record<string, number>> = [
  { organization: 1, type: 1 },
  { organization: 1, type: 1, workSchedule: 1 },
];
const sameKey = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(env.MONGODB_URI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const collection = LeavePolicy.collection;
  const indexes = await collection.indexes();
  console.log("Current indexes:");
  for (const i of indexes) console.log(`  ${i.name}  ${JSON.stringify(i.key)}${i.unique ? "  UNIQUE" : ""}`);

  const stale = indexes.filter(
    (i) => i.unique && STALE.some((k) => sameKey(i.key as Record<string, unknown>, k))
  );
  if (!stale.length) {
    console.log("\nNo superseded unique index — nothing to drop.");
  } else if (!apply) {
    console.log(`\nDry run — re-run with --apply to drop: ${stale.map((i) => `"${i.name}"`).join(", ")}.`);
  } else {
    for (const i of stale) {
      await collection.dropIndex(i.name!);
      console.log(`\nDropped "${i.name}".`);
    }
  }

  if (apply) {
    // Builds whatever the schema declares and removes anything it no longer does.
    await LeavePolicy.syncIndexes();
    console.log("Indexes synced to the schema:");
    for (const i of await collection.indexes()) {
      console.log(`  ${i.name}  ${JSON.stringify(i.key)}${i.unique ? "  UNIQUE" : ""}`);
    }
  }

  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.connection.close();
  process.exit(1);
});
