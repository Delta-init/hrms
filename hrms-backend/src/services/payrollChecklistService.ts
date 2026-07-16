import { PayrollChecklistItem, DEFAULT_CHECKLIST } from "../models/PayrollChecklistItem.js";
import type { CreateChecklistItemInput, UpdateChecklistItemInput } from "../validations/payrollChecklistValidation.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

export class PayrollChecklistService {
  /** List the org's checklist; lazily seed defaults the first time it's read. */
  async list() {
    const count = await PayrollChecklistItem.countDocuments(orgFilter());
    if (count === 0) {
      await PayrollChecklistItem.insertMany(
        DEFAULT_CHECKLIST.map((d, i) => ({ ...d, order: i, organization: getOrgId() }))
      );
    }
    return PayrollChecklistItem.find(orgFilter()).sort({ order: 1, createdAt: 1 });
  }

  async create(input: CreateChecklistItemInput) {
    const last = await PayrollChecklistItem.findOne(orgFilter()).sort({ order: -1 }).select("order");
    return PayrollChecklistItem.create({
      organization: getOrgId(),
      label: input.label,
      link: input.link ?? "",
      order: input.order ?? (last ? last.order + 1 : 0),
    });
  }

  async update(id: string, input: UpdateChecklistItemInput) {
    const item = await PayrollChecklistItem.findOne(scoped({ _id: id }));
    if (!item) throw Object.assign(new Error("Checklist item not found"), { statusCode: 404 });
    if (input.label !== undefined) item.label = input.label;
    if (input.link !== undefined) item.link = input.link ?? "";
    if (input.order !== undefined) item.order = input.order;
    await item.save();
    return item;
  }

  async remove(id: string) {
    const item = await PayrollChecklistItem.findOneAndDelete(scoped({ _id: id }));
    if (!item) throw Object.assign(new Error("Checklist item not found"), { statusCode: 404 });
  }
}
