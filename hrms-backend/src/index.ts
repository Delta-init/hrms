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

const app = express();

// ─── Security & Parsing Middleware ────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: [env.CLIENT_URL, "http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Org-Id"],
  })
);
app.use(express.json({ limit: "10mb" }));
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
  app.listen(Number(env.PORT), () => {
    console.log(`🚀 Server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
    console.log(`📋 API Base: http://localhost:${env.PORT}/api/v1`);
  });
};

start();

export default app;
