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
import organizationRoutes from "./organizationRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/cards", cardRoutes);
router.use("/resignations", resignationRoutes);
router.use("/loans", loanRoutes);
router.use("/organizations", organizationRoutes);
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/leaves", leaveRoutes);
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
