import { Router } from "express";
import {
  createReport, getMyReports, getReports, getWhoCanFileFor,
} from "../controllers/monthlyPerformanceReportController.js";
import { authenticate } from "../middleware/auth.js";
import { uploadSingle } from "../middleware/upload.js";

/**
 * Filing needs no module permission at all — the service decides who may
 * file for whom against the org chart (yourself, or your own department),
 * exactly like leave or office keeping. Listing everybody's is the same
 * story: the service narrows a caller with no `performance.edit` down to
 * their own team rather than the route refusing them outright.
 */
const router = Router();
router.use(authenticate);

router.get("/eligible", getWhoCanFileFor);
router.post("/", uploadSingle, createReport);
router.get("/mine", getMyReports);
router.get("/", getReports);

export default router;
