import { Router } from "express";
import {
  createLeave,
  getLeaves,
  getMyLeaves,
  getLeaveById,
  updateLeave,
  reviewLeave,
  deleteLeave,
  withdrawLeave,
  getLeaveOptions,
} from "../controllers/leaveController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.use(authenticate);

// Self-service — own requests, no module permission required.
router.get("/mine", getMyLeaves);
// What this person may request. Self-service by default: anyone can ask what
// their own schedule allows, which is what the form needs to render at all.
router.get("/options", getLeaveOptions);
// Withdraw a still-pending request of one's own; ownership is checked in the service.
router.patch("/:id/withdraw", withdrawLeave);

router.get("/", checkPermission("leave", "view"), getLeaves);
router.post("/", checkPermission("leave", "create"), createLeave);
router.get("/:id", checkPermission("leave", "view"), getLeaveById);
// Approve/reject is its own action, gated on leave.approve.
router.patch("/:id/review", checkPermission("leave", "approve"), reviewLeave);
router.put("/:id", checkPermission("leave", "edit"), updateLeave);
router.delete("/:id", checkPermission("leave", "delete"), deleteLeave);

export default router;
