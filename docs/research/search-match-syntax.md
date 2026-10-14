# Research: one search/match syntax (2026-10-14)

Read-only research for docs/plans/wildcard-rules.md. Benchmarks ran against the controller's own better-sqlite3 (SQLite 3.53.2) and re2js 2.8.6 on Node 22.22.3.

## 1. Syntax convention
Plain text = substring (search) or exact (rules); `/pattern/` = regex escape hatch; case-insensitive by default. *arr precedent: Sonarr "Must Not Contain" documents `/regex-here/i` (E1), Radarr regex conditions always case-insensitive (E2), Lidarr "terms (or regex patterns)" (E3). Full query languages (beets E4, Quod Libet E5, GitHub E6) are power-user tools; the rule card already expresses field + any-of OR + negation structurally. Jellyfin substring only (E7); Plex smart filters contains/begins/ends, no regex (E8); Navidrome moved to FTS5 in v0.61 (E9) and had to fix short/non-ASCII names (E10).
Verdict: keep `/pattern/` (commit 89919943). No `*` glob, no query language (YAGNI).

## 2. Regex safety on Node 22
`(a+)+$` on 29 chars: 16.9 s default V8; 1 ms with `--enable-experimental-regexp-engine-on-excessive-backtracks`; `l` flag 0 ms but rejects backrefs (E11); V8: fallback "does not apply to all patterns", linear engine lacks lookaround and `i` (E12). `re2` 1.27.0 native (node-gyp fallback; image has no compiler E14; npm allowScripts E15). `re2-wasm` dead. `re2js` 2.8.6 pure JS, zero deps, refuses backrefs/lookaround at compile, folds Å/å case-insensitively, catastrophic pattern 1.3 ms; ~4 µs/test vs native 0.5 µs (E16). recheck/safe-regex2 alive but heuristic (E13). `RegExp.escape` needs Node 24 (E17); controller is node:22.
Pick: re2js. Runner-up: native RegExp + V8 excessive-backtracks flag.

## 3. SQLite
lower() ASCII-only without ICU (E18); this build ENABLE_ICU=0 (E19); `LIKE '%å…%'` 0 rows vs REGEXP 190 (E20). 7k rows × 3 cols: LIKE 1.8 ms, db.function REGEXP native 4.6 ms, re2js 26 ms, FTS5 trigram 0.05 ms (E20). Trigram: ≥3 chars only (E21), external-content table + triggers. `deterministic: true` documented hint (E22).
Best fit now: one registered `search_match(pattern, value)` backed by the same re2js matcher, used for plain text too (escaped) → Unicode folding + one code path. FTS5 trigram = upgrade past ~50–100k tracks.

## 4. Reusable design sketch
Mirror constraint (E23): parser zod-only/pure.
- `controller/src/schemas/search.ts` (mirrored): `type Search = {kind:'text';text} | {kind:'pattern';source}`; `SEARCH_MAX = 64`; `parseSearch(input)`; `escapeRegex(text)` (MDN idiom); `searchSource(s, mode:'substring'|'exact')`; zod `searchValue`.
- `controller/src/music/search-match.ts` (server, re2js): `compileSearch(s, mode): Matcher` (throws SearchSyntaxError → 400); `registerSearchSql(db)` (`db.function('search_match', {deterministic:true})` + LRU); `searchWhere(cols, s, mode): {sql, params}`.
- Callers: blocklist-rules (pattern values via compileSearch 'exact'; text values keep folded sets), library-db/browse (searchWhere substring), likes route (`routes/library/browse.ts:127` `.includes`), `/dj/search` → Navidrome FTS unchanged, 400 for `/…/`; `/similar-tracks` (listener-facing) stays plain.

