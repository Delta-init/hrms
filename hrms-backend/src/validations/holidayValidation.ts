import { z } from "zod";

const typeEnum = z.enum(["public", "company", "optional"]);

export const createHolidaySchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
  timeZone: z.string().min(1).default("Asia/Dubai"),
  type: typeEnum.default("public"),
  recurring: z.boolean().default(false),
  workSchedule: z.string().optional().nullable(),
  /**
   * Whose calendar this belongs to; omitted or null is everybody's.
   *
   * Every holiday written before this field existed has none, and they were
   * created meaning the whole organisation — so absent has to keep meaning
   * exactly that.
   */
  workMode: z.enum(["office", "wfh"]).nullish().transform((v) => v ?? null),
  /** True where the date may move — a holiday set by moon sighting. */
  provisional: z.boolean().default(false),
  description: z.string().max(300).optional(),
});

export const updateHolidaySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  date: z.coerce.date().optional(),
  timeZone: z.string().min(1).optional(),
  type: typeEnum.optional(),
  recurring: z.boolean().optional(),
  workSchedule: z.string().optional().nullable(),
  workMode: z.enum(["office", "wfh"]).nullish().transform((v) => v ?? null),
  provisional: z.boolean().optional(),
  description: z.string().max(300).optional().nullable(),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
