import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { Employee } from "../../models/Employee.js";
// Registered so the department populate below can resolve it.
import { Department } from "../../models/Department.js";
import { User } from "../../models/User.js";
import { sendMail } from "../../utils/mailer.js";

void Department;

/**
 * Give every migrated employee a way in.
 *
 * The GreytHR import created a hundred logins and no passwords anybody knows,
 * so the accounts exist and nobody can use them. This issues a fresh temporary
 * password for each, writes them all to one sheet, and sends each person the
 * same invitation the app sends when HR creates a login by hand.
 *
 * Three separate steps, because they carry different risks:
 *
 *   (no flag)          reports who would be invited and writes nothing
 *   --apply            sets the passwords and writes the sheet, sends nothing
 *   --apply --send     also sends the invitations
 *
 * Splitting the last two is deliberate. Passwords have to exist before a sheet
 * of them can be true, but a hundred emails should not go out because somebody
 * wanted to see the list.
 *
 * Who is skipped, and why:
 *   · anyone whose employee has left — they keep no access
 *   · logins with no employee record — the kiosk tablet is one of these, and it
 *     is a device, not a person
 *   · anyone who has already signed in, unless --include-active is passed:
 *     resetting a working password locks somebody out of an account they use
 *
 *   bun src/seeds/inviteEmployees/index.ts
 *   bun src/seeds/inviteEmployees/index.ts --apply
 *   bun src/seeds/inviteEmployees/index.ts --apply --send
 *   bun src/seeds/inviteEmployees/index.ts --apply --send --only=a@x.com,b@x.com
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const SEND = args.includes("--send");
const INCLUDE_ACTIVE = args.includes("--include-active");
/**
 * Hours within which somebody already invited is left alone.
 *
 * A run of a hundred emails can stop halfway — a closed terminal, a dropped
 * connection — and the people already reached must not be reissued a password,
 * because that kills the one sitting in the mail they just received. Re-running
 * therefore resumes. `--reinvite-after=0` overrides it and invites everybody.
 */
const REINVITE_AFTER_H = Number(arg("reinvite-after") ?? 24);
/**
 * Retro-stamp the first N of the pool as already invited, and send nothing.
 *
 * For a batch that was interrupted before this stamp existed: the order is
 * fixed (by employee code), so the N the terminal reported as sent are the
 * first N here, and marking them stops the resume from mailing them twice.
 */
const MARK_SENT = Number(arg("mark-sent") ?? 0);
/** One address or several, comma-separated — for trying it on a few people first. */
const ONLY = arg("only")?.toLowerCase().split(",").map((e) => e.trim()).filter(Boolean);
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";
const OUT = (arg("out") ?? `${process.env.HOME}/Downloads/Employee invitations.xlsx`).replace(/^~/, process.env.HOME ?? "~");
/** Gmail throttles a burst; one every second and a half is well inside it. */
const GAP_MS = Number(arg("gap") ?? 1500);
/**
 * Where the activation link points.
 *
 * Deliberately not `env.CLIENT_URL`. This runs from somebody's laptop, where
 * that is localhost, and the first two invitations went out with an activate
 * button nobody outside this machine could open. A script that sends real mail
 * to real people must not inherit a developer's local address, so the public
 * one is the default and `--client-url` is there for anyone who needs another.
 */
