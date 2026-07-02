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
  status: z.enum(["active", "probation", "on_leave", "terminated"]),
  location: z.string().max(120).optional(),
  salary: z.coerce.number().min(0, "Salary cannot be negative").optional(),
  currency: z.string().max(6).optional(),
});

export type EmployeeFormValues = z.infer<typeof employeeFormSchema>;
