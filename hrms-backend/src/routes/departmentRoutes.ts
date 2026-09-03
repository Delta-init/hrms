import { Router } from "express";
import {
  createDepartment, getDepartments, getAllDepartmentsSimple, getMyDepartments,
  getDepartmentById, getDepartmentReport, updateDepartment, deleteDepartment,
} from "../controllers/departmentController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission, checkPermissionOrHeadsDepartment } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — which department(s) this login heads, if any. Above "/:id",
// or "mine" is read as a department id.
router.get("/mine", getMyDepartments);

router.get("/all", checkPermission("departments", "view"), getAllDepartmentsSimple);
router.get("/", checkPermission("departments", "view"), getDepartments);
router.post("/", checkPermission("departments", "create"), createDepartment);
// The permission, or heading this specific department — a head can open their
// own department's page and report without `departments.view`, which would
// otherwise also open the company-wide list and every other department along
// with it. Create/update/delete/list stay permission-only, deliberately.
router.get("/:id", checkPermissionOrHeadsDepartment("departments", "view"), getDepartmentById);
router.get("/:id/report", checkPermissionOrHeadsDepartment("departments", "view"), getDepartmentReport);
router.put("/:id", checkPermission("departments", "edit"), updateDepartment);
router.delete("/:id", checkPermission("departments", "delete"), deleteDepartment);

export default router;
