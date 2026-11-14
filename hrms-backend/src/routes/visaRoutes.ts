import { Router } from "express";
import {
  getMyVisa, submitMyVisa, listSubmissions, pendingCount, outstanding, approveSubmission, rejectSubmission, setNotRequired,
} from "../controllers/visaController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { uploadSingle } from "../middleware/upload.js";

/**
 * Visas kept up to date by the employees themselves. Their own half needs no
 * permission; checking and deciding is HR's, behind employees.edit, since
 * approving writes to the employee record.
 */
const router = Router();
router.use(authenticate);

router.get("/me", getMyVisa);
router.post("/me", uploadSingle, submitMyVisa);

router.get("/submissions", checkPermission("employees", "edit"), listSubmissions);
router.get("/pending-count", checkPermission("employees", "edit"), pendingCount);
router.get("/outstanding", checkPermission("employees", "edit"), outstanding);
router.post("/submissions/:id/approve", checkPermission("employees", "edit"), approveSubmission);
router.post("/submissions/:id/reject", checkPermission("employees", "edit"), rejectSubmission);
router.put("/not-required/:employeeId", checkPermission("employees", "edit"), setNotRequired);

export default router;
