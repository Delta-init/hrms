"use client";

/**
 * Lightweight, purely-decorative HRMS dashboard preview shown on the blue auth
 * panel. Built from divs + inline SVG — no real data or image asset needed.
 */
export function DashboardMock() {
  return (
    <div className="pointer-events-none select-none">
      <div className="relative w-[560px] max-w-full rounded-2xl bg-white/95 p-3 shadow-2xl ring-1 ring-black/5">
        {/* top stat row */}
        <div className="grid grid-cols-3 gap-3">
          {/* Total employees (accent) */}
          <div className="rounded-xl bg-primary p-3 text-white">
            <p className="text-[10px] font-medium text-white/80">Total Employees</p>
            <p className="mt-3 text-lg font-bold">248</p>
            <span className="mt-2 inline-block rounded-full bg-white/20 px-1.5 py-0.5 text-[9px]">↑ 7% this quarter</span>
          </div>
          {/* Avg check-in */}
          <div className="rounded-xl border border-neutral-100 p-3">
            <p className="text-[10px] font-medium text-neutral-500">Avg. Check-in</p>
            <p className="mt-3 text-lg font-bold tabular-nums text-neutral-900">09:02</p>
            <div className="mt-2 h-6">
              <svg viewBox="0 0 120 24" className="h-full w-full">
                <polyline
                  points="0,18 15,14 30,16 45,8 60,12 75,5 90,10 105,4 120,7"
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
          {/* Attendance bars */}
          <div className="rounded-xl border border-neutral-100 p-3">
            <p className="text-[10px] font-medium text-neutral-500">Attendance</p>
            <div className="mt-3 flex h-12 items-end gap-1">
              {[70, 88, 62, 95, 80, 90].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-indigo-200"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* second row: present today + department donut */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-neutral-100 p-3">
            <p className="text-[10px] font-medium text-neutral-500">Present Today</p>
            <p className="mt-2 text-base font-bold text-neutral-900">236</p>
            <span className="mt-1 inline-block text-[9px] font-medium text-emerald-500">↑ 4% vs yesterday</span>
          </div>
          {/* donut card spanning 2 cols */}
          <div className="col-span-2 flex items-center gap-4 rounded-xl border border-neutral-100 p-3">
            <div className="relative h-20 w-20 shrink-0">
              <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#eef2ff" strokeWidth="4" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#4f46e5" strokeWidth="4"
                  strokeDasharray="44 100" strokeLinecap="round" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#a5b4fc" strokeWidth="4"
                  strokeDasharray="33 100" strokeDashoffset="-44" strokeLinecap="round" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#c7d2fe" strokeWidth="4"
                  strokeDasharray="23 100" strokeDashoffset="-77" strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-sm font-bold text-neutral-900">248</span>
                <span className="text-[8px] text-neutral-400">Staff</span>
              </div>
            </div>
            <div className="space-y-1.5 text-[10px]">
              <p className="mb-1 text-[10px] font-semibold text-neutral-700">By Department</p>
              {[
                { c: "bg-primary", l: "Engineering", v: "110" },
                { c: "bg-indigo-300", l: "Operations", v: "82" },
                { c: "bg-indigo-200", l: "Support", v: "56" },
              ].map((r) => (
                <div key={r.l} className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${r.c}`} />
                  <span className="text-neutral-500">{r.l}</span>
                  <span className="ml-auto font-semibold text-neutral-700">{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* recent requests table */}
        <div className="mt-3 rounded-xl border border-neutral-100 p-3">
          <p className="mb-2 text-[10px] font-semibold text-neutral-700">Recent Requests</p>
          <div className="space-y-1.5">
            {[
              { n: "Aisha Khan", t: "Annual Leave", d: "12 Feb", s: "Approved", sc: "bg-emerald-50 text-emerald-500" },
              { n: "Rahul Menon", t: "Expense Claim", d: "12 Feb", s: "Pending", sc: "bg-amber-50 text-amber-500" },
              { n: "Sara Pereira", t: "Work From Home", d: "11 Feb", s: "Approved", sc: "bg-emerald-50 text-emerald-500" },
              { n: "John David", t: "Sick Leave", d: "11 Feb", s: "Pending", sc: "bg-amber-50 text-amber-500" },
            ].map((r) => (
              <div key={r.n} className="flex items-center gap-2 text-[9px] text-neutral-500">
                <span className="flex-1 truncate font-medium text-neutral-700">{r.n}</span>
                <span className="w-24 truncate">{r.t}</span>
                <span className="w-12 text-right">{r.d}</span>
                <span className={`w-16 rounded-full px-1.5 py-0.5 text-center font-medium ${r.sc}`}>{r.s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
