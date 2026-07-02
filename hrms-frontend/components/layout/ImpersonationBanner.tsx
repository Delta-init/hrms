"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, LogOut, Loader2 } from "lucide-react";
import { useExitImpersonation } from "@/hooks/useAuth";
import { toast } from "@/lib/toast";

export function ImpersonationBanner() {
  const { data: session } = useSession();
  const exit = useExitImpersonation();
  const [busy, setBusy] = useState(false);
  const imp = session?.impersonatedBy;

  const onExit = async () => {
    setBusy(true);
    try {
      await exit();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not exit impersonation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {imp && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/40 bg-amber-400/15 px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
              <Eye className="h-4 w-4" />
              Viewing as <strong>{session?.user?.name}</strong>
              <span className="hidden text-amber-600/80 sm:inline">· impersonated by {imp.name}</span>
            </span>
            <button
              onClick={onExit}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              Exit impersonation
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
