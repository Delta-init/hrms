import cron from "node-cron";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { cronSetting } from "../utils/cronSetting.js";
import { env } from "../config/env.js";
import { Organization } from "../models/Organization.js";
import { MailboxCursor } from "../models/MailboxCursor.js";
import { imapConfig, mailboxAddress } from "../utils/mailer.js";
import { runWithOrg } from "../utils/orgContext.js";
import { OfferService, type InboundMail } from "../services/offerService.js";

/**
 * Replies to offers, read from the mailbox HR sends from.
 *
 * The mailbox is opened read-only: nothing is marked read, moved or deleted,
 * so HR's own view of the inbox is exactly as it was. The reader remembers the
 * last message it looked at and only looks past it; the first run, and any run
 * after the server renumbers the mailbox, looks back a few days instead.
 *
 * Most mail has nothing to do with offers. Each message is judged on its
 * envelope first — who it is to and from, what it replies to — and only the
 * ones that answer an offer are downloaded in full.
 */
const offers = new OfferService();
const LOOK_BACK_MS = 3 * 86_400_000;
const MAX_PER_RUN = 500;

function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithOrg({ orgId, isSuperAdmin: false }, () => { fn().then(resolve, reject); });
  });
}

const addresses = (v: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap((a) => a.value.map((x) => (x.address ?? "").toLowerCase())).filter(Boolean);

/** One message, parsed into what the offer service stores. */
export async function parseInbound(source: Buffer): Promise<InboundMail> {
  const p = await simpleParser(source);
  const refs = Array.isArray(p.references) ? p.references : p.references ? p.references.split(/\s+/) : [];
  return {
    messageId: p.messageId ?? null,
    inReplyTo: p.inReplyTo ?? null,
    references: refs,
    from: addresses(p.from)[0] ?? "",
    to: [...addresses(p.to), ...addresses(p.cc)],
    subject: p.subject ?? "",
    date: p.date ?? null,
    text: p.text ?? "",
    attachments: p.attachments.map((a) => ({
      filename: a.filename, contentType: a.contentType, size: a.size, content: a.content,
      inline: a.contentDisposition === "inline" || !!a.related,
    })),
  };
}

/** One organisation's mailbox. Returns how many replies were stored. */
export async function checkOfferInbox(orgId: string): Promise<number> {
  const cfg = await imapConfig(orgId);
  if (!cfg) return 0;
  const own = (await mailboxAddress(orgId))?.toLowerCase();
  const cursor = await MailboxCursor.findOneAndUpdate(
    { organization: orgId, mailbox: "INBOX" }, { $setOnInsert: { organization: orgId, mailbox: "INBOX" } },
    { upsert: true, new: true }
  );

  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
  let stored = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const box = client.mailbox;
      const validity = box ? String(box.uidValidity) : null;
      const fresh = !cursor.uidValidity || cursor.uidValidity !== validity;
      const uids = fresh
        ? ((await client.search({ since: new Date(Date.now() - LOOK_BACK_MS) }, { uid: true })) || [])
        : ((await client.search({ uid: `${(cursor.lastUid ?? 0) + 1}:*` }, { uid: true })) || []).filter((u) => u > (cursor.lastUid ?? 0));
      const batch = uids.sort((a, b) => a - b).slice(0, MAX_PER_RUN);
      let last = fresh ? 0 : cursor.lastUid ?? 0;

      if (batch.length) {
        const wanted: number[] = [];
        for await (const msg of client.fetch(batch.join(","), { uid: true, envelope: true }, { uid: true })) {
          last = Math.max(last, msg.uid);
          const env = msg.envelope;
          const from = (env?.from?.[0]?.address ?? "").toLowerCase();
          if (!from || from === own) continue;
          const to = [...(env?.to ?? []), ...(env?.cc ?? [])].map((a) => (a.address ?? "").toLowerCase());
          const hit = await withOrg(orgId, () => offers.match({ from, to, inReplyTo: env?.inReplyTo ?? null, references: [] }));
          if (hit) wanted.push(msg.uid);
        }
        for (const uid of wanted) {
          const full = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!full || !full.source) continue;
          const mail = await parseInbound(full.source);
          const r = await withOrg(orgId, () => offers.ingest(mail));
          if (r.stored) stored++;
        }
      }
      await MailboxCursor.updateOne({ _id: cursor._id }, { $set: { uidValidity: validity, lastUid: last, lastCheckedAt: new Date() } });
    } finally {
      lock.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await MailboxCursor.updateOne({ _id: cursor._id }, { $set: { lastError: message.slice(0, 500), lastErrorAt: new Date() } });
    console.error(`📨 offer inbox (${orgId}): ${message}`);
  } finally {
    await client.logout().catch(() => undefined);
  }
  return stored;
}

export async function runOfferInbox() {
  const orgs = await Organization.find({ status: "active" }).select("_id").lean();
  let stored = 0;
  for (const org of orgs) stored += await checkOfferInbox(String(org._id));
  if (stored) console.log(`📨 offer inbox: ${stored} repl${stored === 1 ? "y" : "ies"} stored.`);
}

export function startOfferInboxCron() {
  const expr = cronSetting("OFFER_INBOX_CRON", env.OFFER_INBOX_CRON);
  if (!expr) return;
  let running = false;
  cron.schedule(expr, () => {
    // A slow mailbox must not start a second reader on top of the first.
    if (running) return;
    running = true;
    runOfferInbox().catch((e) => console.error("📨 offer inbox job failed:", e)).finally(() => { running = false; });
  });
  console.log(`📨 offer inbox cron scheduled: "${expr}"`);
}
