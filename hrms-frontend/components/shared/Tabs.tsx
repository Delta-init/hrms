"use client";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface TabItem {
  key: string;
  label: string;
  icon?: React.ElementType;
  count?: number;
}

interface Props {
  tabs: TabItem[];
  value: string;
  onChange: (key: string) => void;
  layoutId?: string;
}

export function Tabs({ tabs, value, onChange, layoutId = "tab-underline" }: Props) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={cn(
              "relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.icon && <t.icon className="h-4 w-4" />}
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                {t.count}
              </span>
            )}
            {active && (
              <motion.div layoutId={layoutId} className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
