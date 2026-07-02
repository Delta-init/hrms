# Deployment (CI/CD)

The backend auto-deploys to the VPS on every push to `main` that touches
`hrms-backend/**`. The pipeline SSHes into the VPS, pulls `main`, installs
dependencies, and reloads the app with pm2.

Workflow: [`.github/workflows/deploy-backend.yml`](.github/workflows/deploy-backend.yml)

---

## 1. GitHub Actions secrets

Add these under **GitHub → repo → Settings → Secrets and variables → Actions → New repository secret**:

| Secret         | Example        | What it is                                              |
| -------------- | -------------- | ------------------------------------------------------- |
| `VPS_HOST`     | `203.0.113.10` | VPS IP address                                          |
| `VPS_USERNAME` | `root`         | SSH login user                                          |
| `VPS_PASSWORD` | `••••••••`     | SSH login password                                      |
| `VPS_PORT`     | `22`           | SSH port                                                |
| `VPS_APP_PATH` | `/root/hrms`   | Repo root on the VPS (the folder that contains `hrms-backend/`) |

> Your shell showed `root@srv1651103:~/hrms/hrms-backend`, so on that box
> `VPS_USERNAME=root` and `VPS_APP_PATH=/root/hrms`.

---

## 2. Let the VPS pull the private repo without a password (deploy key)

The pipeline runs `git pull` **on the VPS**, so the VPS itself must be able to
authenticate to the private GitHub repo. Use a read-only **deploy key**.

**On the VPS**, run:

```bash
# 1. Generate a dedicated key (no passphrase → non-interactive pulls)
ssh-keygen -t ed25519 -C "hrms-vps-deploy" -f ~/.ssh/hrms_deploy -N ""

# 2. Show the PUBLIC key — copy the whole line
cat ~/.ssh/hrms_deploy.pub

# 3. Tell git/ssh to use this key for github.com
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/hrms_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

**On GitHub**: repo → **Settings → Deploy keys → Add deploy key** → paste the
public key from step 2. Leave **"Allow write access" unchecked** (pulls only).

**Point the VPS checkout at the SSH remote** (deploy keys only work over SSH,
not HTTPS):

```bash
cd /root/hrms
git remote set-url origin git@github.com:Delta-init/hrms.git

# Verify — should greet you by the repo name, no password prompt:
ssh -T git@github.com
git pull      # should now work without asking for anything
```

---

## 3. One-time VPS setup (first deploy only)

```bash
# Bun (runtime)
curl -fsSL https://bun.sh/install | bash
# then reopen the shell, or: source ~/.bashrc

# pm2 (process manager) — needs Node/npm present
npm install -g pm2

# Clone the repo (over SSH, using the deploy key from step 2)
cd /root
git clone git@github.com:Delta-init/hrms.git
cd hrms/hrms-backend

# Create the production .env (NOT in git — copy from the example and fill in)
cp .env.example .env
nano .env        # set PORT, MONGODB_URI, JWT_SECRET, etc.

# First start
bun install --frozen-lockfile
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

# Make pm2 resurrect apps on VPS reboot (run the command it prints)
pm2 startup
```

After this, every push to `main` redeploys automatically.

### If pm2 can't find `bun`
The pm2 daemon may not have `~/.bun/bin` on its PATH. Fix once:

```bash
pm2 delete hrms-backend 2>/dev/null || true
export PATH="$HOME/.bun/bin:$PATH"
pm2 start ecosystem.config.cjs
pm2 save
```

Or set an absolute interpreter path in `hrms-backend/ecosystem.config.cjs`
(e.g. `interpreter: "/root/.bun/bin/bun"`).

---

## Notes
- `.env` is gitignored, and the deploy uses `git reset --hard` (which does **not**
  touch untracked files), so your VPS secrets are never overwritten.
- Password SSH auth is used per request. For better security you can later swap
  `password:` for `key:` in the workflow and store a private key in `VPS_SSH_KEY`.
