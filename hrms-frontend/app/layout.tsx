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
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Delta HRMS",
  },
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
      <head>
        {/*
          Catch the install offer before React exists.

          Chrome fires beforeinstallprompt within milliseconds of load, and it
          fires once — a listener added later in a useEffect, after hydration,
          simply never sees it. Everything needed to be installable was in
          place (manifest, icons, an active service worker), so on Android the
          offer was being made and missed, and the Install button never
          appeared. Stashed here and read by the component when it mounts.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__hrmsInstallEvent=e;window.dispatchEvent(new Event('hrms:installready'))});window.addEventListener('appinstalled',function(){window.__hrmsInstallEvent=null})})();`,
          }}
        />
      </head>
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
