// pm2 process definition for the HRMS backend (Bun runtime).
// Used by the CI/CD deploy: `pm2 startOrReload ecosystem.config.cjs`.
module.exports = {
  apps: [
    {
      name: "hrms-backend",
      script: "src/index.ts",
      // Run the app with Bun instead of Node. `bun` must be on PATH for the
      // pm2 daemon (see DEPLOY.md if pm2 can't find it).
      interpreter: "bun",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
