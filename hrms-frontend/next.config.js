/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disabled: React Strict Mode's dev double-mount makes framer-motion skip
  // entrance (mount) animations, leaving `initial` states (opacity:0) stuck.
  reactStrictMode: false,
};

module.exports = nextConfig;
