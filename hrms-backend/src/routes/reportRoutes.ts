import { Router } from "express";
import { getReportSources, runReport } from "../controllers/reportController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/sources", checkPermission("reports", "view"), getReportSources);
router.post("/run", checkPermission("reports", "view"), runReport);

export default router;
