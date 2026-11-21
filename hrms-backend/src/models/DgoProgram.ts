import mongoose, { Schema } from "mongoose";

/**
 * DGO Points switched on or off for an organisation, which of its
 * departments count as revenue departments for the 55/45 split, who sees the
 * leaderboard, the nomination limit and the monthly achiever categories.
 *
 * Operational, so not versioned like the settings: a month's budget copies the
 * grouping it was opened with, which is what keeps an earlier month unchanged
 * when a department is moved between groups later.
 */
const dgoProgramSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    /** Off until an admin opens it: until then only staff with a DGO permission, heads and Super Admins see anything. */
    openToEmployees: { type: Boolean, default: false },
    revenueDepartments: { type: [{ type: Schema.Types.ObjectId, ref: "Department" }], default: [] },
    /** Who it is open to once switched on: everybody, or a pilot group of departments and people (Phase 4). */
    audience: { type: String, enum: ["everyone", "pilot"], default: "everyone" },
    pilotDepartments: { type: [{ type: Schema.Types.ObjectId, ref: "Department" }], default: [] },
    pilotEmployees: { type: [{ type: Schema.Types.ObjectId, ref: "Employee" }], default: [] },
    /** Who sees the points leaderboard: everybody, their own department, or only managers (everyone always sees their own line). */
    leaderboardVisibility: { type: String, enum: ["everyone", "department", "managers"], default: "everyone" },
    /** Nominations one person may send in a month. */
    nominationsPerMonth: { type: Number, min: 0, max: 100, default: 4 },
    /** The monthly achiever (elite) categories; empty means the defaults. A month copies them when its figures are fetched. */
    eliteCategories: {
      type: [{
        _id: false,
        code: { type: String, required: true },
        name: { type: String, required: true },
        metric: { type: String, required: true },
        place: { type: Number, required: true },
        threshold: { type: Number, required: true },
        prizeAed: { type: Number, required: true },
        active: { type: Boolean, required: true },
      }],
      default: [],
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** The day the nightly DGO job last ran here, so two servers never run it twice. */
    lastDailyRun: { type: String, default: null },
  },
  { timestamps: true, versionKey: false }
);

dgoProgramSchema.index({ organization: 1 }, { unique: true });

export const DgoProgram = mongoose.model("DgoProgram", dgoProgramSchema);
