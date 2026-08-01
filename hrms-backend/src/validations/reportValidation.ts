import { z } from "zod";

export const runReportSchema = z.object({
  source: z.enum(["employees", "attendance", "leave", "reimbursements", "payslips"]),
  columns: z.array(z.string()).optional(),
  filters: z
    .object({
      status: z.string().optional(),
      department: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    })
    .default({}),
});

export type RunReportInput = z.infer<typeof runReportSchema>;
