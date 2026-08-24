import { z } from "zod";

export const employeeFormSchema = z.object({
  employeeCode: z.string().min(1, "Employee code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  department: z.string().nullable().optional(),
  designation: z.string().max(100).optional(),
  workSchedule: z.string().nullable().optional(),
  user: z.string().nullable().optional(),
  employmentType: z.enum(["full_time", "part_time", "contract", "intern"]),
  joiningDate: z.string().optional(),
  status: z.enum(["active", "probation", "on_leave", "notice_period", "terminated"]),
  location: z.enum(["india", "dubai"]).optional(),
  workMode: z.enum(["office", "wfh"]),
  salary: z.coerce.number().min(0, "Salary cannot be negative").optional(),
  currency: z.string().max(6).optional(),

  /* Login provisioning, only used when creating. */
  createLogin: z.boolean().optional(),
  loginEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  loginRole: z.string().optional(),
}).superRefine((v, ctx) => {
  if (!v.createLogin) return;
  // A login needs somewhere to send the invite and a role to grant.
  if (!v.loginRole) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loginRole"], message: "Pick a role for the login" });
  }
  if (!v.loginEmail && !v.email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loginEmail"], message: "An email is needed to send the invite" });
  }
});

export type EmployeeFormValues = z.infer<typeof employeeFormSchema>;
