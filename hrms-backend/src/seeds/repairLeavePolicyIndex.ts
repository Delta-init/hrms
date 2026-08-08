import "dotenv/config";
import mongoose from "mongoose";
import { LeavePolicy } from "../models/LeavePolicy.js";
import { env } from "../config/env.js";

/**
 * Replace the leave-policy uniqueness rule with the schedule-aware one.
 *
 * Policies used to be unique on (organization, type), which is exactly what
 * stops a second Annual policy from existing for a different work schedule.
 * Declaring the new index in the schema is not enough: Mongo keeps the old one
 * until it is dropped, and it goes on rejecting the writes.
 *
 *   bun src/seeds/repairLeavePolicyIndex.ts          # report only
 *   bun src/seeds/repairLeavePolicyIndex.ts --apply  # swap the index
 *
 * Deliberately unscoped — the index is collection-wide — and safe to re-run:
 * once the old index is gone there is nothing left to drop.
 */
const STALE = { organization: 1, type: 1 };
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

  const stale = indexes.find((i) => sameKey(i.key as Record<string, unknown>, STALE) && i.unique);
  if (!stale) {
    console.log("\nNo stale (organization, type) unique index — nothing to drop.");
  } else if (!apply) {
    console.log(`\nDry run — re-run with --apply to drop "${stale.name}".`);
  } else {
    await collection.dropIndex(stale.name!);
    console.log(`\nDropped "${stale.name}".`);
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
