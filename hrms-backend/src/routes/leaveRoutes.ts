import { Router } from "express";
import {
  createLeave,
  getLeaves,
  getPendingLeaveCount,
  getMyLeaves,
  getLeaveById,
  updateLeave,
  reviewLeave,
  setLeaveStatus,
  deleteLeave,
  withdrawLeave,
  uploadLeaveCertificate,
  getLeaveOptions,
} from "../controllers/leaveController.js";
import { authenticate } from "../middleware/auth.js";
import { uploadSingle } from "../middleware/upload.js";
import { checkPermission, checkPermissionOrDepartmentHead, requesterFromRecord } from "../middleware/permissions.js";
import { LeaveRequest } from "../models/LeaveRequest.js";

const router = Router();

router.use(authenticate);

// Self-service — own requests, no module permission required.
router.get("/mine", getMyLeaves);
// What this person may request. Self-service by default: anyone can ask what
// their own schedule allows, which is what the form needs to render at all.
router.get("/options", getLeaveOptions);
// Withdraw a still-pending request of one's own; ownership is checked in the service.
router.patch("/:id/withdraw", withdrawLeave);
// Certified Sick Leave: the requester's own medical certificate (checked in the service).
router.post("/:id/certificate", uploadSingle, uploadLeaveCertificate);

// Before "/:id", or "pending-count" is read as a request id. Gated on view
// rather than approve: a badge is a number, and anyone allowed to open the
// queue is allowed to know how long it is.
router.get("/pending-count", checkPermission("leave", "view"), getPendingLeaveCount);
router.get("/", checkPermission("leave", "view"), getLeaves);
router.post("/", checkPermission("leave", "create"), createLeave);
router.get("/:id", checkPermission("leave", "view"), getLeaveById);
// Approve/reject is its own action, gated on leave.approve — or on heading the
// department the request came from, which is checked against that one record
// rather than against the route, so a head gains their own team and nothing else.
router.patch(
  "/:id/review",
  checkPermissionOrDepartmentHead(
    "leave", "approve",
    requesterFromRecord((id) => LeaveRequest.findById(id).select("user").lean())
  ),
  reviewLeave
);
// Setting the status by hand, after the fact — HR's approve permission, never a
// department head's standing, since it can undo a decision the workflow made.
router.patch("/:id/status", checkPermission("leave", "approve"), setLeaveStatus);
router.put("/:id", checkPermission("leave", "edit"), updateLeave);
router.delete("/:id", checkPermission("leave", "delete"), deleteLeave);

export default router;
