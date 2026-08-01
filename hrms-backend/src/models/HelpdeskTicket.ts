import mongoose, { Schema } from "mongoose";
import type { IHelpdeskTicket } from "../types/index.js";

const helpdeskCommentSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: [true, "Comment body is required"], trim: true, maxlength: 2000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false, timestamps: false }
);

/** An employee support ticket, worked by an assigned staff member through a comment thread. */
const helpdeskTicketSchema = new Schema<IHelpdeskTicket>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    subject: { type: String, required: [true, "Subject is required"], trim: true, maxlength: 150 },
    description: { type: String, required: [true, "Description is required"], trim: true, maxlength: 3000 },
    category: { type: String, enum: ["it", "hr", "payroll", "facilities", "other"], default: "other" },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    status: { type: String, enum: ["open", "in_progress", "resolved", "closed"], default: "open", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", default: null },
    comments: { type: [helpdeskCommentSchema], default: [] },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

helpdeskTicketSchema.index({ organization: 1, status: 1, createdAt: -1 });
helpdeskTicketSchema.index({ organization: 1, createdBy: 1, createdAt: -1 });

export const HelpdeskTicket = mongoose.model<IHelpdeskTicket>("HelpdeskTicket", helpdeskTicketSchema);
