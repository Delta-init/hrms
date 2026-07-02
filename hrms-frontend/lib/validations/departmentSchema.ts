import { z } from "zod";

// leader/members are encoded as "Employee:<id>" or "User:<id>" in the form,
// then decoded to { kind, ref } on submit.
export const departmentFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  code: z.string().max(12).optional(),
  description: z.string().max(300).optional(),
  leader: z.string().optional(),
  members: z.array(z.string()).default([]),
  status: z.enum(["active", "inactive"]),
});

export type DepartmentFormValues = z.infer<typeof departmentFormSchema>;
