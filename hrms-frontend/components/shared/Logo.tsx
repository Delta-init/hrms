import { cn } from "@/lib/utils";

/**
 * Brand assets.
 *
 * The artwork is white lettering drawn for dark grounds, so on a light one it
 * is flipped to solid black — otherwise the wordmark disappears into the page.
 * `brightness-0` rather than `invert`, because inverting turns the teal accent
 * a colour that isn't ours; going flat black keeps the shape and drops the hue.
 *
 * `logo-mark.png` is the "d" glyph cut from the same file, for the places too
 * narrow for a lockup two-and-a-bit times wider than it is tall — a collapsed
 * sidebar, mostly. Cropping it at build time rather than with CSS keeps the
 * markup honest and the mark sharp at any size.
 */
const themed = "select-none brightness-0 dark:brightness-100";

/** Full "delta INTERNATIONAL" lockup. Set a height; width follows (~2.25:1). */
export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo.png" alt="Delta International" className={cn("w-auto", themed, className)} draggable={false} />
  );
}

/** The "d" mark alone, for square slots. Roughly 0.7:1. */
export function LogoMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo-mark.png" alt="" aria-hidden className={cn("w-auto", themed, className)} draggable={false} />
  );
}
