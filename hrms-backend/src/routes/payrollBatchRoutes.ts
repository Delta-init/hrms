import { Router } from "express";
import {
  getPayrollBatch, getPayrollBatches, getPreflight, submitPayroll, recallPayroll, getSlabSalaries, refreshSlabs,
} from "../controllers/payrollBatchController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("payroll", "view"), getPayrollBatches);
// Ahead of "/:month" so the word is not read as a period.
router.get("/:month/preflight", checkPermission("payroll", "view"), getPreflight);
// The CRM salary slabs for the month (2026-11-01): what is kept, and HR's refresh from Root.
router.get("/:month/slab-salaries", checkPermission("payroll", "view"), getSlabSalaries);
router.post("/:month/slab-salaries/refresh", checkPermission("payroll", "edit"), refreshSlabs);
router.get("/:month", checkPermission("payroll", "view"), getPayrollBatch);

// Handing a month to accounts, and taking it back, are a level above editing a
// payslip: they decide that a month is finished. Hence "approve", not "edit".
router.post("/:month/submit", checkPermission("payroll", "approve"), submitPayroll);
router.post("/:month/recall", checkPermission("payroll", "approve"), recallPayroll);

export default router;
