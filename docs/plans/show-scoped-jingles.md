# Show-scoped jingles
Status: approved
Issue: diblaze/subwave#6

FORK-ONLY FILE. Lives on the fork's working branch only; never commit it to a branch that is pushed to upstream or included in the PR.

## Goal
A jingle can carry a list of show ids; the controller-owned rotate draws only jingles open to all shows or listing the show on air (skips the slot otherwise), the mixer playlist holds only all-show jingles, and the admin page, doctor, backup restore and boot ident refresh all preserve and surface the list.

## Evidence
All paths on `upstream/develop`.

E1 `controller/src/broadcast/jingles.ts:3` — `// sidecar (filename → { text, createdAt, builtin, source })` — the record the show list joins.
E2 `controller/src/broadcast/jingles.ts:45-48` — `async function rewritePlaylist(filenames: string[]) { const lines = filenames.map(...)` — the single m3u writer; 7 call sites all pass `Object.keys(meta.items)` (lines 111, 146, 160, 176, 190, 291, 328).
E3 `controller/src/broadcast/jingles.ts:308-329` — `restoreMeta` rebuilds entries field-by-field: `next[name] = { text…, createdAt…, builtin…, source… }` — risk 1: drops any key it does not name.
E4 `controller/src/broadcast/jingles.ts:180-192` — `ensureDefaultIdent` upgrade branch: `meta.items[DEFAULT_IDENT.filename] = { text, createdAt: existing?.createdAt…, builtin: true, source: 'builtin' }` — risk 2: rebuilds the builtin's record.
E5 `controller/src/broadcast/jingles.ts:54-75` — `list()` row shape `{ filename, text, createdAt, builtin, source, size }` — rows gain `showIds`.
E6 `controller/src/broadcast/jingle-rotate.ts:69-78` — `pickRotateJingle(filenames, last, rand)` — pure draw; stays untouched, fed a filtered pool.
E7 `controller/src/broadcast/jingle-rotate.ts:6-8` — only `import type { JingleRotateOwner } from '../schemas/settings.js'` — module is import-free by design (acyclic with settings.ts, lines 139-142); a zod-only schema module import keeps that.
E8 `controller/src/broadcast/queue.ts:3335-3352` — `playRotateJingle(): this._tracksSinceJingle = 0; const filename = pickRotateJingle((await jingles.list()).map(j => j.filename), this._lastRotateJingle); if (!filename) { log('… rotate skipped — the jingle library is empty') …` — the one automatic draw site; skip = offer spent (`broadcast.md:72` "SPENDS the offer rather than banking it").
E9 `controller/src/broadcast/queue.ts:2385` — `const show = settings.resolveActiveShow();` — queue.ts already resolves the show on air; `settings/persona.ts:179` `resolveActiveShow(date = new Date(), s = get())` picks takeover over grid.
E10 `controller/src/broadcast/queue.ts:3267-3290` — `playJingle(filename, { rotate = false })` — manual press path; `routes/jingles.ts:71-75` "Manual trigger, so it ignores jingleRatio" — stays show-blind.
E11 `controller/src/music/blocklist-rules.ts:77` — `if (rule.showIds.length) return ctx.activeShowId != null && rule.showIds.includes(ctx.activeShowId);` — the identical scope rule already shipped, inline; `scripts/blocklist-rules.test.ts:63-66` pins it (`'no show on air → scoped rule inert'`).
E12 `controller/src/schemas/show.ts:16` — `export const SHOW_ID_RE = /^[a-z0-9_]{3,32}$/;` — show vocabulary is homed here; `docs/internals/schemas.md` "a constant two features share is homed in the first one converted"; pure-helper precedent `slugifyStationName` in `schemas/station.ts`.
E13 `controller/src/schemas/blocklist.ts:134-144` — `showIds: z.preprocess((v) => (v == null ? undefined : v), z.array(z.unknown()…).transform(items => [...new Set(items.filter(string && trim))]).default([]))` — the array rule to restate (mirrored modules may not import siblings: `CLAUDE.md:142`).
E14 `controller/src/schemas/imaging.ts:92-99` — `jingleCreateSchema` — the jingle schema file; `routes/jingles.ts:23` `validateBody(jingleCreateSchema)` route posture.
E15 `controller/src/routes/library/blocklist.ts:51-55` — `router.put('/library/blocklist/rules/:id', requireAdmin, validateBody(blockRuleSchema…` — PUT-on-subresource precedent.
E16 `controller/src/routes/shows.ts:115-141` — `DELETE /shows/:id` removes the show + nulls grid slots only; `settings.ts:2548-2560` sweep touches schedule/takeover only; blocklist `showIds` stale ids "are inert" (`blocklist-rules.ts:42`) and the web renders `(deleted show)` (`BlockRulesCard.tsx:268`) — same posture for jingles: never sweep, never widen.
E17 `controller/src/doctor/checks-content.ts:24-29` — `out.push(await m3uFinding(`${STATE_DIR}/jingles.m3u`, { label: 'jingles', emptyHint: 'No station idents yet…', fix: generate-jingles }))` — counts m3u lines; with every jingle tied the m3u is empty and the hint would be wrong. `doctor/types.ts:28-34` `Finding { label, status, detail?, hint?, fix? }`; `web/components/admin/doctor-rig.test.ts:74` pins label `'jingles'` + fix id.
E18 `controller/src/doctor/checks-content.ts:8` — `import * as settings from '../settings.js';` — owner readable via `jingleRotateOwner(settings.get())`.
E19 `liquidsoap/CLAUDE.md:11` — `rotate(weights=[1, jingle_ratio], [jingles, music])` … controller owner "writes `jingle_ratio` 0 and draws the stinger through `jingle-now.txt`" — under `'controller'` the m3u is never drawn from, so its contents can be owner-independent.
E20 `scripts/generate-jingles.sh:69-76` — writes `jingles.m3u` itself from `jingle-*.wav` on disk, no sidecar — a pre-existing second writer; the controller's next rewrite already drops those lines (E2). Out of scope.
E21 `controller/src/routes/backup.ts:42-46,205-206` — restore routes `jingles.json` through `jingles.restoreMeta(data)`, never copies the m3u; `scripts/backup-restore-guards.test.ts:107-112` pins the regeneration.
E22 `controller/src/personas/bundle.ts:367-371` — `jingles.adopt(j.data, { filename, text, reserved })` — bundle import mints a fresh record; show ids are station-local, so bundles carry none.
E23 `web/components/admin/library/BlockRulesCard.tsx:168-182` — `useAdminQuery<ShowSettingsResponse>({ key: settingsKeys.detail(), path: '/settings' })` → `shows = (showsQuery.data?.values?.shows || []).flatMap(…{ id, name })` — the roster comes from `/settings`, which `ImagingPanel.tsx:43-47` already polls (`useSettingsQuery<SettingsData>`).
E24 `web/components/admin/library/BlockRulesCard.tsx:558-586` — `<Controller name="showIds" render={… <Label>Only during certain shows…</Label> … shows.map(s => <label><input type="checkbox" checked={field.value.includes(s.id)} onChange={…toggle} />` — the show picker, inline; extraction gives both callers one component.
E25 `web/components/admin/settings/shared.tsx:389-396` — `export interface JingleEntry { filename; text?; size?; createdAt?; builtin?; source? }`; `SettingsData.values` (398+) has no `shows` field.
E26 `web/components/admin/imaging/ImagingPanel.tsx:157-167` — `deleteJingle` via `resourceMutation.mutateAsync({ path, init: { method: 'DELETE' }, key: imagingKeys.jingles() })` — the mutation pattern a PUT follows.
E27 `web/components/admin/imaging/JinglesSection.tsx:282,349-373` — `rotateOwner = data.values?.jingleRotate === 'controller' ? 'controller' : 'mixer'` and the "counted by" panel — where the mixer-owner notice goes; rows at 382-427.
E28 `controller/src/mcp/tools.ts:755-758` — `const data = await client.listJingles(); return { content: [text(data)] }` — pass-through; new row field rides along, no MCP change.
E29 `controller/scripts/backup-routes.test.ts:37-45` — `const app = express(); app.use(express.json()); app.use(router); createServer(app).listen(0…)` — route test pattern.
E30 `web/components/admin/dash/QueueHeldBadge.test.tsx:1-6` — `renderToStaticMarkup(createElement(...))` — web component test pattern.
E31 `CLAUDE.md:137` — "`queue.playJingle()` the only writer of `jingle-now.txt` (… `queue.playRotateJingle()` draws the clip and calls it, it does not write)".
E32 `CLAUDE.md:142` — "mirrored to `web/lib/schemas.generated.ts` by `npm run gen:schemas` (CI diffs it) … Never hand-edit the mirror".

