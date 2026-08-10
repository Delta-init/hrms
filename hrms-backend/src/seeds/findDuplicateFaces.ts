/**
 * Report employees whose enrolled faces are too alike to tell apart.
 *
 * The guard on enrolment only sees faces added after it existed, so anything
 * enrolled before it — or while the service was unreachable — is still in
 * there. A clash is invisible until both people are refused at the door with
 * "not recognised", which nobody connects back to an enrolment, so it is worth
 * looking for deliberately.
 *
 * Read-only: it reports and changes nothing. Clearing a clash is a decision
 * about people, not something a script should make.
 *
 *     bun src/seeds/findDuplicateFaces.ts
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { env } from "../config/env.js";
import { FaceProfile } from "../models/FaceProfile.js";
import { User } from "../models/User.js";

const MATCH_THRESHOLD = 0.45;
const BAND = Number(env.FACE_DUPLICATE_MARGIN) || 0.1;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  return dot; // stored vectors are unit length
}

/** Best similarity between any capture of one person and any of the other. */
function similarity(a: number[][], b: number[][]): number {
  let best = -1;
  for (const left of a) for (const right of b) best = Math.max(best, cosine(left, right));
  return best;
}

async function main() {
  await connectDB();

  const profiles = await FaceProfile.find({ status: "active" }).select("+embeddings user organization");
  const users = await User.find({ _id: { $in: profiles.map((p) => p.user) } }).select("name email");
  const nameOf = new Map(users.map((u) => [String(u._id), `${u.name} <${u.email}>`]));

  console.log(`Checking ${profiles.length} enrolled face(s)…\n`);

  // Only within an organization: galleries are per-org, so two tenants sharing
  // a face never meet at a kiosk.
  const byOrg = new Map<string, typeof profiles>();
  for (const profile of profiles) {
    const key = profile.organization ? String(profile.organization) : "global";
    byOrg.set(key, [...(byOrg.get(key) ?? []), profile]);
  }

  let clashes = 0;
  for (const [org, group] of byOrg) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const score = similarity(group[i]!.embeddings, group[j]!.embeddings);
        if (score < MATCH_THRESHOLD - BAND) continue;
        clashes += 1;
        const severity = score >= MATCH_THRESHOLD ? "SAME FACE" : "too alike";
        console.log(`[${severity}] similarity ${score.toFixed(3)}  (org ${org})`);
        console.log(`    ${nameOf.get(String(group[i]!.user)) ?? group[i]!.user}`);
        console.log(`    ${nameOf.get(String(group[j]!.user)) ?? group[j]!.user}`);
        console.log(
          "    → neither can use the kiosk while both are enrolled; delete one enrolment.\n"
        );
      }
    }
  }

  if (clashes === 0) console.log("No clashes. Every enrolled face is distinguishable from the others.");
  else console.log(`${clashes} clash(es) found. Each one blocks both people from checking in.`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
