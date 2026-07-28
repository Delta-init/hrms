import { Router } from "express";
import {
  createOvertime, getOvertime, getOvertimeById, updateOvertime, deleteOvertime,
} from "../controllers/overtimeController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("payroll", "view"), getOvertime);
router.post("/", checkPermission("payroll", "create"), createOvertime);
router.get("/:id", checkPermission("payroll", "view"), getOvertimeById);
router.put("/:id", checkPermission("payroll", "edit"), updateOvertime);
router.delete("/:id", checkPermission("payroll", "delete"), deleteOvertime);

export default router;
