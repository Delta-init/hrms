"use client";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type {
  ApiResponse, DgoAchieversView, DgoApprovalsView, DgoAuditView, DgoBudgetView, DgoColleague, DgoDashboard,
  DgoEvent, DgoLeaderboardView, DgoLot, DgoMe, DgoNominateInput, DgoNominationsTab, DgoNominationsView,
  DgoPerson, DgoProgramInput, DgoRecordInput, DgoRecordResult, DgoRedeemInput, DgoRedemption,
  DgoRedemptionsTab, DgoRedemptionsView, DgoReward, DgoRewardInput, DgoRewardsView, DgoRule, DgoRuleInput,
  DgoRulesView, DgoSettings, DgoSettingsInput, DgoSettingsView, DgoUpload, DgoUploadKind, DgoWalletView,
} from "@/types";

/**
 * DGO Points — every call the screens make, in one place.
 *
 * One root key, so anything that moves points (a decision, a reversal, a new
 * award, a budget confirmation) can refresh every DGO screen at once rather than
 * each mutation guessing which of six views it touched.
 */
const KEY = ["dgo-points"] as const;

export function dgoErrorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

/** Points as AED, to two places. */
export const dgoAed = (points: number, pointValueAed: number) => Math.round(points * pointValueAed * 100) / 100;

