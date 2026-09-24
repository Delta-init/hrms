import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const month = z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM");

export const createMonthlyPerformanceReportSchema = z
  .object({
    employee: objectId,
    month,
    reportText: z.string().trim().max(5000).optional(),
  })
  .superRefine((v, ctx) => {
    // A file may arrive alongside this in the same multipart request, so an
    // empty report is only wrong once both are actually absent — checked in
    // the service, which is the one place that also knows whether a file came
    // with it.
    if (v.reportText !== undefined && v.reportText.length > 5000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reportText"], message: "Too long" });
    }
  });

export type CreateMonthlyPerformanceReportInput = z.infer<typeof createMonthlyPerformanceReportSchema>;
