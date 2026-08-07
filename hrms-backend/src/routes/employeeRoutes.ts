import { Router } from "express";
import {
  createEmployee, getEmployees, getEmployeeById, getEmployeeByUser,
  getNextEmployeeCode, getMyEmployeeProfile, updateMyProfile, updateEmployee, deleteEmployee, createEmployeeLogin,
} from "../controllers/employeeController.js";
import {
  listDocumentsForEmployee, uploadDocumentForEmployee, deleteDocumentForEmployee,
  listOtherDocs, addOtherDoc, updateOtherDoc, deleteOtherDoc,
} from "../controllers/documentController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { uploadSingle } from "../middleware/upload.js";

const router = Router();
router.use(authenticate);

// Self-service — own profile, no module permission required (must precede "/:id").
router.get("/me", getMyEmployeeProfile);
router.put("/me", updateMyProfile);

router.get("/", checkPermission("employees", "view"), getEmployees);
router.post("/", checkPermission("employees", "create"), createEmployee);
// Resolve the employee linked to a login account (must precede "/:id").
// Must precede "/:id".
router.get("/next-code", checkPermission("employees", "create"), getNextEmployeeCode);
router.get("/by-user/:userId", checkPermission("employees", "view"), getEmployeeByUser);
router.get("/:id", checkPermission("employees", "view"), getEmployeeById);
router.put("/:id", checkPermission("employees", "edit"), updateEmployee);
router.delete("/:id", checkPermission("employees", "delete"), deleteEmployee);
// Provision a login account for the employee
router.post("/:id/create-login", checkPermission("employees", "edit"), createEmployeeLogin);

// Documents filed on an employee's behalf. Viewing a passport scan is reading
// the employee record, so it rides on the same view/edit permissions.
router.get("/:id/documents", checkPermission("employees", "view"), listDocumentsForEmployee);
router.post("/:id/documents", checkPermission("employees", "edit"), uploadSingle, uploadDocumentForEmployee);
router.delete("/:id/documents/:type", checkPermission("employees", "edit"), deleteDocumentForEmployee);

// Free-form documents and credentials. Multipart so the details and an optional
// scan arrive together; `uploadSingle` is a no-op when no file is attached.
router.get("/:id/other-documents", checkPermission("employees", "view"), listOtherDocs);
router.post("/:id/other-documents", checkPermission("employees", "edit"), uploadSingle, addOtherDoc);
router.put("/:id/other-documents/:recordId", checkPermission("employees", "edit"), uploadSingle, updateOtherDoc);
router.delete("/:id/other-documents/:recordId", checkPermission("employees", "edit"), deleteOtherDoc);

export default router;
