import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const decideSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(1000).optional(),
});

export const bulkDecideSchema = z.object({
  module: z.string().trim().min(1),
  // One module at a time: each has its own rules, and a mixed batch cannot
  // report a meaningful failure.
  ids: z.array(objectId).min(1, "Nothing selected").max(100),
  approve: z.boolean(),
  // Required on a bulk action. Approving twenty things in one click without
  // saying why is exactly how twenty things get approved without being read.
  note: z.string().trim().min(1, "Say why — a bulk decision needs a note").max(1000),
});

export type DecideInput = z.infer<typeof decideSchema>;
export type BulkDecideInput = z.infer<typeof bulkDecideSchema>;
