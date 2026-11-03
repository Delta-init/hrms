import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { Organization } from "../models/Organization.js";
import { CompOffCredit } from "../models/CompOffCredit.js";
import { CompOffService } from "../services/compOffService.js";
import { notify } from "../services/notificationService.js";
import { watchersFor } from "../services/watchers.js";
import { runWithOrg } from "../utils/orgContext.js";
import { env } from "../config/env.js";

/**
 * A day back, raised the same run it was earned rather than left for HR to
 * notice — but as a request HR approves, not a credit. Until it is approved
 * it counts toward nobody's balance.
 *
 * `CompOffService.suggestions()` already does the finding — anyone who
 * worked a holiday or weekend with nothing on record for that day yet. This
 * is only the other half: turning each one into a pending request and
 * telling HR there is something to look at. Idempotent by construction,
 * since a day with a request of any status drops out of `suggestions()` on
 * its own — a missed run or a re-run both catch up safely, and a day HR
 * rejected is not raised again.
 *
 * Half a day under four hours worked, a full day at four or more — the
 * organisation's own call, made once here; HR can change it on approval.
 */
const FULL_DAY_AFTER_MINUTES = 240;

const service = new CompOffService();

/** runWithOrg is void-returning by design (built for Express's synchronous
 *  next()) — bridge it so a multi-org loop can await org-scoped work. */
function withOrg<T>(store: Parameters<typeof runWithOrg>[0], fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithOrg(store, () => { fn().then(resolve, reject); });
  });
}

/**
 * One organisation's share of the work.
 *
 * Exported on its own so this can be pointed at a single, known org and
 * checked without running the loop below, which is deliberately
 * org-context-free and has no way to limit itself to one.
 */
export async function requestSuggestionsFor(orgId: string): Promise<{ requested: number }> {
  return withOrg({ orgId, isSuperAdmin: false }, async () => {
    const suggestions = await service.suggestions();
    let requested = 0;

    for (const s of suggestions) {
      const amount = s.workedMinutes >= FULL_DAY_AFTER_MINUTES ? 1 : 0.5;
      const reasonLabel = s.reason === "holiday" ? "a holiday" : "a weekend";
      const hours = Math.round((s.workedMinutes / 60) * 10) / 10;

      await CompOffCredit.create({
        organization: orgId,
        employee: s.employee._id,
        user: s.user,
        date: s.date,
        amount,
        reason: `Worked ${reasonLabel} (${hours}h) — from attendance`,
        status: "pending",
        source: "attendance",
        createdBy: null,
      });
      requested++;
    }

    // One note for the night, not one per person — HR reads the list itself.
    if (requested) {
      await notify({
        users: await watchersFor("leave"),
        kind: "leave",
        title: `${requested} comp-off request${requested === 1 ? "" : "s"} to review`,
        body: "Weekend or holiday work from attendance — approve them under Leave → Comp-Off.",
        href: "/leave",
        organization: orgId,
      });
    }
    return { requested };
  });
}

export async function runCompOffAutoRequest(): Promise<{ requested: number }> {
  const orgs = await Organization.find({ status: "active" }).select("_id").lean();
  let requested = 0;

  for (const org of orgs) {
    requested += (await requestSuggestionsFor(String(org._id))).requested;
  }

  if (!requested) console.log("🗓️  comp-off requests: nothing new.");
  else console.log(`🗓️  comp-off requests: ${requested} raised for HR.`);
  return { requested };
}

export function startCompOffAutoCreditCron() {
  const expr = cronSetting("COMP_OFF_AUTO_CREDIT_CRON", env.COMP_OFF_AUTO_CREDIT_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runCompOffAutoRequest().catch((e) => console.error("🗓️  comp-off requests failed:", e));
  });
  console.log(`🗓️  comp-off request cron scheduled: "${expr}"`);
}
