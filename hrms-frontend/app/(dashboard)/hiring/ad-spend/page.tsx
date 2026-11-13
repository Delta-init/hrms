"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BarChart3, CalendarRange, Loader2, Megaphone, PenLine, Settings } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useAdSpendOverview, useAdSpendSettings, useAdSpendWeeks } from "@/hooks/useAdSpend";
import { AdSpendOverview } from "@/components/adSpend/AdSpendOverview";
import { WeeksList } from "@/components/adSpend/WeeksList";
import { WeekEntry } from "@/components/adSpend/WeekEntry";
import { AdSpendSettingsDialog } from "@/components/adSpend/AdSpendSettingsDialog";
import { addMonths, mondayOf } from "@/components/adSpend/format";

const RANGES = [
  { key: "3", label: "Last 3 months" },
  { key: "6", label: "Last 6 months" },
  { key: "12", label: "Last 12 months" },
  { key: "year", label: "This year" },
] as const;

export default function AdSpendPage() {
  // useSearchParams needs a boundary or the whole page opts out of static rendering.
  return (
    <Suspense fallback={<div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <AdSpendScreen />
    </Suspense>
  );
}

/**
 * Recruitment ad spend: the recruiter logs each week, HR and management read
 * it as months, platforms and roles. Reached from the Hiring page and the
 * sidebar; the Monday reminder links straight to the week that is owed.
 */
function AdSpendScreen() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("adSpend", "view");
  const canLog = hasPermission("adSpend", "create");
  const canSettings = hasPermission("adSpend", "edit");
  const canDelete = hasPermission("adSpend", "delete");
  const canExport = hasPermission("adSpend", "export");

  const router = useRouter();
  const params = useSearchParams();
  const { data: settings, isLoading, error } = useAdSpendSettings(canView);

  // From the reminder's link. Anything that is not a date is ignored; a date mid-week opens its week.
  const linked = /^\d{4}-\d{2}-\d{2}$/.test(params.get("week") ?? "") ? mondayOf(params.get("week")!) : null;
  const [tab, setTab] = useState<string>(linked ? "week" : "overview");
  const [week, setWeek] = useState<string | null>(linked);
  const [range, setRange] = useState<string>("6");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => { if (settings && !week) setWeek(settings.lastWeek); }, [settings, week]);

  const months = useMemo(() => {
    if (!settings) return {};
    const to = settings.today.slice(0, 7);
    if (range === "year") return { from: `${to.slice(0, 4)}-01`, to };
    return { from: addMonths(to, -(Number(range) - 1)), to };
  }, [settings, range]);

  const overview = useAdSpendOverview(months, canView && !!settings && tab === "overview");
  const weeks = useAdSpendWeeks(months, canView && !!settings && tab === "weeks");

  const openWeek = (w: string) => {
    setWeek(w);
    setTab("week");
    router.replace(`/hiring/ad-spend?week=${w}`, { scroll: false });
  };

  if (!canView) {
    return <div className="py-24 text-center text-sm text-muted-foreground">You don’t have access to recruitment ad spend.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Management reads this without any access to Hiring itself. */}
      {hasPermission("hiring", "view") && (
        <Link href="/hiring" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />Hiring
        </Link>
      )}

      <PageHeader
        title="Recruitment ad spend"
        description="What job ads cost, logged each week, against the budget and the candidates they bring in."
        icon={Megaphone}
        action={
          <div className="flex items-center gap-2">
            {tab !== "week" && (
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="h-9 w-[10.5rem]"><SelectValue /></SelectTrigger>
                <SelectContent>{RANGES.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {canSettings && settings && (
              <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings className="h-4 w-4" />Settings</Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : error || !settings ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {(error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message ?? "Ad spend could not be loaded."}
        </p>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={(k) => { setTab(k); if (k !== "week") router.replace("/hiring/ad-spend", { scroll: false }); }}
            layoutId="ad-spend-tab"
            tabs={[
              { key: "overview", label: "Overview", icon: BarChart3 },
              { key: "weeks", label: "Weeks", icon: CalendarRange },
              { key: "week", label: canLog ? "Log a week" : "Week", icon: PenLine },
            ]}
          />
          {tab === "overview" && (
            <AdSpendOverview data={overview.data} loading={overview.isLoading} settings={settings} canLog={canLog} onOpenWeek={openWeek} />
          )}
          {tab === "weeks" && (
            <WeeksList data={weeks.data} loading={weeks.isLoading} currency={settings.currency} canExport={canExport} onOpenWeek={openWeek} />
          )}
          {tab === "week" && week && (
            <WeekEntry settings={settings} weekStart={week} onWeekChange={openWeek} canLog={canLog} canDelete={canDelete} />
          )}
          <AdSpendSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} />
        </>
      )}
    </div>
  );
}
