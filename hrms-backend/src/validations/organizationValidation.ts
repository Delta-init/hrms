import { z } from "zod";

const settingsSchema = z.object({
  currency: z.string().max(6).optional(),
  timeZone: z.string().max(60).optional(),
  smtpHost: z.string().max(200).optional(),
  smtpPort: z.string().max(6).optional(),
  smtpUser: z.string().max(200).optional(),
  smtpPass: z.string().max(200).optional(),
  smtpSecure: z.boolean().optional(),
  mailFrom: z.string().max(200).optional(),
  enforceWorkMode: z.boolean().optional(),
  remoteDevice: z.enum(["off", "flag", "enforce"]).optional(),
});

export const createOrganizationSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  code: z.string().min(1, "Code is required").max(20),
  logo: z.string().optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
  settings: settingsSchema.optional(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().min(1).max(20).optional(),
  logo: z.string().optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
  settings: settingsSchema.optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
