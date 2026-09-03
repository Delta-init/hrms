import mongoose, { Schema } from "mongoose";
import type { IProgramRegistration } from "../types/index.js";

/**
 * One person's place in one program.
 *
 * The unique index is the real guard against double-booking, not the button
 * being disabled: a second tab, a double tap or a retried request all arrive as
 * a second insert, and the index refuses it where application logic checking
 * first would race with itself.
 *
 * Cancelling keeps the row and changes its status rather than deleting it. A
 * deleted row cannot answer "did they cancel or were they never on it", and the
 * seat accounting depends on knowing which — a cancellation that ran twice
 * would otherwise release two places for one person.
 */
const programRegistrationSchema = new Schema<IProgramRegistration>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    program: { type: Schema.Types.ObjectId, ref: "Program", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["registered", "cancelled"], default: "registered" },
    registeredAt: { type: Date, default: Date.now },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: false, versionKey: false }
);

// One row per person per program, cancelled or not — the row is reused when
// somebody books again, so this holds whether or not they have changed mind.
programRegistrationSchema.index({ organization: 1, program: 1, user: 1 }, { unique: true });
// The register, and "what am I signed up for", in one index each.
programRegistrationSchema.index({ program: 1, status: 1 });
programRegistrationSchema.index({ user: 1, status: 1 });

export const ProgramRegistration = mongoose.model<IProgramRegistration>(
  "ProgramRegistration",
  programRegistrationSchema
);
