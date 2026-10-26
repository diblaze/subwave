# Design
## Context
All paths on `upstream/develop` (677cc2ed). Read with `git show upstream/develop:<path>`.

E1 `controller/src/schemas/show.ts:380-384`: `// Shape-checked only: ids resolve against live Navidrome at pick time.` `playlistIds: showStringList({ max: PLAYLISTS_PER_SHOW, …})`. This is the precedent for a list whose ids resolve at use time. The new fields reuse `showStringList`, defined at `:84`.
E2 `controller/src/schemas/show.ts:404-408`: `// Organisation only, declared LAST so persisted key order is unchanged.` `tags: showTags,`. Shows are a `z.object` that strips unknown keys (`:146`), so a field has to be declared or it is lost. New fields go after `tags`.
E3 `controller/src/schemas/show.ts:560-563`: `playlistIds: repairShowStringList(raw.playlistIds, { max: PLAYLISTS_PER_SHOW }),`. This is the lenient load repair. Without a matching repair line, a malformed entry fails the parse and `normalize.ts:267` `if (!parsed.success) continue;` silently deletes the whole show.
E4 `controller/src/settings/validate.ts:77`: `const parsed = showsSchema(ctx).safeParse(raw);`. This is the strict save chokepoint for `POST /shows` (`routes/shows.ts:209` `settings.update({ shows: merged })`) and for backup restore (`routes/backup.ts:150` `settings.prepareUpdate(settingsPatch…)`, `:225` `settings.update(settingsPatch)`).
E5 `controller/src/settings/persona.ts:179`: `export function resolveActiveShow(date = new Date(), s = get())`. Takeover outranks the grid (`:183-191`). It returns `resolveShowShape` (`:227`), which lists its fields explicitly. `:277-280`: "omitting it here silently disabled the whole feature on every pick path — the #779 blocklist no-op".
E6 `controller/src/broadcast/queue.ts:3458-3466`: `playRotateJingle(): this._tracksSinceJingle = 0; const filename = pickRotateJingle((await jingles.list()).map(j => j.filename), …); if (!filename) { this.log('scheduler', '[jingle] rotate skipped — the jingle library is empty'); return false; }`. This is the automatic draw. The offer is spent either way (`:3456` "So the offer is spent").
E7 `controller/src/broadcast/queue.ts:3521-3523`: `const catalog = await jingles.list(); const filename = pickRotateJingle(catalog.map(j => j.filename), …); if (!filename) return;`. This is the over-music ID, the second automatic draw.
E8 `controller/src/broadcast/queue.ts:1313-1318`: `const pick = bedPolicy.pickBed(await this._bedCatalog(), bedSec, this._lastBed, Math.random()); if (!pick) { this.log('beds', 'no bed long enough …') ; return; }`. This is the only bed choice. `_bedCatalog` can be stubbed (`queue.ts:452`, used by `scripts/host-speech-queue.test.ts:337`).
E9 `controller/src/broadcast/jingle-rotate.ts:78-87` `pickRotateJingle(filenames, last, rand)` and `bed-policy.ts:83-97` `pickBed(beds, bedSec, lastUsed, roll)`. Both are pure, and both take an already-filtered pool unchanged.
E10 `controller/src/broadcast/queue.ts:3387` `async playJingle(filename, { rotate = false })` and `routes/jingles.ts:75` "Manual trigger, so it ignores jingleRatio". Root `CLAUDE.md:128`: "Manual operator triggers are exempt from every automatic gate".
E11 `controller/src/broadcast/jingle-rotate.ts:20-25`: `jingleRotateOwner(s)` returns `'controller'` when placement is not `'between'` or `jingleRotate === 'controller'`, else `'mixer'`. The mixer draws from `jingles.m3u` (root `CLAUDE.md:60`) and has no idea which show is on air.
E12 `controller/src/doctor/checks-content.ts:24-31`: the jingles `m3uFinding` (label `jingles`) and `return out;`. A second finding is appended here, and `:8` already imports `settings`.
E13 `controller/src/routes/public.ts:395-406`: public `GET /schedule` maps each show to `{ id, name, topic, moods, mood, personaId, guestPersonaIds }`. That is an explicit allowlist (root `CLAUDE.md:132`), so the new fields cannot reach it unless it is widened.
E14 `controller/src/routes/jingles.ts:17-77` / `routes/beds.ts:17-72`: the jingle and bed routes are get, create, upload, delete, audio and play only. Neither has a rename, so a "renamed" entry is a deleted one plus a new one. Jingle keys are filenames (`personas/bundle-pure.ts:59` `JINGLE_FILENAME_RE = /^[A-Za-z0-9_.-]{1,116}$/`). Bed keys are slugged names (`beds.ts:109` `slugify(name)`).
E15 `controller/src/routes/shows.ts:77-100`: the community install builds a show without the new keys, so they default to `[]`. That is right: library names are local to a station.
E16 Root `CLAUDE.md:82`: "Policy lives in its own module … A decision reached from several call sites is made in one place". There are three call sites (E6, E7, E8), so one helper.
E17 Root `CLAUDE.md:84`: schemas are "mirrored to `web/lib/schemas.generated.ts` by `npm run gen:schemas` (CI diffs it; never hand-edit it)".
E18 `controller/CLAUDE.md:13`: "Pin a new field with a cold-load round trip (`setCache(null)` + `load()`)".
E19 `web/components/admin/shows/lib.ts:20-52` `hydrateShow` and `:91-132` `showPayload` both list every field explicitly. A field missing from either is dropped on editor save.
E20 `web/components/admin/shows/ShowPickers.tsx:169-269` `PlaylistPicker({ playlists, status, selected, max, onChange, searchLabel })`: a checkbox list with search, a cap and `(missing)` rows for stale ids (`:185`, `:254-264`). Its strings are Navidrome-specific (`:191`, `:202`, `:211`, `:226`, `:261-262`). `ShowEditor.tsx:1093-1124` `PlaylistIdsField` wraps it with ARIA, and its `name` union holds only the two playlist paths.
E21 `web/components/admin/imaging/queries.ts:35-40`: `useJinglesQuery` and `useBedsQuery` already exist, and `ShowsPanel.tsx:111-122` derives a `PlaylistIndexStatus` from a query in the same way.
E22 `web/components/admin/imaging/JinglesSection.tsx:311-312`: `rotateOwner = data.values?.jingleRotate === 'controller' ? …` and `placement = data.values?.jinglePlacement ?? 'between'`. These are the same `/settings` values the editor reads (`shows/types.ts:240-253` `SettingsResponse`).
E23 Fork reference `subwave-deploy` commit 33a214af and `docs/plans/show-scoped-jingles.md`. They store the ids on the jingle, so their risks were `restoreMeta` and the builtin ident refresh dropping fields. With the lists on the show, the sidecars are untouched, so neither risk applies. What still applies: the controller-vs-mixer limit, the doctor finding, deleted ids being inert rather than widened, and the pick-time show.
E24 perminder-klair/subwave#1188 (outsider claim, checked against E8/E9): the bed choice is a pure pick over a catalog, so filtering the catalog is all a per-show bed list needs. Its `enabled` flag and "empty = no bed" rule are not adopted (the operator's rule is empty = all).

