import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/providers/Providers";
import { GoeyToaster } from "@/components/ui/goey-toaster";
import NextTopLoader from "nextjs-toploader";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Delta HRMS",
  description: "Delta Human Resource Management System",
  applicationName: "Delta HRMS",
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <NextTopLoader
            color="#4f46e5"
            shadow="0 0 10px #4f46e5, 0 0 5px #4f46e5"
            height={3}
            showSpinner={false}
            easing="ease"
            speed={200}
          />
          {children}
          <GoeyToaster />
        </Providers>
      </body>
    </html>
  );
}
