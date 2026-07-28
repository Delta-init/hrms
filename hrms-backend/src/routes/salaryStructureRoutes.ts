import { Router } from "express";
import {
  createStructure, getStructures, getStructureById, updateStructure, deleteStructure,
  assignStructure, getAssignments, updateAssignment, deleteAssignment, getBreakup,
} from "../controllers/salaryStructureController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Assignments + breakup (declared before "/:id" so they aren't shadowed).
router.get("/assignments", checkPermission("payroll", "view"), getAssignments);
router.post("/assignments", checkPermission("payroll", "create"), assignStructure);
router.put("/assignments/:id", checkPermission("payroll", "edit"), updateAssignment);
router.delete("/assignments/:id", checkPermission("payroll", "delete"), deleteAssignment);
router.get("/breakup", checkPermission("payroll", "view"), getBreakup);

// Structure templates.
router.get("/", checkPermission("payroll", "view"), getStructures);
router.post("/", checkPermission("payroll", "create"), createStructure);
router.get("/:id", checkPermission("payroll", "view"), getStructureById);
router.put("/:id", checkPermission("payroll", "edit"), updateStructure);
router.delete("/:id", checkPermission("payroll", "delete"), deleteStructure);

export default router;
