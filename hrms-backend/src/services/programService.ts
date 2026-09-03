import { Types } from "mongoose";
import { Program } from "../models/Program.js";
import { ProgramRegistration } from "../models/ProgramRegistration.js";
import { User } from "../models/User.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { notify } from "./notificationService.js";
import { putObject, deleteObject, attachmentKey, publicUrl } from "./uploadService.js";
import type { CreateProgramInput, UpdateProgramInput } from "../validations/programValidation.js";

/**
 * Programs, and the places in them.
 *
 * The seat accounting is the only interesting part. Everything else is a list
 * and a form.
 */

const err = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/**
 * Add the banner's URL to a `lean()` row.
 *
 * `lean()` skips the schema's toJSON transform, so every read that uses it has
 * to do this itself — the same shape the employee list uses for photos. Missed,
 * the field is simply absent and the card silently renders without an image,
 * which is the kind of bug that survives review because nothing errors.
 */
const withImage = <T extends { image?: string }>(row: T): T & { imageUrl: string } => ({
  ...row,
  imageUrl: row.image ? publicUrl(String(row.image)) : "",
});

/** A program with the caller's own place in it, for the staff-facing list. */
export interface ProgramForUser {
  program: Record<string, unknown>;
  registered: boolean;
  seatsLeft: number | null;
  full: boolean;
}

export class ProgramService {
  // ── Managing ──────────────────────────────────────────────────────────────

  async create(input: CreateProgramInput, createdBy: string) {
    return Program.create({ ...input, organization: getOrgId(), seatsTaken: 0, createdBy });
  }

  async list(query: { status?: string } = {}) {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status;
    return (await Program.find(filter).sort({ startsAt: 1 }).populate("createdBy", "name").lean()).map(withImage);
  }

  async getById(id: string) {
    const program = await Program.findOne(scoped({ _id: id })).populate("createdBy", "name").lean();
    if (!program) throw err("Program not found", 404);
    return withImage(program);
  }

  /**
   * Amend a program.
   *
   * `capacity` is allowed to move, including below what is already taken — a
   * room genuinely does get smaller sometimes. It is refused only where it
   * would make the numbers dishonest rather than merely awkward: nobody is
   * un-booked automatically, so a capacity under `seatsTaken` is reported as
   * over-subscribed and the manager decides who to remove.
   *
   * `seatsTaken` is never accepted from a caller. It is derived by the claim
   * below, and letting a form set it would undo the guarantee that makes the
   * claim safe.
   */
  async update(id: string, input: UpdateProgramInput) {
    const program = await Program.findOne(scoped({ _id: id }));
    if (!program) throw err("Program not found", 404);

    if (input.capacity !== undefined && input.capacity > 0 && input.capacity < program.seatsTaken) {
      throw err(
        `${program.seatsTaken} ${program.seatsTaken === 1 ? "person is" : "people are"} already registered. ` +
          `Remove someone first, or set the capacity to at least ${program.seatsTaken}.`,
        400
      );
    }

    Object.assign(program, input);
    await program.save();
    const saved = await Program.findById(program._id).populate("createdBy", "name").lean();
    return saved ? withImage(saved) : saved;
  }

  /**
   * Delete a program and the register with it.
   *
   * The registrations are meaningless without the program they point at — a
   * row saying somebody has a place in something that no longer exists cannot
   * be displayed anywhere and cannot be acted on. Unlike a payslip, nothing
   * downstream depends on them.
   */
  async remove(id: string) {
    const program = await Program.findOneAndDelete(scoped({ _id: id }));
    if (!program) throw err("Program not found", 404);
    await ProgramRegistration.deleteMany(scoped({ program: id }));
    // The banner goes too — an orphaned object nothing references is a bill
    // nobody can trace back to anything.
    if (program.image) await deleteObject(String(program.image));
    return { message: "Program deleted" };
  }

