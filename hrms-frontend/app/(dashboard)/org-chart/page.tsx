"use client";
import { Loader2, Network } from "lucide-react";
import { useOrgChart } from "@/hooks/useDashboard";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { OrgChartBoard } from "@/components/org-chart/OrgChartBoard";
import { Card } from "@/components/ui/card";

export default function OrgChartPage() {
  const { hasPermission } = useAuth();
  // Everybody may look at the chart — they are all in it. Opening the profile
  // behind a card is a different thing, and stays with the employees permission.
  const canView = true;
  const canOpenProfile = hasPermission("employees", "view");
  const canEdit = hasPermission("employees", "edit");
  const canCreate = hasPermission("employees", "create");
  const { data, isLoading } = useOrgChart(canView);
  const roots = data?.roots ?? [];

  return (
    <div>
      <PageHeader
        title="Organization Chart"
        description={canEdit
          ? "Drag someone onto another card to change who they report to, or use a card's menu."
          : "Reporting lines across the team, built from each employee's manager."}
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
          <OrgChartBoard roots={roots} canEdit={canEdit} canCreate={canCreate} canOpenProfile={canOpenProfile} />
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
