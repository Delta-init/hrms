const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  workboxOptions: {
    // Never cache the API — attendance/leave/payroll data must always be fresh.
    runtimeCaching: [],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disabled: React Strict Mode's dev double-mount makes framer-motion skip
  // entrance (mount) animations, leaving `initial` states (opacity:0) stuck.
  reactStrictMode: false,
};

module.exports = withPWA(nextConfig);
