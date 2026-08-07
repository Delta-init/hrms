import { PerformanceCycle } from "../models/PerformanceCycle.js";
import { Appraisal } from "../models/Appraisal.js";
import { Employee } from "../models/Employee.js";
import type {
  CreateCycleInput, SetCycleStatusInput, SetGoalsInput, SubmitSelfReviewInput, ReviewAppraisalInput,
} from "../validations/performanceValidation.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

const APPRAISAL_POP = [
  { path: "employee", select: "name employeeCode designation department" },
  { path: "cycle", select: "title startDate endDate status" },
  { path: "reviewedBy", select: "name" },
];

export class PerformanceService {
  // ── Cycles (admin) ────────────────────────────────────────────────────────
  async createCycle(input: CreateCycleInput, createdBy: string) {
    return PerformanceCycle.create({ ...input, organization: getOrgId(), createdBy });
  }

  async listCycles() {
    return PerformanceCycle.find(orgFilter()).sort({ createdAt: -1 });
  }

  /**
   * Give every eligible employee an appraisal for this cycle.
   *
   * Only inserts what is missing, so it is safe to run repeatedly — which is
   * the point: this used to fire once, on the draft→active edge, and an
   * organization that gained an employee a minute later never got them an
   * appraisal and had no way to ask for one.
   *
   * An appraisal is keyed to a login, so employees without one can't have a
   * self-review to fill in. They are counted and reported rather than dropped
   * in silence — a cycle that generates nothing looks identical to a broken
   * feature otherwise.
   */
  private async syncAppraisals(cycleId: unknown) {
    const employees = await Employee.find(scoped({ status: "active" })).select("_id user").lean();
    const existing = await Appraisal.find({ cycle: cycleId }).select("employee").lean();
    const already = new Set(existing.map((a) => String(a.employee)));

    const pending = employees.filter((e) => !already.has(String(e._id)));
    const toCreate = pending.filter((e) => e.user);
    const skipped = pending.filter((e) => !e.user).length;

    if (toCreate.length) {
      await Appraisal.insertMany(
        toCreate.map((e) => ({ organization: getOrgId(), cycle: cycleId, employee: e._id, user: e.user, goals: [], status: "draft" }))
      );
    }
    return { generated: toCreate.length, skipped, existing: already.size };
  }

  async setCycleStatus(id: string, input: SetCycleStatusInput) {
    const cycle = await PerformanceCycle.findOne(scoped({ _id: id }));
    if (!cycle) throw Object.assign(new Error("Cycle not found"), { statusCode: 404 });
    if (cycle.status === "closed") throw Object.assign(new Error("Closed cycles cannot be reopened"), { statusCode: 400 });

    // Any move into `active` tops up the roster, not just the first one.
    const counts = input.status === "active" ? await this.syncAppraisals(cycle._id) : null;

    cycle.status = input.status;
    await cycle.save();
    return { cycle, ...(counts ?? {}) };
  }

  /** Pull employees hired since activation into a running cycle. */
  async syncCycle(id: string) {
    const cycle = await PerformanceCycle.findOne(scoped({ _id: id }));
    if (!cycle) throw Object.assign(new Error("Cycle not found"), { statusCode: 404 });
    if (cycle.status !== "active") {
      throw Object.assign(new Error("Only an active cycle can be synced"), { statusCode: 400 });
    }
    return { cycle, ...(await this.syncAppraisals(cycle._id)) };
  }

  async removeCycle(id: string) {
    const cycle = await PerformanceCycle.findOne(scoped({ _id: id }));
    if (!cycle) throw Object.assign(new Error("Cycle not found"), { statusCode: 404 });
    if (cycle.status !== "draft") throw Object.assign(new Error("Only draft cycles can be deleted"), { statusCode: 400 });
    await PerformanceCycle.deleteOne({ _id: cycle._id });
    return { message: "Cycle deleted successfully" };
  }

  // ── Appraisals (admin / manager review) ─────────────────────────────────
  async listAppraisals(query: { cycle?: string; status?: string }) {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.cycle) filter.cycle = query.cycle;
    if (query.status) filter.status = query.status;
    return Appraisal.find(filter).populate(APPRAISAL_POP).sort({ createdAt: -1 });
  }

  async getAppraisalById(id: string) {
    const record = await Appraisal.findOne(scoped({ _id: id })).populate(APPRAISAL_POP);
    if (!record) throw Object.assign(new Error("Appraisal not found"), { statusCode: 404 });
    return record;
  }

  async review(id: string, input: ReviewAppraisalInput, reviewerId: string) {
    const record = await Appraisal.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Appraisal not found"), { statusCode: 404 });
    if (record.status !== "submitted") {
      throw Object.assign(new Error("This employee hasn't submitted their self-review yet"), { statusCode: 400 });
    }

    const ratingByGoalId = new Map(input.goalRatings.map((g) => [g.goalId, g.managerRating]));
    for (const goal of record.goals) {
      const rating = ratingByGoalId.get(String(goal._id));
      if (rating !== undefined) goal.managerRating = rating;
    }
    if (input.managerComment !== undefined) record.managerComment = input.managerComment;

    const rated = record.goals.map((g) => g.managerRating).filter((r): r is number => r != null);
    record.overallRating = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 100) / 100 : null;
    record.status = "completed";
    record.completedAt = new Date();
    record.reviewedBy = reviewerId as never;
    await record.save();
    return Appraisal.findById(id).populate(APPRAISAL_POP);
  }

  // ── Self-service ("my appraisals") ──────────────────────────────────────
  async listMine(userId: string) {
    return Appraisal.find({ user: userId, ...orgFilter() }).populate(APPRAISAL_POP).sort({ createdAt: -1 });
  }

  async setGoals(userId: string, id: string, input: SetGoalsInput) {
    const record = await Appraisal.findOne(scoped({ _id: id, user: userId }));
    if (!record) throw Object.assign(new Error("Appraisal not found"), { statusCode: 404 });
    if (record.status !== "draft") {
      throw Object.assign(new Error("Goals can only be edited before you submit your self-review"), { statusCode: 400 });
    }
    record.goals = input.goals.map((g) => ({
      _id: g._id as never, title: g.title, description: g.description, weight: g.weight,
      selfRating: g.selfRating ?? null, managerRating: null,
    })) as never;
    await record.save();
    return Appraisal.findById(id).populate(APPRAISAL_POP);
  }

  async submitSelfReview(userId: string, id: string, input: SubmitSelfReviewInput) {
    const record = await Appraisal.findOne(scoped({ _id: id, user: userId }));
    if (!record) throw Object.assign(new Error("Appraisal not found"), { statusCode: 404 });
    if (record.status !== "draft") throw Object.assign(new Error("This self-review has already been submitted"), { statusCode: 400 });
    if (record.goals.length === 0) throw Object.assign(new Error("Add at least one goal before submitting"), { statusCode: 400 });

    if (input.selfComment !== undefined) record.selfComment = input.selfComment;
    record.status = "submitted";
    record.submittedAt = new Date();
    await record.save();
    return Appraisal.findById(id).populate(APPRAISAL_POP);
  }
}
