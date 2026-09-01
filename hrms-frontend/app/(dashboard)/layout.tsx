import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { OnboardingGate } from "@/components/layout/OnboardingGate";
import { KioskLock } from "@/components/layout/KioskLock";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineNotice } from "@/components/pwa/OfflineNotice";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
    <OnboardingGate />
    <KioskLock />
    <div className="flex h-screen w-full overflow-hidden bg-muted/30">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col p-2 md:p-3">
        <Header />
        <div className="mt-2"><ImpersonationBanner /></div>
        <OfflineNotice />
        {/* Permanent: no dismiss button, and a past dismissal is not
            remembered. Asked for that way — installing the app is the thing
            most people here still have to do, and an offer they closed once
            was an offer they could never find again. */}
        <InstallPrompt persistent />
        <main className="flex-1 overflow-y-auto rounded-2xl border border-border/40 bg-background p-4 shadow-sm md:p-6">
          {children}
        </main>
      </div>
    </div>
    </ThemeProvider>
  );
}
