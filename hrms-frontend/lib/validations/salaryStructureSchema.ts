import { z } from "zod";

export const componentSchema = z.object({
  name: z.string().min(1, "Name required").max(60),
  type: z.enum(["earning", "deduction"]),
  calc: z.enum(["fixed", "percent"]),
  value: z.coerce.number().min(0, "Cannot be negative"),
});

export const structureFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  description: z.string().max(300).optional(),
  components: z.array(componentSchema),
});

export const assignFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  structure: z.string().min(1, "Select a structure"),
  basicAmount: z.coerce.number().min(0, "Cannot be negative"),
  effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  notes: z.string().max(300).optional(),
});

export type StructureFormValues = z.infer<typeof structureFormSchema>;
export type AssignFormValues = z.infer<typeof assignFormSchema>;
