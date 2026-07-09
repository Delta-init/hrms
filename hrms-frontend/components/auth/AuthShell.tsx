"use client";
import { DashboardMock } from "./DashboardMock";

/**
 * Sellora-style split auth layout: a rounded white card on a light page, with
 * the form on the left (logo top, footer bottom) and a blue marketing panel on
 * the right (headline + dashboard preview).
 *
 * Logo asset in /public: /logo.png (white/transparent). On the white left panel
 * it's rendered black via `brightness-0`; on the blue panel it stays white.
 */

const enter = "animate-in fade-in-0 slide-in-from-bottom-3 duration-500 fill-mode-both ease-out";

/** Brand logo mark. Pass `dark` to render it black (for light backgrounds). */
export function BrandLogo({ className = "h-8 w-auto", dark = false }: { className?: string; dark?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.png" alt="Delta HRMS" className={`${className} ${dark ? "brightness-0" : ""}`} />;
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center ">
      <div className="grid w-full h-screen overflow-hidden rounded-[2rem] border border-black/5 bg-white  lg:grid-cols-2">
        {/* ── Left: form panel ── */}
        <div className="flex flex-col p-8 sm:p-10 lg:p-12">
          {/* logo */}
          <div className={`flex items-center ${enter}`}>
            <BrandLogo dark className="h-8 w-auto" />
          </div>

          {/* form (vertically centered) */}
          <div className="flex flex-1 flex-col justify-center py-8">
            <div className="mx-auto w-full max-w-sm">{children}</div>
          </div>

          {/* footer */}
          <div className="flex flex-col gap-1 text-xs text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} Delta Institutions LTD.</span>
            <a href="#" className="transition-colors hover:text-neutral-600">Privacy Policy</a>
          </div>
        </div>

        {/* ── Right: blue marketing panel ── */}
        <div className="relative hidden p-3 lg:block">
          <div className="relative flex h-full flex-col overflow-hidden rounded-[1.6rem] bg-primary p-10 xl:p-12">
            {/* decorative rings */}
            <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full border-[40px] border-white/5" />
            <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full border-[40px] border-white/5" />

            <div className="relative z-10 max-w-md">
              <h2 className="text-3xl font-bold leading-tight tracking-tight text-white xl:text-4xl">
                Effortlessly manage your team and operations.
              </h2>
              <p className="mt-4 text-sm text-white/70">
                Log in to access your HRMS dashboard and manage your team.
              </p>
            </div>

            {/* dashboard preview */}
            <div className="relative z-10 mt-8 flex flex-1 items-center justify-center">
              <div className="scale-[0.92] xl:scale-100">
                <DashboardMock />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
