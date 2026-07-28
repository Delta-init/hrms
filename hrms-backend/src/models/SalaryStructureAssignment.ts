import mongoose, { Schema } from "mongoose";
import type { ISalaryStructureAssignment } from "../types/index.js";

/** Assigns a salary structure to an employee from a given month, with the
 *  employee's Basic pay. The assignment in force for a payroll month is the
 *  latest one whose effectiveMonth is on or before it; a raise = a new
 *  assignment with a later effectiveMonth. */
const salaryStructureAssignmentSchema = new Schema<ISalaryStructureAssignment>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    structure: { type: Schema.Types.ObjectId, ref: "SalaryStructure", required: [true, "Structure is required"] },
    basicAmount: { type: Number, required: [true, "Basic amount is required"], min: 0 },
    effectiveMonth: { type: String, required: [true, "Effective month is required"], match: /^\d{4}-\d{2}$/ },
    notes: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

salaryStructureAssignmentSchema.index({ organization: 1, employee: 1, effectiveMonth: -1 });

export const SalaryStructureAssignment = mongoose.model<ISalaryStructureAssignment>(
  "SalaryStructureAssignment",
  salaryStructureAssignmentSchema
);
