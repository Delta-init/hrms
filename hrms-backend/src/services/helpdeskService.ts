import { HelpdeskTicket } from "../models/HelpdeskTicket.js";
import type {
  CreateTicketInput, AssignTicketInput, SetTicketStatusInput, AddCommentInput,
} from "../validations/helpdeskValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";

interface TicketQuery extends PaginationQuery {
  status?: string;
  category?: string;
  assignedTo?: string;
}

const POP = [
  { path: "createdBy", select: "name email" },
  { path: "assignedTo", select: "name email" },
  { path: "comments.author", select: "name" },
];

export class HelpdeskService {
  async create(input: CreateTicketInput, createdBy: string) {
    const doc = await HelpdeskTicket.create({ ...input, organization: getOrgId(), createdBy, status: "open" });
    return HelpdeskTicket.findById(doc._id).populate(POP);
  }

  /** The caller's own tickets (self-service). */
  async listMine(userId: string) {
    return HelpdeskTicket.find(scoped({ createdBy: userId })).sort({ createdAt: -1 }).populate(POP);
  }

  async list(query: TicketQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 100);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.assignedTo) filter.assignedTo = query.assignedTo;
    if (query.search) filter.subject = searchRegex(query.search);

    const [records, total] = await Promise.all([
      HelpdeskTicket.find(filter).populate(POP).sort({ createdAt: -1 }).skip(skip).limit(limit),
      HelpdeskTicket.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await HelpdeskTicket.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });
    return record;
  }

  async assign(id: string, input: AssignTicketInput) {
    const record = await HelpdeskTicket.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });
    record.assignedTo = (input.assignedTo || null) as never;
    if (input.assignedTo && record.status === "open") record.status = "in_progress";
    await record.save();
    return HelpdeskTicket.findById(id).populate(POP);
  }

  async setStatus(id: string, input: SetTicketStatusInput) {
    const record = await HelpdeskTicket.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });
    record.status = input.status;
    record.resolvedAt = input.status === "resolved" || input.status === "closed" ? new Date() : null;
    await record.save();
    return HelpdeskTicket.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await HelpdeskTicket.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });
    return { message: "Ticket deleted successfully" };
  }

  /** Add a comment — allowed for the ticket's owner, its assignee, or anyone with helpdesk.edit. */
  async addComment(id: string, userId: string, input: AddCommentInput, canManage: boolean) {
    const record = await HelpdeskTicket.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });
    const isOwner = String(record.createdBy) === String(userId);
    const isAssignee = !!record.assignedTo && String(record.assignedTo) === String(userId);
    if (!isOwner && !isAssignee && !canManage) {
      throw Object.assign(new Error("You don't have access to this ticket"), { statusCode: 403 });
    }
    record.comments.push({ author: userId as never, body: input.body, at: new Date() });
    await record.save();
    return HelpdeskTicket.findById(id).populate(POP);
  }
}