const CLIENT_URL = (arg("client-url") ?? "https://hrms.deltainstitutions.com").replace(/\/+$/, "");

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 58 - s.length))}`); };

/**
 * A temporary password that satisfies the login policy and is readable aloud.
 *
 * No l/I/O/0 — these get copied off a screen and typed by hand, and a password
 * somebody cannot transcribe is a support call.
 */
function temporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const bytes = randomBytes(20);
  const pick = (set: string, i: number) => set[bytes[i] % set.length];
  const chars = [pick(upper, 0), pick(lower, 1), pick(digits, 2)];
  for (let i = 3; i < 12; i++) chars.push(pick(all, i));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[i % bytes.length] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** The invitation the app itself sends, word for word. */
const inviteHtml = (name: string, email: string, pw: string, url: string) =>
  `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">
    <h2 style="color:#4f46e5">Welcome to Delta HRMS</h2>
    <p style="color:#555">Hi ${name}, an account has been created for you. Use these details to sign in for the first time:</p>
    <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#888">Email</td><td style="padding:4px 0;font-weight:600">${email}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#888">Temporary password</td><td style="padding:4px 0;font-weight:600;font-family:monospace">${pw}</td></tr>
    </table>
    <p><a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Activate your account</a></p>
    <p style="color:#999;font-size:12px;margin-top:20px">You'll be asked to set your own password on first sign-in. Sent automatically by Delta HRMS.</p>
  </div>`;

interface Row {
  userId: unknown;
  code: string; name: string; email: string; password: string;
  designation: string; department: string; sent: string; note: string;
}

async function main() {
  if (SEND && !APPLY) throw new Error("--send needs --apply: an email cannot carry a password that was never set.");
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).lean();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);

  log(`Organisation : ${org.name}`);
  log(`Mode         : ${
    MARK_SENT > 0 ? `MARK ONLY — first ${MARK_SENT} recorded as already invited, nothing sent`
    : !APPLY ? "DRY RUN — nothing is written"
    : SEND ? "APPLY + SEND — each password set immediately before its own email"
    : "APPLY — passwords set, sheet written, nothing sent"}`);
  if (ONLY) log(`Only         : ${ONLY.join(", ")}`);
  log(`Activate at  : ${CLIENT_URL}/set-password`);

  const employees = await Employee.find({ organization: org._id, status: { $ne: "terminated" }, user: { $ne: null } })
    .select("name employeeCode designation department user status")
    .populate<{ department: { name: string } | null }>("department", "name")
    .sort({ employeeCode: 1 })
    .lean();

  const users = await User.find({ organization: org._id }).select("name email status tokenVersion invitedAt").lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const targets: Array<{ emp: (typeof employees)[number]; user: (typeof users)[number] }> = [];
  const skipped: string[] = [];

  for (const emp of employees) {
    const user = byId.get(String(emp.user));
    if (!user) { skipped.push(`${emp.employeeCode} ${emp.name} — login missing`); continue; }
    if (!user.email) { skipped.push(`${emp.employeeCode} ${emp.name} — no email address`); continue; }
    if (ONLY && !ONLY.includes(user.email.toLowerCase())) continue;
    if ((user.tokenVersion ?? 0) > 0 && !INCLUDE_ACTIVE) {
      skipped.push(`${emp.employeeCode} ${emp.name} — has signed in already (--include-active to reset anyway)`);
      continue;
    }
    const invitedAt = (user as { invitedAt?: Date | null }).invitedAt;
    if (REINVITE_AFTER_H > 0 && invitedAt && Date.now() - new Date(invitedAt).getTime() < REINVITE_AFTER_H * 3_600_000) {
      const hrs = Math.round((Date.now() - new Date(invitedAt).getTime()) / 360_000) / 10;
      skipped.push(`${emp.employeeCode} ${emp.name} — invited ${hrs}h ago (--reinvite-after=0 to send again)`);
      continue;
    }
    targets.push({ emp, user });
  }

  head("Who this covers");
  log(`  employees still here, with a login   ${employees.length}`);
  log(`  to invite                            ${targets.length}`);
  log(`  skipped                              ${skipped.length}`);
  for (const s of skipped.slice(0, 12)) log(`      ${s}`);
  if (skipped.length > 12) log(`      … and ${skipped.length - 12} more`);
  // Logins with no employee behind them — the kiosk tablet among them — are
  // never in `employees`, so they cannot be reached from here at all.
  const orphans = users.filter((u) => !employees.some((e) => String(e.user) === String(u._id)));
  log(`  logins with no employee (never touched) ${orphans.length}`);

  if (!APPLY) {
    head("Nothing was written");
    log(`  --apply            set the passwords and write the sheet`);
    log(`  --apply --send     and send the invitations`);
    await mongoose.disconnect();
    return;
  }

  if (MARK_SENT > 0) {
    head(`Marking the first ${MARK_SENT} as already invited`);
    const now = new Date();
    for (const { emp, user } of targets.slice(0, MARK_SENT)) {
      await User.updateOne({ _id: user._id }, { $set: { invitedAt: now } });
      log(`  ${emp.employeeCode.toString().padEnd(6)} ${user.email}`);
    }
    log(`\n  Nothing was sent and no password changed. Re-run with --apply --send`);
    log(`  to reach the remaining ${targets.length - Math.min(MARK_SENT, targets.length)}.`);
    await mongoose.disconnect();
    return;
  }

  /**
   * Give one person a fresh temporary password.
   *
   * Kept a step of its own so a sending run can do it one person at a time,
   * immediately before their email. Resetting the whole batch first and mailing
   * afterwards means an interruption leaves everyone past the cut-off holding a
   * password that exists only in a database column — locked out, with no mail
   * to tell them otherwise.
   */
  const setPassword = async (userId: unknown) => {
    const doc = await User.findById(userId);
    if (!doc) return null;
    const password = temporaryPassword();
    doc.password = password;            // hashed by the schema's pre-save hook
    doc.mustResetPassword = true;       // forced to choose their own on first sign-in
    if (doc.status === "inactive") doc.status = "invited";
    await doc.save();
    return password;
  };

  const rowFor = (emp: (typeof targets)[number]["emp"], user: (typeof targets)[number]["user"], password: string): Row => ({
    userId: user._id,
    code: String(emp.employeeCode), name: String(emp.name), email: String(user.email),
    password, designation: String(emp.designation ?? ""),
    department: (emp.department as { name?: string } | null)?.name ?? "",
    sent: "", note: "",
  });

  const rows: Row[] = [];
  if (!SEND) {
    for (const { emp, user } of targets) {
      const password = await setPassword(user._id);
      if (password) rows.push(rowFor(emp, user, password));
    }
    log(`\n  ${rows.length} temporary passwords set`);
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  if (SEND) {
    head("Sending");
    let ok = 0;
    for (const [i, { emp, user }] of targets.entries()) {
      const email = String(user.email);
      const label = `${String(i + 1).padStart(3)}/${targets.length}  ${String(emp.employeeCode).padEnd(6)} ${email}`;

      // Kept so a failure can put the account back exactly as it was, rather
      // than leaving somebody with a password that was mailed nowhere. The
      // pre-save hook only runs on save(), so writing the old hash through
      // updateOne restores it verbatim instead of hashing it twice.
      const before = await User.findById(user._id).select("+password status").lean();
      const password = await setPassword(user._id);
      if (!password) { log(`  ${label}  SKIPPED — login vanished`); continue; }

      const r = rowFor(emp, user, password);
      const url = `${CLIENT_URL}/set-password?email=${encodeURIComponent(email)}`;
      let sent = false;
      try {
        sent = await sendMail({
          to: email, organization: String(org._id),
          subject: "Welcome to Delta HRMS — activate your account",
          html: inviteHtml(r.name, email, password, url),
          text: `Welcome to Delta HRMS. Sign in with ${email} / temporary password ${password}, then set your own password at ${url}`,
        });
      } catch (e) {
        r.note = e instanceof Error ? e.message : String(e);
      }
      r.sent = sent ? "sent" : "failed";
      if (sent) {
        ok++;
        // Stamped only once the mail is away, so an interrupted batch resumes
        // where it stopped and a failure is retried rather than quietly skipped.
        await User.updateOne({ _id: user._id }, { $set: { invitedAt: new Date() } });
      } else if (before) {
        await User.updateOne(
          { _id: user._id },
          { $set: { password: before.password, status: before.status } }
        );
        r.password = "(unchanged — nothing was sent)";
      }
      rows.push(r);
      log(`  ${label}  ${sent ? "sent" : `FAILED${r.note ? ` — ${r.note}` : ""}`}`);
      // Paced so a hundred at once is not read as a burst.
      if (i < targets.length - 1) await new Promise((res) => setTimeout(res, GAP_MS));
    }
    log(`\n  ${ok} sent · ${rows.length - ok} failed`);
  }

  // ── The sheet ─────────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Code", "Name", "Email", "Temporary password", "Designation", "Department", "Invitation", "Note"],
    ...rows.map((r) => [r.code, r.name, r.email, r.password, r.designation, r.department, r.sent || "not sent", r.note]),
  ]), "Invitations");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Skipped", ""], [], ...skipped.map((s) => [s]),
  ]), "Skipped");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  XLSX.writeFile(wb, OUT);

  head("Done");
  log(`  sheet: ${OUT}`);
  log(`  It holds live passwords in plain text. Hand it over the way you would`);
  log(`  a list of keys, and delete it once everyone has signed in.`);
  if (!SEND) log(`\n  Nothing was emailed. Re-run with --apply --send when you are ready.`);
  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(String(e?.message ?? e)); await mongoose.disconnect(); process.exit(1); });
