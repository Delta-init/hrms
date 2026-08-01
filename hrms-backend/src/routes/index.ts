import { Router } from "express";
import authRoutes from "./authRoutes.js";
import userRoutes from "./userRoutes.js";
import roleRoutes from "./roleRoutes.js";
import attendanceRoutes from "./attendanceRoutes.js";
import leaveRoutes from "./leaveRoutes.js";
import holidayRoutes from "./holidayRoutes.js";
import workScheduleRoutes from "./workScheduleRoutes.js";
import departmentRoutes from "./departmentRoutes.js";
import employeeRoutes from "./employeeRoutes.js";
import regularizationRoutes from "./regularizationRoutes.js";
import payslipRoutes from "./payslipRoutes.js";
import dashboardRoutes from "./dashboardRoutes.js";
import cardRoutes from "./cardRoutes.js";
import resignationRoutes from "./resignationRoutes.js";
import loanRoutes from "./loanRoutes.js";
import salaryIncrementRoutes from "./salaryIncrementRoutes.js";
import payrollChecklistRoutes from "./payrollChecklistRoutes.js";
import oneTimeAdjustmentRoutes from "./oneTimeAdjustmentRoutes.js";
import salaryStructureRoutes from "./salaryStructureRoutes.js";
import reimbursementRoutes from "./reimbursementRoutes.js";
import overtimeRoutes from "./overtimeRoutes.js";
import assetRoutes from "./assetRoutes.js";
import leaveBalanceRoutes from "./leaveBalanceRoutes.js";
import organizationRoutes from "./organizationRoutes.js";
import onboardingRoutes from "./onboardingRoutes.js";
import letterRoutes from "./letterRoutes.js";
import compOffRoutes from "./compOffRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/cards", cardRoutes);
router.use("/resignations", resignationRoutes);
router.use("/loans", loanRoutes);
router.use("/salary-increments", salaryIncrementRoutes);
router.use("/payroll-checklist", payrollChecklistRoutes);
router.use("/one-time-adjustments", oneTimeAdjustmentRoutes);
router.use("/salary-structures", salaryStructureRoutes);
router.use("/reimbursements", reimbursementRoutes);
router.use("/overtime", overtimeRoutes);
router.use("/assets", assetRoutes);
router.use("/onboarding", onboardingRoutes);
router.use("/letters", letterRoutes);
router.use("/comp-off", compOffRoutes);
router.use("/organizations", organizationRoutes);
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/leaves", leaveRoutes);
router.use("/leave-balances", leaveBalanceRoutes);
router.use("/holidays", holidayRoutes);
router.use("/work-schedules", workScheduleRoutes);
router.use("/departments", departmentRoutes);
router.use("/employees", employeeRoutes);
router.use("/regularizations", regularizationRoutes);
router.use("/payslips", payslipRoutes);

// Health check
router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
