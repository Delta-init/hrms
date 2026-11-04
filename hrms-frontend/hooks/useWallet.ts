"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import type { ApiResponse, Wallet } from "@/types";

/** A month of the wallet — your own, or (with the payroll permission) somebody else's. */
export const useWallet = (month: string, employeeId?: string | null) =>
  useQuery({
    queryKey: ["wallet", employeeId || "mine", month],
    queryFn: async () =>
      (await api.get<ApiResponse<Wallet>>(employeeId ? `/wallet/${employeeId}` : "/wallet/mine", { params: { month } })).data.data!,
    // Finance is asked on every load; a minute keeps flicking between months from asking again each time.
    staleTime: 60_000,
    retry: false,
  });
