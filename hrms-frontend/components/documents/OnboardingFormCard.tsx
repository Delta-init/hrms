"use client";
import { FileDown, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDownloadOnboardingForm } from "@/hooks/useOnboardingForm";

/**
 * The company's joining form, filled from whatever this record already
 * holds — a download rather than a page, since the point is a document HR
 * can put in a file, not another screen to browse.
 *
 * A blank field on the generated PDF means exactly what it looks like:
 * nobody has told the system that answer yet, not that the form failed.
 */
export function OnboardingFormCard({ employeeId }: { employeeId?: string }) {
  const { mutate: download, isPending } = useDownloadOnboardingForm(employeeId);

  return (
    <Card className="flex items-center justify-between gap-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileDown className="h-4 w-4 text-muted-foreground" />
          Onboarding form
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The company&apos;s joining form, filled in from what&apos;s already on record. Anything not
          yet entered comes through blank — fill those in above and download again.
        </p>
      </div>
      <Button onClick={() => download()} disabled={isPending} className="shrink-0">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        Download PDF
      </Button>
    </Card>
  );
}
