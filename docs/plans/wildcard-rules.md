# One `/pattern/` regex syntax for blocking rules and the Library search
Status: approved
Issue: diblaze/subwave#19
## Goal
A rule value or Library-tab search written `/pattern/` is one case-insensitive RE2 regex (linear time, no catastrophic backtracking) tested against the raw metadata, through one server helper every present and future search box reuses; any other value keeps today's meaning (rule = exact name, search = substring).
## Evidence
- E1 controller/src/schemas/blocklist.ts:40-47 — `export function ruleRegex(value: string): RegExp | null { const m = /^\/(.+)\/$/s.exec(value.trim()); return m ? new RegExp(m[1]!, 'i') : null; }` — HEAD 89919943's native-RegExp parser, inside the mirrored schema; `:121-126` runs it on save. Both go: the matcher moves server-side (E8) and the schema may import only zod (E7).
- E2 controller/src/music/blocklist-rules.ts:88,97,103-109,128-129 — `regexes: RegExp[]` / `regexes: rule.values.flatMap((v) => compiledRegex(v) ?? [])` / `const hit = (set, raw, key = normText(raw)) => set.has(key) || cr.regexes.some((re) => re.test(raw));` — the shape stays; only the compile target changes.
- E3 controller/src/music/blocklist-rules.ts:48-55 — `// Chokepoint for POST and PUT alike.` … `export function validateRulePatch(raw: unknown)` and :163-172 `coerceStoredRule` → `validateRulePatch` — the one server-side place a rule value is checked on save (`blocklist.ts:375,389` addRule/updateRule) and on load (`blocklist.ts:172`, dropped loudly). The RE2 compile check lives here.
- E4 controller/src/routes/library/blocklist.ts:34,38,48-50 — `validateBody(blockRuleSchema, { messages: 'verbatim' })` then `await blocklist.addRule(req.body)` … `catch (err) { … res.status(400).json({ error: err.message }); }` — a throw from E3 is already a 400; web/components/admin/library/BlockRulesCard.tsx:235 `notify.err(\`Save failed: ${errorMessage(e)}\`)` toasts it. No new error plumbing.
- E5 controller/src/music/scene-references.ts:36-43 — `let re: RegExp | null = null; try { re = ruleRegex(filterValue); } catch { return false; } if (re) return re.test(scene);` and :49-53 `filterNamesScene` = mutual `filterCatchesScene` — the orphan scan tests with the rule's own matcher; a pattern string is never itself caught, so HEAD's test (`orphanedFilters(…['/^xmas/']…) → []`) holds under any matcher.
- E6 controller/src/music/library-db/browse.ts:15,47-53 — `const q = (opts.q || '').trim().toLowerCase();` … `` `(LOWER(COALESCE(title,'')) LIKE ? OR LOWER(COALESCE(artist,'')) LIKE ? OR LOWER(COALESCE(album,'')) LIKE ?)` `` / `` const pat = `%${q}%`; `` — the plain substring path; it ORs three fields, while a rule checks one field (E2), so the two are the same syntax, not the same predicate.
- E7 controller/scripts/gen-schemas.ts:148-157 — `A mirrored module may reference only 'zod'. Move anything else into a *-server.ts sibling, which is not mirrored.` — re2js can never sit in `schemas/`; and web/components/admin/library/BlockRulesCard.tsx:24 `import { blockRuleSchema, RULE_TEXT_MAX } from '@/lib/schemas.generated'` is the only web consumer, which needs no parser once the pattern check is server-side (E3/E4).
- E8 Scratchpad run, Node 22.22.3 (`node --enable-experimental-regexp-engine-on-excessive-backtracks`): `(a+)+$` on 27 chars — `flags="" 1 ms` / `flags="i" 4588 ms`. V8's linear fallback does not cover the `i` flag, so "native RegExp + V8 flag" cannot protect an always-case-insensitive convention. re2js 2.8.6 (npm: no `dependencies`, MIT, `engines node >=18`): `RE2JS.compile('\\b(live|remix)\\b', RE2JS.CASE_INSENSITIVE).matcher('Song (Live)').find()` → true, `'Liver'` → false; `'^åsa'` finds `'Åsa Jinder'`; `(live`, `(a)\1`, `(?=x)y` throw at compile (`error parsing regexp: …`); `(a+)+$` 0.47 ms. docker/Dockerfile.controller:1,141 `FROM node:22-bookworm-slim` / `RUN npm ci --omit=dev` — pure JS, no build step, must be a prod dependency.
- E9 controller/src/music/library-db/lifecycle.ts:32-33 — `const db = new Database(DB_PATH); setHandle({ db, …` — the one place the better-sqlite3 handle is born; `search_match` is registered right after it.
- E10 controller/src/music/library-db/types.ts:210 `q?: string | null;` and controller/src/music/library.ts:613-624 — `// Filter contract for the admin Library browse panel` … `q?: string | null;` — FilterOpts is declared twice (db + facade); `pattern` goes in both.
- E11 controller/src/routes/library/browse.ts:17,37 — `router.get('/library/browse', requireAdmin, …` / `q: typeof q.q === 'string' ? q.q : null,` — the admin Library tab's search, the only caller that may set `pattern`.
- E12 Other `filter({ q })` callers keep plain text: controller/src/routes/public.ts:575,600 `router.get('/similar-tracks', requireStationAuth, …` / `for (const cand of library.filter({ q, limit: 8 }).rows)` with :573-574 `\`q\` would otherwise make a blocked track's title and artist an unauthenticated lookup by name` (listener-facing; a regex would widen that probe); controller/src/music/library.ts:330,350 `for (const row of db.filter({ q: seed, limit: 8 }).rows)` (LLM title fallback, model text must stay literal). Neither ever sees `pattern`.
- E13 Text-search surfaces that are not `filter()`: controller/src/routes/dj.ts:882-891 `router.get('/dj/search', …` → `subsonic.search(q, …)` (Navidrome search3 matches; the controller never tests rows) — reached by web/components/admin/library/tabs/SearchTab.tsx:61 and web/components/admin/playlist-builder/queries.ts:44; controller/src/routes/library/browse.ts:147,154 `/library/search-sound` → `analyzer.embedTexts([q]…)` (semantic); controller/src/routes/library/browse.ts:88,125-127 `/library/liked` `.includes(q)` — web/components/admin/library/tabs/useTrackModes.ts:73-75 sends `limit/offset/sort` only, so no UI sends that `q`; controller/src/routes/public.ts:724 `/geocode` (external); LLM tools `llm/internal/tools/picker/tools/search-library.ts:16`, `identify-requested-track.ts:40` → `subsonic.search`.
- E14 Web boxes that filter a client-side list (no server, no change): SkillsPanel.tsx:304-308, SceneVocabSection.tsx:106-107, EndpointsTab.tsx:18-24, ModelCombobox.tsx:85 (`.toLowerCase().includes(q)`), PlaylistBuilderPanel.tsx:1390-1393 (`playlistQuery`), RosterToolbar, SettingsSearch (cmdk).
- E15 web/components/admin/library/BrowseFilters.tsx:61 — `placeholder="filter results by title, artist, or album…"` — the Library tab box; the stash's copy `filter by title, artist, or album, or /regex/…` names what the slashes do.
- E16 HEAD 89919943 web copy (BlockRulesCard.tsx:47-52,466,472): `'exact match or /regex/ across genre tags, …'`, `(any of, Enter to add{fieldWatch === 'genre' ? '' : '; /pattern/ is a case-insensitive regex'})`, `fieldWatch === 'title' ? 'e.g. /\\b(live|remix)\\b/'` — kept as is.
- E17 HEAD tests: controller/scripts/blocklist-rules.test.ts:112-128 (`liveOrRemix`, per-field, genre never a pattern, stored verbatim, `/(live/` refused `/not a valid pattern/`); scene-references.test.ts:170-175; stash `controller/scripts/library-search-pattern.test.ts` (node:test, `db.open` + `upsertTrackMeta`/`upsertTrackTags` exist: library-db/tracks.ts:168,312; cases `\b(live|remix)\b`, `^the `, `^åsa`). All reusable; see Changes for the asserts that move.
- E18 docs/internals/music.md:117 — HEAD's sentence `A \`tag\`/\`mood\`/\`artist\`/\`album\`/\`title\` value written \`/pattern/\` is a JavaScript RegExp (always case-insensitive, \`schemas/blocklist.ts\` \`ruleRegex\`) … A catastrophic pattern can stall the event loop` — names the wrong engine and the wrong module after this change.
- E19 .github/workflows/lint.yml:80-81 — `npm run gen:schemas` / `git diff --exit-code ../web/lib/schemas.generated.ts` — the mirror drift gate; removing E1 from the schema puts the mirror back to upstream byte-for-byte.
## Changes
Amend HEAD 89919943 into slice 1 (same feature, new engine); slice 2 is a new commit on top. Nothing from the stash's native `REGEXP`/64-entry cache survives except the `pattern` opt shape, the route parse and the test file.

