# Proposal

Status: approved
Issue: diblaze/subwave#23

## Why
Operators who lock a station behind an identity proxy or mTLS at the edge (Cloudflare Access / mTLS, Caddy `client_auth`, nginx `ssl_verify_client`) cannot use the native app: it sends only HTTP Basic (E14, E15) and presents no client certificate anywhere, and the docs disagree about whether it does (E28 vs E29, E49). A Discord request asks for exactly this: hand a listener a certificate, no account, no VPN client.

## What Changes
- App: per-station custom request headers (e.g. `CF-Access-Client-Id` / `CF-Access-Client-Secret`), kept in secure storage and sent on every request to that station: API, stream, cover art, Live Activity artwork.
- App: per-station client certificate for TLS client auth on the same paths. Android picks a device-installed certificate; iOS imports a `.p12` with its passphrase (iOS apps cannot use profile-installed identities).
- App: Google Cast is hidden for a station with headers or a certificate, as it is today for a saved login (E44, E72).
- Docs: resolve the E28/E29 contradiction; new reverse-proxy section on requiring client certificates (which clients can and cannot comply, what to leave open, Icecast callback unaffected); web player documented as "browser handles the certificate".
- No server or proxy code changes: TLS ends in front of Caddy (E33), Icecast's listener-auth callback is internal (E35).

## Capabilities
### New Capabilities
- `app-station-headers`: saving custom request headers per station and attaching them to every request the app makes to it.
- `app-client-certificate`: attaching a TLS client identity to a station and presenting it on every connection the app opens to it.
### Modified Capabilities
- none (no existing specs under `openspec/specs/`).

## Impact
- `app/src/lib/api.ts`, `app/src/lib/station.ts`, `app/src/config/StationContext.tsx`, `app/src/app/onboarding.tsx`, `app/src/player/CoverArt.tsx`, `app/src/player/drawers/ScheduleDrawer.tsx`, new `app/src/lib/station-headers.ts` + test.
- New local Expo module `app/modules/client-cert/` (Kotlin + Swift), registered in `app/app.json`; no new npm dependency; new EAS build required (native, not OTA-reachable).
- Docs: `docs/private-station.md`, `DEPLOY.md`, `docs/reverse-proxy.md`, `app/docs/QA-CHECKLIST.md`, `app/CLAUDE.md`.
- Merge-order risk with branch `feat/app-station-login` (E50, E80): both touch the station-login UI and `StationContext`.
