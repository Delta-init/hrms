import { Router } from "express";
import { serviceAuth } from "../middleware/serviceAuth.js";
import {
  listOrganizations, listDepartments, listEmployees, ping,
  listHandoverBatches, getHandoverBatch, claimHandoverBatch,
  listFinanceAdjustments, applyFinanceAdjustments, removeFinanceAdjustment,
  approveHandoverBatch, returnHandoverBatch, recordPayment, reversePayment,
} from "../controllers/integrationController.js";
import { serviceOrgScope } from "../middleware/serviceOrgScope.js";

const router = Router();

// Signed machine calls only. No `authenticate`, and therefore no org context:
// every handler below takes the organization as an explicit parameter.
router.use(serviceAuth);

router.get("/ping", ping);
router.get("/directory/organizations", listOrganizations);
router.get("/directory/departments", listDepartments);
router.get("/directory/employees", listEmployees);

// Payroll. Behind serviceOrgScope as well as the signature: these touch
// org-scoped services, and without a tenant installed `scoped()` would read
// across every organization at once.
router.get("/payroll/batches", serviceOrgScope, listHandoverBatches);
router.get("/payroll/batches/:month", serviceOrgScope, getHandoverBatch);
router.post("/payroll/batches/:month/claim", serviceOrgScope, claimHandoverBatch);

// The one door through which a locked month may still change, and only while
// it is with accounts.
router.get("/payroll/batches/:month/adjustments", serviceOrgScope, listFinanceAdjustments);
router.post("/payroll/batches/:month/adjustments", serviceOrgScope, applyFinanceAdjustments);
router.delete("/payroll/batches/:month/adjustments/:externalId", serviceOrgScope, removeFinanceAdjustment);

// Sign-off, payment, and the way back. A payment is the only path by which a
// payslip becomes paid — nothing on the HR side can set it.
router.post("/payroll/batches/:month/approve", serviceOrgScope, approveHandoverBatch);
router.post("/payroll/batches/:month/return", serviceOrgScope, returnHandoverBatch);
router.post("/payroll/batches/:month/payments", serviceOrgScope, recordPayment);
router.post("/payroll/batches/:month/payments/:paymentId/reverse", serviceOrgScope, reversePayment);

export default router;
