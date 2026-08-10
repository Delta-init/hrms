import { Candidate } from "../models/Candidate.js";
import { Application } from "../models/Application.js";
import { JobRequisition } from "../models/JobRequisition.js";
import { Interview } from "../models/Interview.js";
import { APPLICATION_STAGES } from "../types/index.js";
import type { ApplicationStage, PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";
import { publicUrl, deleteObject } from "./uploadService.js";
import type {
  CreateCandidateInput, UpdateCandidateInput, ApplyInput, MoveStageInput,
} from "../validations/candidateValidation.js";

/**
 * Candidates, and their applications against requisitions.
 *
 * The pipeline is one ordered list rather than a table of allowed transitions:
 * a stage's position in APPLICATION_STAGES is its position in the process, so
 * moving is a comparison. Recruiters skip stages constantly — a strong referral
 * goes straight to offer — and a rule that forbids it just gets worked around.
 */

class CandidateError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const CANDIDATE_POP = [{ path: "createdBy", select: "name email" }];
const APPLICATION_POP = [
  { path: "candidate", select: "name email phone currentCompany expectedSalary currency noticePeriodDays resumeKey resumeFileName" },
  { path: "requisition", select: "title department status headcount" },
];

/**
 * A stored candidate with its resume as a link rather than a key.
 *
 * The link is signed and short-lived, so it is minted per response rather than
 * stored — a CV is somebody's personal data and the bucket is private.
 */
function shape<T extends { resumeKey?: string | null }>(doc: T | null) {
  if (!doc) return doc;
  return { ...doc, resumeUrl: doc.resumeKey ? publicUrl(doc.resumeKey) : "" };
}

export class CandidateService {
  /**
   * Create, or return the one already on file.
   *
   * A person who applied before is the same person, and the second conversation
   * is better for knowing about the first — so a repeat email updates the
   * record rather than colliding with the unique index.
   */
  async create(input: CreateCandidateInput, createdBy: string) {
    const existing = await Candidate.findOne(scoped({ email: input.email.toLowerCase() }));
    if (existing) {
      Object.assign(existing, { ...input, email: existing.email });
      await existing.save();
      return { record: shape(existing.toObject()), reused: true };
    }
    const doc = await Candidate.create({ ...input, organization: getOrgId(), createdBy });
    return { record: shape(doc.toObject()), reused: false };
  }

  async list(query: PaginationQuery & { source?: string }) {
    const { page, limit, skip } = parsePagination(query, 20, 100);
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.source) filter.source = query.source;
    if (query.search) {
      const term = String(query.search).trim();
      filter.$or = [
        { name: { $regex: term, $options: "i" } },
        { email: { $regex: term, $options: "i" } },
        { currentCompany: { $regex: term, $options: "i" } },
      ];
    }

    const [records, total] = await Promise.all([
      Candidate.find(filter).populate(CANDIDATE_POP).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Candidate.countDocuments(filter),
    ]);
    return { records: records.map((r) => shape(r as never)), pagination: buildPagination(total, page, limit) };
  }

  /** One candidate, with every requisition they have been put forward for. */
  async getById(id: string) {
    const record = await Candidate.findOne(scoped({ _id: id })).populate(CANDIDATE_POP).lean();
    if (!record) throw new CandidateError("Candidate not found", 404);
    const applications = await Application.find(scoped({ candidate: id }))
      .populate({ path: "requisition", select: "title status type department" })
      .sort({ createdAt: -1 })
      .lean();

    const interviews = await Interview.find(scoped({ application: { $in: applications.map((a) => a._id) } }))
      .select("application round mode scheduledAt durationMinutes status meetingLink location recordingLink panel")
      .populate({ path: "panel", select: "name" })
      .sort({ scheduledAt: 1 })
      .lean();
    for (const a of applications) {
      (a as Record<string, unknown>).interviews = interviews.filter((iv) => String(iv.application) === String(a._id));
    }
    return { ...shape(record), applications };
  }

  async update(id: string, input: UpdateCandidateInput) {
    const record = await Candidate.findOneAndUpdate(scoped({ _id: id }), { $set: input }, { new: true }).lean();
    if (!record) throw new CandidateError("Candidate not found", 404);
    return shape(record as never);
  }

  async remove(id: string) {
    const inFlight = await Application.countDocuments(scoped({ candidate: id, status: "active" }));
    if (inFlight > 0) {
      throw new CandidateError(
        `This candidate is in ${inFlight} live pipeline${inFlight === 1 ? "" : "s"}. Reject or withdraw those first.`
      );
    }
    const record = await Candidate.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw new CandidateError("Candidate not found", 404);
    if (record.resumeKey) await deleteObject(record.resumeKey);
    return { message: "Candidate deleted successfully" };
  }

  /** Attach (or replace) a CV. */
  async setResume(id: string, key: string, fileName: string) {
    const record = await Candidate.findOne(scoped({ _id: id }));
    if (!record) throw new CandidateError("Candidate not found", 404);
    if (record.resumeKey) await deleteObject(record.resumeKey);
    record.resumeKey = key;
    record.resumeFileName = fileName;
    await record.save();
    return shape(record.toObject());
  }

  // ── Applications ───────────────────────────────────────────────────────────

  /**
   * Put a candidate forward for a requisition.
   *
   * Only an approved one. The whole point of the approval chain is that nobody
   * spends time recruiting for a role the business has not agreed to fill.
   */
  async apply(input: ApplyInput, by: string) {
    const req = await JobRequisition.findOne(scoped({ _id: input.requisition })).select("status title").lean();
    if (!req) throw new CandidateError("Requisition not found", 404);
    if (req.status !== "approved") {
      throw new CandidateError(
        `"${req.title}" is ${req.status}, not approved. Candidates can only be added to an approved requisition.`
      );
    }
    const candidate = await Candidate.findOne(scoped({ _id: input.candidate })).select("_id").lean();
    if (!candidate) throw new CandidateError("Candidate not found", 404);

    const existing = await Application.findOne(scoped({ requisition: input.requisition, candidate: input.candidate }));
    if (existing) throw new CandidateError("This candidate is already in that pipeline");

    const doc = await Application.create({
      organization: getOrgId(),
      requisition: input.requisition,
      candidate: input.candidate,
      stage: input.stage ?? "applied",
      stageHistory: [{ stage: input.stage ?? "applied", by, at: new Date() }],
    });
    return Application.findById(doc._id).populate(APPLICATION_POP);
  }

  /**
   * Every application on a requisition, grouped into the pipeline's columns.
   *
   * Each one carries its interviews, because "has anyone actually spoken to
   * them" is the question a board is scanned for, and a card that cannot answer
   * it sends you to another page to find out.
   */
  async pipeline(requisitionId: string) {
    const applications = await Application.find(scoped({ requisition: requisitionId }))
      .populate(APPLICATION_POP)
      .sort({ updatedAt: -1 })
      .lean();

    const interviews = await Interview.find(scoped({ application: { $in: applications.map((a) => a._id) } }))
      .select("application round mode scheduledAt durationMinutes status meetingLink location recordingLink panel")
      .populate({ path: "panel", select: "name" })
      .sort({ scheduledAt: 1 })
      .lean();
    const byApplication = new Map<string, typeof interviews>();
    for (const iv of interviews) {
      const key = String(iv.application);
      byApplication.set(key, [...(byApplication.get(key) ?? []), iv]);
    }
    for (const a of applications) {
      (a as Record<string, unknown>).interviews = byApplication.get(String(a._id)) ?? [];
    }

    const columns = APPLICATION_STAGES.map((stage) => ({
      stage,
      applications: applications.filter((a) => a.status === "active" && a.stage === stage),
    }));
    return {
      columns,
      // Out of the running, kept visible: a pipeline that hides its rejections
      // looks healthier than it is.
      closed: applications.filter((a) => a.status !== "active"),
      total: applications.length,
    };
  }

  async listApplications(query: PaginationQuery & { requisition?: string; stage?: string }) {
    const { page, limit, skip } = parsePagination(query, 50, 200);
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.requisition) filter.requisition = query.requisition;
    if (query.stage) filter.stage = query.stage;
    if (query.status) filter.status = query.status;

    const [records, total] = await Promise.all([
      Application.find(filter).populate(APPLICATION_POP).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      Application.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  /**
   * Move an application along, or out.
   *
   * Backwards is allowed — a candidate sent to interview too early gets sent
   * back to screening, and refusing that would only mean the stage stops
   * reflecting reality.
   */
  async moveStage(id: string, input: MoveStageInput, by: string) {
    const record = await Application.findOne(scoped({ _id: id }));
    if (!record) throw new CandidateError("Application not found", 404);

    // Closed once meant closed for good. A rejection is often reconsidered and a
    // waitlisted candidate is parked precisely so they can come back, so the way
    // out is an explicit restore rather than a silent stage change.
    const restoring = input.status === "active";
    if (record.status !== "active" && !restoring) {
      throw new CandidateError(`This application is ${record.status}. Restore it first to move them again.`);
    }

    if (input.status && input.status !== "active") {
      record.status = input.status;
      record.rejectionReason = input.reason ?? undefined;
    } else if (restoring) {
      record.status = "active";
      record.rejectionReason = undefined;
    }

    if (input.stage) {
      // Becoming an employee is its own step, with a record to create and
      // onboarding to seed. It is not a column somebody drags a card into.
      if (input.stage === "hired") {
        throw new CandidateError("Marking somebody hired happens when their employee record is created, not here");
      }
      // An offer is the first irreversible thing anybody says to a candidate.
      if (input.stage === "offer" && record.offerApproval?.status !== "approved") {
        record.offerApproval = {
          status: "pending",
          requestedBy: by as never,
          requestedAt: new Date(),
          decidedBy: null,
          decidedAt: null,
        } as never;
      }
      if (input.stage === "accepted" && record.offerApproval?.status !== "approved") {
        throw new CandidateError(
          "The offer has not been approved yet. Management sign off before it goes out, and before it can be accepted."
        );
      }
      record.stage = input.stage as ApplicationStage;
    }
    if (input.rating !== undefined) record.rating = input.rating;
    if (input.offeredSalary !== undefined) record.offeredSalary = input.offeredSalary;

    record.stageHistory = [
      ...(record.stageHistory ?? []),
      {
        stage: (input.status && input.status !== "active" ? input.status : record.stage) as never,
        by: by as never,
        at: new Date(),
        note: input.reason ?? input.note ?? (restoring ? "restored" : undefined),
      },
    ];
    await record.save();
    return Application.findById(id).populate(APPLICATION_POP);
  }

  /**
   * Offers waiting on management.
   *
   * Surfaced as a list of its own because an approval nobody can find is an
   * approval that does not happen — the candidate simply waits.
   */
  async pendingOffers() {
    return Application.find(scoped({ "offerApproval.status": "pending" }))
      .populate(APPLICATION_POP)
      .populate({ path: "offerApproval.requestedBy", select: "name email" })
      .sort({ "offerApproval.requestedAt": 1 })
      .lean();
  }

  /**
   * Release an offer, or refuse it.
   *
   * Management only — the same people who own the headcount decision own the
   * number that goes out with it.
   */
  async decideOffer(id: string, approve: boolean, note: string | undefined, by: string) {
    const record = await Application.findOne(scoped({ _id: id }));
    if (!record) throw new CandidateError("Application not found", 404);
    if (record.offerApproval?.status !== "pending") {
      throw new CandidateError("There is no offer waiting for a decision on this application");
    }

    record.offerApproval = {
      ...(record.offerApproval as object),
      status: approve ? "approved" : "rejected",
      decidedBy: by,
      decidedAt: new Date(),
      note,
    } as never;

    // A refused offer does not reject the candidate — the number was wrong, not
    // the person — so they go back a stage rather than out of the process.
    if (!approve) record.stage = "interview";

    record.stageHistory = [
      ...(record.stageHistory ?? []),
      { stage: (approve ? "offer approved" : "offer refused") as never, by: by as never, at: new Date(), note },
    ];
    await record.save();
    return Application.findById(id).populate(APPLICATION_POP);
  }

  async removeApplication(id: string) {
    const record = await Application.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw new CandidateError("Application not found", 404);
    return { message: "Application removed" };
  }
}