## Changes
Commit 1 — `refactor(shows): name the show-scope predicate`
- `controller/src/schemas/show.ts` — add `export function showScopeAllows(showIds: readonly string[], activeShowId: string | null): boolean { return showIds.length === 0 || (activeShowId != null && showIds.includes(activeShowId)); }` with a 2-line comment: empty = everywhere; a scoped list with no show on air matches nothing (E11, E12). The shared piece #1188 would reuse; nothing else is abstracted.
- `controller/src/music/blocklist-rules.ts:77` — `if (rule.showIds.length) return showScopeAllows(rule.showIds, ctx.activeShowId);` (keeps the `length` guard so season-only behaviour is byte-identical; E11 tests unchanged).
- `web/lib/schemas.generated.ts` — regenerated (E32).

Commit 2 — `feat(jingles): tie a jingle to shows`
- `controller/src/broadcast/jingles.ts` — header comment (E1) adds `showIds`; new `showIdsOf(info)` (`Array.isArray(info?.showIds) ? strings only : []`); `rewritePlaylist(items)` takes the sidecar map and writes only keys with `showIdsOf(info).length === 0` — one rule for both owners (E19): the m3u is "what the mixer may draw", and the controller never reads it; all 7 call sites pass `meta.items`/`next` (E2); `list()` rows add `showIds` (E5); new `export async function setShows(filename, showIds: string[])` (unknown filename throws; writes, saves, rewrites — same single writer); `restoreMeta` carries `...(Array.isArray(info.showIds) ? { showIds: strings only } : {})` (E3, risk 1); `ensureDefaultIdent` upgrade branch carries `...(existing?.showIds ? { showIds: existing.showIds } : {})` (E4, risk 2). `adopt` unchanged (E22).
- `controller/src/schemas/imaging.ts` — `export const jingleShowsSchema = z.object({ showIds: <E13 rule restated> })`, comment pointing at `schemas/blocklist.ts` (mirror rule, E13).
- `controller/src/routes/jingles.ts` — `router.put('/jingles/:filename/shows', requireAdmin, validateBody(jingleShowsSchema), …)`: 404 on unknown jingle (via `jingles.getPath`), resolve ids against `settings.get().shows` ids; any unknown → `400 { error: 'unknown show: <id>', fieldErrors: { showIds: 'unknown show: <id>' } }` (refuse, not drop: the UI always posts live ids; a stale id only ever arises from show deletion and the fix is this very edit); on success `queue.log('scheduler', …)` and `res.json({ filename, showIds })` (E14, E15).
- `controller/src/broadcast/jingle-rotate.ts` — `export function rotateJinglePool(rows: readonly { filename: string; showIds?: readonly string[] }[], activeShowId: string | null): string[]` = `rows.filter(r => showScopeAllows(r.showIds ?? [], activeShowId)).map(r => r.filename)`; imports the predicate from `../schemas/show.js` (E7). `pickRotateJingle` untouched (E6).
- `controller/src/broadcast/queue.ts:3335-3352` — `const rows = await jingles.list(); const pool = rotateJinglePool(rows, settings.resolveActiveShow()?.id ?? null); const filename = pickRotateJingle(pool, this._lastRotateJingle);` — show resolved at pick time (accepted in the issue); skip log says `library is empty` when `rows.length === 0`, else `no jingle is open to the show on air` (E8, E9). Manual `playJingle` untouched (E10, E31).
- `controller/src/doctor/checks-content.ts:24-29` — replace the jingles `m3uFinding` with a sidecar finding from `jingles.list()`: 0 rows → today's warn + `generate-jingles` fix; mixer owner (`jingleRotateOwner(settings.get())`) and ≥1 tied row → `warn`, detail `N of M tied to shows`, hint `Show-tied jingles rotate only when the controller counts the tracks. Imaging → Jingles → counted by: Controller, then restart the mixer — or clear their show lists.`; else `ok`, detail `M entries` (+ `, N show-tied`) (E17, E18). Label stays `jingles`.
- `controller/scripts/jingle-rotate.test.ts` — `rotateJinglePool`: empty list draws everywhere; tied matches only its show; no show on air excludes tied; all tied + wrong show → `[]` → `pickRotateJingle` null (slot skipped, never another show's).
- `controller/scripts/jingle-shows.test.ts` (new, `node:test`, temp `STATE_DIR`) — `setShows` round-trips through `list()`; m3u lists untied only, identical under both owners; `restoreMeta` keeps `showIds` and drops non-strings (risk 1); `ensureDefaultIdent` on a `source: 'tts'` builtin with `showIds` upgrades to the bundled asset (`sounds/station_ident_default.wav` via default `SOUNDS_DIR`) and keeps the list (risk 2); route (E29 pattern): 200 happy path, 400 unknown show id with `fieldErrors.showIds`, 404 unknown jingle.
- `controller/scripts/imaging-schema.test.ts` — `jingleShowsSchema` dedupes, drops non-strings/blank, refuses a non-array.
- `controller/scripts/jingle-play.test.ts` — unchanged; it is the proof a manual press ignores the list (no `showIds` in its sidecar fixture, lines 43-48).
- `web/lib/schemas.generated.ts` — regenerated.
- Docs in the same commit: `docs/internals/broadcast.md:72` — append: per-jingle `showIds` in the sidecar, pool filtered by `showScopeAllows` at pick time, skip-never-substitute, m3u holds all-show jingles only so tied ones need `'controller'`, deleted show = silent until re-tied; `controller/CLAUDE.md:34` — one sentence on `showIds` + `setShows` and the m3u rule; `liquidsoap/CLAUDE.md:11` — clause: "`jingles.m3u` lists only jingles open to every show"; `docs/updating.md:33-34` — restore keeps each entry's show list; `docs/mcp-server.md:209` — rows carry `showIds` (E28). Root `CLAUDE.md:129` unchanged (still true).

Commit 3 — `feat(web): shows control on jingle rows`
- `web/components/admin/shows/ShowChecklist.tsx` (new, ~25 lines) — `{ shows: {id,name}[]; value: string[]; onChange(next: string[]); emptyHint: string }` lifted verbatim from E24; `BlockRulesCard.tsx:558-586` renders it inside the existing `Controller`.
- `web/components/admin/settings/shared.tsx:389-396` — `JingleEntry.showIds?: string[]`; `SettingsData.values.shows?: Array<{ id?: string; name?: string }>` (E25; the roster already rides `/settings`, E23 — no new query).
- `web/components/admin/imaging/jingle-shows.ts` (new, pure) — `jingleShowsLabel(showIds, shows)`: `[]` → `all shows`; else names joined, unknown id → `(deleted show)`; `tiedJingleCount(jingles)`.
- `web/components/admin/imaging/ImagingPanel.tsx` — `setJingleShows(filename, showIds)` via `resourceMutation` PUT `/jingles/<f>/shows`, key `imagingKeys.jingles()`, toast on error (E26); passed to `JinglesSection`.
- `web/components/admin/imaging/JinglesSection.tsx` — per row (E27 382-427): a `MetaLine` entry with `jingleShowsLabel` and a `Shows` `Btn` opening a `Modal` with `ShowChecklist` + Save (posts checked live ids only — a deleted id is dropped by the edit, which is the documented fix); under "counted by" (349-373) when `rotateOwner === 'mixer' && tiedJingleCount > 0`: one line `N jingles are tied to shows and will not rotate until the controller counts — switch to Controller and restart the mixer.` Create/import dialogs untouched.
- `web/components/admin/imaging/jingle-shows.test.ts` — label cases (all shows / names / deleted) and the tied count (E30 style).
- `node web/scripts/audit-admin-query.mjs` must stay green (PUT is a mutation, not a read).

Commit boundaries: 1 is a behaviour-preserving refactor reviewable alone; 2 is controller + docs + tests; 3 is web. One PR against `develop` (`CONTRIBUTING.md` "Branch off `develop`"), squash-merged by the maintainer. No station-identifying strings anywhere; test fixtures use generic ids (`morning_show`, `late_show`).

## Check
```
cd controller && npm test -- jingle && npm test -- imaging-schema && npm test -- blocklist-rules && npm run lint && npm run gen:schemas && git diff --exit-code ../web/lib/schemas.generated.ts
cd web && npm test && npm run lint && node scripts/audit-admin-query.mjs
```
Live (operator station, `jingleRotate: 'controller'`, rebuilt controller + web images): tie jingle A to the show on air and jingle B to another show, untie C. Over the next 3×`jingleRatio` boundaries the booth log's `[jingle]` lines name only A or C, never B; `cat state/jingles.m3u` lists only C; Admin → Doctor shows `jingles ok`; flip counted-by to Mixer → Doctor warns and the Jingles page shows the notice; flip back. Export a backup, restore it: `jingles.json` still carries A's and B's `showIds`. Restart the controller: the builtin's list (tie it first) survives. Delete B's show: B's row reads `(deleted show)`, B never airs automatically.

## Deferred (YAGNI)
- #1188 per-show/persona beds — reopen when beds get a scope; `showScopeAllows` is the shared piece, nothing more is pre-built.
- Show picker in the create/import dialogs — reopen when an operator asks; the issue scoped it to the row.
- Per-jingle voice/persona — separate issue per the proposal.
- Sweeping deleted show ids out of `jingles.json` on `DELETE /shows/:id` — spec says mark, never widen (E16); reopen if `(deleted show)` rows become noise.
- `scripts/generate-jingles.sh` writes its own m3u without the sidecar (E20) — pre-existing divergence; reopen if someone runs it on a tied library and expects tied jingles out of the mixer rotation.
- Rewriting `jingles.m3u` per show change for the mixer owner — rejected in the issue.
- MCP tool to set a jingle's shows — reopen when an agent needs it; `subwave_list_jingles` already shows the field (E28).

## Decisions (operator, 2026-10-11)
- Approved with one addition: when the show on air has jingles tied to it, the rotate picks from those about three times out of four and from the all-show jingles the fourth; with only one of the two pools present it draws from that one. Fixed ratio, no setting. This goes beyond the proposal agreed in upstream #1875 and the PR text must say so.
- Commit 1 is dropped from the PR as planned: `showScopeAllows` is added for jingles only and `music/blocklist-rules.ts` is not touched.
- Doctor: the existing jingles finding stays; a second finding covers show-tied jingles under the mixer-owned rotate.
## Open questions
- Does the maintainer want commit 1 (naming the blocklist's inline predicate) in this PR, or should `showScopeAllows` land unused-by-blocklist and the blocklist switch wait for #1188? Changes whether `music/blocklist-rules.ts` is touched.
- Doctor: replace the m3u line count with the sidecar finding (proposed), or keep the m3u finding and add a second `jingle shows` finding? Changes `checks-content.ts` shape and the doctor-rig test expectations.
