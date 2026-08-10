const path = require("node:path");

// pm2 config for the face service, mirroring how hrms-backend is deployed.
// Run from this directory: pm2 startOrReload ecosystem.config.cjs --update-env
module.exports = {
  apps: [
    {
      name: "hrms-face",
      cwd: __dirname,
      // Launch the module rather than uvicorn directly, so FACE_HOST/FACE_PORT
      // in .env stay the single source of truth for where it binds.
      script: path.join(__dirname, ".venv/bin/python"),
      args: "-m app.main",
      interpreter: "none",

      // One process, always. The enrolled-face gallery is held in this
      // process's memory, so a second instance would serve recognitions
      // against an empty cache until the backend happened to sync it.
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      // Model load takes a few seconds; don't count that as a healthy start.
      min_uptime: "60s",
      max_restarts: 10,
      // Give in-flight recognitions a moment to finish on reload.
      kill_timeout: 10000,
      // ~700 MB resident is normal with buffalo_l loaded. This is a leak guard,
      // not a target — raise it if a large gallery pushes past it.
      max_memory_restart: "1500M",

      env: { PYTHONUNBUFFERED: "1" },
    },
  ],
};
