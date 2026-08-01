import { ApprovalWorkflow } from "../models/ApprovalWorkflow.js";
import type {
  ApprovableModule, IApprovalStepSnapshot, IApprovalTrailEntry, IRole,
} from "../types/index.js";
import type { UpsertApprovalWorkflowInput } from "../validations/approvalWorkflowValidation.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

const POP = [{ path: "steps.role", select: "roleName" }];

export class ApprovalWorkflowService {
  async list() {
    return ApprovalWorkflow.find(orgFilter()).populate(POP).sort({ module: 1 });
  }

  async get(module: ApprovableModule) {
    return ApprovalWorkflow.findOne(scoped({ module })).populate(POP);
  }

  async upsert(module: ApprovableModule, input: UpsertApprovalWorkflowInput) {
    const steps = input.steps.map((s, i) => ({ order: i + 1, role: s.role, label: s.label }));
    const record = await ApprovalWorkflow.findOneAndUpdate(
      scoped({ module }),
      { $set: { enabled: input.enabled, steps }, $setOnInsert: { organization: getOrgId(), module } },
      { new: true, upsert: true }
    );
    return ApprovalWorkflow.findById(record!._id).populate(POP);
  }

  async remove(module: ApprovableModule) {
    const record = await ApprovalWorkflow.findOneAndDelete(scoped({ module }));
    if (!record) throw Object.assign(new Error("Approval workflow not found"), { statusCode: 404 });
    return { message: "Approval workflow removed — this module reverts to single-step approval." };
  }
}

/**
 * The step snapshot a newly-created record of `module` should start with:
 * step 1 of the org's enabled workflow, or nulls when none is configured
 * (falls back to today's single-step approve/reject).
 */
export async function beginWorkflowState(
  module: ApprovableModule
): Promise<{ workflowStep: number | null; workflowTotalSteps: number | null; approvalSteps: IApprovalStepSnapshot[] }> {
  const workflow = await ApprovalWorkflow.findOne(scoped({ module, enabled: true }))
    .populate<{ steps: { order: number; role: IRole; label?: string }[] }>("steps.role", "roleName")
    .sort({ createdAt: -1 });
  if (!workflow || workflow.steps.length === 0) {
    return { workflowStep: null, workflowTotalSteps: null, approvalSteps: [] };
  }
  const approvalSteps: IApprovalStepSnapshot[] = workflow.steps
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ order: s.order, role: s.role._id, roleName: s.role.roleName, label: s.label }));
  return { workflowStep: 1, workflowTotalSteps: approvalSteps.length, approvalSteps };
}

export interface ReviewerRole {
  _id: string;
  roleName: string;
  isSystemRole: boolean;
}

interface ReviewOutcome {
  /** True: this step is done and the request now waits on the next step (status stays "pending"). */
  advance: boolean;
  /** True: this action is terminal — record.status should become the reviewed action. */
  final: boolean;
  trailEntry: IApprovalTrailEntry;
}

/**
 * Decide what a review action does to a record's workflow state, and enforce
 * that the reviewer holds the role assigned to the record's CURRENT step.
 * Records with no workflowStep (no workflow was configured when they were
 * created) behave exactly as before: single step, always final.
 * Super Admin bypasses the step-role check, same as it bypasses checkPermission.
 */
export function resolveReviewOutcome(
  approvalSteps: IApprovalStepSnapshot[] | null | undefined,
  currentStep: number | null | undefined,
  action: "approved" | "rejected",
  note: string | null | undefined,
  reviewer: ReviewerRole
): ReviewOutcome {
  const isSuperAdmin = reviewer.isSystemRole && reviewer.roleName === "Super Admin";
  const step = approvalSteps?.find((s) => s.order === currentStep);

  if (!approvalSteps?.length || !currentStep || !step) {
    // Legacy / no workflow configured for this record — single-step, always final.
    return {
      advance: false,
      final: true,
      trailEntry: { step: currentStep ?? 1, by: reviewer._id as never, action, note: note ?? undefined, at: new Date() },
    };
  }

  if (!isSuperAdmin && String(step.role) !== String(reviewer._id)) {
    throw Object.assign(
      new Error(`Only "${step.label || step.roleName}" can act on this request at step ${currentStep} of ${approvalSteps.length}`),
      { statusCode: 403 }
    );
  }

  const trailEntry: IApprovalTrailEntry = {
    step: currentStep, roleName: step.roleName, by: reviewer._id as never, action, note: note ?? undefined, at: new Date(),
  };

  if (action === "rejected") return { advance: false, final: true, trailEntry };

  const isLastStep = currentStep >= approvalSteps.length;
  return { advance: !isLastStep, final: isLastStep, trailEntry };
}
