import { Router } from "express";
import {
  createCycle, getCycles, setCycleStatus, deleteCycle,
  getAppraisals, getAppraisalById, reviewAppraisal,
  getMyAppraisals, setMyGoals, submitMySelfReview,
} from "../controllers/performanceController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — own appraisals, no module permission required.
router.get("/mine", getMyAppraisals);
router.put("/mine/:id/goals", setMyGoals);
router.post("/mine/:id/submit", submitMySelfReview);

// `performance.view` also drives self-service nav visibility for /performance/mine,
// so it's held by plain Employees too — cycle/appraisal administration must gate on
// `edit` instead, or that same flag would leak every employee's appraisal data to them.
router.get("/cycles", checkPermission("performance", "edit"), getCycles);
router.post("/cycles", checkPermission("performance", "create"), createCycle);
router.patch("/cycles/:id/status", checkPermission("performance", "edit"), setCycleStatus);
router.delete("/cycles/:id", checkPermission("performance", "delete"), deleteCycle);

router.get("/appraisals", checkPermission("performance", "edit"), getAppraisals);
router.get("/appraisals/:id", checkPermission("performance", "edit"), getAppraisalById);
router.patch("/appraisals/:id/review", checkPermission("performance", "edit"), reviewAppraisal);

export default router;