export const formatAed = (aed: number) =>
  `AED ${aed.toLocaleString("en-US", { minimumFractionDigits: aed % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const formatPoints = (points: number) => points.toLocaleString("en-US");

/**
 * Who you are to DGO Points. Asked of everybody (the sidebar draws the section
 * from it), kept five minutes, and never retried: an error simply hides the
 * section rather than flashing a broken one.
 */
export const useDgoMe = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "me"],
    queryFn: async () => (await api.get<ApiResponse<DgoMe>>("/dgo-points/me")).data.data!,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

export type DgoNavFlag = "use" | "nominate" | "approvals" | "budgets" | "settings";

/** Whether a DGO menu entry is drawn for this person. Shared by the sidebar and search. */
export function dgoAllows(flag: DgoNavFlag, me: DgoMe | undefined): boolean {
  if (!me) return false;
  switch (flag) {
    case "use": return me.canUse;
    case "nominate": return me.canUse && !!me.can.nominate;
    case "approvals": return me.can.approvals || me.can.recordAwards;
    case "budgets": return me.can.budgetsView;
    case "settings": return me.can.settingsView;
  }
}

/** A fresh id per opening of a form, so a double submit or a retry acts once. */
export const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useDgoDashboard = (month: string, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "dashboard", month],
    queryFn: async () => (await api.get<ApiResponse<DgoDashboard>>("/dgo-points/dashboard", { params: { month } })).data.data!,
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

export interface DgoWalletParams {
  employeeId?: string;
  type?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export const useDgoWallet = (params: DgoWalletParams, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "wallet", params],
    queryFn: async () => {
      const query: Record<string, string> = { page: String(params.page), limit: String(params.limit) };
      if (params.employeeId) query.employeeId = params.employeeId;
      if (params.type) query.type = params.type;
      if (params.from) query.from = params.from;
      if (params.to) query.to = params.to;
      return (await api.get<ApiResponse<DgoWalletView>>("/dgo-points/wallet", { params: query })).data.data!;
    },
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useDgoLots = (employeeId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "lots", employeeId ?? "mine"],
    queryFn: async () =>
      (await api.get<ApiResponse<DgoLot[]>>("/dgo-points/wallet/lots", { params: employeeId ? { employeeId } : {} })).data.data!,
    enabled,
    retry: false,
  });

export const useDgoRules = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "rules"],
    queryFn: async () => (await api.get<ApiResponse<DgoRulesView>>("/dgo-points/rules")).data.data!,
    enabled,
    staleTime: 60_000,
    retry: false,
  });

/** People the viewer may record points for, or look up. */
export const useDgoPeople = (search: string, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "employees", search],
    queryFn: async () =>
      (await api.get<ApiResponse<DgoPerson[]>>("/dgo-points/employees", { params: search ? { search } : {} })).data.data!,
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useDgoApprovals = (tab: DgoApprovalsView["tab"], enabled = true) =>
  useQuery({
    queryKey: [...KEY, "approvals", tab],
    queryFn: async () => (await api.get<ApiResponse<DgoApprovalsView>>("/dgo-points/approvals", { params: { tab } })).data.data!,
    enabled,
    placeholderData: keepPreviousData,
    // Several people clear the same queue; acting on a stale row is what matters here.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

export const useDgoBudget = (month: string, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "budgets", month],
    queryFn: async () => (await api.get<ApiResponse<DgoBudgetView>>("/dgo-points/budgets", { params: { month } })).data.data!,
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useDgoSettings = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "settings"],
    queryFn: async () => (await api.get<ApiResponse<DgoSettingsView>>("/dgo-points/settings")).data.data!,
    enabled,
    retry: false,
  });

export const useDgoAudit = (params: { page: number; limit: number; action?: string }, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "audit", params],
    queryFn: async () => {
      const query: Record<string, string> = { page: String(params.page), limit: String(params.limit) };
      if (params.action) query.action = params.action;
      return (await api.get<ApiResponse<DgoAuditView>>("/dgo-points/audit", { params: query })).data.data!;
    },
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

// ─── Phase 2 reads ────────────────────────────────────────────────────────────

export const useDgoNominations = (tab: DgoNominationsTab, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "nominations", tab],
    queryFn: async () => (await api.get<ApiResponse<DgoNominationsView>>("/dgo-points/nominations", { params: { tab } })).data.data!,
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

/** Anyone active in the organisation except you — the nominee picker. */
export const useDgoColleagues = (search: string, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "colleagues", search],
    queryFn: async () =>
      (await api.get<ApiResponse<DgoColleague[]>>("/dgo-points/colleagues", { params: search ? { search } : {} })).data.data!,
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

/** The store. `manage` (rewards managers) includes hidden rewards and the office's cost. */
export const useDgoRewards = (manage = false, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "rewards", manage ? "manage" : "store"],
    queryFn: async () =>
      (await api.get<ApiResponse<DgoRewardsView>>("/dgo-points/rewards", { params: manage ? { manage: "1" } : {} })).data.data!,
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useDgoRedemptions = (tab: DgoRedemptionsTab, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "redemptions", tab],
    queryFn: async () => (await api.get<ApiResponse<DgoRedemptionsView>>("/dgo-points/redemptions", { params: { tab } })).data.data!,
    enabled,
    placeholderData: keepPreviousData,
    // HR works the queue together; a stale row is the one that gets handled twice.
    refetchInterval: tab === "queue" ? 60_000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  });

export const useDgoLeaderboard = (month: string, department: string, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "leaderboard", month, department],
    queryFn: async () =>
      (await api.get<ApiResponse<DgoLeaderboardView>>("/dgo-points/leaderboard", { params: { month, ...(department ? { department } : {}) } })).data.data!,
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

/** Monthly achievers. Without a month the server picks last month. */
export const useDgoAchievers = (month: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "achievers", month ?? "default"],
    queryFn: async () =>
      (await api.get<ApiResponse<DgoAchieversView>>("/dgo-points/achievers", { params: month ? { month } : {} })).data.data!,
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

// ─── Changes ──────────────────────────────────────────────────────────────────

function useDgoMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  success: string | ((out: TOutput) => string),
  failure: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success(typeof success === "function" ? success(out) : success);
    },
    onError: (error) => toast.error(dgoErrorMessage(error, failure)),
  });
}

export const useRecordDgoPoints = () =>
  useDgoMutation(
    async (input: DgoRecordInput) => (await api.post<ApiResponse<DgoRecordResult>>("/dgo-points/earnings", input)).data.data!,
    (out) => {
      if (out.duplicate) return "Already recorded — nothing new was added";
      switch (out.event.status) {
        case "posted": return `${out.event.points} points added`;
        case "pending": return "Recorded — waiting for approval";
        case "capped": return "Held: the daily cap is already used";
        case "budget_blocked": return "Held: the department's budget is used up";
        default: return "Recorded";
      }
    },
    "The points couldn't be recorded",
  );

export const useDecideDgoPoints = () =>
  useDgoMutation(
    async ({ id, approve, note }: { id: string; approve: boolean; note?: string }) =>
      (await api.post<ApiResponse<{ event: DgoEvent }>>(`/dgo-points/approvals/${id}/decision`, { approve, note })).data.data!,
    (out) =>
      out.event.status === "posted" ? `Approved — ${out.event.points} points posted`
        : out.event.status === "pending" ? "Approved — passed to the next step"
          : out.event.status === "rejected" ? "Rejected"
            : out.event.status === "budget_blocked" ? "Approved, but held: the department's budget is used up"
              : out.event.status === "capped" ? "Approved, but held: the daily cap is used"
                : "Saved",
    "That decision couldn't be saved",
  );

export const useReverseDgoPoints = () =>
  useDgoMutation(
    async ({ id, reason }: { id: string; reason: string }) =>
      (await api.post<ApiResponse<{ event: DgoEvent }>>(`/dgo-points/earnings/${id}/reverse`, { reason })).data.data!,
    (out) => `Reversed — ${out.event.points} points taken back`,
    "The reversal couldn't be saved",
  );

export const useEnterDgoCollections = () =>
  useDgoMutation(
    async ({ month, amountAed, note }: { month: string; amountAed: number; note?: string }) =>
      (await api.post<ApiResponse<DgoBudgetView>>(`/dgo-points/budgets/${month}/collections`, { amountAed, note })).data.data!,
    "Saved — a second person in finance must confirm it",
    "The collections figure couldn't be saved",
  );

export const useConfirmDgoCollections = () =>
  useDgoMutation(
    async ({ month }: { month: string }) =>
      (await api.post<ApiResponse<DgoBudgetView>>(`/dgo-points/budgets/${month}/collections/confirm`, {})).data.data!,
    (out) => `Confirmed — the month runs on "${out.tierLabel}"`,
    "The collections figure couldn't be confirmed",
  );

export const useRecountDgoBudget = () =>
  useDgoMutation(
    async ({ month }: { month: string }) =>
      (await api.post<ApiResponse<DgoBudgetView>>(`/dgo-points/budgets/${month}/recount`, {})).data.data!,
    "Staff recounted and allowances updated",
    "The recount couldn't be done",
  );

export const useSaveDgoSettings = () =>
  useDgoMutation(
    async (input: DgoSettingsInput) => (await api.put<ApiResponse<DgoSettings>>("/dgo-points/settings", input)).data.data!,
    (out) => `Saved as version ${out.version}, from ${out.effectiveFrom}`,
    "The settings couldn't be saved",
  );

export const useSaveDgoRule = () =>
  useDgoMutation(
    async ({ code, ...input }: DgoRuleInput & { code: string }) =>
      (await api.put<ApiResponse<DgoRule>>(`/dgo-points/rules/${code}`, input)).data.data!,
    (out) => `${out.code} saved as version ${out.version}, from ${out.effectiveFrom}`,
    "The rule couldn't be saved",
  );

export const useSaveDgoProgram = () =>
  useDgoMutation(
    async (input: DgoProgramInput) =>
      (await api.put<ApiResponse<DgoSettingsView["program"]>>("/dgo-points/program", input)).data.data!,
    "Saved",
    "That couldn't be saved",
  );

/**
 * A change whose toast is the server's own words — "Already done", "Approved —
 * now with HR" — rather than a guess made here about what happened.
 */
function useDgoServerMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<{ message: string; data: TOutput }>,
  failure: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success(out.message || "Saved");
    },
    onError: (error) => toast.error(dgoErrorMessage(error, failure)),
  });
}

const withMessage = <T,>(res: { data: ApiResponse<T> }) => ({ message: res.data.message, data: res.data.data! });

// ─── Phase 2 changes ──────────────────────────────────────────────────────────

/** Upload a photo or PDF; nothing is refreshed — the key goes on the form that is being filled. */
export const useDgoUpload = () =>
  useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: DgoUploadKind }) => {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post<ApiResponse<DgoUpload>>("/dgo-points/uploads", form, {
        params: { kind },
        headers: { "Content-Type": undefined }, // let the browser set the multipart boundary
      });
      return res.data.data!;
    },
    onError: (e) => toast.error(dgoErrorMessage(e, "The file couldn't be uploaded")),
  });

export const useNominate = () =>
  useDgoMutation(
    async (input: DgoNominateInput) => (await api.post<ApiResponse<DgoRecordResult>>("/dgo-points/nominations", input)).data.data!,
    (out) => {
      if (out.duplicate) return "Already sent — nothing new was added";
      switch (out.event.status) {
        case "posted": return `Approved at once — ${out.event.points} points added`;
        case "pending": return "Nomination sent — it goes for approval now";
        case "capped": return "Sent, but held: their daily cap is already used";
        case "budget_blocked": return "Sent, but held: their department's budget is used up";
        default: return "Nomination sent";
      }
    },
    "The nomination couldn't be sent",
  );

export const useSaveDgoReward = () =>
  useDgoMutation(
    async ({ id, ...input }: DgoRewardInput & { id?: string }) =>
      id
        ? (await api.put<ApiResponse<DgoReward>>(`/dgo-points/rewards/${id}`, input)).data.data!
        : (await api.post<ApiResponse<DgoReward>>("/dgo-points/rewards", input)).data.data!,
    (out) => `"${out.name}" saved`,
    "The reward couldn't be saved",
  );

export const useArchiveDgoReward = () =>
  useDgoMutation(
    async ({ id }: { id: string }) => (await api.delete<ApiResponse<unknown>>(`/dgo-points/rewards/${id}`)).data,
    "Reward removed from the store",
    "The reward couldn't be removed",
  );

export const useRedeemDgoReward = () =>
  useDgoMutation(
    async (input: DgoRedeemInput) =>
      (await api.post<ApiResponse<{ redemption: DgoRedemption; duplicate: boolean }>>("/dgo-points/redemptions", input)).data.data!,
    (out) => (out.duplicate ? "Already requested — nothing new was added" : `${out.redemption.points.toLocaleString("en-US")} points held — HR will approve it`),
    "The reward couldn't be requested",
  );

type RedemptionStep = "cancel" | "approve" | "reject" | "fulfil";

/** One step on a redemption. `reject` needs a reason; the others take an optional note. */
export const useDgoRedemptionStep = () =>
  useDgoServerMutation(
    async ({ id, step, note }: { id: string; step: RedemptionStep; note?: string }) =>
      withMessage(
        await api.post<ApiResponse<{ redemption: DgoRedemption }>>(
          `/dgo-points/redemptions/${id}/${step}`,
          step === "reject" ? { reason: note } : step === "cancel" ? {} : note ? { note } : {},
        ),
      ),
    "That couldn't be saved",
  );

type AchieverStep = "fetch" | "pick" | "verify" | "send-back" | "approve";

/** One step on a month's achievers. `send-back` needs a reason; `pick` needs the category and the person. */
export const useDgoAchieverStep = () =>
  useDgoServerMutation(
    async ({ month, step, note, code, email }: { month: string; step: AchieverStep; note?: string; code?: string; email?: string }) => {
      const body =
        step === "pick" ? { code, email }
          : step === "send-back" ? { reason: note }
            : step === "fetch" ? {}
              : note ? { note } : {};
      return withMessage(await api.post<ApiResponse<DgoAchieversView>>(`/dgo-points/achievers/${month}/${step}`, body));
    },
    "That couldn't be done",
  );
