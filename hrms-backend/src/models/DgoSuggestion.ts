import mongoose, { Schema } from "mongoose";

/**
 * An award somebody could record, suggested by another system — today a
 * verified 5-star LMS review with a comment, for the mentor it was about. A
 * head or HR records it in one click (the usual head → HR chain follows) or
 * dismisses it. One per source item, so a re-import never suggests it twice.
 */
const dgoSuggestionSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    source: { type: String, enum: ["lms_review"], required: true },
    sourceId: { type: String, required: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    employeeName: { type: String, required: true },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    departmentName: { type: String, default: null },
    ruleCode: { type: String, required: true },
    day: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    detail: { type: String, default: "", maxlength: 2000 },
    status: { type: String, enum: ["open", "recorded", "dismissed"], default: "open" },
    event: { type: Schema.Types.ObjectId, ref: "DgoEarningEvent", default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedByName: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    note: { type: String, default: null },
  },
  { timestamps: true, versionKey: false }
);

dgoSuggestionSchema.index({ organization: 1, source: 1, sourceId: 1 }, { unique: true });
dgoSuggestionSchema.index({ organization: 1, status: 1, day: -1 });

export const DgoSuggestion = mongoose.model("DgoSuggestion", dgoSuggestionSchema);
