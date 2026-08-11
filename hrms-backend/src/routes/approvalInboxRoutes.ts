import { Router } from "express";
import {
  getApprovalInbox, getApprovalModules, getApprovalDetail,
  decideApproval, decideApprovalsBulk,
} from "../controllers/approvalInboxController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// No `checkPermission`: this crosses organisations, so the gate is the
// Super Admin check inside the controller rather than a module permission
// somebody could be granted in one tenant.
router.use(authenticate);

router.get("/", getApprovalInbox);
router.get("/modules", getApprovalModules);
router.post("/bulk", decideApprovalsBulk);
router.get("/:module/:id", getApprovalDetail);
router.patch("/:module/:id", decideApproval);

export default router;
