import { Card } from "../models/Card.js";
import type { CreateCardInput, UpdateCardInput } from "../validations/cardValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";

interface CardQuery extends PaginationQuery {
  client?: string;
  status?: string; // "active" | "expired"
}

const POP = { path: "client", select: "name email" };

export class CardService {
  async create(input: CreateCardInput) {
    const existing = await Card.findOne({ cardNumber: input.cardNumber.trim() });
    if (existing) throw Object.assign(new Error("Card number already exists"), { statusCode: 409 });
    const card = await Card.create(input);
    return Card.findById(card._id).populate(POP);
  }

  async list(query: CardQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.search) {
      const rx = new RegExp(query.search, "i");
      filter.$or = [{ cardNumber: rx }, { name: rx }];
    }
    if (query.client) filter.client = query.client;
    if (query.status === "expired") filter.expiryDate = { $ne: null, $lt: new Date() };
    else if (query.status === "active") filter.$and = [{ $or: [{ expiryDate: null }, { expiryDate: { $gte: new Date() } }] }];

    const sortable = new Set(["cardNumber", "name", "issueDate", "expiryDate", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Card.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      Card.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Card.findById(id).populate(POP);
    if (!record) throw Object.assign(new Error("Card not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateCardInput) {
    const record = await Card.findById(id);
    if (!record) throw Object.assign(new Error("Card not found"), { statusCode: 404 });
    if (input.cardNumber && input.cardNumber.trim() !== record.cardNumber) {
      const dupe = await Card.findOne({ cardNumber: input.cardNumber.trim(), _id: { $ne: id } });
      if (dupe) throw Object.assign(new Error("Card number already exists"), { statusCode: 409 });
    }
    Object.assign(record, input);
    await record.save();
    return Card.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Card.findByIdAndDelete(id);
    if (!record) throw Object.assign(new Error("Card not found"), { statusCode: 404 });
  }
}
