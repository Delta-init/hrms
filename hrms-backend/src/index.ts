import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { connectDB } from "./config/database.js";
import { env } from "./config/env.js";
import routes from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { sanitizeQuery } from "./middleware/sanitizeQuery.js";
import { startBirthdayCron } from "./jobs/birthdayJob.js";
import { startResignationCron } from "./jobs/resignationJob.js";
import { startFaceProofPurgeCron } from "./jobs/facePurgeJob.js";
import { startApprovalDigestCron } from "./jobs/approvalDigestJob.js";
import { startLateNoticeCron } from "./jobs/lateNoticeJob.js";
import { startPunchReminderCron } from "./jobs/punchReminderJob.js";
import { startAttendanceDigestCron } from "./jobs/attendanceDigestJob.js";
import { startBackupCron } from "./jobs/backupJob.js";
import { startLeaveQueueCron } from "./jobs/leaveQueueJob.js";

const app = express();

/**
 * Whose word to take for the client's IP address.
 *
 * Express trusts no proxy by default, so `req.ip` is the socket address —
 * behind nginx or a CDN that is the proxy's own address, identical for every
 * employee. Remote check-ins now record the address a punch came from, and a
 * confidently wrong one is worse than none at all.
 *
 * Still off unless configured, because the opposite mistake is the dangerous
 * one: trust the forwarded header when nothing sets it and anybody can claim
 * any IP by sending it themselves. Set TRUST_PROXY to the number of proxies in
 * front of this server (1 for a single nginx or CDN), or to their addresses.
 */
const trustProxy = env.TRUST_PROXY?.trim();
if (trustProxy) {
  const hops = Number(trustProxy);
  app.set("trust proxy", Number.isInteger(hops) ? hops : trustProxy.split(",").map((s) => s.trim()));
}

// ─── Security & Parsing Middleware ────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: [env.CLIENT_URL, "http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    // X-Kiosk-Token is how a kiosk tablet authenticates as a device. Being a
    // custom header it triggers a preflight, so leaving it out here blocks the
    // kiosk in a browser while server-to-server calls carry on working.
    allowedHeaders: ["Content-Type", "Authorization", "X-Org-Id", "X-Kiosk-Token"],
  })
);
/**
 * Keep the raw bytes of every JSON body.
 *
 * The integration API verifies an HMAC over the body exactly as it arrived
 * (see middleware/serviceAuth.ts). Re-serialising `req.body` to check the
 * signature would let the sender and this server disagree about key order or
 * number formatting, failing honest requests. Costs one Buffer reference per
 * request and nothing else.
 */
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// After the body parsers (so req.body exists) and before any route.
app.use(sanitizeQuery);

if (env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use("/api/v1", routes);

// ─── 404 & Error Handlers ─────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
const start = async () => {
  await connectDB();
  startBirthdayCron();
  startResignationCron();
  startFaceProofPurgeCron();
  startApprovalDigestCron();
  startLateNoticeCron();
  startPunchReminderCron();
  startAttendanceDigestCron();
  startBackupCron();
  startLeaveQueueCron();
  app.listen(Number(env.PORT), () => {
    console.log(`🚀 Server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
    console.log(`📋 API Base: http://localhost:${env.PORT}/api/v1`);
  });
};

start();

export default app;
