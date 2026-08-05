import { Router } from "express";
import {
  createEmployee, getEmployees, getEmployeeById, getEmployeeByUser, getMyEmployeeProfile, updateMyProfile, updateEmployee, deleteEmployee, createEmployeeLogin,
} from "../controllers/employeeController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — own profile, no module permission required (must precede "/:id").
router.get("/me", getMyEmployeeProfile);
router.put("/me", updateMyProfile);

router.get("/", checkPermission("employees", "view"), getEmployees);
router.post("/", checkPermission("employees", "create"), createEmployee);
// Resolve the employee linked to a login account (must precede "/:id").
router.get("/by-user/:userId", checkPermission("employees", "view"), getEmployeeByUser);
router.get("/:id", checkPermission("employees", "view"), getEmployeeById);
router.put("/:id", checkPermission("employees", "edit"), updateEmployee);
router.delete("/:id", checkPermission("employees", "delete"), deleteEmployee);
// Provision a login account for the employee
router.post("/:id/create-login", checkPermission("employees", "edit"), createEmployeeLogin);

export default router;
