"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { EmployeeSelect } from "@/components/pickers";
import { useUpdateEmployee } from "@/hooks/useEmployees";
import { toast } from "@/lib/toast";
import type { OrgNode } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The node the chosen person will report to. */
  manager: OrgNode;
  /** Picking this person would close a reporting loop. */
  wouldLoop: (employeeId: string) => boolean;
  /** Already reports to this manager — nothing to change. */
  currentReports: Set<string>;
}

/**
 * Move someone who already exists under a chart node.
 *
 * People who can't be chosen stay listed with the reason rather than being
 * filtered out — a manager looking for someone and not finding them can't tell
 * an empty result from a blocked one.
 */
export function AssignReportDialog({ open, onOpenChange, manager, wouldLoop, currentReports }: Props) {
  const [employeeId, setEmployeeId] = useState("");
  const { mutate: update, isPending } = useUpdateEmployee();

  const submit = () => {
    if (!employeeId) return;
    update(
      { id: employeeId, data: { reportingTo: manager._id, reportingToKind: "Employee" } },
      {
        onSuccess: () => {
          toast.success(`Now reporting to ${manager.name}`);
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add a report under {manager.name}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-3 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee</Label>
            <EmployeeSelect
              value={employeeId}
              onChange={setEmployeeId}
              placeholder="Search for someone…"
              decorate={(option) => {
                if (currentReports.has(option.value)) {
                  return { ...option, disabled: true, badge: { label: "Already reports here", tone: "neutral" } };
                }
                if (wouldLoop(option.value)) {
                  return { ...option, disabled: true, badge: { label: `${manager.name} reports to them`, tone: "warn" } };
                }
                return option;
              }}
            />
            <p className="text-xs text-muted-foreground">
              Their current manager is replaced by {manager.name}.
            </p>
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={!employeeId || isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Add report
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
