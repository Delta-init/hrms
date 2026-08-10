import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const hireSchema = z
  .object({
    // The two nobody could derive from the candidate or the requisition.
    employeeCode: z.string().trim().min(1, "An employee code is required").max(20),
    joiningDate: z.coerce.date({ required_error: "A joining date is required" }),

    name: z.string().trim().max(100).optional(),
    email: z.string().trim().toLowerCase().email().max(160).optional(),
    designation: z.string().trim().max(120).optional(),
    department: objectId.nullish(),
    location: z.enum(["india", "dubai"]).optional(),
    employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).default("full_time"),
    salary: z.coerce.number().min(0).optional(),
    currency: z.string().trim().toUpperCase().length(3).default("AED"),

    createLogin: z.boolean().default(false),
    loginRole: objectId.optional(),
    onboardingTemplate: objectId.optional(),
  })
  .superRefine((v, ctx) => {
    // Without a role there is nothing to provision the account against, and the
    // employee service would refuse it after the record already exists.
    if (v.createLogin && !v.loginRole) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loginRole"], message: "Pick the role their login should have" });
    }
  });

export type HireInput = z.infer<typeof hireSchema>;
