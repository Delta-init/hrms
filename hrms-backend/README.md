# Delta HRMS — Backend

Bun + Express + TypeScript + MongoDB (Mongoose) API for the Delta HRMS.

**Phase 1 scope:** authentication, users, and roles/permissions (RBAC).

## Stack
- **Runtime:** Bun
- **Framework:** Express + TypeScript
- **DB:** MongoDB via Mongoose
- **Auth:** JWT (access + refresh), bcrypt password hashing
- **Validation:** Zod

## Setup
```bash
bun install
cp .env.example .env      # then edit values
bun run seed              # creates Super Admin, HR Manager, Employee roles + admin user
bun run dev               # starts on http://localhost:5055
```

> Requires a running MongoDB (default `mongodb://localhost:27017/hrms`).

### Seeded admin
- **Email:** `admin@hrms.com`
- **Password:** `Admin@12345`
(change via `.env` before seeding)

## API (base: `/api/v1`)

### Auth
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/auth/login` | Verify credentials, return `{accessToken, refreshToken, user}` | public |
| POST | `/auth/set-password` | Invited user sets their own password using the temporary one | public |
| POST | `/auth/refresh-token` | Rotate tokens | public |
| GET | `/auth/me` · `/auth/profile` | Current user | Bearer |
| PUT | `/auth/change-password` | Change own password | Bearer |

### Users (`users` module permissions)
`GET /users` · `POST /users` · `GET /users/:id` · `PUT /users/:id` · `DELETE /users/:id` · `GET /users/profile`

### Roles (`roles` module permissions)
`GET /roles` · `POST /roles` · `GET /roles/all` · `GET /roles/:id` · `PUT /roles/:id` · `DELETE /roles/:id`

## RBAC
Roles hold a per-module permission matrix (`view/create/edit/delete/approve/export`) over
`HRMS_MODULES` (dashboard, employees, departments, attendance, leave, payroll, users, roles, settings).
The **Super Admin** system role bypasses all checks.

## Admin-invite flow (Option B — no public signup)
1. Admin creates a user with `status: "invited"` and `mustResetPassword: true` + a temporary password.
2. Login is blocked until activation.
3. The employee activates via `POST /auth/set-password` (email + temp password + new password) → status becomes `active`.
