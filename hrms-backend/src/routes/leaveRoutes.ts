import { Router } from "express";
import {
  createLeave,
  getLeaves,
  getMyLeaves,
  getLeaveById,
  updateLeave,
  deleteLeave,
} from "../controllers/leaveController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.use(authenticate);

// Self-service — own requests, no module permission required.
router.get("/mine", getMyLeaves);

router.get("/", checkPermission("leave", "view"), getLeaves);
router.post("/", checkPermission("leave", "create"), createLeave);
router.get("/:id", checkPermission("leave", "view"), getLeaveById);
// edit covers approve/reject (status change)
router.put("/:id", checkPermission("leave", "edit"), updateLeave);
router.delete("/:id", checkPermission("leave", "delete"), deleteLeave);

export default router;
