import { z } from "zod";

const typeEnum = z.enum(["public", "company", "optional"]);

export const createHolidaySchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
  timeZone: z.string().min(1).default("Asia/Dubai"),
  type: typeEnum.default("public"),
  recurring: z.boolean().default(false),
  workSchedule: z.string().optional().nullable(),
  description: z.string().max(300).optional(),
});

export const updateHolidaySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  date: z.coerce.date().optional(),
  timeZone: z.string().min(1).optional(),
  type: typeEnum.optional(),
  recurring: z.boolean().optional(),
  workSchedule: z.string().optional().nullable(),
  description: z.string().max(300).optional().nullable(),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
