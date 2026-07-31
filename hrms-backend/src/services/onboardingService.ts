import { OnboardingTemplate } from "../models/OnboardingTemplate.js";
import { OnboardingChecklist } from "../models/OnboardingChecklist.js";
import { Employee } from "../models/Employee.js";
import type {
  CreateTemplateInput, UpdateTemplateInput, CreateChecklistInput, UpdateTaskStatusInput,
} from "../validations/onboardingValidation.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

const CHECKLIST_POP = [{ path: "employee", select: "name employeeCode designation department joiningDate user" }];

interface ChecklistQuery {
  status?: string; // "pending" | "completed" — computed, not a stored field
  employee?: string;
  search?: string;
}

export class OnboardingService {
  // ── Templates ──────────────────────────────────────────────────────────
  async createTemplate(input: CreateTemplateInput) {
    const existing = await OnboardingTemplate.findOne(scoped({ name: input.name.trim() }));
    if (existing) throw Object.assign(new Error("A template with this name already exists"), { statusCode: 409 });
    return OnboardingTemplate.create({ organization: getOrgId(), ...input });
  }

  async listTemplates() {
    return OnboardingTemplate.find(scoped({})).sort({ name: 1 });
  }

  async getTemplateById(id: string) {
    const record = await OnboardingTemplate.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Template not found"), { statusCode: 404 });
    return record;
  }

  async updateTemplate(id: string, input: UpdateTemplateInput) {
    const record = await OnboardingTemplate.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Template not found"), { statusCode: 404 });
    if (input.name && input.name !== record.name) {
      const clash = await OnboardingTemplate.findOne(scoped({ name: input.name.trim(), _id: { $ne: id } }));
      if (clash) throw Object.assign(new Error("A template with this name already exists"), { statusCode: 409 });
    }
    Object.assign(record, input);
    await record.save();
    return record;
  }

  async removeTemplate(id: string) {
    const record = await OnboardingTemplate.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Template not found"), { statusCode: 404 });
    return { message: "Template deleted successfully" };
  }

  // ── Checklists ─────────────────────────────────────────────────────────
  async createChecklist(input: CreateChecklistInput, createdBy: string) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    const existing = await OnboardingChecklist.findOne(scoped({ employee: employee._id }));
    if (existing) throw Object.assign(new Error("This employee already has an onboarding checklist"), { statusCode: 409 });

    const template = await OnboardingTemplate.findOne(scoped({ _id: input.templateId }));
    if (!template) throw Object.assign(new Error("Template not found"), { statusCode: 404 });
    if (template.tasks.length === 0) throw Object.assign(new Error("This template has no tasks"), { statusCode: 400 });

    const base = employee.joiningDate ? new Date(employee.joiningDate) : new Date();
    const tasks = template.tasks.map((t) => {
      const dueDate = new Date(base);
      dueDate.setUTCDate(dueDate.getUTCDate() + t.dueDayOffset);
      return {
        title: t.title, description: t.description, category: t.category,
        assigneeRole: t.assigneeRole, dueDate, status: "pending" as const,
      };
    });

    const doc = await OnboardingChecklist.create({
      organization: getOrgId(), employee: employee._id, templateName: template.name, tasks, createdBy,
    });
    return OnboardingChecklist.findById(doc._id).populate(CHECKLIST_POP);
  }

  async listChecklists(query: ChecklistQuery) {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.employee) filter.employee = query.employee;

    let records = await OnboardingChecklist.find(filter).populate(CHECKLIST_POP).sort({ createdAt: -1 });

    if (query.search) {
      const term = query.search.toLowerCase();
      records = records.filter((r) => {
        const emp = r.employee as unknown as { name?: string; employeeCode?: string };
        return emp?.name?.toLowerCase().includes(term) || emp?.employeeCode?.toLowerCase().includes(term);
      });
    }
    if (query.status === "completed") records = records.filter((r) => r.tasks.every((t) => t.status === "completed"));
    else if (query.status === "pending") records = records.filter((r) => r.tasks.some((t) => t.status !== "completed"));

    return records;
  }

  async getChecklistById(id: string) {
    const record = await OnboardingChecklist.findOne(scoped({ _id: id })).populate(CHECKLIST_POP);
    if (!record) throw Object.assign(new Error("Checklist not found"), { statusCode: 404 });
    return record;
  }

  async removeChecklist(id: string) {
    const record = await OnboardingChecklist.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Checklist not found"), { statusCode: 404 });
    return { message: "Checklist deleted successfully" };
  }

  async setTaskStatus(checklistId: string, taskId: string, input: UpdateTaskStatusInput, actorId: string) {
    const checklist = await OnboardingChecklist.findOne(scoped({ _id: checklistId }));
    if (!checklist) throw Object.assign(new Error("Checklist not found"), { statusCode: 404 });
    const task = checklist.tasks.id(taskId);
    if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404 });

    task.status = input.status;
    task.completedAt = input.status === "completed" ? new Date() : null;
    task.completedBy = input.status === "completed" ? (actorId as never) : null;
    await checklist.save();
    return OnboardingChecklist.findById(checklistId).populate(CHECKLIST_POP);
  }

  // ── Self-service ("my tasks") ─────────────────────────────────────────
  async getMyChecklist(userId: string) {
    const employee = await Employee.findOne(scoped({ user: userId }));
    if (!employee) return null;
    return OnboardingChecklist.findOne(scoped({ employee: employee._id }));
  }

  async setMyTaskStatus(userId: string, taskId: string, input: UpdateTaskStatusInput) {
    const employee = await Employee.findOne(scoped({ user: userId }));
    if (!employee) throw Object.assign(new Error("No employee profile linked to this account"), { statusCode: 404 });
    const checklist = await OnboardingChecklist.findOne(scoped({ employee: employee._id }));
    if (!checklist) throw Object.assign(new Error("You have no onboarding checklist"), { statusCode: 404 });
    const task = checklist.tasks.id(taskId);
    if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404 });
    if (task.assigneeRole !== "employee") throw Object.assign(new Error("This task isn't assigned to you"), { statusCode: 403 });

    task.status = input.status;
    task.completedAt = input.status === "completed" ? new Date() : null;
    task.completedBy = input.status === "completed" ? (userId as never) : null;
    await checklist.save();
    return checklist;
  }
}
