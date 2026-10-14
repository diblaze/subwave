# liqe spike results (2026-10-15)

liqe 3.8.7 (deps nearley, ts-error), run on Node 22 against a read-only copy of a real 6.6k-track library.db.

- Parses: bare terms, `field:value`, quotes, `-`/`NOT`, `AND`/`OR`/implicit AND, grouping `(...)`, ranges `[a TO b]`/`{a TO b}`, `:>`/`:>=`/`:<`/`:<=`, `:=` (exact), unquoted `*` wildcard (raw LiteralExpression), `/re/flags` (RegexExpression, not validated by liqe).
- Does NOT parse field grouping `title:(live OR remix)` (SyntaxError col 7). Use `title:live OR title:remix` or `title:/live|remix/`.
- Errors: SyntaxError "Syntax error at line 1 column N" for most; an unclosed quote throws "Found no parsings." with no position.
- Every node has `location {start,end}` (UI highlighting).
- liqe's in-memory test()/filter() evaluate RegexExpression with native RegExp (ReDoS) — compile regex nodes through util/search-pattern (RE2) instead.
- sql.ts: ~70-line AST→SQL prototype (text via fold()+LIKE, `*`→LIKE, regex→search_match, `:=`→fold equality, numeric year/bpm comparisons/ranges, energy/mood/genre facets, unknown field → error with offset). Counts on the real library: `live` 121, `title:/\((live|remix)\)/` 35, `artist:the*` 185, `åsa` 1, `genre:pop year:[2000 TO 2009]` 724, `title:live OR title:remix` 207, `artist:="ABBA"` 39.
- Timing warm: 4–30 ms per COUNT query (first query ~0.5 s warmup); parse ~1 ms for a complex query.
- Size: liqe 396 KB + nearley 140 KB, pure JS.
