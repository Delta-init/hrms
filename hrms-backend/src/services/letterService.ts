import { LetterTemplate } from "../models/LetterTemplate.js";
import { GeneratedLetter } from "../models/GeneratedLetter.js";
import { Employee } from "../models/Employee.js";
import { Organization } from "../models/Organization.js";
import type {
  CreateLetterTemplateInput, UpdateLetterTemplateInput, GenerateLetterInput, UpdateGeneratedLetterInput,
} from "../validations/letterValidation.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex } from "../utils/query.js";

const LETTER_POP = [
  { path: "employee", select: "name employeeCode designation department joiningDate" },
  { path: "issuedBy", select: "name" },
];

interface GeneratedLetterQuery {
  employee?: string;
  category?: string;
  search?: string;
}

const fmtDate = (d?: Date | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(d)) : "";

/** Flat, dotted merge context — the single source of truth for what {{tokens}} resolve to. */
async function buildMergeContext(employeeId: string, orgId: string | null): Promise<Record<string, string>> {
  const employee = await Employee.findOne(scoped({ _id: employeeId }))
    .populate<{ department: { name?: string } | null }>("department", "name")
    .populate<{ reportingTo: { name?: string } | null }>("reportingTo", "name");
  if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

  const org = orgId ? await Organization.findById(orgId).select("name code") : null;

  return {
    "employee.name": employee.name ?? "",
    "employee.employeeCode": employee.employeeCode ?? "",
    "employee.designation": employee.designation ?? "",
    "employee.department": (employee.department as { name?: string } | null)?.name ?? "",
    "employee.email": employee.email ?? "",
    "employee.phone": employee.phone ?? employee.mobileNumber ?? "",
    "employee.joiningDate": fmtDate(employee.joiningDate),
    "employee.salary": employee.salary ? `${employee.currency ?? "AED"} ${employee.salary.toLocaleString()}` : "",
    "employee.location": employee.location ?? "",
    "employee.reportingTo": (employee.reportingTo as { name?: string } | null)?.name ?? "",
    "organization.name": org?.name ?? "",
    "organization.code": org?.code ?? "",
    "date.today": fmtDate(new Date()),
  };
}

/** Replace every {{merge.token}} in `body` with its resolved value (blank if unknown). */
function renderTemplate(body: string, ctx: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => ctx[key] ?? "");
}

export class LetterService {
  // ── Templates ──────────────────────────────────────────────────────────
  async createTemplate(input: CreateLetterTemplateInput, createdBy: string) {
    const existing = await LetterTemplate.findOne(scoped({ name: input.name.trim() }));
    if (existing) throw Object.assign(new Error("A template with this name already exists"), { statusCode: 409 });
    return LetterTemplate.create({ organization: getOrgId(), ...input, createdBy });
  }

  async listTemplates(query: { search?: string } = {}) {
    const filter: Record<string, unknown> = scoped({});
    if (query.search) filter.name = searchRegex(query.search);
    return LetterTemplate.find(filter).sort({ name: 1 });
  }

  async getTemplateById(id: string) {
    const record = await LetterTemplate.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Template not found"), { statusCode: 404 });
    return record;
  }

  async updateTemplate(id: string, input: UpdateLetterTemplateInput) {
    const record = await LetterTemplate.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Template not found"), { statusCode: 404 });
    if (input.name && input.name !== record.name) {
      const clash = await LetterTemplate.findOne(scoped({ name: input.name.trim(), _id: { $ne: id } }));
      if (clash) throw Object.assign(new Error("A template with this name already exists"), { statusCode: 409 });
    }
    Object.assign(record, input);
    await record.save();
    return record;
  }

  async removeTemplate(id: string) {
    const record = await LetterTemplate.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Template not found"), { statusCode: 404 });
    return { message: "Template deleted successfully" };
  }

  // ── Generated letters ─────────────────────────────────────────────────
  async generateLetter(input: GenerateLetterInput, issuedBy: string) {
    const template = await LetterTemplate.findOne(scoped({ _id: input.templateId }));
    if (!template) throw Object.assign(new Error("Template not found"), { statusCode: 404 });

    const orgId = getOrgId();
    const ctx = await buildMergeContext(input.employee, orgId);
    const subject = template.subject ? renderTemplate(template.subject, ctx) : template.name;
    const content = renderTemplate(template.body, ctx);

    const doc = await GeneratedLetter.create({
      organization: orgId,
      employee: input.employee,
      template: template._id,
      templateName: template.name,
      category: template.category,
      subject,
      content,
      issuedBy,
      notes: input.notes,
    });
    return GeneratedLetter.findById(doc._id).populate(LETTER_POP);
  }

  /** Self-service — letters generated for the caller. */
  async listMyGeneratedLetters(userId: string) {
    const employee = await Employee.findOne(scoped({ user: userId })).select("_id");
    if (!employee) return [];
    return this.listGeneratedLetters({ employee: String(employee._id) });
  }

  async listGeneratedLetters(query: GeneratedLetterQuery) {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.employee) filter.employee = query.employee;
    if (query.category) filter.category = query.category;

    let records = await GeneratedLetter.find(filter).populate(LETTER_POP).sort({ issuedAt: -1 });

    if (query.search) {
      const term = query.search.toLowerCase();
      records = records.filter((r) => {
        const emp = r.employee as unknown as { name?: string; employeeCode?: string };
        return emp?.name?.toLowerCase().includes(term) || emp?.employeeCode?.toLowerCase().includes(term) || r.subject?.toLowerCase().includes(term);
      });
    }
    return records;
  }

  async getGeneratedLetterById(id: string) {
    const record = await GeneratedLetter.findOne(scoped({ _id: id })).populate(LETTER_POP);
    if (!record) throw Object.assign(new Error("Letter not found"), { statusCode: 404 });
    return record;
  }

  async updateGeneratedLetter(id: string, input: UpdateGeneratedLetterInput) {
    const record = await GeneratedLetter.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Letter not found"), { statusCode: 404 });
    if (input.notes !== undefined) record.notes = input.notes;
    await record.save();
    return GeneratedLetter.findById(id).populate(LETTER_POP);
  }

  async removeGeneratedLetter(id: string) {
    const record = await GeneratedLetter.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Letter not found"), { statusCode: 404 });
    return { message: "Letter deleted successfully" };
  }
}
