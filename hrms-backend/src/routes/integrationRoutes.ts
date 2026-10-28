import { Router } from "express";
import { serviceAuth } from "../middleware/serviceAuth.js";
import {
  listOrganizations, listDepartments, listEmployees, listWorkHours, listAttendanceNow, listAttendanceDay, ping,
  listHandoverBatches, getHandoverBatch, claimHandoverBatch,
  listFinanceAdjustments, applyFinanceAdjustments, removeFinanceAdjustment,
  approveHandoverBatch, returnHandoverBatch, recordPayment, reversePayment,
  listProcurementRequests, approveProcurementRequest, rejectProcurementRequest,
  listSalaryAdvances, approveSalaryAdvance, rejectSalaryAdvance,
  listOneTimePayments, markOneTimePaymentPaid, rejectOneTimePayment,
  listHiringRequisitions, approveHiringRequisition, rejectHiringRequisition,
} from "../controllers/integrationController.js";
import { serviceOrgScope } from "../middleware/serviceOrgScope.js";
import {
  listPods, listPodBookings, holdClassPod, releaseClassPod, listClassPods, listWorkModes, crmRoomsDay, crmBook, crmCancel,
} from "../controllers/classPodController.js";

const router = Router();

// Signed machine calls only. No `authenticate`, and therefore no org context:
// every handler below takes the organization as an explicit parameter.
router.use(serviceAuth);

router.get("/ping", ping);
router.get("/directory/organizations", listOrganizations);
router.get("/directory/departments", listDepartments);
router.get("/directory/employees", listEmployees);
// Working hours and leave, for the CS Portal's Mentor Calendar.
router.get("/directory/work-hours", listWorkHours);
// Who is clocked in now, or on leave today — the Sales CRM's live lead split.
router.get("/directory/attendance-now", listAttendanceNow);
// Somebody's shift and a day's clock-ins and clock-outs — the sales CRMs' Activity and team pages.
router.get("/directory/attendance-day", listAttendanceDay);

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

// Procurement. Finance sees what HR has passed on, and decides the money
// question; the HR side records the answer and tells whoever asked.
router.get("/procurement/requests", serviceOrgScope, listProcurementRequests);
router.post("/procurement/requests/:id/approve", serviceOrgScope, approveProcurementRequest);
router.post("/procurement/requests/:id/reject", serviceOrgScope, rejectProcurementRequest);
// Salary advances HR has approved; finance pays them out or refuses them.
router.get("/advances/requests", serviceOrgScope, listSalaryAdvances);
router.post("/advances/requests/:id/approve", serviceOrgScope, approveSalaryAdvance);
router.post("/advances/requests/:id/reject", serviceOrgScope, rejectSalaryAdvance);
// One-time payments HR sent to finance to pay directly (never on a payslip).
router.get("/one-time-payments/requests", serviceOrgScope, listOneTimePayments);
router.post("/one-time-payments/requests/:id/paid", serviceOrgScope, markOneTimePaymentPaid);
router.post("/one-time-payments/requests/:id/reject", serviceOrgScope, rejectOneTimePayment);
// Hiring requisitions HR approved that need accounts (HIRING_FINANCE_STEP=on);
// finance approves or refuses the budget.
router.get("/hiring/requisitions", serviceOrgScope, listHiringRequisitions);
router.post("/hiring/requisitions/:id/approve", serviceOrgScope, approveHiringRequisition);
router.post("/hiring/requisitions/:id/reject", serviceOrgScope, rejectHiringRequisition);

// Pods for the LMS's online classes (2026-10-18): the rooms, who has them when, and one held or let go per class.
router.get("/meetings/pods", serviceOrgScope, listPods);
router.get("/meetings/pod-bookings", serviceOrgScope, listPodBookings);
router.get("/meetings/class-pods", serviceOrgScope, listClassPods);
router.put("/meetings/class-pods/:ref", serviceOrgScope, holdClassPod);
router.delete("/meetings/class-pods/:ref", serviceOrgScope, releaseClassPod);

// Where the LMS's mentors work — office or from home — so only office staff get a pod (2026-10-19).
router.post("/directory/work-modes", listWorkModes);

// Meeting Room 1 and 2 for the sales CRMs, one Dubai day at a time, inside office hours (2026-10-19).
router.get("/meetings/crm-rooms", serviceOrgScope, crmRoomsDay);
router.post("/meetings/crm-bookings", serviceOrgScope, crmBook);
router.delete("/meetings/crm-bookings/:id", serviceOrgScope, crmCancel);

export default router;
