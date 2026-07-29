import { Router } from "express";
import { getDashboardSummary, getDocumentExpiry, getOrgChart, triggerBirthdayCheck } from "../controllers/dashboardController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// HR snapshot — available to anyone who can view employees (HR Manager, Super Admin).
router.get("/summary", checkPermission("employees", "view"), getDashboardSummary);
router.get("/document-expiry", checkPermission("employees", "view"), getDocumentExpiry);
router.get("/org-chart", checkPermission("employees", "view"), getOrgChart);
// Manually run the daily birthday email (testing / on-demand).
router.post("/birthday-check", checkPermission("employees", "view"), triggerBirthdayCheck);

export default router;
