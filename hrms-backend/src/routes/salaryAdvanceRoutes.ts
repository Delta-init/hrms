import { Router } from "express";
import {
  getEligibility, createAdvance, getMyAdvances, getAdvances, reviewAdvance, withdrawAdvance,
} from "../controllers/salaryAdvanceController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

/**
 * Asking is self-service, like a deduction removal — the limit and the
 * one-at-a-time rule are checked in the service, not by a permission.
 * `advances.approve` gates HR's panel. Finance decides over the integration
 * API (integrationRoutes), never here.
 */
const router = Router();
router.use(authenticate);

router.get("/eligibility", getEligibility);
router.get("/mine", getMyAdvances);
router.post("/", createAdvance);
router.patch("/:id/withdraw", withdrawAdvance);

router.get("/", checkPermission("advances", "approve"), getAdvances);
router.patch("/:id/review", checkPermission("advances", "approve"), reviewAdvance);

export default router;
