# Aoi

Aoi is a private relationship app for two people. It combines a shared timeline, lightweight planning, and profile space setup in one calm, private environment.

## Current Product Scope (Feb 2026)

The mobile app currently ships these flows:

- OAuth provider sign in (Apple and Google)
- Session restore/logout using secure token storage
- Relationship space onboarding:
  - create a space (name, partner name, relationship start date)
  - or join with a 6-character invite code
- Optional import of past milestones during onboarding
- Theme selection from three shared presets
- Main app with four tabs:
  - Timeline (moments, upcoming goals lane)
  - Calendar (event planning by person)
  - Profile (identity + relationship details)
  - Settings (theme selector + session actions)

## Scope Deferred From Earlier Docs

The codebase has intentionally narrowed MVP scope. These areas are now post-MVP:

- Media upload pipeline (direct-to-object-storage)
- Purchase/entitlement enforcement
- Storage quota tiers
- Deterministic monthly/anniversary recaps
- Full account export/deletion flows

## Backend Direction

- API: Go + Gin (stateless)
- DB: Postgres (Neon)
- Hosting: Fly.io
- Cache/ratelimiting/idempotency: Redis-compatible store
- Object storage (deferred module): Cloudflare R2

## Required Auth API Contract (Already Used by App)

These auth routes are already called by the app and must remain compatible:

- `POST /v1/auth/oauth/start`
- `POST /v1/auth/oauth/callback`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`

## Core Docs

- `aoi-prd-engineering.md` - updated product + engineering scope
- `aoi-db-api.md` - updated schema + endpoint plan
- `go-backend-performance-blueprint.md` - performance-first backend implementation plan

## Repo Notes

- This repository currently contains the Expo mobile app.
- Backend implementation is planned under `services/api`.
