# App: edit a saved station login, say when it is rejected
Status: approved
Issue: diblaze/subwave#7

> Fork-only working file. Never commit this file on an upstream-bound branch
> (upstream merges `docs/plans/*`: E25). Code reviewed from `upstream/develop`
> at 7dbc57ce; all `path:line` below are relative to `app/` on that commit.

## Goal
A listener can open "Station login" for any saved station (list row, tuned-in card, player banner), fix or remove the login or forget the station password, only ever persist a login the station did not reject, and the player stops reconnecting and says "Station login rejected" when the proxy returns 401 for the saved login.

## Evidence
E1 `gh issue view 1873 --comments` — bot proposal items 1–5 + operator reply (tuned-in card has no actions; use `verifyStoredPasswords`'s `POST /station-auth` check on save; stop player on reject: yes; forget station password from edit screen: yes; featured key button: no opinion; stream probe: no) + owner "feel free to open a pr" — scope.
E2 `src/app/stations.tsx:117-133` — `<Divider>Tuned in</Divider><View style={{ borderWidth: 1, borderColor: colors.accent …` — tuned-in card is a plain View, no actions.
E3 `src/app/stations.tsx:144,159-169` — `onLongPress={removable ? () => confirmForget(st) : undefined}` … `{removable ? (<Pressable onPress={() => confirmForget(st)} … <Trash2` — the only per-row action today; the key button goes beside it.
E4 `src/app/stations.tsx:56-74` — `confirmForget` → `forgetStation(st.url)` with the "Couldn't remove station" Alert — pattern for destructive confirm + SecureStore failure copy.
E5 `src/app/onboarding.tsx:55-67` — `function confirmCleartextLogin(): Promise<boolean>` (Alert "Send station login over HTTP?"); `:202-205` `if (activeCredentials && candidates[0].startsWith('http://')) { const allowed = await confirmCleartextLogin();` — the consent rule: credentials AND `http://`, no localhost exemption.
E6 `src/app/onboarding.tsx:83-86` — `'The station rejected this login (HTTP 401). Go back and check the username and password.'`; `:353` `const enteredCredentials = username || password ? { username, password } : null;` — reuse wording and the empty-fields rule.
E7 `src/app/onboarding.tsx:339` — `"Couldn't save this station login securely. The station was not added; unlock secure storage and try again."`; `src/app/stations.tsx:50-51` — `"The device's secure storage could not be read. …"` — existing SecureStore failure copy.
E8 `src/config/StationContext.tsx:106-124` — `selectStation` is the only writer of credentials and calls `await teardown()`; `:131-134` `forgetStation` = `removeRecent(url)`; `:151-155` `forgetStationPassword` works on `base` only; `:157-163` `api` memo on `[base, credentials]` — a changed login rebuilds the client without a station switch.
E9 `src/lib/station.ts:81-87` `loadStationCredentials`; `:93-99` `saveStationPassword`/`clearStationPassword(rawUrl)` take any URL; `:116-120` `if (nextCredentials) await credentialVault.set(url, …) else if (credentials === null) await credentialVault.remove(url)`; `:131-140` `removeRecent` removes login AND station password.
E10 `src/lib/credential-vault.ts:41-56` — `get/set/remove(base)`; `set` reads first, so a locked keychain throws before any write (`scripts/station-credentials.test.ts:207-223`).
E11 `src/lib/station-password.ts:67-69` `stationLockRequired(privacy)`; `:75-82` `StationAuthResult = 'ok' | 'denied' | 'rate-limited' | 'unavailable'`; `:105-122` `verifyStoredPasswords({ stored, login, check })` — injected-callback style to copy for the save rule.
E12 `src/lib/api.ts:40-42` `HealthResult … kind: 'timeout' | 'http' | 'network'; status?`; `:128-137` `probeHealth` (401 → `{ kind: 'http', status: 401 }`, abort → `timeout`); `:147-152` `health()` collapses every HTTP status to `false`; `:171-182` `checkStationAuth(password)` never throws; `:215` `streamHeaders: () => streamAuthHeaders` — defined iff a login is saved.
E13 `src/hooks/useStationGate.ts:88-97` — `if (verdict.save) … else if (verdict.clearStored) await storeRef.current.forgetStationPassword(); … setPhase(verdict.phase)`; `:111-128` stuck recheck `if (result !== 'denied' …) return; await … forgetStationPassword(); if (alive) setPhase('prompt')`; `:105-107` `if (phase === 'prompt' && tunedIn) stop();` — the two "saved password rejected" paths and the existing stop-on-prompt.
E14 `src/player/StationGate.tsx:22-26` `FAILURE_COPY … denied: 'That password was not accepted.'`; `:113-121` `{error ? (<Text accessibilityRole="alert" …` — where the "saved password" notice renders.
E15 `src/hooks/usePlayer.ts:124-137` `reconnect` → `loadAndPlay` → on throw `armWatchdogRef.current(nextRetryDelay())`; `:173-178` `PlaybackError` → `armWatchdog`; `:259-265` `stop()` clears the watchdog and tears down — stopping from the screen ends the loop without touching audio code.
E16 `src/player/PlayerScreen.tsx:239` `const signal = useSignal({ api, tunedIn, status, offline });`; `:279-281` `if (offline && tunedIn) stop();` — precedent for "screen stops player on a derived condition"; `:501-519` bottom bar container; `:522-524` prompt gate render.
E17 `src/hooks/useSignal.ts:60-61` `const healthy = await api.health(ctrl.signal); if (!healthy) throw` — the only periodic health poll while tuned in; `:42-48` latency/failed reset on tune-out.
E18 `src/app/_layout.tsx:76-78` — `<Stack.Screen name="stations" options={{ presentation: 'modal' }} />` — route registration pattern.
E19 `package.json` scripts: `"test": "tsx --test scripts/*.test.ts"`, `"lint": "eslint . && tsc --noEmit"`, `"web": "expo start --web"`; `package-lock.json` has NO `node_modules/react-native-web`, `react-dom` or `shaka-player` entries (`rg` over the lockfile); `index.ts:4-6` `TrackPlayer.registerPlaybackService(…)` runs at entry; `src/lib/station.ts:6` `import * as SecureStore from 'expo-secure-store'` (no web implementation in Expo's platform table) — web verdict inputs.
E20 `.github/workflows/lint.yml:34,48` — `package: [controller, web, mcp-subwave, app]` … `run: npm ci` + lint only; no `npm test` for app.
E21 `README.md:73` — "`expo export` bundles cleanly for both iOS and Android" — bundling is an accepted no-device check.
E22 `docs/private-station.md:70-76` (app bullet under "Tuning in with a password"), `:95-98` ("open **Station login**, then fill in …"), `:110-124` three-things list; `app/docs/QA-CHECKLIST.md:26-36` section style — docs to update.
E23 `src/hooks/useStationFeed.ts:133-168` — on `api` identity change every feed field resets, including `state` (so `privacy`) until the next tick — side effect of saving the active station's login.
E24 `src/hooks/useCast.ts:45` `const castable = !!api && !api.streamHeaders();` — precedent for "login saved" = `streamHeaders()`.
E25 `git ls-tree upstream/develop docs/plans/` → `1230-show-preparation.md` — plan files do land upstream.
E26 `web/components/player/StationGate.tsx:85` `'That password was not accepted.'` — wording lineage for item 4.
E27 `scripts/station-password.test.ts:16-23,77-86` — `memoryStorage()` and `checker()` fakes; new tests copy them.

## Changes

### Web testability verdict: (c) not feasible; bundling is the no-device smoke test
- `react-native-web`/`react-dom` are not in the lockfile (E19) → `expo start --web`/`expo export --platform web` abort asking to add them: a new dependency, forbidden. Even in a scratch install the entry registers RNTP (E19; RNTP's web path needs `shaka-player`, also absent), `station.ts` imports `expo-secure-store` at module scope (no web impl), and `/stations`+`/station-login` only render through `StationProvider` → `station.ts`. A storage shim would be a Metro alias + a fake vault: more untested novelty than the screen. Not doing it.
- What runs here: `npm ci && npm test && npm run lint` and `npx expo export --platform ios --output-dir <scratch>` (+ `--platform android`) — Metro/Babel/NativeWind bundle every route, catching bad imports, JSX, route files, typed-route names (`experiments.typedRoutes`: export regenerates `.expo/types/router.d.ts`, so a later `tsc` also validates the `'/station-login'` href literal). Precedent E21. The PR must say screens were not run on a device and ask the maintainer (or the operator, who offered in E1) for a device pass against a basic-auth proxy and a stream-password station.

### PR 1 — edit screen (commits 1–4)
Commit 1 `feat(app): pure station-login save rule`
- `src/lib/station-login.ts` (new) — E1 item 2, E5, E6, E11, E12:
  - `loginFromFields(username, password): StationCredentials | null` — `username || password ? {…} : null` (E6:353); both empty = remove.
  - `needsCleartextConsent(base, credentials): boolean` — `!!credentials && /^http:\/\//i.test(base)` (E5:202).
  - `type LoginVerdict = { outcome: 'save' } | { outcome: 'rejected'; by: 'proxy' | 'station' } | { outcome: 'unverified'; reason: 'timeout' | 'network' | 'http' | 'station-auth'; status?: number }`
  - `verifyLogin({ password, probe, privacy, checkAuth })`: `probe()` → 401 ⇒ `rejected/proxy`; other `!ok` ⇒ `unverified/<kind>` (+status); ok → `privacy()` (null = /state unreadable ⇒ `save`; the gate re-checks at tune time, E13) → `!stationLockRequired` ⇒ `save`; else `checkAuth(password)`: `ok` ⇒ `save`, `denied` ⇒ `rejected/station`, else ⇒ `unverified/station-auth`. No stream probe (E1 item 6).
  - `loginRejectedByProxy(result: HealthResult, hasLogin: boolean)` — `hasLogin && !result.ok && result.kind === 'http' && result.status === 401` (used by PR 2; one line, tested here).
- `scripts/station-login.test.ts` (new) — `node:test`, fakes per E27. Table:

  | probe | privacy | checkAuth | verdict |
  |---|---|---|---|
  | ok | `{}` / `undefined` | not called | save |
  | ok | `null` | not called | save |
  | ok | `{listenerAuth:true}` | ok | save |
  | ok | `{privatePlayer:true}` | denied | rejected/station |
  | ok | `{listenerAuth:true}` | unavailable | unverified/station-auth |
  | ok | `{listenerAuth:true}` | rate-limited | unverified/station-auth |
  | http 401 | not called | not called | rejected/proxy |
  | http 407 | not called | not called | unverified/http 407 |
  | http 502 | not called | not called | unverified/http 502 |
  | timeout | not called | not called | unverified/timeout |
  | network | not called | not called | unverified/network |

  plus `loginFromFields('', '') === null`, `('dj','') → {dj,''}`; `needsCleartextConsent('http://…', creds) true`, `https false`, `http + null false`; `loginRejectedByProxy`: 401+login true, 401 no login false, timeout false, 503 false.

Commit 2 `feat(app): save or clear a station login without switching station`
- `src/lib/station.ts` — add `saveStationCredentials(rawUrl, credentials | null)`: `credentials ? credentialVault.set(base, …) : credentialVault.remove(base)` (E9:116-120, E10). Nothing else changes; `setActiveStation` untouched.
- `src/config/StationContext.tsx` — add `saveLogin(url, credentials | null)`: persist, then `if (splitStationAddress(url).base === base) setCredentials(credentials)` (api rebuilds via E8:157-163; no `teardown` — the next reconnect reads the new headers through `apiRef`, E15:126-131). Add `forgetStationPasswordFor(url)`: `clearStationPassword(url)` (E9:97) then `if (active) setStationPassword(null)`; errors propagate (unlike E8:151-155, which stays as is). Both exposed on the context value.
- `src/hooks/useStationGate.ts` — one effect: `if (required && phase === 'ok' && stationPassword == null) setPhase('prompt')`. Reason: the gate reads passwords through refs (E13 comment `:61-62`), so forgetting the active station's password from the edit screen would otherwise leave the face open until the next visit; `:105-107` then stops audio. Only an external forget can produce `ok` + null (both `ok` paths set a password first).

Commit 3 `feat(app): station login screen`
- `src/lib/cleartext-consent.ts` (new) — move `confirmCleartextLogin` verbatim from E5:55-67; `onboarding.tsx` loses the function and gains one import. This is the only onboarding edit (import-only; `tsc` + export smoke cover it). The username/password `TextInput`s are duplicated, not extracted: in onboarding they are bound to `showLogin`, `returnKeyType`/`onSubmitEditing={submitEntry}` (`:453-523`); sharing them means props plumbing and an onboarding retest we cannot run. ~60 lines of JSX copied is the safer choice.
- `src/app/station-login.tsx` (new) — params `{ url, name }`. On mount: `credentialsFor(url)` (E8:126-129) pre-fills; failure shows E7 stations copy and leaves buttons enabled (a later write fails safely, E10). `loadStationPassword(url)` (E9:89-91; direct lib import, read-only, same as StationContext) → shows "Forget station password" only when one is saved. Actions:
  - **Check and save**: `creds = loginFromFields(...)`; null → same as Remove. `needsCleartextConsent` → `confirmCleartextLogin()` (cancel = return). `api = createApi(url, creds)`; `verifyLogin({ password, probe: api.probeHealth, privacy: () => api.state().then(s => s.privacy ?? null, () => null), checkAuth: api.checkStationAuth })` (api's own 8 s timeout, E12; no AbortController in the screen). `save` → `saveLogin(url, creds)` → `router.back()`. `rejected` → inline error (proxy: E6:85 wording minus "Go back and"; station: "This station uses a station password and did not accept this one. Nothing was saved."). `unverified` → `Alert.alert("Couldn't verify this login", <reason>, [Cancel, "Save anyway" → saveLogin])`; reason copy: timeout = onboarding `:81`, network = `:103`, http = `The server answered with HTTP ${status}, so the login could not be checked.`, station-auth = "The station could not check the password right now."
  - **Remove login**: Alert confirm (E4 shape) → `saveLogin(url, null)`.
  - **Forget station password**: Alert confirm → `forgetStationPasswordFor(url)`.
  - Any write failure → one inline string: "The device's secure storage could not be updated, so nothing was changed. Unlock the device and try again." (E7 lineage).
  - Layout: `SafeAreaView` + header with `X` (stations.tsx `:105-112`), fields as onboarding `:455-521`, buttons as onboarding `:531-542`. No new components.
- `src/app/_layout.tsx` — `<Stack.Screen name="station-login" options={{ presentation: 'modal' }} />` after E18:78.
- `src/app/stations.tsx` — `KeyRound` button (lucide, already used in onboarding `:16`) on every Recent row next to the trash (E3) and on the Tuned-in card (E2), unconditional including the featured station (E1 item 6: "pick the simpler"; no `removable` branch), `onPress={() => router.push({ pathname: '/station-login', params: { url, name } })}`, `accessibilityLabel={`Edit login for ${name}`}`.

Commit 4 `docs(app): station login editing`
- `docs/private-station.md` — E22: in the app bullet (`:70-76`) add "Stations → key icon → Forget station password"; after `:98` add a paragraph: Stations list / tuned-in card key icon opens Station login; a login is checked first and a rejected one is never saved; unreachable asks "Save anyway"; plain http asks the same cleartext question; "Remove login".
- `app/docs/QA-CHECKLIST.md` — new "## Station login & password" section: edit from Recent row; edit from Tuned-in card; wrong login → not saved + message; station unreachable → Save anyway; http station → consent prompt; Remove login → cast button returns (E24); Forget station password while tuned in → prompt appears and audio stops.

### PR 2 — rejected-login banner and gate wording (commits 5–6; branch stacked on PR 1 until it merges)
Commit 5 `feat(app): stop and explain when the proxy rejects the saved login`
- `src/hooks/useSignal.ts` — replace E17:60-61 with `const r = await api.probeHealth(ctrl.signal); if (!r.ok) { if (loginRejectedByProxy(r, !!api.streamHeaders())) setLoginRejected(true); throw … }` (same failure accounting as before). New state `loginRejected`, NOT reset in the tune-out block (`:42-48`) — reset only by `useEffect(() => setLoginRejected(false), [api])` (a saved login rebuilds `api`, E8). Return it in `Signal`. Timeouts/network stay `kind !== 'http'` → never set (E12:128-137).
- `src/player/PlayerScreen.tsx` — `useEffect(() => { if (signal.loginRejected && tunedIn) stop(); }, …)` beside E16:279-281 (ends the E15 loop; no `usePlayer`/`audio` edits). Render `LoginRejectedBanner` above `<TransportBar>` inside E16:501-519 when `signal.loginRejected`.
- `src/player/LoginRejectedBanner.tsx` (new, declarative) — box styled like onboarding's "Insecure connection" (`:746-755`): title "Station login rejected", body "The station refused the saved username or password.", button "Edit station login" → `router.push({ pathname: '/station-login', params: { url: api.base, name } })`. `accessibilityRole="alert"`.

Commit 6 `feat(app): say when the saved station password was rejected`
- `src/hooks/useStationGate.ts` — `savedRejected` state: `true` at E13:95 (`clearStored`) and E13:120 (stuck recheck), `false` when the visit effect restarts (`:86`) and on `unlock` ok (`:136-139`). Returned on `StationGate`.
- `src/player/StationGate.tsx` — prop `savedRejected?: boolean`; render `error || (savedRejected ? 'The saved password was not accepted. Enter the current station password.' : '')` in E14:113-121 (derived, not state: the solid gate instance stays mounted across checking → prompt, PlayerScreen `:382-393`). Pass it at PlayerScreen `:385-390` and `:523`.
- `app/docs/QA-CHECKLIST.md` — two rows: proxy password rotated while tuned in → banner within ~10 s, audio stops, Edit opens the screen, fixing it clears the banner; station password rotated → prompt reads "The saved password was not accepted".

### Strings (all new copy in one place)
"Station login" · "Check and save" · "Remove login" · "Forget station password" · "This station uses a station password and did not accept this one. Nothing was saved." · "Couldn't verify this login" / "Save anyway" · "The server answered with HTTP {status}, so the login could not be checked." · "The station could not check the password right now." · "The device's secure storage could not be updated, so nothing was changed. Unlock the device and try again." · "Station login rejected" / "The station refused the saved username or password." / "Edit station login" · "The saved password was not accepted. Enter the current station password." · a11y "Edit login for {name}". Everything else reuses E5/E6/E7 text verbatim.

### Known side effects to state in the PR
- Saving the active station's login rebuilds `api` → feed resets for one poll (E23) and the gate re-verifies (E13:80-101) — same as a station switch; on a `privatePlayer` station the face hides for that tick.
- Banner covers proxies that 401 `/api/health`; a proxy that guards only `/stream.*` shows nothing (E1 "detection limits", accepted). Stream-password stations are covered by the existing gate (E13).

## Check
```
cd app && npm ci && npm test && npm run lint \
 && npx expo export --platform ios --output-dir /mnt/black/tmp/claude/subwave-export-ios \
 && npx expo export --platform android --output-dir /mnt/black/tmp/claude/subwave-export-android
```
Fails if: any verdict row above is wrong (`scripts/station-login.test.ts`), the new route/imports do not bundle, or the typed `'/station-login'` href does not exist. Device behaviour stays unverified here; the PR says so and asks for a device pass (E1: operator offered).

## Deferred (YAGNI)
- Trash/"Remove station" on the Tuned-in card — reopen when a user asks to drop the tuned-in station outright (the edit screen already covers login/password; store supports it, E9:131-140, stations.tsx:81-83).
- "Station login required" banner on 401 with no saved login — reopen when a report shows a station that turned basic auth on after being saved.
- Shared `StationLoginFields` component for onboarding + edit screen — reopen when a third screen needs the fields or onboarding gets a device retest anyway.
- Legacy `user:pass@host` recents whose migration failed (E9:76-78) keep winning over the vault (E9:85) — reopen if such a record is ever reported.
- Web/react-native-web harness — reopen if upstream adds `react-native-web` + `react-dom` to the lockfile.

## Decisions (operator, 2026-10-11)
- Approved, both PRs. No PR is opened without the operator's explicit yes.
- The screens cannot be run here; the PR text must state what is unverified and ask for a device check.
## Open questions
- Proxy basic auth on `/stream.*` only, combined with the station password: health is open, `/station-auth` denies the proxy password → plan says `rejected/station` (never saved; E1 item 2 "a login the station rejects is never saved"). Alternative: treat it as `unverified` and offer "Save anyway". Changes one branch in `verifyLogin` and one table row. Default: refuse, since this combination is documented as rarely useful (`docs/private-station.md:130-133`).
- One PR or two: plan says two (PR 1 edit screen, PR 2 banner + wording, stacked). If the maintainer prefers one, keep the six commits in order; commits 1–4 are independently testable.

Unverified: `expo-secure-store` web entry point and RNTP's web `shaka-player` requirement — `app/node_modules` is not installed and installing is out of scope; verdict rests on the lockfile (E19) and Expo's platform table. `modules/airplay-route-picker/index.tsx` beyond line 40 — not read; irrelevant to this change.
