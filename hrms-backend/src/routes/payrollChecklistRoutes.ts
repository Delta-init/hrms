import { Router } from "express";
import {
  getChecklist, createChecklistItem, updateChecklistItem, deleteChecklistItem,
} from "../controllers/payrollChecklistController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("payroll", "view"), getChecklist);
router.post("/", checkPermission("payroll", "edit"), createChecklistItem);
router.put("/:id", checkPermission("payroll", "edit"), updateChecklistItem);
router.delete("/:id", checkPermission("payroll", "edit"), deleteChecklistItem);

export default router;
