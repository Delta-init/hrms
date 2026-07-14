import { Router } from "express";
import {
  createPayslip, getPayslips, getMyPayslips, getPayslipSummary,
  getPayrollRun, runPayroll, getPayslipById, updatePayslip, deletePayslip,
} from "../controllers/payslipController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

// Self-service — own payslips.
router.get("/mine", getMyPayslips);

router.get("/summary", checkPermission("payroll", "view"), getPayslipSummary);
// Monthly payroll run (must precede "/:id").
router.get("/run", checkPermission("payroll", "view"), getPayrollRun);
router.post("/run", checkPermission("payroll", "create"), runPayroll);
router.get("/", checkPermission("payroll", "view"), getPayslips);
router.post("/", checkPermission("payroll", "create"), createPayslip);
router.get("/:id", checkPermission("payroll", "view"), getPayslipById);
router.put("/:id", checkPermission("payroll", "edit"), updatePayslip);
router.delete("/:id", checkPermission("payroll", "delete"), deletePayslip);

export default router;
