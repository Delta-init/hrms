import { Router } from "express";
import {
  createReimbursement, getReimbursements, getMyReimbursements, getReimbursementById,
  updateReimbursement, reviewReimbursement, deleteReimbursement,
} from "../controllers/reimbursementController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — own claims, no module permission required.
router.get("/mine", getMyReimbursements);

router.get("/", checkPermission("reimbursements", "view"), getReimbursements);
router.post("/", checkPermission("reimbursements", "create"), createReimbursement);
router.get("/:id", checkPermission("reimbursements", "view"), getReimbursementById);
// Approve/reject is its own action, gated on reimbursements.approve.
router.patch("/:id/review", checkPermission("reimbursements", "approve"), reviewReimbursement);
router.put("/:id", checkPermission("reimbursements", "edit"), updateReimbursement);
router.delete("/:id", checkPermission("reimbursements", "delete"), deleteReimbursement);

export default router;
