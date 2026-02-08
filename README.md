# Aoi

Aoi is a private, shared relationship scrapbook for two people. It stores photos, short videos, notes, milestones, important dates, and goals, and generates monthly and anniversary recaps.

## Principles
- No AI features.
- No social feed, chat, or public sharing.
- Relationship as a chapter (can be archived/ended).
- Media owned by uploader; shared visibility via relationship membership.
- Direct-to-object storage uploads (no media through API).

## Monetization
- Free to download.
- $9.99 one-time in-app purchase per relationship creation (invite one partner for free).
- Optional storage subscription later (extra capacity). If canceled: view-only, export allowed.

## Stack
- Mobile: React Native (Expo)
- Backend: Go (Gin)
- Database: Postgres (Neon)
- Storage: Cloudflare R2 (S3-compatible)
- Hosting: Fly.io

## Suggested repo layout
```
aoi/
  apps/
    mobile/                # Expo app
  services/
    api/                   # Go Gin API
  packages/
    shared/                # shared types, schemas, constants
  docs/
    blueprint.md
    prd-engineering.md
    db-api.md
```

## Core flows (MVP)

### Upload
1. Client compresses media locally.
2. Client requests a presigned upload URL.
3. Client uploads directly to R2.
4. Client calls complete endpoint to register media.
5. Client creates a moment referencing the media.

### Relationship creation
1. Client purchases relationship creation entitlement (IAP).
2. Client verifies purchase with backend.
3. Client creates relationship (consumes entitlement).
4. Client generates invite code.
5. Partner redeems invite code.

## Policies (high level)
- Location optional per upload and stored at rounded precision.
- Refunds revoke entitlements and switch users to view-only.
- Retention cleanup runs daily via cron hitting an internal endpoint.

## Docs
- `docs/blueprint.md` — product scope and constraints
- `docs/prd-engineering.md` — PRD + engineering spec
- `docs/db-api.md` — schema + endpoints
