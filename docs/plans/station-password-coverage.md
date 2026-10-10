# Station password covers the whole listener API
Status: approved
Issue: diblaze/subwave#1
## Goal
On a station with either privacy lock on, every listener-facing controller route (not just `GET /similar-tracks`) answers 401 without the station password and 200 with it; public stations are byte-identical.
## Evidence
All `path:line` are `upstream/develop`.

Rule and gate already exist — reuse, do not redesign:
- E1 controller/src/util/listener-auth.ts:64-66 — `stationLockEngaged … return opts.privatePlayer || opts.listenerAuth;` — upstream already decided "either lock on → station password required" for reads (#1575).
- E2 controller/src/middleware/station-auth.ts:24-58 — `export async function requireStationAuth` … `if (ok) return next(); … checkAuthRateLimit(ip, 'station-read')` … 401 — the gate to reuse; fails CLOSED, own bucket.
- E3 controller/src/util/listener-auth.ts:90-103 — `stationAuthCandidate`: `x-station-auth` → `Bearer` → `?auth=`; no Basic.
- E4 docs/api.md:84-86 — "An `Authorization: Basic` header is never read as a station token: admin credentials are a separate secret and accepting them here would quietly widen the gate." — upstream's stated position; keep Basic out of the TOKEN path.
- E5 controller/src/routes/public.ts:575 — `router.get('/similar-tracks', requireStationAuth, …` — the only gated listener read today.

Routes without `requireAdmin` (route sweep over `controller/src/routes/**`; all others carry `requireAdmin`/`requireAdminUi`):
- E6 controller/src/routes/public.ts:108,148,180,331,346,358,388,428,449,499,535,641,666,686,696,706,735 — `/cover/:id`, `/persona-avatar/:id`, `/now-playing`, `/listen.pls`, `/listen.m3u`, `/dj`, `/schedule`, `/personas`, `/state`, `POST /listener-auth`, `POST /station-auth`, `/themes`, `/session`, `/skills/community`, `/personas/community`, `/shows/community`, `/health`.
- E7 controller/src/routes/request.ts:693 — `router.post('/request', validatePublicBody(listenerRequestSchema), …` and :811 `router.get('/request/:id', …` — validation runs first, hence the observed 400 (not 401).
- E8 controller/src/routes/likes.ts:62,106 — `router.post('/like'` / `router.get('/like'`; controller/src/routes/audience.ts:37 — `router.post('/beacon'`.
- E9 controller/src/routes/onboarding.ts:43-45 — "Deliberately public … it only exposes whether the station is configured yet." `GET /onboarding/status`.
- E10 controller/src/routes/mcp.ts:50,62-65 — `POST /mcp` … `forwardStationAuth: … req.headers['x-station-auth']` — MCP transport is open; tools call loopback REST.
- E11 controller/src/routes/public.ts:323-329 — `tuneInFilesBlocked … listenerAuth !== true) return false; res.status(403)` — `/listen.*` already 403 under the stream lock; under `privatePlayer` only the stream is public by design (docs/private-station.md "This only hides the interface").

Must stay reachable by machines:
- E12 docker-compose.yml:156 — `curl -fsS http://localhost:7701/health` (same in byo:140, dev:136); cli/src/api.ts:110 `client.get('/health'`; app/src/lib/api.ts:130 `api('/health')` — `/health` stays open.
- E13 docs/private-station.md:35-37 — "Icecast asks the controller on every listener connect" → `POST /listener-auth` untouched; `POST /station-auth` is the login itself (public.ts:532-555).
- E14 liquidsoap/radio.liq — no `http.` call to the controller (grep: only comments mention "controller"; IPC is `next.txt`/telnet, CLAUDE.md "file-based IPC"). docker/aio/supervisor.sh:717 — only `LISTENER_AUTH_URL`.
- E15 web/lib/station.ts:23-27 — server-side `fetch(\`${CONTROLLER_BASE}/dj\`` … `if (!res.ok) return null;` → generic branding; desired on a private station. communitySkills/Personas/Shows.ts hit the static `/*/community` catalogs only.

Clients that must start sending the password:
- E16 web/lib/stationClient.ts:93-160 — the ONE web chokepoint: `fetch(\`${api}/now-playing\`…`, `/state`, `/session`, `/schedule`, `/themes`, `/request`, `/request/${id}`, `/like`, `/beacon`; :92 `coverUrl`, :91 `resolve` build `<img>` URLs. No header anywhere.
- E17 web/lib/stationAuth.ts:5-12,32-36 — `getStationAuthToken()` (localStorage) and `withStreamAuth(url)` appending `?auth=` — reusable for headers and image URLs.
- E18 web/components/player/StationGate.tsx:21-24 — `const required = state.privacy?.privatePlayer === true || state.privacy?.listenerAuth === true;` — the prompt needs `privacy` from `/state`, which will be locked.
- E19 web/hooks/useStationFeed.ts:110-114,193,198 — `Promise.all([client.nowPlaying…, client.state…, client.session…])` … `setIfChanged(setState, stRes)` … `catch {}`; controller/src/middleware/startup.ts:12 already feeds the same poll `503 … json({ status: 'starting', error: … })`, so error-shaped bodies are tolerated today.
- E20 web/public/sw.js:58 — `if (url.pathname.startsWith('/api/')) return;` — no SW caching of the API. No `EventSource`/`WebSocket` in web or app (grep).
- E21 web/components/admin/dash/queries.ts:46-47 — `adminJson(fetcher, '/now-playing' …)`, `'/state'`; web/hooks/useStationSwitch.ts:31 `adminFetch('/state')`; web/lib/adminAuth.ts:85-88 "a 401 from any page query reaches AdminShell and unmounts its QueryClient" — the admin console reads locked routes with ADMIN Basic and signs out on 401.
- E22 controller/src/settings/store.ts:159 — `clone.privacy.password = s.privacy?.password ? 'set' : '';` — the admin UI cannot read the station password, so it cannot send `x-station-auth`; verified admin Basic must pass the gate (E21).
- E23 controller/src/middleware/auth.ts:127-139 — Basic decode + `safeEqual(u, ADMIN_USER) && safeEqual(p, ADMIN_PASS)` inside `authenticateAdmin` (strikes, cookie); :143-146 "A request with no Basic header is not a strike."
- E24 app/src/lib/api.ts:109-113,140-144 — `getJson(url)` → `fetch` with no headers; `if (!res.ok) throw`; :208-213 `cover`/`avatar` plain URLs; :214 `streamUrl … withStreamAuth(…, stationPassword())`; :215 `streamHeaders` is the PROXY login, not the station password. Released apps send nothing on API calls.
- E25 app/src/hooks/useStationFeed.ts:262-273 — `Promise.allSettled` … `if (st.status === 'fulfilled') setIfChanged('state', …)` — a 401 leaves `state.privacy` empty → app/src/hooks/useStationGate.ts:56 `stationLockRequired(privacy)` false → no prompt, blank feed.
- E26 controller/src/mcp/client.ts:194-195 — `...(init.admin ? this.authHeader() : {}), ...(init.station ? this.stationHeader() : {})`; :287-334 `/now-playing`, `/state`, `/schedule`, `/session`, `/request`, `/request/:id` called without `station: true`; :398 only `/similar-tracks` has it. :235-245 the station-401 message already says what to do.
- E27 cli/src/api.ts:55 — `if (opts.admin && authHeader) headers.Authorization = authHeader;`; cli/src/commands/status.ts:45,77 and cli/src/doctor.ts:174 call `/now-playing`, `/state` without `admin: true`.
- E28 controller/src/connect/catalog.ts:116,146,167,190,211,228,242,333,346 — `auth: 'none'` on the listener entries; :43 vocabulary `'none' | 'admin' | 'station'`.

Rate limit and caching:
- E29 controller/src/middleware/station-auth.ts:50-51 — `checkAuthRateLimit(ip, 'station-read')` on EVERY failure, including an empty candidate; ratelimit.ts:135-145 cap 20/15 min. A fresh visitor polling 3 routes/5 s unauthenticated fills it in ~35 s, then "a full bucket refuses the right password too" (station-auth.ts:15-18).
- E30 controller/src/routes/public.ts:116 — `'Cache-Control', 'public, max-age=86400, immutable'` (cover); :168 `'public, max-age=3600'` (avatar). JSON routes set no Cache-Control. Caches key on the full URL, so a `?auth=` image URL is only re-served to a holder of that token; docs/private-station.md:135 already accepts the token in logs for the stream.

Tests and conventions:
- E31 controller/scripts/listener-auth-route.test.ts:19-32 — real Express app: `app.use(router); app.listen(0 …)`; :56 `settings.update({ privacy: { password: PW, listenerAuth: true } })`.
- E32 controller/scripts/similar-tracks.test.ts:319-329 — walks `router.stack … layer.route.stack.some((h) => h.name === 'requireStationAuth')` — the route-table introspection pattern to generalise.
- E33 CONTRIBUTING.md:328-338 — `fix(ui): …  # → patch bump`, "`feat!:` … Use `!` … for anything that breaks compatibility"; CLAUDE.md:64-66 PRs target `develop`.
- E34 CLAUDE.md:197 — "Absent or malformed settings must coerce to the pre-existing behaviour, so an upgrade is byte-identical."; docs/private-station.md:24-26, 130 and SECURITY.md:402-403 document the open metadata API — docs to update, not a design to preserve (upstream's stated reason, "the player and admin dash rely on them", is what this plan fixes at the clients).
## Changes
Rule: `stationLockEngaged` (E1) governs — either lock on ⇒ password on every listener route below; nothing else changes on a public station. Credential carriers stay E3 (header, Bearer, `?auth=`); plus a Basic header that verifies as the ADMIN credential passes (E21-E23) — Basic is still never read as a station token (E4). Three PRs, in this order (an old controller ignores the extra header/query, so clients ship first):

PR 1 — `feat(web): send the station password on listener API calls`
- web/lib/stationClient.ts — one `headers()` adding `x-station-auth: getStationAuthToken()` (E17) to every fetch in E16 except `/health` and `/onboarding/status`; `coverUrl`/`resolve` wrap with `withStreamAuth` (E17; no-op without a token); `state()`: on 401 call `clearStationAuthToken()` and return `{ upcoming: [], history: [], privacy: body.privacy, locked: true }` so E18 keeps working (E19).
- web/lib/types.ts — `StationState.locked?: boolean`.
- web/components/player/StationGate.tsx — in `useStationAuth`: `useEffect(() => { if (state.locked && phase === 'ok') setPhase('prompt'); }, [state.locked, phase])` (rotated password mid-session).
- web/lib/stationClient.test.ts — new (fetch stub): header rides when a token is stored and is absent otherwise; cover URL carries `?auth=`; 401 on `/state` yields the synthesized state and clears the token.

PR 2 — `feat(app): send the station password on listener API calls`
- app/src/lib/api.ts — `stationHeaders()` from `stationPassword()` on every API fetch in E24 except `/health` and `/station-auth`; `cover`/`avatar` via `withStreamAuth(url, stationPassword())` (already imported, :5); `state()` 401 → `{ upcoming: [], history: [], privacy: body.privacy, locked: true }` (mirrors PR 1, fixes E25).
- app/src/hooks/useStationGate.ts — re-run the stored-password verification effect (:80-101) when `state.locked` flips true (add it to the hook's inputs/deps); existing `verifyStoredPasswords` decides prompt vs ok.
- app/CLAUDE.md:23 — add "the password also rides every `/api` call as `x-station-auth`".

PR 3 — `fix(security): listener API honours the station password` (controller + mcp + cli + docs; the behaviour change)
- controller/src/middleware/auth.ts — extract E23 lines 127-139 into exported pure `adminCredentialsMatch(authorization?: string): boolean` (false when `!ADMIN_AUTH_REQUIRED`); `authenticateAdmin` calls it. No strike, no cookie.
- controller/src/middleware/station-auth.ts — (a) after `stationLockEngaged` peek: `if (adminCredentialsMatch(req.headers.authorization)) return next();` (E21-E22); (b) count a strike only when the candidate is non-empty (E29; same posture as E23:143-146); (c) 401 body adds `privacy: { privatePlayer, listenerAuth }` (two booleans `/state` already publishes, public.ts:477-481) so E18/E25 can render the prompt.
- controller/src/routes/public.ts — insert `requireStationAuth` on `/cover/:id`, `/persona-avatar/:id`, `/now-playing`, `/dj`, `/schedule`, `/personas`, `/state`, `/themes`, `/session` (E6). Open, with the reason in the file-head comment: `/health` (E12), `/listener-auth` + `/station-auth` (E13), `/listen.pls|m3u` (E11), `/*/community` (static shipped data, E15), `/onboarding/status` (E9), `/geocode` (admin already).
- controller/src/routes/request.ts — `router.post('/request', requireStationAuth, validatePublicBody(…)` and `router.get('/request/:id', requireStationAuth, …` (E7); import from `../middleware/station-auth.js`.
- controller/src/routes/likes.ts, controller/src/routes/audience.ts — gate `/like` ×2 and `/beacon` (E8).
- controller/src/mcp/client.ts — `station: true` on `/now-playing`, `/state`, `/schedule`, `/session`, `/request`, `/request/:id` (E26); update the header comment :10-18. `routes/mcp.ts` already forwards the header (E10).
- controller/src/connect/catalog.ts — the E28 entries become `auth: 'station'` (Connect badges + OpenAPI follow).
- cli/src/commands/status.ts:45,77, cli/src/doctor.ts:174 — add `{ admin: true }` (E27; host CLI holds the admin creds, passes via (a)).
- controller/scripts/station-read-gate.test.ts — new, E31 style: mount public+request+likes+audience routers; `OPEN = ['/health','/listener-auth','/station-auth','/listen.pls','/listen.m3u','/skills/community','/personas/community','/shows/community']`; (1) route-table guard: every `layer.route` in those routers is in `OPEN` or has `requireStationAuth`/`requireAdmin`/`requireAdminUi` in `route.stack` by name (E32) — fails when a new listener route lands without a decision; (2) with `privatePlayer` only and with `listenerAuth` only: each gated route → 401 whose body has `privacy`; `x-station-auth` → not 401; admin Basic (set `ADMIN_USER/PASS` env before the first import) → not 401; `OPEN` routes → not 401; (3) 25 credential-less polls then the right header → 200 (E29 fix); (4) public station, no credential → not 401 on every route (E34).
- Docs (same PR): docs/private-station.md:24-26 and :130 (metadata now locked; stream-only lock still leaves `/listen.*` open), docs/api.md:61-66 (listener reads move to **station**; :84-86 add "a header that verifies as the admin credential passes — it is checked as admin, never as a station token"), SECURITY.md:402-403 ("… intentionally unauthenticated on a public station"), docs/internals/infrastructure.md:60 and controller/CLAUDE.md:141 (gate now covers all listener reads; strike only on a presented token), docs/mcp-server.md:264 + mcp-subwave/README.md:63 (`SUBWAVE_STATION_PASSWORD` needed for every read on a private station).
## Check
`cd controller && npm test -- station-read-gate` (PR 3; fails on today's tree because `/now-playing` etc. answer 200 unauthenticated and have no gate in `route.stack`). Live: `curl -s -o /dev/null -w '%{http_code}\n' https://<private-station>/api/now-playing` → `401`, and `-H 'x-station-auth: <pw>'` → `200`.
## Deferred (YAGNI)
- `Cache-Control: no-store` on gate 401s / locked JSON — reopen if an edge is found caching `/api/*` JSON (Caddy adds none, E30; Cloudflare skips JSON by default).
- Cookie instead of `?auth=` on image URLs — reopen if token-in-access-log for covers matters more than it already does for the stream (docs/private-station.md:135).
- Password prompt on pages outside the player shell (`/shows`, `/personas`, `/observatory`) — they render empty on a private station because `schedule()`/`themes()` already throw on `!ok` (E16:99,104); reopen if an operator asks for the prompt there.
- A `privacy.lockApi` compatibility switch — reopen only if a third-party integration against a *private* station is reported; none found in-repo (E14, E15, E26, E27 all covered here).
- `/listen.pls|m3u` 403 under `privatePlayer` only — reopen if upstream wants the UI lock to hide the mount list; today the stream is deliberately public then (E11).
## Decisions (operator, 2026-10-10)
- Old app builds: ship with a release note, no compatibility switch, controller PR not held for the stores.
- `/cover/:id` and `/persona-avatar/:id` are gated, `?auth=` on image URLs.
- Issue lives on the fork; upstream PRs reference it. Commit type for PR 3 is left to the maintainer, proposed `fix(security):`.
