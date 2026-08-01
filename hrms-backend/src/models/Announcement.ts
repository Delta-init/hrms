import mongoose, { Schema } from "mongoose";
import type { IAnnouncement } from "../types/index.js";

/** An org-wide news/engagement post, visible to every employee. */
const announcementSchema = new Schema<IAnnouncement>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 150 },
    body: { type: String, required: [true, "Body is required"], trim: true, maxlength: 3000 },
    category: { type: String, enum: ["general", "policy", "event", "celebration"], default: "general" },
    pinned: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

announcementSchema.index({ organization: 1, pinned: -1, createdAt: -1 });

export const Announcement = mongoose.model<IAnnouncement>("Announcement", announcementSchema);
