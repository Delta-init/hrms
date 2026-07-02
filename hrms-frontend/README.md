# Delta HRMS — Frontend

Next.js (App Router) + TypeScript frontend for the Delta HRMS, sharing the Delta design system.

**Phase 1 scope:** immersive auth (login + activate-account), dashboard, users & roles management.

## Stack
- **Next.js 14** (App Router) + React 18
- **NextAuth** (Credentials provider) — session layer over the Express backend
- **React Query** (TanStack) — data fetching
- **Zustand** — client UI state
- **Zod** + **react-hook-form** — validation
- **Framer Motion** — animation
- **shadcn/ui** + **Tailwind CSS** — UI kit (reused from Delta CRM)

## Auth model
Express verifies credentials and issues a JWT; **NextAuth owns the browser session**.
The Credentials provider calls Express `/auth/login`, stores the Express access token
inside the NextAuth session, and the axios client attaches it as a Bearer token on every
request. Routes are protected by `middleware.ts`.

## Setup
```bash
bun install
cp .env.local.example .env.local   # (or edit .env.local directly)
bun run dev                         # http://localhost:3000
```

### Environment (`.env.local`)
```
API_URL=http://localhost:5055/api/v1            # server-side (NextAuth authorize)
NEXT_PUBLIC_API_URL=http://localhost:5055/api/v1 # browser axios client
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<random secret>
```

> Start the backend first, then this app. Sign in with the seeded admin
> (`admin@hrms.com` / `Admin@12345`).

## Routes
- `/login` — immersive sign-in
- `/set-password` — activate account (invited users set their own password)
- `/dashboard` — stats overview
- `/users` — user management (create / edit / disable, RBAC-gated)
- `/roles` — roles & permission matrix
- Other HR modules (employees, attendance, leave, payroll, departments, settings) are
  placeholder screens for future phases.

## Structure
```
app/(auth)        immersive login + set-password
app/(dashboard)   protected app shell + pages
components/auth    AuthShell, LoginForm, SetPasswordForm
components/ui      shadcn kit (shared with Delta CRM)
components/layout  Sidebar, Header
hooks              useAuth (NextAuth), useUsers, useRoles (React Query)
lib/auth           NextAuth options
lib/axios.ts       session-aware API client
```
