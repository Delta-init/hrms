import mongoose, { Schema } from "mongoose";
import type { ICard } from "../types/index.js";

const cardSchema = new Schema<ICard>(
  {
    cardNumber: {
      type: String,
      required: [true, "Card number is required"],
      unique: true,
      trim: true,
      maxlength: [40, "Card number cannot exceed 40 characters"],
    },
    name: {
      type: String,
      required: [true, "Name on card is required"],
      trim: true,
      maxlength: [120, "Name cannot exceed 120 characters"],
    },
    client: { type: Schema.Types.ObjectId, ref: "User", required: [true, "Client is required"] },
    issueDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Derived status from expiry date.
cardSchema.virtual("status").get(function (this: ICard) {
  if (this.expiryDate && new Date(this.expiryDate).getTime() < Date.now()) return "expired";
  return "active";
});

cardSchema.index({ client: 1 });

export const Card = mongoose.model<ICard>("Card", cardSchema);
