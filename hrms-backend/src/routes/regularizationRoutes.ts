import { Router } from "express";
import {
  createRegularization, getRegularizations, getMyRegularizations, getMyRegularizationAllowance,
  getRegularizationById, updateRegularization, reviewRegularization, deleteRegularization,
} from "../controllers/regularizationController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — own requests, no module permission required.
router.get("/mine", getMyRegularizations);
// Self-service: how many corrections are left this month, and who has to sign
// off past that. No module permission — it is the caller's own allowance.
router.get("/mine/allowance", getMyRegularizationAllowance);

router.get("/", checkPermission("regularization", "view"), getRegularizations);
router.post("/", checkPermission("regularization", "create"), createRegularization);
router.get("/:id", checkPermission("regularization", "view"), getRegularizationById);
router.put("/:id", checkPermission("regularization", "edit"), updateRegularization);
// Approving writes corrected punch times into Attendance — its own permission.
router.patch("/:id/review", checkPermission("regularization", "approve"), reviewRegularization);
router.delete("/:id", checkPermission("regularization", "delete"), deleteRegularization);

export default router;
