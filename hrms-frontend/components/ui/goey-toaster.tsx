"use client";

import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
export function GoeyToaster() {
  return (
    <GooeyToaster
      // Mobile dialogs render as bottom sheets — a bottom-anchored toast can
      // overlap their footer buttons (e.g. a dialog's Submit). Top keeps toasts
      // clear of that content on every screen size.
      position="top-center"
      preset="smooth"
      closeButton
      richColors
      maxQueue={1}
      // theme={(theme as "light" | "dark")=="light"?"dark":"light"}

    />
  );
}
