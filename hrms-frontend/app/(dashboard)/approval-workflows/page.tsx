"use client";
import { GitBranch, Loader2 } from "lucide-react";
import { useApprovalWorkflows } from "@/hooks/useApprovalWorkflows";
import { useRolesSimple } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { ApprovalWorkflowCard } from "@/components/approval-workflows/ApprovalWorkflowCard";
import type { ApprovableModule } from "@/types";

const MODULES: { key: ApprovableModule; title: string; description: string }[] = [
  { key: "leave", title: "Leave", description: "Chain leave approvals across roles — e.g. Team Lead, then HR Manager." },
  { key: "regularization", title: "Attendance Regularization", description: "Chain attendance-correction approvals across roles." },
  { key: "reimbursements", title: "Expense Reimbursements", description: "Chain expense-claim approvals across roles." },
];

export default function ApprovalWorkflowsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("approvalWorkflows", "view");
  const canEdit = hasPermission("approvalWorkflows", "edit");
  const { data: workflows, isLoading } = useApprovalWorkflows();
  const { data: roles } = useRolesSimple();

  return (
    <div>
      <PageHeader
        title="Approval Workflows"
        description="Configure multi-step approval chains for leave, regularization and expense claims."
        icon={GitBranch}
      />
      {!canView ? (
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to approval workflows.</Card>
      ) : isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-4">
          {MODULES.map((m) => (
            <ApprovalWorkflowCard
              key={m.key}
              module={m.key}
              title={m.title}
              description={m.description}
              workflow={workflows?.find((w) => w.module === m.key)}
              roles={roles ?? []}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
