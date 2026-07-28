import mongoose, { Schema } from "mongoose";
import type { ISalaryStructure } from "../types/index.js";

/** A reusable salary breakup template: a set of allowance (earning) and
 *  recurring-deduction components, each a fixed amount or a percentage of
 *  Basic. Basic itself is per-employee and lives on the assignment. */
const salaryComponentSchema = new Schema(
  {
    name: { type: String, required: [true, "Component name is required"], trim: true, maxlength: 60 },
    type: { type: String, enum: ["earning", "deduction"], required: true },
    calc: { type: String, enum: ["fixed", "percent"], required: true },
    value: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const salaryStructureSchema = new Schema<ISalaryStructure>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300 },
    components: { type: [salaryComponentSchema], default: [] },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

salaryStructureSchema.index({ organization: 1, name: 1 });

export const SalaryStructure = mongoose.model<ISalaryStructure>("SalaryStructure", salaryStructureSchema);
