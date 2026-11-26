import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

const routineItem = z.object({
  title: z.string().trim().min(1, "Name the task").max(120),
  mins: z.number().int().min(5, "At least 5 minutes").max(480),
  steps: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  fixedAt: hhmm.nullish(),
  kind: z.enum(["task", "break"]).default("task"),
});

export const dayPlanSchema = z.object({
  name: z.string().trim().min(2, "Name the plan").max(80),
  employee: objectId,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day").max(7).default([0, 1, 2, 3, 4, 5]),
  startAt: hhmm.default("09:00"),
  roundEveryMins: z.number().int().min(0).max(240).default(60),
  items: z.array(routineItem).min(1, "Add at least one task").max(80),
  active: z.boolean().default(true),
});

export const addDayItemSchema = z.object({
  title: z.string().trim().min(1, "Say what the task is").max(120),
  mins: z.number().int().min(5).max(480),
  afterId: objectId.nullish(),
  steps: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

export const tickSchema = z.object({ done: z.boolean() });
export const reorderSchema = z.object({ ids: z.array(objectId).min(1).max(120) });
export const lengthSchema = z.object({ mins: z.number().int().min(5).max(480) });
export const roundSchema = z.object({ due: hhmm });
export const dayQuerySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export type DayPlanInput = z.infer<typeof dayPlanSchema>;
export type AddDayItemInput = z.infer<typeof addDayItemSchema>;
