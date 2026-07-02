import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain at least one uppercase letter, one lowercase letter, and one number"
  );

export const createUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
  password: passwordSchema,
  role: z.string().min(1, "Role is required"),
  designation: z.string().max(100).optional(),
  workSchedule: z.string().optional().nullable(),
  status: z.enum(["active", "inactive", "invited"]).default("active"),
  mustResetPassword: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email("Invalid email address").optional(),
  password: passwordSchema.optional(),
  role: z.string().optional(),
  designation: z.string().max(100).optional().nullable(),
  workSchedule: z.string().optional().nullable(),
  status: z.enum(["active", "inactive", "invited"]).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
