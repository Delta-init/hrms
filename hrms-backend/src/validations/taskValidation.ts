import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES } from "../models/Task.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const step = z.string().trim().min(1, "A step can't be blank").max(200);

/** One task, to people and/or departments (each person gets their own copy). */
export const createTaskSchema = z
  .object({
    title: z.string().trim().min(2, "Give the task a title").max(150),
    details: z.string().trim().max(4000).optional(),
    category: objectId.nullish(),
    priority: z.enum(TASK_PRIORITIES).default("normal"),
    employees: z.array(objectId).max(500).default([]),
    departments: z.array(objectId).max(50).default([]),
    dueAt: z.coerce.date(),
    steps: z.array(step).max(30).default([]),
    needsApproval: z.boolean().default(true),
    proofRequired: z.boolean().default(false),
  })
  .refine((v) => v.employees.length + v.departments.length > 0, { path: ["employees"], message: "Choose who gets it" });

/** HR's edit of one copy. Steps can change only while nobody has ticked one. */
export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).max(150).optional(),
  details: z.string().trim().max(4000).optional(),
  category: objectId.nullish(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.coerce.date().optional(),
  steps: z.array(step).max(30).optional(),
  needsApproval: z.boolean().optional(),
  proofRequired: z.boolean().optional(),
});

export const stepToggleSchema = z.object({ done: z.boolean() });

/** Multipart: `note` arrives as a form field, the proof as the file. */
export const submitTaskSchema = z.object({ note: z.string().trim().max(2000).optional() });

export const reviewTaskSchema = z
  .object({ decision: z.enum(["approve", "send_back"]), note: z.string().trim().max(1000).optional() })
  .refine((v) => v.decision === "approve" || (v.note ?? "").length >= 3, {
    path: ["note"],
    message: "Say what needs doing again",
  });

export const cancelTaskSchema = z.object({ note: z.string().trim().max(500).optional() });

export const listTaskSchema = z.object({
  scope: z.enum(["mine", "all", "assigned_by_me", "waiting"]).default("all"),
  status: z.enum(TASK_STATUSES).optional(),
  open: z.enum(["true", "false"]).optional(),
  overdue: z.enum(["true", "false"]).optional(),
  category: objectId.optional(),
  assignee: objectId.optional(),
  department: objectId.optional(),
  search: z.string().trim().max(80).optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Name it").max(40),
  color: z.string().trim().max(20).optional(),
  active: z.boolean().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTaskQuery = z.infer<typeof listTaskSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
