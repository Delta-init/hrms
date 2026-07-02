import mongoose, { Schema } from "mongoose";
import type { IEmployee } from "../types/index.js";

const employeeSchema = new Schema<IEmployee>(
  {
    employeeCode: {
      type: String,
      required: [true, "Employee code is required"],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [20, "Employee code cannot exceed 20 characters"],
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    phone: { type: String, trim: true, maxlength: [30, "Phone cannot exceed 30 characters"] },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    designation: { type: String, trim: true, maxlength: [100, "Designation cannot exceed 100 characters"] },
    workSchedule: { type: Schema.Types.ObjectId, ref: "WorkSchedule", default: null },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    employmentType: {
      type: String,
      enum: ["full_time", "part_time", "contract", "intern"],
      default: "full_time",
    },
    joiningDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ["active", "probation", "on_leave", "terminated"],
      default: "active",
    },
    location: { type: String, trim: true, maxlength: [120, "Location cannot exceed 120 characters"] },
    salary: { type: Number, default: 0, min: 0 },
    currency: { type: String, trim: true, uppercase: true, default: "AED", maxlength: 6 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

employeeSchema.index({ department: 1 });
employeeSchema.index({ status: 1 });

export const Employee = mongoose.model<IEmployee>("Employee", employeeSchema);
