import mongoose, { Schema } from "mongoose";
import type { IProgram } from "../types/index.js";
import { publicUrl } from "../config/r2.js";

/**
 * Something staff can put their name down for: a training session, a workshop,
 * an induction — anything with a date and a limited number of places.
 *
 * The seat count lives here rather than being counted from the registrations,
 * and that is the whole design. Counting would mean reading the registrations,
 * deciding there is room, and then writing one — three steps across two
 * collections, which cannot be made atomic on a standalone MongoDB because
 * there are no multi-document transactions to wrap them in. Two people
 * pressing Book on the last place at the same moment would both pass the check.
 *
 * A counter on this one document can be claimed and guarded in a single
 * operation instead, so the last seat can only be taken once. `seatsTaken` is
 * therefore the authority on how full a program is, and the registrations are
 * the record of who is in it — see `programService.register` for the ordering
 * that keeps the two agreeing.
 */
const programSchema = new Schema<IProgram>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 2000 },
    /** Where it happens — a room, an address, or a meeting link. */
    location: { type: String, trim: true, maxlength: 200, default: "" },
    startsAt: { type: Date, required: [true, "A start time is required"] },
    endsAt: { type: Date, default: null },
    /**
     * Places available. Zero means unlimited — a briefing everybody may attend
     * still wants a register, and refusing to save one without a number would
     * push people into typing 999.
     */
    capacity: { type: Number, default: 0, min: 0, max: 100_000 },
    /**
     * Places claimed. Never written directly outside the atomic claim in the
     * service: an assignment here would undo the guard that makes it safe.
     */
    seatsTaken: { type: Number, default: 0, min: 0 },
    /**
     * Draft is invisible to staff; open accepts registrations; closed keeps the
     * register readable but takes no more; cancelled means it is not happening.
     */
    status: { type: String, enum: ["draft", "open", "closed", "cancelled"], default: "draft", index: true },
    /**
     * A banner, stored as an R2 key rather than a URL.
     *
     * The key is what survives: a stored URL bakes in the host and the signing
     * scheme, and both have changed here before. `publicUrl()` builds the link
     * at read time from whatever the configuration says today.
     */
    image: { type: String, trim: true, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

// The list everybody sees: this organisation's open programs, soonest first.
programSchema.index({ organization: 1, status: 1, startsAt: 1 });

/**
 * Serve the stored key as a URL, the way the employee photo does.
 *
 * Added on read rather than stored, so a page never has to know how files are
 * hosted — and `lean()` reads bypass this, which is why the service adds it
 * explicitly there.
 */
programSchema.set("toJSON", {
  transform(_doc, ret) {
    // Cast the way the employee schema does — Mongoose types `ret` as the
    // document, and the added field is not on it.
    const out = ret as unknown as Record<string, unknown>;
    out.imageUrl = out.image ? publicUrl(String(out.image)) : "";
    return out;
  },
});

export const Program = mongoose.model<IProgram>("Program", programSchema);
