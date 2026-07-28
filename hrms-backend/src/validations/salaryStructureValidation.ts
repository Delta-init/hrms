import { z } from "zod";

const componentSchema = z.object({
  name: z.string().min(1, "Component name is required").max(60),
  type: z.enum(["earning", "deduction"]),
  calc: z.enum(["fixed", "percent"]),
  value: z.number().min(0, "Value cannot be negative"),
});

export const createSalaryStructureSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  description: z.string().max(300).optional(),
  components: z.array(componentSchema).default([]),
  status: z.enum(["active", "inactive"]).optional(),
});

export const updateSalaryStructureSchema = createSalaryStructureSchema.partial();

export const assignStructureSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  structure: z.string().min(1, "Structure is required"),
  basicAmount: z.number().min(0, "Basic amount cannot be negative"),
  effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/, "Effective month must be YYYY-MM"),
  notes: z.string().max(300).optional(),
});

export const updateAssignmentSchema = assignStructureSchema.partial().omit({ employee: true });

export type CreateSalaryStructureInput = z.infer<typeof createSalaryStructureSchema>;
export type UpdateSalaryStructureInput = z.infer<typeof updateSalaryStructureSchema>;
export type AssignStructureInput = z.infer<typeof assignStructureSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
