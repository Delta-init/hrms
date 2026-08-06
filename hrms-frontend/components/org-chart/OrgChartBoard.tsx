"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { GripVertical, MoreVertical, Pencil, User, UserPlus, Users, ArrowUpToLine } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { EmployeeDialog } from "@/components/employees/EmployeeDialog";
import { AssignReportDialog } from "@/components/org-chart/AssignReportDialog";
import { useEmployee, useUpdateEmployee } from "@/hooks/useEmployees";
import { toast } from "@/lib/toast";
import { getInitials, cn } from "@/lib/utils";
import type { OrgNode } from "@/types";

interface Props {
  roots: OrgNode[];
  /** Reassigning and editing need employees.edit; the chart is read-only without it. */
  canEdit: boolean;
  /** Adding a brand-new person needs employees.create. */
  canCreate: boolean;
}

/** A node's parent id, for every node in the forest. Roots map to null. */
function buildParentMap(roots: OrgNode[]) {
  const parentOf = new Map<string, string | null>();
  const walk = (node: OrgNode, parent: string | null) => {
    parentOf.set(node._id, parent);
    node.children.forEach((c) => walk(c, node._id));
  };
  roots.forEach((r) => walk(r, null));
  return parentOf;
}

/**
 * Interactive org chart.
 *
 * Reporting lines are edited here directly: drag a card onto another to
 * re-parent that person, or use the card menu (drag-and-drop doesn't exist on
 * touch, so every drag action has a menu equivalent).
 *
 * Drops that would close a loop are refused before the request goes out — the
 * server rejects them too, but greying the card out while dragging explains the
 * rule instead of only reporting the failure afterwards.
 */
export function OrgChartBoard({ roots, canEdit, canCreate }: Props) {
  const { mutate: update, isPending } = useUpdateEmployee();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  // Dialog targets. `editId` fetches the full record; the chart node only
  // carries the handful of fields the tree needs to draw.
  const [editId, setEditId] = useState<string | null>(null);
  const [assignUnder, setAssignUnder] = useState<OrgNode | null>(null);
  const [createUnder, setCreateUnder] = useState<OrgNode | null>(null);

  const parentOf = useMemo(() => buildParentMap(roots), [roots]);

  /** Is `id` somewhere above `target` in the tree? Walking up beats a subtree scan. */
  const isAncestorOf = (id: string, target: string) => {
    let cursor = parentOf.get(target) ?? null;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      if (cursor === id) return true;
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    return false;
  };

  const canDropOn = (targetId: string) =>
    !!dragId && dragId !== targetId && !isAncestorOf(dragId, targetId) && parentOf.get(dragId) !== targetId;

  const setManager = (employeeId: string, managerId: string | null, label: string) =>
    update(
      { id: employeeId, data: managerId ? { reportingTo: managerId, reportingToKind: "Employee" } : { reportingTo: null } },
      { onSuccess: () => toast.success(label) }
    );

  const handleDrop = (target: OrgNode) => {
    const moved = dragId;
    setDragId(null);
    setDropId(null);
    if (!moved || !canDropOn(target._id)) return;
    setManager(moved, target._id, `Now reporting to ${target.name}`);
  };

  const handleDropToTop = () => {
    const moved = dragId;
    setDragId(null);
    setDropId(null);
    if (!moved || !parentOf.get(moved)) return;
    setManager(moved, null, "Moved to the top level");
  };

  const nodeProps = (node: OrgNode) => {
    if (!canEdit) return {};
    const valid = canDropOn(node._id);
    return {
      draggable: !isPending,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        // Firefox ignores a drag that carries no payload.
        e.dataTransfer.setData("text/plain", node._id);
        setDragId(node._id);
      },
      onDragEnd: () => { setDragId(null); setDropId(null); },
      onDragOver: (e: React.DragEvent) => { if (valid) { e.preventDefault(); setDropId(node._id); } },
      onDragLeave: () => setDropId((cur) => (cur === node._id ? null : cur)),
      onDrop: (e: React.DragEvent) => { e.preventDefault(); handleDrop(node); },
    };
  };

  return (
    <>
      {canEdit && (
        <div
          onDragOver={(e) => { if (dragId && parentOf.get(dragId)) { e.preventDefault(); setDropId("__top__"); } }}
          onDragLeave={() => setDropId((cur) => (cur === "__top__" ? null : cur))}
          onDrop={(e) => { e.preventDefault(); handleDropToTop(); }}
          className={cn(
            "mb-4 rounded-xl border border-dashed px-4 py-2.5 text-center text-xs transition",
            dropId === "__top__"
              ? "border-primary bg-primary/10 text-primary"
              : dragId
                ? "border-primary/40 text-muted-foreground"
                : "border-border text-muted-foreground"
          )}
        >
          {dragId ? "Drop here to remove this person's manager" : "Drag a card onto another to change who they report to"}
        </div>
      )}

      <div className="org-tree inline-block min-w-full text-center">
        <ul>
          {roots.map((n) => (
            <TreeNode
              key={n._id}
              node={n}
              canEdit={canEdit}
              canCreate={canCreate}
              hasParent={!!parentOf.get(n._id)}
              dragId={dragId}
              dropId={dropId}
              canDropOn={canDropOn}
              nodeProps={nodeProps}
              onEdit={setEditId}
              onAssignUnder={setAssignUnder}
              onCreateUnder={setCreateUnder}
              onDetach={(node) => setManager(node._id, null, `${node.name} moved to the top level`)}
            />
          ))}
        </ul>
      </div>

      {editId && <EditEmployeeDialog id={editId} onClose={() => setEditId(null)} />}

      {assignUnder && (
        <AssignReportDialog
          open
          onOpenChange={(o) => !o && setAssignUnder(null)}
          manager={assignUnder}
          wouldLoop={(id) => assignUnder._id === id || isAncestorOf(id, assignUnder._id)}
          currentReports={new Set(assignUnder.children.map((c) => c._id))}
        />
      )}

      {createUnder && (
        <EmployeeDialog
          open
          onOpenChange={(o) => !o && setCreateUnder(null)}
          defaultReportingTo={createUnder._id}
          defaultReportingToLabel={createUnder.name}
        />
      )}
    </>
  );
}

