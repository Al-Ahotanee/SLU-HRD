# Fixes applied — read this first

## What was actually wrong

1. **The database was sql.js (SQLite-in-memory) writing to `/tmp` on Vercel.**
   Vercel serverless functions are stateless: every request can land on a
   different, isolated container, and `/tmp` is private to that one
   container. So:
   - Two requests at the same time can hit two different containers, each
     with its own private copy of "the database" — explains users/records
     flickering between counts (e.g. 6 then 3) on refresh or in another
     browser.
   - Any container can be destroyed and replaced at any time. A fresh
     container starts with an empty `/tmp`, so it reloads only the 3 seeded
     demo accounts — explains records you just added vanishing later.
   - This is a fundamental serverless + ephemeral-disk mismatch, not a bug
     that can be patched — it needs a real external database.

2. **The frontend trusted the cached login token without checking it.**
   On load, `app.html` jumped straight to the dashboard if `localStorage`
   had a token, and only found out it was bad/expired once a page tried to
   load data — so you'd see the dashboard shell with "Invalid token" errors
   scattered inside it, rather than a clean "please log in again."

## What changed

- `api/db.js` — rewritten to use PostgreSQL (`pg`) instead of sql.js/`/tmp`.
  One shared, persistent database for every request, every instance, every
  browser. All `db.*` functions are now `async`.
- `api/index.js` — routes updated to `await` the now-async db calls, a
  shared "DB ready" gate middleware, and Postgres-style unique-constraint
  error detection (`error.code === '23505'`) instead of the old
  SQLite-flavoured `e.message.includes('UNIQUE')`.
- `app.html` / `public/app.html`:
  - On load, the cached token is verified against `/api/auth/me` **before**
    the dashboard is shown.
  - Any `401` response anywhere in the app now logs the user out cleanly and
    shows a "Session expired, please log in again" toast, instead of leaving
    a half-broken dashboard on screen.

## What you need to do before deploying

1. **Create a Postgres database.** Neon (neon.tech) has a free tier and
   matches what you've used on your other projects. Create a project and
   copy the connection string it gives you (it looks like
   `postgresql://user:password@host/dbname?sslmode=require`).
2. **In your Vercel project → Settings → Environment Variables**, add:
   - `DATABASE_URL` = the Neon connection string from step 1
   - `JWT_SECRET` = any long random string (e.g. generate one with
     `openssl rand -hex 32`)
   Add both to **all three** environments (Production, Preview,
   Development) with the *same* values — a mismatched `JWT_SECRET` between
   environments is what causes "valid" tokens to fail verification when you
   hit a different deployment URL.
3. **Redeploy.** On first request, the app will automatically create its
   tables and seed the 3 demo accounts (admin / lecturer / student) — same
   as before, just in real Postgres now.
4. For local development, copy `.env.example` to `.env` and fill in the
   same two values, then `node api/index.js` (or `npm run dev`).

## Why this fixes every symptom you described

- "Invalid token right after logging in / had to log out and back in" →
  fixed by verifying the token on load instead of trusting stale
  `localStorage`, plus making sure `JWT_SECRET` is pinned to one consistent
  value everywhere.
- "Users/records appear then disappear" / "6 users then 3 on refresh" /
  "different browser shows different data" → fixed by moving off
  per-instance in-memory SQLite onto one shared Postgres database that every
  request talks to.