## 5. Recommendation
Pick: `/pattern/` + mirrored parser + re2js matcher + one `search_match` SQL function. Runner-up: native RegExp + V8 flag. Changes answer: listener-facing search box (re2js mandatory); >100k library (FTS5 trigram for search); Node 24 (RegExp.escape). Smallest next step: drop stash's native REGEXP, add re2js, move ruleRegex → schemas/search.ts, point browse.ts + blocklist-rules.ts at it, keep stash test (+ Å case, `(a+)+$` timing).

## Evidence
- E1 https://raw.githubusercontent.com/Servarr/Wiki/master/sonarr/settings.md — "Regex needs to be like `/regex-here/i`"
- E2 https://raw.githubusercontent.com/Servarr/Wiki/master/radarr/settings.md — "Any conditions that use RegEx are case insensitive"
- E3 https://raw.githubusercontent.com/Servarr/Wiki/master/lidarr/settings.md — "terms (or regex patterns)"
- E4 https://beets.readthedocs.io/en/stable/reference/query.html — negation `-`/`^`, regex `::`
- E5 https://quodlibet.readthedocs.io/en/latest/guide/searching.html — `artist = /\sRice/`
- E6 https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax
- E7 https://forum.jellyfin.org/t-how-does-jellyfin-search-work — "searches if the name contains the search term"
- E8 https://kometa.wiki/en/latest/files/builders/plex/smart-filter/ — contains/.not/begins/ends, no regex
- E9 Navidrome v0.61.0 release — "rebuilt on top of SQLite FTS5 with two-phase BM25 ranking"
- E10 Navidrome v0.63.0 release — "Fix artists with short or non-ASCII names being unfindable after the FTS5 search migration"
- E11 Local Node 22.22.3: default 16915 ms, fallback 1 ms, l-flag 0 ms, backref rejected under l, RegExp.escape undefined
- E12 https://v8.dev/blog/non-backtracking-regexp — fallback "does not apply to all patterns"
- E13 npm registry: re2 1.27.0 (2026-09-26, nan/node-gyp), re2js 2.8.6 (2026-07-05, no deps), recheck 4.5.0, safe-regex2 5.1.2, re2-wasm 1.0.2 (2022)
- E14 docker/Dockerfile.controller:1,5-9,141 — node:22-bookworm-slim, python3 only, `npm ci --omit=dev`
- E15 https://raw.githubusercontent.com/uhop/node-re2/master/README.md — prebuilt download, node-gyp fallback, allowScripts
- E16 bench: native 3.39 ms / re2js 29.39 ms per 7k tests, same hits; re2js rejects backref/lookahead; Å fold true; (a+)+$ 1.26 ms
- E17 https://nodejs.org/en/blog/migrations/v22-to-v24 ; https://2ality.com/2025/01/regexp-escape.html — RegExp.escape = Node 24
- E18 https://www.sqlite.org/lang_corefunc.html — lower() "works for ASCII characters only"
- E19 local pragma_compile_options: ENABLE_FTS5 1, ENABLE_ICU 0, lower('ÅÄÖ')='ÅÄÖ'
- E20 bench 7k rows: LIKE 1.84 / REGEXP native 4.55 / re2js 26.21 / FTS5 trigram 0.05 ms; LIKE Å 0 vs REGEXP 190
- E21 https://www.sqlite.org/fts5.html — trigram: fewer than 3 chars match nothing
- E22 better-sqlite3 docs/api.md — `.function(..., {deterministic: true})`
- E23 controller/scripts/gen-schemas.ts:155 — mirrored module may reference only 'zod'
- E24 controller/src/schemas/blocklist.ts:42-46 (ruleRegex, ponytail note); blocklist-rules.ts:97,129
- E25 library-db/browse.ts:48-52 (LIKE ×3); routes/library/browse.ts:88,127 (likes `.includes`); routes/dj.ts:883-891 (/dj/search → search3); routes/public.ts:575-577 (/similar-tracks, station auth)
- E26 stash@{0} (native REGEXP + 64-entry cache + library-search-pattern.test.ts); branch backup/wildcards-glob (rejected glob)
