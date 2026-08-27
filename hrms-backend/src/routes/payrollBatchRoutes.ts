import { Router } from "express";
import {
  getPayrollBatch, getPayrollBatches, getPreflight, submitPayroll, recallPayroll,
} from "../controllers/payrollBatchController.js";
import { authenticate } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();
router.use(authenticate);

router.get("/", checkPermission("payroll", "view"), getPayrollBatches);
// Ahead of "/:month" so the word is not read as a period.
router.get("/:month/preflight", checkPermission("payroll", "view"), getPreflight);
router.get("/:month", checkPermission("payroll", "view"), getPayrollBatch);

// Handing a month to accounts, and taking it back, are a level above editing a
// payslip: they decide that a month is finished. Hence "approve", not "edit".
router.post("/:month/submit", checkPermission("payroll", "approve"), submitPayroll);
router.post("/:month/recall", checkPermission("payroll", "approve"), recallPayroll);

export default router;
