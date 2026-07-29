"use client";
import Link from "next/link";
import { Loader2, Network } from "lucide-react";
import { useOrgChart } from "@/hooks/useDashboard";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { getInitials } from "@/lib/utils";
import type { OrgNode } from "@/types";

export default function OrgChartPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("employees", "view");
  const { data, isLoading } = useOrgChart(canView);
  const roots = data?.roots ?? [];

  return (
    <div>
      <PageHeader
        title="Organization Chart"
        description="Reporting lines across the team, built from each employee's manager."
        icon={Network}
      />

      {!canView ? (
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to the org chart.</Card>
      ) : isLoading ? (
        <Card className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : roots.length === 0 ? (
        <Card className="p-16 text-center text-muted-foreground"><Network className="mx-auto mb-2 h-7 w-7" />No employees to chart yet.</Card>
      ) : (
        <Card className="overflow-x-auto p-6">
          <div className="org-tree inline-block min-w-full text-center">
            <ul>
              {roots.map((n) => <TreeNode key={n._id} node={n} />)}
            </ul>
          </div>
        </Card>
      )}

      <style jsx global>{`
        .org-tree ul { display: flex; justify-content: center; padding-top: 22px; position: relative; margin: 0; list-style: none; }
        .org-tree li { list-style: none; position: relative; padding: 22px 10px 0; }
        /* down + horizontal connectors */
        .org-tree li::before, .org-tree li::after {
          content: ''; position: absolute; top: 0; right: 50%;
          border-top: 1.5px solid hsl(var(--border)); width: 50%; height: 22px;
        }
        .org-tree li::after { right: auto; left: 50%; border-left: 1.5px solid hsl(var(--border)); }
        .org-tree li:only-child::before, .org-tree li:only-child::after { display: none; }
        .org-tree li:only-child { padding-top: 22px; }
        .org-tree li:first-child::before, .org-tree li:last-child::after { border: 0 none; }
        .org-tree li:last-child::before { border-right: 1.5px solid hsl(var(--border)); border-radius: 0 6px 0 0; }
        .org-tree li:first-child::after { border-radius: 6px 0 0 0; }
        .org-tree ul ul::before {
          content: ''; position: absolute; top: 0; left: 50%;
          border-left: 1.5px solid hsl(var(--border)); width: 0; height: 22px;
        }
        .org-tree > ul { padding-top: 0; }
        .org-tree > ul > li:only-child { padding-top: 0; }
      `}</style>
    </div>
  );
}

function TreeNode({ node }: { node: OrgNode }) {
  return (
    <li>
      <Link
        href={`/employees/${node._id}`}
        className="inline-flex w-44 flex-col items-center gap-1 rounded-xl border border-border bg-card p-3 align-top shadow-sm transition hover:border-primary/40 hover:shadow-md"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(node.name)}</div>
        <p className="mt-0.5 line-clamp-1 text-sm font-semibold">{node.name}</p>
        {node.designation && <p className="line-clamp-1 text-xs text-muted-foreground">{node.designation}</p>}
        {node.department && <span className="mt-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{node.department}</span>}
      </Link>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => <TreeNode key={c._id} node={c} />)}
        </ul>
      )}
    </li>
  );
}