  /**
   * Replace the banner.
   *
   * The previous object is deleted after the new key is stored, not before: if
   * the upload fails the program keeps the image it had, rather than losing the
   * old one and gaining nothing.
   */
  async setImage(id: string, file: { buffer: Buffer; mimetype: string }, ext: string) {
    const program = await Program.findOne(scoped({ _id: id }));
    if (!program) throw err("Program not found", 404);

    const previous = program.image;
    const key = attachmentKey(getOrgId(), String(program._id), "programs", ext, Date.now());
    await putObject(key, file.buffer, file.mimetype);
    program.image = key;
    await program.save();
    if (previous && previous !== key) await deleteObject(String(previous));

    const saved = await Program.findById(program._id).lean();
    return withImage(saved as { image?: string });
  }

  /** Who is on it, for the manager's view. */
  async registrations(id: string) {
    await this.getById(id);
    return ProgramRegistration.find(scoped({ program: id, status: "registered" }))
      .populate("user", "name email")
      .sort({ registeredAt: 1 })
      .lean();
  }

  // ── Booking ───────────────────────────────────────────────────────────────

  /**
   * Take a place, or fail because there is not one.
   *
   * The order here is the whole safety argument, so it is worth stating plainly.
   *
   * The seat is claimed FIRST, with a single `findOneAndUpdate` whose filter
   * carries the capacity test and whose update increments the count. Mongo
   * applies that to one document atomically, so of two people racing for the
   * last place exactly one matches and the other gets null. Reading the count
   * and then writing would let both through — and there are no multi-document
   * transactions to fall back on, because the database is a standalone.
   *
   * Only then is the registration written. If that fails — they already have a
   * place, the commonest case — the claim is handed back, because a seat
   * counted against somebody who is not registered is a place nobody can ever
   * use.
   */
  async register(programId: string, userId: string) {
    const program = await Program.findOne(scoped({ _id: programId })).lean();
    if (!program) throw err("Program not found", 404);
    if (program.status === "cancelled") throw err("This program has been cancelled", 400);
    if (program.status === "draft") throw err("This program is not open yet", 400);
    if (program.status === "closed") throw err("Registration for this program has closed", 400);
    if (program.startsAt.getTime() <= Date.now()) throw err("This program has already started", 400);

    // Already on it — answered before claiming anything, so the ordinary
    // double-click does not have to be unwound below.
    const existing = await ProgramRegistration.findOne(scoped({ program: programId, user: userId }));
    if (existing?.status === "registered") throw err("You already have a place on this program", 409);

    const unlimited = !program.capacity;
    if (!unlimited) {
      // The claim. The filter is the guard and the update is the claim, in one
      // operation — this is what makes the last place unforgeable.
      const claimed = await Program.findOneAndUpdate(
        scoped({ _id: programId, status: "open", $expr: { $lt: ["$seatsTaken", "$capacity"] } }),
        { $inc: { seatsTaken: 1 } },
        { new: true }
      );
      if (!claimed) throw err("This program is full", 409);
    }

    try {
      if (existing) {
        // They cancelled earlier and have come back. The row is reused, because
        // the unique index means there can only ever be one.
        existing.status = "registered";
        existing.registeredAt = new Date();
        existing.cancelledAt = null;
        await existing.save();
      } else {
        await ProgramRegistration.create({
          organization: getOrgId(),
          program: programId,
          user: userId,
          status: "registered",
          registeredAt: new Date(),
        });
      }
    } catch (e) {
      // Hand the place back. Without this a failed write leaves a seat counted
      // against nobody, and the program fills up with people who are not on it.
      if (!unlimited) await Program.updateOne({ _id: programId }, { $inc: { seatsTaken: -1 } });
      throw e;
    }

    await notify({
      users: [userId],
      kind: "announcement",
      tone: "positive",
      title: `You have a place on ${program.title}`,
      body: `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(program.startsAt)}${program.location ? ` · ${program.location}` : ""}`,
      href: "/programs",
    });

    return this.forUser(programId, userId);
  }

