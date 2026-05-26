# Aoi API Server

## Setup
1. Copy `.env.example` to `.env` and fill in values
2. `pnpm install`
3. Create the database, then: `pnpm run db:generate && pnpm run db:migrate`
4. `pnpm run dev` — starts on port 8080

## Environment Variables
- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — Secret for signing JWTs (generate with `openssl rand -hex 32`)
- `CORS_ORIGIN` — Allowed CORS origin (default: `*`)
- `PORT` — Server port (default: 8080)

## API Endpoints
See `../../aoi-db-api.md` for the full API specification.
