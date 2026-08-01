import { Router } from "express";
import {
  getApprovalWorkflows, getApprovalWorkflow, upsertApprovalWorkflow, deleteApprovalWorkflow,
} from "../controllers/approvalWorkflowController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("approvalWorkflows", "view"), getApprovalWorkflows);
router.get("/:module", checkPermission("approvalWorkflows", "view"), getApprovalWorkflow);
router.put("/:module", checkPermission("approvalWorkflows", "edit"), upsertApprovalWorkflow);
router.delete("/:module", checkPermission("approvalWorkflows", "delete"), deleteApprovalWorkflow);

export default router;