E25 `web/components/admin/shows/ShowEditor.tsx:634`: `<span role="alert" className="field-hint text-vermilion">`, the editor's existing inline warning pattern (also `:745`, `:897`).
E26 `controller/src/broadcast/jingles.ts:77` `list()` and `controller/src/broadcast/beds.ts:52` `list()`: both return only entries whose file exists. That makes them the "exists in the library" test for the doctor.

## Goals / Non-Goals
**Goals:**
- Two show fields and one filtering helper shared by beds and jingles. That helper drives the three automatic draw sites.
- The lists persist through save, cold load and restore. They are picked in the existing show editor and warned about where the mixer ignores them.

**Non-Goals:**
- Persona-level lists: reopen when an operator asks for persona imaging (#1188's persona half).
- "Which shows use this jingle" shortcut on the Imaging page: reopen after this lands, as a read of `/settings` shows. It needs no new storage.
- Per-show `jingles.m3u` rewrite so the mixer honours lists: reopen if operators refuse to switch counting to the controller (rejected in #1875).
- A "no bed for this show" switch (#1188 `enabled`): reopen if an operator needs a show without beds while the station has beds on.
- Sweeping deleted names out of shows on jingle/bed delete: reopen if missing rows become noise (E20 already makes them removable).
- MCP tooling for the lists: reopen when an agent needs it. Shows already ride `/settings`.

## Decisions
- Store `allowedJingles: string[]` (jingle filenames) and `allowedBeds: string[]` (bed names) on the show. Both are shape-checked with `showStringList`, capped at a new `SHOW_IMAGING_ALLOWLIST_MAX = 64`, items at most 128 characters, and declared after `tags`. Membership is not checked on save, the same as `playlistIds` (E1, E2, E14). The alternative, storing show ids on the jingle (E23), lost: the operator wants the list on the show, and the jingle/bed sidecars stay untouched.
- One pure helper `allowedForShow(items, allowlist, key)` in a new `broadcast/show-allowlist.ts`. An empty or absent list returns every item; otherwise it returns only items whose key is listed. `queue.ts` calls it at E6, E7 and E8 with `settings.resolveActiveShow()` (E5, E16). `pickRotateJingle` and `pickBed` are unchanged (E9).
- Strict allowlist (OQ1): a non-empty list never falls back to station jingles or beds. A list whose entries all vanished matches nothing, so the rotate skips and the link airs without a bed, each with a booth-log line. It does not quietly widen to "all" (OQ2).
- The show is resolved at pick time, not at air time (E5). A jingle picked at 12:59 may air after a 13:00 show change. #1875 accepted this.
- The manual press is untouched (E10).
- Mixer-counted rotate: the lists are ignored there (E11). There is a new doctor finding `show jingles` (E12) and a notice under the editor's jingle picker. The web uses the same owner rule as E11 and E22.
- Editor UI reuses `PlaylistPicker`/`PlaylistIdsField` (E20) with one optional `copy` prop. The default copy is today's Navidrome strings, so the playlist UI is byte-identical. The data comes from the existing imaging queries (E21). A new picker component lost: it would be a copy of E20.
- Public schedule is unchanged (E13). A test pins that the lists are absent.
- OQ1 (operator): strict. A non-empty list never mixes in station jingles or beds.
- OQ2 (operator): keep stale names and skip. Never fall back to "all". The operator must see why: the editor marks each stale entry "(deleted)" through `PlaylistPicker`'s existing missing row (E20, new `copy`). When a list's entries all fail to resolve, the editor shows a skip notice in the existing `<span role="alert" className="field-hint text-vermilion">` pattern (E25). Both are gated on the library status being `ready`, so a failed fetch never claims "deleted" (E20 `:165-168`). The doctor adds one `show lists` warn finding per affected show, naming it (E12). This is one pure web helper and one doctor loop, with no new component.
- OQ3 (operator): warning only. Saving a list never flips counting.
- OQ4 (operator): the "which shows use this" shortcut is a follow-up (Non-Goals).
- OQ5 (operator): no `enabled` flag. Empty = all.

## Risks / Trade-offs
- Field-list drift: `resolveShowShape` (E5), `repairShowForLoad` (E3), `hydrateShow` and `showPayload` (E19) each list fields by hand. Missing any one silently drops the feature. Each gets its own scenario test.
- On a mixer-counted station (the default), jingle lists do nothing until the operator switches counting. Mitigated by the doctor warning and the editor notice. Bed lists work on every station (E8 is always controller-side).
- The imaging queries poll every 3 s (`queries.ts:29`) while the shows panel is open. This is accepted to avoid a second query layer. `audit-admin-query` must stay green.

## Open Questions
None. The operator resolved them on 2026-10-26, and the answers are recorded under Decisions as OQ1–OQ5.
