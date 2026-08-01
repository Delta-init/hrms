import type { WorkflowState } from "@/types";

/** Whether the given reviewer can act on a record's CURRENT approval step.
 *  Records with no active workflow (workflowStep null) behave as before —
 *  anyone holding the module's approve permission can act, in one step. */
export function canActOnWorkflowStep(record: WorkflowState, reviewerRoleId?: string, isSuperAdmin?: boolean): boolean {
  if (!record.workflowStep || !record.approvalSteps?.length) return true;
  if (isSuperAdmin) return true;
  const step = record.approvalSteps.find((s) => s.order === record.workflowStep);
  return !!step && step.role === reviewerRoleId;
}

/** "Step 2/3 · HR Manager" — null when no workflow is active for this record. */
export function workflowStepLabel(record: WorkflowState): string | null {
  if (!record.workflowStep || !record.workflowTotalSteps || !record.approvalSteps?.length) return null;
  const step = record.approvalSteps.find((s) => s.order === record.workflowStep);
  const name = step?.label || step?.roleName || "";
  return `Step ${record.workflowStep}/${record.workflowTotalSteps}${name ? ` · ${name}` : ""}`;
}
