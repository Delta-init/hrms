"use client";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function ComingSoon({ title, icon: Icon = Sparkles }: { title: string; icon?: React.ElementType }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="relative mb-6"
      >
        <div className="absolute inset-0 rounded-3xl bg-primary/20 blur-2xl" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <Icon className="h-9 w-9" />
        </div>
      </motion.div>
      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-2xl font-bold tracking-tight"
      >
        {title}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
        className="mt-2 max-w-sm text-sm text-muted-foreground"
      >
        This module is coming in a future phase. Phase 1 covers users, roles &
        authentication.
      </motion.p>
    </div>
  );
}
