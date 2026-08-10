const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  workboxOptions: {
    // Never cache the API — attendance/leave/payroll data must always be fresh.
    runtimeCaching: [],
  },
});

const isDev = process.env.NODE_ENV === "development";

// The API lives on its own origin, so connect-src has to name it explicitly.
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL).origin;
  } catch {
    return "";
  }
})();

/**
 * `unsafe-inline` on script-src is unavoidable without per-request nonces,
 * which need middleware Next can't apply to statically-rendered routes. The
 * directives below still block the things that matter most: framing, plugin
 * embeds, base-tag hijacking, form posts to third parties, and loading code or
 * opening connections to any origin other than our own API.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disabled: React Strict Mode's dev double-mount makes framer-motion skip
  // entrance (mount) animations, leaving `initial` states (opacity:0) stuck.
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Belt-and-braces alongside frame-ancestors, for older browsers.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // camera=(self), not camera=(): an empty allowlist bars every origin
          // including our own, which silently kills getUserMedia — the browser
          // reports the permission as denied and never prompts, whatever the
          // user has allowed in their browser settings. Face check-in needs the
          // camera on our own pages; (self) grants exactly that and still
          // refuses it to anything embedded, which frame-ancestors already
          // prevents anyway. Microphone and location stay barred outright.
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

module.exports = withPWA(nextConfig);
