import { z } from "zod";

const resignationType = z.enum([
  "resignation",
  "termination",
  "retirement",
  "end_of_contract",
  "absconding",
]);

export const createResignationSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  resignationType: resignationType.optional(),
  resignationDate: z.coerce.date({ errorMap: () => ({ message: "Resignation date is required" }) }),
  noticeRequired: z.boolean().optional(),
  noticePeriodDays: z.coerce.number().min(0).optional(),
  lastWorkingDay: z.coerce.date().optional().nullable(),
  reason: z.string().max(1000).optional(),
});

export const reviewResignationSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  noticePeriodDays: z.coerce.number().min(0).optional(),
  lastWorkingDay: z.coerce.date().optional().nullable(),
  reviewNote: z.string().max(500).optional(),
});

export const updateResignationSchema = z.object({
  resignationType: resignationType.optional(),
  resignationDate: z.coerce.date().optional(),
  noticeRequired: z.boolean().optional(),
  noticePeriodDays: z.coerce.number().min(0).optional(),
  lastWorkingDay: z.coerce.date().optional().nullable(),
  reason: z.string().max(1000).optional().nullable(),
});

export const exitDetailsSchema = z.object({
  leavingDate: z.coerce.date().optional().nullable(),
  finalSettlement: z.coerce.number().min(0).optional().nullable(),
  left: z.boolean().optional(),
  noticePeriodServed: z.boolean().optional(),
  // Leave settlement
  leaveSalaryPaid: z.boolean().optional(),
  ticketAllowancePaid: z.boolean().optional(),
  paymentType: z.enum(["cash", "bank_transfer", "cheque"]).optional().nullable(),
  remarks: z.string().max(1000).optional().nullable(),
});

const settlementLineSchema = z.object({
  label: z.string().min(1).max(120),
  // Must be non-negative: earnings and deductions are summed with opposing signs,
  // so a negative deduction would inflate net payable (and a negative earning
  // would silently underpay).
  amount: z.coerce.number().min(0, "Amount cannot be negative"),
});

/** Manual inputs that steer the settlement computation; auto lines (gratuity,
 *  loans, reimbursements, one-time) are derived server-side. */
export const settlementInputSchema = z.object({
  leaveEncashmentDays: z.coerce.number().min(0).optional(),
  noticeShortfallDays: z.coerce.number().min(0).optional(),
  gratuityOverride: z.coerce.number().min(0).optional().nullable(),
  extraEarnings: z.array(settlementLineSchema).optional(),
  extraDeductions: z.array(settlementLineSchema).optional(),
  notes: z.string().max(1000).optional().nullable(),
});

const clearanceDepartment = z.enum(["it", "finance", "hr", "admin", "manager"]);

/** Replace the whole checklist — add, remove or reword lines in one call. */
export const clearanceSchema = z.object({
  items: z.array(
    z.object({
      _id: z.string().optional(),
      department: clearanceDepartment,
      item: z.string().min(1, "Item is required").max(150),
      status: z.enum(["pending", "cleared", "not_applicable"]).optional(),
      notes: z.string().max(500).optional().nullable(),
    })
  ),
});

/** Sign off (or reopen) a single checklist line. */
export const clearanceItemUpdateSchema = z.object({
  status: z.enum(["pending", "cleared", "not_applicable"]),
  notes: z.string().max(500).optional().nullable(),
});

const rating = z.coerce.number().min(1).max(5).optional().nullable();

export const exitInterviewSchema = z.object({
  primaryReason: z
    .enum([
      "compensation", "career_growth", "work_life_balance", "management",
      "relocation", "higher_studies", "health", "role_mismatch", "other",
    ])
    .optional(),
  ratings: z
    .object({
      workEnvironment: rating,
      management: rating,
      growth: rating,
      compensation: rating,
      workLifeBalance: rating,
    })
    .optional(),
  whatWentWell: z.string().max(2000).optional().nullable(),
  whatCouldImprove: z.string().max(2000).optional().nullable(),
  wouldRecommend: z.boolean().optional().nullable(),
  eligibleForRehire: z.boolean().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export type ClearanceInput = z.infer<typeof clearanceSchema>;
export type ClearanceItemUpdateInput = z.infer<typeof clearanceItemUpdateSchema>;
export type ExitInterviewInput = z.infer<typeof exitInterviewSchema>;
export type SettlementInput = z.infer<typeof settlementInputSchema>;
export type CreateResignationInput = z.infer<typeof createResignationSchema>;
export type ReviewResignationInput = z.infer<typeof reviewResignationSchema>;
export type UpdateResignationInput = z.infer<typeof updateResignationSchema>;
export type ExitDetailsInput = z.infer<typeof exitDetailsSchema>;
