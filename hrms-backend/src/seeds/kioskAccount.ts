import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { Organization } from "../models/Organization.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";

/**
 * The login for the check-in tablet by the door.
 *
 * The tablet screen itself has never needed a login — it pairs with a device
 * token and identifies whoever walks up by their face. What it needed was an
 * account that cannot reach anything *else*, because the browser it runs in
 * sits unattended in a lobby and every other page in the app is a typed URL
 * away.
 *
 * Before the `kiosk` permission existed, the nearest thing was `users` or
 * `attendance`, either of which hands a reception tablet the staff register or
 * everybody's punch history. This role grants the kiosk and nothing at all
 * besides, and the app treats an account holding only that as a device: no
 * menu, no other page, and sign-in lands straight on the kiosk.
 *
 * Dry by default; `--apply` writes.
 *
 *   bun src/seeds/kioskAccount.ts
 *   bun src/seeds/kioskAccount.ts --apply
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";
const EMAIL = (arg("email") ?? "kiosk@deltainstitutions.com").toLowerCase();
const ROLE_NAME = arg("role") ?? "Kiosk Device";
/** Off by default: a tablet nobody signs into daily should not be able to lock
 *  itself out behind a password screen only an administrator can clear. */
const FORCE_RESET = args.includes("--force-password-change");

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 58 - s.length))}`); };

/**
 * A password strong enough that it never needs rotating on a schedule, and
 * awkward enough that nobody will be tempted to reuse it. Generated rather than
 * chosen: this one gets taped to the back of a tablet.
 */
function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const bytes = randomBytes(24);
  const pick = (set: string, i: number) => set[bytes[i] % set.length];
  const chars = [pick(upper, 0), pick(lower, 1), pick(digits, 2)];
  for (let i = 3; i < 20; i++) chars.push(pick(all, i));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[i % bytes.length] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).lean();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);

  log(`Organisation : ${org.name}`);
  log(`Role         : ${ROLE_NAME}`);
  log(`Login        : ${EMAIL}`);
  log(`Mode         : ${APPLY ? "APPLY — this writes" : "DRY RUN — nothing is written"}`);

  const permissions = { kiosk: { view: true, create: false, edit: false, delete: false, approve: false, export: false } };

  const existingRole = await Role.findOne({ organization: org._id, roleName: ROLE_NAME });
  const existingUser = await User.findOne({ email: EMAIL });

  head("What this would do");
  log(`  role  ${existingRole ? "exists — permissions reset to kiosk-only" : "created"}`);
  log(`        permissions: kiosk.view only — every other module left false`);
  log(`  user  ${existingUser ? "exists — left alone, nothing is overwritten" : "created with a generated password"}`);
  if (existingUser) {
    log();
    log(`  ${EMAIL} already exists. Delete it first, or pass --email= with another`);
    log(`  address. A seed that resets a live account's password on every run is`);
    log(`  a seed nobody can run safely.`);
  }

  if (!APPLY) {
    head("Nothing was written");
    log(`  re-run with --apply to make these changes`);
    await mongoose.disconnect();
    return;
  }

  const role = await Role.findOneAndUpdate(
    { organization: org._id, roleName: ROLE_NAME },
    {
      roleName: ROLE_NAME,
      description: "Runs the check-in tablet. No access to anything else.",
      organization: org._id,
      isSystemRole: false,
      permissions,
    },
    { upsert: true, new: true }
  );

  head("Applied");
  log(`  role ${role.roleName} · ${role._id}`);

  if (existingUser) {
    log(`  user ${EMAIL} already existed — left as it was`);
    log(`  its role is unchanged; set it to "${ROLE_NAME}" from Users if that is what you want`);
    await mongoose.disconnect();
    return;
  }

  const password = generatePassword();
  const user = await User.create({
    name: "Check-in Kiosk",
    email: EMAIL,
    password,
    role: role._id,
    organization: org._id,
    status: "active",
    // A device account has no profile to complete and nobody to complete it.
    profileCompleted: true,
    mustResetPassword: FORCE_RESET,
  });

  log(`  user ${user.email} · ${user._id}`);
  log();
  log(`  ┌${"─".repeat(56)}┐`);
  log(`  │ Password (shown once — it is hashed and cannot be read back)`);
  log(`  │`);
  log(`  │   ${password}`);
  log(`  └${"─".repeat(56)}┘`);
  log();
  log(`  Store it in your password manager. Rotate it from Users if it leaks.`);

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
