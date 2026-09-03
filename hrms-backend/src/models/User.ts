import mongoose, { Schema } from "mongoose";
import bcrypt from "bcryptjs";
import type { IUser } from "../types/index.js";

const userSchema = new Schema<IUser>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    role: {
      type: Schema.Types.ObjectId,
      ref: "Role",
      required: [true, "Role is required"],
    },
    designation: {
      type: String,
      trim: true,
      maxlength: [100, "Designation cannot exceed 100 characters"],
    },
    workSchedule: {
      type: Schema.Types.ObjectId,
      ref: "WorkSchedule",
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "invited"],
      default: "active",
    },
    /**
     * When an invitation was last emailed to this person.
     *
     * Written only once the mail actually left, so a batch that stops halfway
     * can be re-run and pick up where it stopped instead of starting again —
     * and nobody gets a second password that invalidates the one they were just
     * sent.
     */
    invitedAt: { type: Date, default: null },
    // When true, the user must set a new password before normal access
    // (used by the admin-invite / first-password flow).
    mustResetPassword: {
      type: Boolean,
      default: false,
    },
    // When false, the user is sent through the onboarding form on login to
    // fill mandatory details on their linked employee record.
    profileCompleted: {
      type: Boolean,
      default: false,
    },
    /**
     * Whether this particular account is held at the agreements wall.
     *
     * Stamped once, at activation — see `AuthService.setPassword` — rather than
     * derived live from the organisation's setting on every login. The org
     * setting is a switch that says "require it of new joiners going forward";
     * checking it live at login time cannot express "going forward", because it
     * has no memory of who was already using the system before the switch was
     * turned on. Read literally, it would hold everyone with no signature —
     * which the day this ships is nearly the whole company, since agreements
     * are new and almost nobody who joined before this feature existed has one.
     *
     * True only for an account that was `status: "invited"` at the exact moment
     * it set its first password, with the organisation's setting on at that
     * moment. An account created directly as active, or one that activated
     * before the setting existed, never has this set and is never held —
     * matching "invited employees only" precisely, because it is captured at
     * the one point in the lifecycle where that phrase is unambiguous.
     */
    agreementsRequired: {
      type: Boolean,
      default: false,
    },
    // Stamped into every issued token; bumping it invalidates all outstanding
    // access and refresh tokens for this user (logout, password change, or an
    // admin revoking a compromised session).
    tokenVersion: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare passwords
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete (ret as { password?: unknown }).password;
    return ret;
  },
});

// email index is created by `unique: true` above
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });

export const User = mongoose.model<IUser>("User", userSchema);