**Slice 1 — amend 89919943: `feat(blocklist): /pattern/ regex values in blocking rules`**
- controller/package.json (+ package-lock.json) — add `"re2js": "^2.8.6"` under `dependencies` (E8: `npm ci --omit=dev`).
- controller/src/util/search-pattern.ts (new, server-only; E7, E8) — the one reusable matcher:
  `export interface SearchPattern { source: string; test(text: string): boolean }`;
  `export function searchPattern(input: string): SearchPattern | null` — `/^\/(.+)\/$/s` on `input.trim()` → null for plain text, else `compile(source)`; wraps RE2JS's error as `Error(\`${trimmed} is not a valid pattern: ${e.message}\`)`;
  `function compile(source)` → `RE2JS.compile(source, RE2JS.CASE_INSENSITIVE)` → `{ source, test: (t) => re.matcher(t).find() }`;
  `export function registerSearchSql(db: Database)` → `db.function('search_match', { deterministic: true }, (source, value) => …)` with a one-entry memo (`last.source === source` — better-sqlite3 is synchronous, so one query never interleaves with another; paging repeats the same source). Header comment states the contract (unanchored, case-insensitive, RE2 dialect: no backrefs/lookaround) and why RE2 (E8).
- controller/src/schemas/blocklist.ts — delete E1 (`ruleRegex` + the `:121-126` try/catch); file returns to upstream.
- web/lib/schemas.generated.ts — `npm run gen:schemas`; returns to upstream (E19).
- controller/src/music/blocklist-rules.ts — (E2, E3) import `searchPattern` instead of `ruleRegex`; `regexes: SearchPattern[]`, compiled only when `rule.field !== 'genre' && rule.field !== 'playlist'` (genre stays exact, operator decision); `compiledRegex` keeps its try/catch (a stored value RE2 refuses is skipped; load already drops it, E3). In `validateRulePatch` after `safeParse`: `if (field is not genre/playlist) for (const v of values) try { searchPattern(v); } catch (e) { throw new Error(\`rule.values: ${e.message}\`); }` — one check, one dialect, surfaced by E4. Comment at :117-118 unchanged except `RegExp` → `RE2 pattern`.
- controller/src/music/scene-references.ts — (E5) `ruleRegex` import → `searchPattern` from `../util/search-pattern.js`; body `let p; try { p = searchPattern(filterValue); } catch { return false; } if (p) return p.test(scene);`. Doc comment `RegExp` → `pattern`.
- controller/scripts/blocklist-rules.test.ts — (E17) keep HEAD's asserts; change the refusal assert to `/\/\(live\/ is not a valid pattern/`; add `assert.throws(() => validateRulePatch({ …, values: ['/(a)\\1/'] }), /not a valid pattern/, 'RE2: no backreferences')`; add `validateRulePatch({ label, field: 'genre', values: ['/(live/'] })` does NOT throw (genre values are names); add a linear-time pin: `ruleMatches(compiled({ field: 'title', values: ['/(a+)+$/'] }), { title: 'a'.repeat(30) + 'b' }, null)` is false and `performance.now()` delta `< 500` (E8: 0.47 ms; native 16.9 s).
- controller/scripts/scene-references.test.ts — (E5, E17) HEAD's test unchanged.
- web/components/admin/library/BlockRulesCard.tsx — (E16) HEAD copy unchanged.
- docs/internals/music.md:117 — (E18) replace the HEAD sentence with: `` A `tag`/`mood`/`artist`/`album`/`title` value written `/pattern/` is a case-insensitive RE2 regex (`util/search-pattern.ts`, re2js — linear time, no backreferences or lookaround, so an admin typo can never stall the event loop) tested unanchored against the raw text; `validateRulePatch` refuses one RE2 cannot compile (the mirrored schema does not look inside values), and the merge-orphan scan (`scene-references.ts`) tests with the same matcher. Genre values are never patterns. The same helper backs the Library tab's `/pattern/` search (`search_match` in `library-db/lifecycle.ts`). ``
- Commit message: body says RE2 via re2js, why not native (E8), `Refs diblaze/subwave#19`.

**Slice 2 — `feat(library): /pattern/ regex in the Library tab search`**
- controller/src/music/library-db/lifecycle.ts — (E9) `registerSearchSql(db)` on the line after `setHandle({ db, … })`.
- controller/src/music/library-db/types.ts and controller/src/music/library.ts — (E10) `pattern?: string | null; // RE2 source over title/artist/album; only the admin browse route sets it (E12)`.
- controller/src/music/library-db/browse.ts — (E6) after the `q` block: `if (opts.pattern) { where.push(\`(search_match(?, COALESCE(title,'')) OR search_match(?, COALESCE(artist,'')) OR search_match(?, COALESCE(album,'')))\`); params.push(p, p, p); }`. `q` path untouched (E12: plain text never becomes a pattern for `/similar-tracks` or the KNN fallback).
- controller/src/routes/library/browse.ts — (E11) `const text = typeof q.q === 'string' ? q.q : null; let p: SearchPattern | null = null; try { p = text ? searchPattern(text) : null; } catch (err) { return res.status(400).json({ error: err.message }); }` then `q: p ? null : text, pattern: p?.source ?? null`. Reusable recipe for any future route: parse with `searchPattern`, 400 on throw, test rows with `.test()` or pass `.source` to `search_match`.
- controller/scripts/library-search-pattern.test.ts — (E17) the stash file as is (its `^åsa` case now proves the RE2 fold); add `assert.throws(() => searchPattern('/(live/'), /not a valid pattern/)` — the route's 400 is that throw.
- web/components/admin/library/BrowseFilters.tsx:61 — (E15) placeholder `filter by title, artist, or album — /regex/ for a pattern…`.
- docs/internals/music.md — covered by the slice-1 sentence's last clause; no second edit.

**Slice 3 — `fix(library): Unicode case folding in the Library search`** (operator: "Unicode is a must", 2026-10-14)
- controller/src/util/search-pattern.ts — `registerSearchSql` also registers `db.function('fold', { deterministic: true }, (v) => String(v ?? '').normalize('NFC').toLowerCase())`; export `foldText(s)` (same body) for the query side.
- controller/src/music/library-db/browse.ts — the three `LOWER(COALESCE(col,''))` in the `q` block → `fold(COALESCE(col,''))`; `q` built with `foldText` instead of `.toLowerCase()`. LIKE then compares already-folded text, so Å/Ä/Ö (and NFD-stored names) match.
- controller/scripts/library-search-pattern.test.ts — plain `åsa` finds "Åsa Jinder"; an NFD-stored "A\u030Asa" is found by `Åsa`.

Surface survey (operator ask "reusable for any search box"):
| Box | Status | Why |
|---|---|---|
| Block rule values | now | slice 1 |
| Library tab Browse search → `/library/browse` | now | slice 2 |
| Library tab Search, 'library' mode → `/dj/search` | never | Navidrome search3 matches, not the controller (E13) |
| Library tab Search, 'sound' mode → `/library/search-sound` | never | CLAP embedding of the text (E13) |
| Playlist builder anchor/suggestion boxes → `/dj/search` | never | same as above (E13) |
| `/library/liked` `q` | later | no UI sends it today (E13); when a Liked search box lands, `searchPattern(q)?.test(...)` replaces `.includes` in the same route |
| `/similar-tracks` `q` (listener-facing) | never | station-auth lookup by name; plain `q` only (E12) |
| `tracksLikeThis*` title fallback | never | LLM text stays literal (E12) |
| Skills/Scenes/Endpoints/Models/Playlists/Roster/Settings boxes | never | client-side `.includes` over a short list (E14) |
## Check
```
cd ~/git/subwave-up2/controller && npm test -- blocklist && npm test -- scene-references && npm test -- library-search-pattern && npm run lint \
  && npm run gen:schemas && git diff --exit-code upstream/develop -- ../web/lib/schemas.generated.ts ../controller/src/schemas/blocklist.ts
cd ~/git/subwave-up2/web && npm run lint
cd ~/git/subwave-up2 && rg -n "new RegExp\(|ruleRegex" controller/src/music/blocklist-rules.ts controller/src/music/scene-references.ts controller/src/routes/library/browse.ts controller/src/music/library-db/ controller/src/schemas/blocklist.ts; test $? -eq 1
```
## Deferred (YAGNI)
- `%`/`_` in a plain Library search are SQL LIKE wildcards (E6, pre-existing) — reopen when an operator reports a literal `%`/`_` title unfindable; fix is `ESCAPE '\'` + a 3-char escape in browse.ts, its own commit (behaviour change to plain search).
- 400 on `/…/` typed into `/dj/search` or `/library/search-sound` — reopen if someone types a pattern there expecting regex; today it is literal text to Navidrome/CLAP and returns nothing.
- Refusing a `/…/` value on a genre rule (today: stored as an exact name that matches nothing; the Blocked tab's `N tracks` count shows 0) — reopen if an operator files it.
- Mirroring `searchPattern`'s `/…/` detection into `schemas/` for client-side feedback — reopen when a web component needs to know "is this a pattern" before submit; today the server 400 toasts (E4).
- FTS5 trigram index for plain search — reopen past ~50k tracks when per-keystroke LIKE is measurably slow (research §3).
## Open questions
- None whose answer changes the Changes section; genre and `*`-glob decisions stand (operator, 2026-10-14).
