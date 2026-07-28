import { Router } from "express";
import {
  createAdjustment, getAdjustments, getAdjustmentById, updateAdjustment, deleteAdjustment,
} from "../controllers/oneTimeAdjustmentController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("payroll", "view"), getAdjustments);
router.post("/", checkPermission("payroll", "create"), createAdjustment);
router.get("/:id", checkPermission("payroll", "view"), getAdjustmentById);
router.put("/:id", checkPermission("payroll", "edit"), updateAdjustment);
router.delete("/:id", checkPermission("payroll", "delete"), deleteAdjustment);

export default router;
