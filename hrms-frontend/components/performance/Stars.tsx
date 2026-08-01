"use client";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function Stars({ value, onChange, readOnly }: { value?: number | null; onChange?: (n: number) => void; readOnly?: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n} type="button" disabled={readOnly}
          onClick={() => onChange?.(n)}
          className={cn("p-0.5", readOnly && "cursor-default")}
        >
          <Star className={cn("h-4 w-4", (value ?? 0) >= n ? "fill-primary text-primary" : "text-muted-foreground")} />
        </button>
      ))}
    </div>
  );
}
