import { Router } from "express";
import {
  getApprovalInbox, getApprovalSummary, getApprovalModules, getApprovalDetail,
  decideApproval, decideApprovalsBulk,
} from "../controllers/approvalInboxController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// No `checkPermission`: this crosses organisations, so the gate is the
// Super Admin check inside the controller rather than a module permission
// somebody could be granted in one tenant.
router.use(authenticate);

router.get("/", getApprovalInbox);
// Both above the "/:module/:id" pattern, which would otherwise swallow them.
router.get("/summary", getApprovalSummary);
router.get("/modules", getApprovalModules);
router.post("/bulk", decideApprovalsBulk);
router.get("/:module/:id", getApprovalDetail);
router.patch("/:module/:id", decideApproval);

export default router;
