import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { ThemeProvider } from "@/providers/ThemeProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
    <div className="flex h-screen w-full overflow-hidden bg-muted/30">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col p-2 md:p-3">
        <Header />
        <div className="mt-2"><ImpersonationBanner /></div>
        <main className="flex-1 overflow-y-auto rounded-2xl border border-border/40 bg-background p-4 shadow-sm md:p-6">
          {children}
        </main>
      </div>
    </div>
    </ThemeProvider>
  );
}