/** Loads the full record behind a chart node, then hands it to the shared editor. */
function EditEmployeeDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: employee, isLoading } = useEmployee(id);
  if (isLoading || !employee) return null;
  return <EmployeeDialog open onOpenChange={(o) => !o && onClose()} employee={employee} />;
}

interface NodeProps {
  node: OrgNode;
  canEdit: boolean;
  canCreate: boolean;
  hasParent: boolean;
  dragId: string | null;
  dropId: string | null;
  canDropOn: (id: string) => boolean;
  nodeProps: (node: OrgNode) => Record<string, unknown>;
  onEdit: (id: string) => void;
  onAssignUnder: (node: OrgNode) => void;
  onCreateUnder: (node: OrgNode) => void;
  onDetach: (node: OrgNode) => void;
}

function TreeNode(props: NodeProps) {
  const { node, canEdit, canCreate, dragId, dropId, canDropOn, nodeProps } = props;
  const isDragging = dragId === node._id;
  const isTarget = dropId === node._id;
  // Dim what this card can't be dropped onto, so the rule is visible mid-drag.
  const invalidTarget = !!dragId && !isDragging && !canDropOn(node._id);

  return (
    <li>
      <div
        {...nodeProps(node)}
        className={cn(
          "group relative inline-flex w-44 flex-col items-center gap-1 rounded-xl border bg-card p-3 align-top shadow-sm transition",
          canEdit && "cursor-grab active:cursor-grabbing",
          isTarget ? "border-primary ring-2 ring-primary/30" : "border-border",
          isDragging && "opacity-40",
          invalidTarget && !isDragging && "opacity-30"
        )}
      >
        {canEdit && (
          <GripVertical className="absolute left-1 top-1 h-3.5 w-3.5 text-muted-foreground/40 opacity-0 transition group-hover:opacity-100" />
        )}

        {(canEdit || canCreate) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Actions for ${node.name}`}
              className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-muted focus:opacity-100 group-hover:opacity-100"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild>
                <Link href={`/employees/${node._id}`}><User className="h-4 w-4" />View profile</Link>
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem onSelect={() => props.onEdit(node._id)}>
                  <Pencil className="h-4 w-4" />Edit details
                </DropdownMenuItem>
              )}
              {(canEdit || canCreate) && <DropdownMenuSeparator />}
              {canEdit && (
                <DropdownMenuItem onSelect={() => props.onAssignUnder(node)}>
                  <Users className="h-4 w-4" />Add existing report
                </DropdownMenuItem>
              )}
              {canCreate && (
                <DropdownMenuItem onSelect={() => props.onCreateUnder(node)}>
                  <UserPlus className="h-4 w-4" />Add new employee here
                </DropdownMenuItem>
              )}
              {canEdit && props.hasParent && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => props.onDetach(node)}>
                    <ArrowUpToLine className="h-4 w-4" />Move to top level
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Link href={`/employees/${node._id}`} className="flex flex-col items-center gap-1" draggable={false}>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {getInitials(node.name)}
          </div>
          <p className="mt-0.5 line-clamp-1 text-sm font-semibold">{node.name}</p>
          {node.designation && <p className="line-clamp-1 text-xs text-muted-foreground">{node.designation}</p>}
          {node.department && (
            <span className="mt-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{node.department}</span>
          )}
        </Link>
      </div>

      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNode {...props} key={c._id} node={c} hasParent />
          ))}
        </ul>
      )}
    </li>
  );
}