  /**
   * Give a place back.
   *
   * The seat is released only when a row that was actually registered moves to
   * cancelled — the status change is the gate. Releasing on the strength of the
   * request alone would let somebody cancel twice and free two places, which is
   * the same overbooking bug approached from the other end.
   */
  async cancel(programId: string, userId: string) {
    const program = await Program.findOne(scoped({ _id: programId })).lean();
    if (!program) throw err("Program not found", 404);
    if (program.startsAt.getTime() <= Date.now()) {
      throw err("This program has already started, so a place cannot be given up here. Ask HR.", 400);
    }

    // Matched on the status as well as the ids, so a second cancel matches
    // nothing and releases nothing.
    const cancelled = await ProgramRegistration.findOneAndUpdate(
      scoped({ program: programId, user: userId, status: "registered" }),
      { $set: { status: "cancelled", cancelledAt: new Date() } }
    );
    if (!cancelled) throw err("You do not have a place on this program", 404);

    if (program.capacity) {
      // Floored at zero: a count that has drifted below what is real should not
      // be driven negative by a correct cancellation.
      await Program.updateOne({ _id: programId, seatsTaken: { $gt: 0 } }, { $inc: { seatsTaken: -1 } });
    }
    return this.forUser(programId, userId);
  }

  // ── The staff-facing view ─────────────────────────────────────────────────

  /** One program, with this person's place in it. */
  private async forUser(programId: string, userId: string): Promise<ProgramForUser> {
    const program = await Program.findOne(scoped({ _id: programId })).lean();
    if (!program) throw err("Program not found", 404);
    const mine = await ProgramRegistration.findOne(scoped({ program: programId, user: userId, status: "registered" }))
      .select("_id")
      .lean();
    return this.shape(program as never, !!mine);
  }

  private shape(program: Record<string, unknown> & { capacity?: number; seatsTaken?: number }, registered: boolean): ProgramForUser {
    const capacity = Number(program.capacity ?? 0);
    const taken = Number(program.seatsTaken ?? 0);
    return {
      program: withImage(program as { image?: string }) as Record<string, unknown>,
      registered,
      // Null rather than a large number where there is no limit: "unlimited" and
      // "lots left" read differently and the screen says different things.
      seatsLeft: capacity ? Math.max(0, capacity - taken) : null,
      full: capacity ? taken >= capacity : false,
    };
  }

  /**
   * What this person can see and book: open programs that have not started.
   *
   * Their own registrations are read in one query rather than one per program —
   * a list of twenty would otherwise be twenty round trips to answer the same
   * question twenty times.
   */
  async listForUser(userId: string): Promise<ProgramForUser[]> {
    const programs = await Program.find(scoped({ status: "open", startsAt: { $gt: new Date() } }))
      .sort({ startsAt: 1 })
      .lean();
    if (!programs.length) return [];

    const mine = await ProgramRegistration.find(
      scoped({ user: userId, status: "registered", program: { $in: programs.map((p) => p._id) } })
    )
      .select("program")
      .lean();
    const registered = new Set(mine.map((m) => String(m.program)));
    return programs.map((p) => this.shape(p as never, registered.has(String(p._id))));
  }

  /**
   * Tell everybody a program is open, once.
   *
   * Called when a program is published rather than on a timer: the point is
   * that people hear about it while there are still places, and a nightly job
   * would announce a half-full program the morning after it filled.
   */
  async announce(programId: string) {
    const program = await Program.findOne(scoped({ _id: programId })).lean();
    if (!program || program.status !== "open") return 0;
    const users = await User.find(scoped({ status: { $ne: "inactive" } })).select("_id").lean();
    return notify({
      users: users.map((u) => u._id),
      kind: "announcement",
      title: `New program: ${program.title}`,
      body: `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(program.startsAt)}${program.capacity ? ` · ${program.capacity} places` : ""}`,
      href: "/programs",
    });
  }
}

/** Ids that are not ids would otherwise reach Mongo as a cast error. */
export const isId = (v: string) => Types.ObjectId.isValid(v);
