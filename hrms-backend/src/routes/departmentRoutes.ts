import { Router } from "express";
import {
  createDepartment, getDepartments, getAllDepartmentsSimple,
  getDepartmentById, getDepartmentReport, updateDepartment, deleteDepartment,
} from "../controllers/departmentController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/all", checkPermission("departments", "view"), getAllDepartmentsSimple);
router.get("/", checkPermission("departments", "view"), getDepartments);
router.post("/", checkPermission("departments", "create"), createDepartment);
router.get("/:id", checkPermission("departments", "view"), getDepartmentById);
router.get("/:id/report", checkPermission("departments", "view"), getDepartmentReport);
router.put("/:id", checkPermission("departments", "edit"), updateDepartment);
router.delete("/:id", checkPermission("departments", "delete"), deleteDepartment);

export default router;
