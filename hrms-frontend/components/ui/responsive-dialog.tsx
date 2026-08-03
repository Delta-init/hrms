"use client";

/**
 * ResponsiveDialog
 * ─────────────────────────────────────────────────────────────────────────────
 * On mobile (< 640 px)  → renders a bottom-sheet Drawer (vaul / shadcn Drawer)
 * On desktop (≥ 640 px) → renders a centred Dialog
 *
 * The Drawer uses a shadcn <ScrollArea> for its body with:
 *   • min-height  → 200px  (drawer is never collapsed smaller than this)
 *   • height      → auto   (grows with content)
 *   • max-height  → calc(92dvh - 60px) (leaves room for the drag handle)
 */

import * as React from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";

// ─── Root ─────────────────────────────────────────────────────────────────────

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function ResponsiveDialog({ open, onOpenChange, children }: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        {children}
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog>
  );
}

// ─── Content ──────────────────────────────────────────────────────────────────

interface ResponsiveDialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Extra className forwarded to DialogContent only (desktop) */
  className?: string;
  /** Max-width + any extra classes applied on desktop only */
  desktopClassName?: string;
  /** Height of the dialog */
  height?: string;
}

export function ResponsiveDialogContent({
  children,
  className,
  desktopClassName,
  height="auto",
  ...props
}: ResponsiveDialogContentProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      /*
       * DrawerContent renders the drag handle automatically.
       * A native overflow-y-auto container handles scrolling — vaul detects
       * the scrollable element and lets touch scroll instead of drag-dismiss.
       * (A Radix ScrollArea here swallowed the gesture on mobile.)
       */
      <DrawerContent className="flex max-h-[92dvh] flex-col px-0">
        <div
          data-vaul-no-drag
          className="w-full flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
          style={{ minHeight: "200px", height }}
        >
          <div className="pb-[env(safe-area-inset-bottom,16px)]">
            {children}
          </div>
        </div>
      </DrawerContent>
    );
  }

  return (
    // A baseline max-height + scroll is always merged in (twMerge lets a more
    // specific value in desktopClassName override it) so a dialog can never
    // render taller than the viewport with no way to reach its footer.
    <DialogContent
      className={cn("max-w-lg max-h-[90vh] overflow-y-auto", desktopClassName, className)}
      {...(props as React.ComponentPropsWithoutRef<typeof DialogContent>)}
    >
      {children}
    </DialogContent>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

export function ResponsiveDialogHeader({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <DrawerHeader
        className={["text-left px-4", className].filter(Boolean).join(" ")}
        {...props}
      >
        {children}
      </DrawerHeader>
    );
  }

  return (
    <DialogHeader className={className} {...props}>
      {children}
    </DialogHeader>
  );
}

// ─── Title ────────────────────────────────────────────────────────────────────

export function ResponsiveDialogTitle({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <DrawerTitle
        className={className}
        {...(props as React.ComponentPropsWithoutRef<typeof DrawerTitle>)}
      >
        {children}
      </DrawerTitle>
    );
  }

  return (
    <DialogTitle
      className={className}
      {...(props as React.ComponentPropsWithoutRef<typeof DialogTitle>)}
    >
      {children}
    </DialogTitle>
  );
}

// ─── Description ─────────────────────────────────────────────────────────────

export function ResponsiveDialogDescription({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <DrawerDescription
        className={className}
        {...(props as React.ComponentPropsWithoutRef<typeof DrawerDescription>)}
      >
        {children}
      </DrawerDescription>
    );
  }

  return (
    <DialogDescription
      className={className}
      {...(props as React.ComponentPropsWithoutRef<typeof DialogDescription>)}
    >
      {children}
    </DialogDescription>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

export function ResponsiveDialogFooter({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <DrawerFooter
        className={["flex-row justify-end px-4 border-t border-border pt-3 mt-2", className]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {children}
      </DrawerFooter>
    );
  }

  return (
    <DialogFooter className={className} {...props}>
      {children}
    </DialogFooter>
  );
}
