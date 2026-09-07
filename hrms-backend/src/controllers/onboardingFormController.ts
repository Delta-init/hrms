import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { Employee } from "../models/Employee.js";
import { buildFilledOnboardingForm } from "../services/onboardingFormService.js";
import { getOrgId } from "../utils/orgContext.js";
import { sendError } from "../utils/response.js";

async function respondWithForm(res: Response, employeeId: string, fileName: string) {
  const pdf = await buildFilledOnboardingForm(employeeId, getOrgId());
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(pdf);
}

/** Self-service: the caller's own onboarding form, filled from their own record. */
export const getMyOnboardingForm = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employee = await Employee.findOne({ organization: getOrgId(), user: req.user!.userId }).select("_id employeeCode");
    if (!employee) { sendError(res, "No employee is linked to your account.", 400); return; }
    await respondWithForm(res, String(employee._id), `onboarding-form-${employee.employeeCode}.pdf`);
  } catch (e) { next(e); }
};

/** Admin: any employee's onboarding form, e.g. from their profile page. */
export const getEmployeeOnboardingForm = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employee = await Employee.findOne({ organization: getOrgId(), _id: req.params.id }).select("employeeCode");
    if (!employee) { sendError(res, "Employee not found", 404); return; }
    await respondWithForm(res, req.params.id, `onboarding-form-${employee.employeeCode}.pdf`);
  } catch (e) { next(e); }
};
