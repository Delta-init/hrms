import { Application } from "../models/Application.js";
import { Candidate } from "../models/Candidate.js";
import { JobRequisition } from "../models/JobRequisition.js";
import { Employee } from "../models/Employee.js";
import { EmployeeService } from "./employeeService.js";
import { OnboardingService } from "./onboardingService.js";
import { scoped } from "../utils/orgContext.js";
import type { HireInput } from "../validations/hireValidation.js";

/**
 * Turning an accepted offer into an employee.
 *
 * This is the seam between recruiting and everything else, and it is the step
 * people forget: an offer is accepted, the candidate turns up on Monday, and
 * nobody has a record, a login, a document checklist or a payslip for them.
 *
 * Nothing here re-implements employee creation or onboarding. Both already
 * exist, including login provisioning that survives a duplicate email — this
 * just carries the details across and records that the two are the same person.
 */

class HireError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const employees = new EmployeeService();
const onboarding = new OnboardingService();

export class HireService {
  /**
   * What the hire form should open with.
   *
   * Everything already known — from the candidate, the requisition and the
   * offer — so the only fields left to fill are the ones nobody could have
   * derived: the employee code and the joining date.
   */
  async prefill(applicationId: string) {
    const app = await Application.findOne(scoped({ _id: applicationId }))
      .populate<{ candidate: { name: string; email: string; phone?: string } }>("candidate", "name email phone")
      .populate<{ requisition: { title: string; department?: unknown; designation?: string; location?: string; employmentType?: string; currency?: string; salaryMax?: number } }>(
        "requisition", "title department designation location employmentType currency salaryMax"
      )
      .lean();
    if (!app) throw new HireError("Application not found", 404);

    const c = app.candidate as unknown as { name: string; email: string; phone?: string };
    const r = app.requisition as unknown as {
      title: string; department?: unknown; designation?: string;
      location?: string; employmentType?: string; currency?: string; salaryMax?: number;
    };

    return {
      name: c?.name ?? "",
      email: c?.email ?? "",
      phone: c?.phone ?? "",
      designation: r?.designation || r?.title || "",
      department: r?.department ? String(r.department) : null,
      location: r?.location ?? null,
      employmentType: r?.employmentType ?? "full_time",
      currency: r?.currency ?? "AED",
      // What was actually offered, falling back to the ceiling that was approved.
      salary: app.offeredSalary ?? r?.salaryMax ?? undefined,
      stage: app.stage,
      status: app.status,
    };
  }

  /**
   * Create the employee, seed onboarding, and close the loop.
   *
   * Order matters. The employee is created first because everything else hangs
   * off it; onboarding is attempted afterwards and its failure is reported
   * rather than thrown, exactly as a failed login already is — a checklist that
   * did not seed is a minute's work to add, and undoing a created employee to
   * punish that would be worse.
   */
  async hire(applicationId: string, input: HireInput, by: string) {
    const app = await Application.findOne(scoped({ _id: applicationId }));
    if (!app) throw new HireError("Application not found", 404);
    if (app.status !== "active") throw new HireError(`This application was already ${app.status}`);
    if (app.stage !== "accepted") {
      throw new HireError(
        `They are at "${app.stage}". Move them to Accepted first — an employee record should only follow an accepted offer.`
      );
    }
    if (app.movedToEmployee) throw new HireError("An employee record has already been created for this application");

    const candidate = await Candidate.findOne(scoped({ _id: app.candidate })).lean();
    if (!candidate) throw new HireError("Candidate not found", 404);

    const { record, loginError } = await employees.create({
      employeeCode: input.employeeCode,
      name: input.name || candidate.name,
      designation: input.designation,
      department: input.department ?? undefined,
      location: input.location,
      employmentType: input.employmentType,
      joiningDate: input.joiningDate,
      salary: input.salary,
      currency: input.currency,
      workEmail: input.email || candidate.email,
      mobileNumber: candidate.phone,
      status: "probation",
      login: input.createLogin && input.loginRole
        ? { email: input.email || candidate.email, role: input.loginRole }
        : undefined,
    } as never);

    const employeeId = String(record!._id);

    app.movedToEmployee = employeeId as never;
    app.stage = "hired";
    app.stageHistory = [
      ...(app.stageHistory ?? []),
      { stage: "hired", by: by as never, at: new Date(), note: `Employee ${input.employeeCode}` },
    ];
    await app.save();

    let onboardingError: string | undefined;
    if (input.onboardingTemplate) {
      try {
        await onboarding.createChecklist({ employee: employeeId, templateId: input.onboardingTemplate }, by);
      } catch (error) {
        onboardingError = error instanceof Error ? error.message : "The onboarding checklist could not be created";
      }
    }

    const filled = await this.closeIfFilled(String(app.requisition));

    return { employee: record, loginError, onboardingError, requisitionFilled: filled };
  }

  /**
   * Mark the requisition filled once enough people have been hired against it.
   *
   * Counted rather than assumed: a requisition for three does not close on the
   * first hire, and one for one should not sit open pretending to be live.
   */
  private async closeIfFilled(requisitionId: string): Promise<boolean> {
    const req = await JobRequisition.findOne(scoped({ _id: requisitionId }));
    if (!req || req.status !== "approved") return false;

    const hired = await Application.countDocuments(scoped({ requisition: requisitionId, stage: "hired" }));
    if (hired < (req.headcount ?? 1)) return false;

    req.status = "filled";
    await req.save();
    return true;
  }

  /** Undo the link, for a hire recorded against the wrong application. */
  async unlink(applicationId: string) {
    const app = await Application.findOne(scoped({ _id: applicationId }));
    if (!app) throw new HireError("Application not found", 404);
    if (!app.movedToEmployee) throw new HireError("No employee record is linked to this application");

    // The employee record itself is deliberately left alone: by now it may have
    // attendance, documents and a payslip against it, and deleting it from here
    // would be a far bigger action than the one being undone.
    const employee = await Employee.findOne(scoped({ _id: app.movedToEmployee })).select("employeeCode").lean();
    app.movedToEmployee = null;
    app.stage = "accepted";
    await app.save();

    return {
      message: employee
        ? `Unlinked from ${employee.employeeCode}. The employee record was left in place — delete it from Employees if it was created in error.`
        : "Unlinked.",
    };
  }
}
