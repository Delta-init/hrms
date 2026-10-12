import { Router } from "express";
import {
  getEligibility, createAdvance, getMyAdvances, getAdvances, reviewAdvance, withdrawAdvance,
  getEmployeeEligibility, createAdvanceForEmployee,
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
// HR raising one on an employee's behalf — HR's approval comes with it.
router.get("/eligibility/:employeeId", checkPermission("advances", "approve"), getEmployeeEligibility);
router.post("/for-employee", checkPermission("advances", "approve"), createAdvanceForEmployee);
router.patch("/:id/review", checkPermission("advances", "approve"), reviewAdvance);

export default router;
