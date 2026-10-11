# Agentic pick: native pass never explores, and the picker is never told the spacing window
Status: approved
Issue: diblaze/subwave#5

## Goal
A pick on a `native-then-done` provider finishes in 2 model calls instead of 5, and the artist guard fires on a minority of picks instead of half, with no new settings.

## Evidence
All paths at `upstream/develop` (7dbc57c) unless noted. Live numbers from `/mnt/black/configs/subwave/logs/events-2026-10-11.jsonl` and `docker logs sub-wave-controller`.

A. Native miss
- E1 controller/src/llm/internal/strategy/plan.ts:17 — `return ollamaish ? 'done-tool' : 'native-then-done';` — openrouter/anthropic/openai/google/deepseek/requesty/gateway/hosted-compatible all take the native pass first.
- E2 controller/src/llm/internal/strategy/agent.ts:267-287 — native `ToolLoopAgent({ ... tools, stopWhen: [isStepCount(...)], ... output: Output.object({ schema: schema! }) ...})` — no `toolChoice`, no `prepareStep`; nothing forces a tool call at any step.
- E3 controller/node_modules/ai/dist/index.js:5613 (ai 7.0.130) — `responseFormat: await output?.responseFormat,` sent on EVERY step; :5545 `prepareToolChoice({ toolChoice: prepareStepResult?.toolChoice ?? toolChoice })` — per-step tool choice is already a supported lever.
- E4 controller/node_modules/@openrouter/ai-sdk-provider/dist/index.js:4299-4304 — `response_format: ... "json_schema"` built from `responseFormat`, beside `tool_choice` (:4348). The schema and the tools reach the model together at step 0 with tool choice open.
- E5 controller/node_modules/@ai-sdk/anthropic/dist/index.js:3716-3725 — native Anthropic does the same (`output_config.format` from `responseFormat`), and :3872-3874 composes it with the caller's `toolChoice` without a guard — forced tool + structured output is a combination the provider emits.
- E6 agent.ts:291-295 — `explored = (nr.steps || []).some((s) => (s.toolCalls || []).length > 0)` — a step-0 object with no tool call is the miss; :313 logs it and falls to the done-tool loop.
- E7 agent.ts:133-139 — `gatedDiscoveryPrepareStep` returns `{ activeTools, toolChoice }` per step; :326 `const forcedChoice = forcedToolChoice(leg.cfg)` — the done path already pins tool choice per step through `prepareStep`.
- E8 controller/src/llm/internal/provider/capabilities.ts:301-304 — `forcedToolChoice`: `'auto'` for `llm.toolChoice: 'auto'` (#570) and thinking-mandatory Claude ids, else `'required'`.
- E9 controller/node_modules/@ai-sdk/google/dist/index.js:1552-1573 — with JSON + tools + `toolChoice: required`, Google swaps in a synthetic `json` tool with `{ type: "required" }` — a forced step 0 on Gemini is "call a discovery tool or `json`", i.e. no worse than today.
- E10 ai/dist/index.js:5684-5690 — a forced step with no tool call throws `ToolChoiceViolationError`; agent.ts:314-317 catches anything that is not generation-control/unavailable and falls to done-tool; controller/src/llm/internal/core/pure.ts:306-322 — `isTransient` matches no field of that error, so it is not retried.
- E11 Live: `settings.json` llm = `openrouter` / `anthropic/claude-haiku-5.5` / `toolChoice: required` / `reasoning: false` / `discoverySteps: 0` / `agentTimeoutMs: 30000` / `pickerAgent: true` / `artistVarietyWindow: 12`. Container log today: 37 `[djAgentPick] native output produced no usable pick (explored=false, accepted=true)` and 18 `[djAgentSegment] ...` — every run. Event log: 36 of 37 `djAgentPick` records at `steps: 4`, 45-60k input tokens; one at `steps: 2`, 20,240 input, 3 tool calls (the native shape).
- E12 agent.ts:262-263 — `lastVia` "stays ':native' so the record attributes there" — the `via` field cannot tell a native hit from a miss (all 37 records say `ai-sdk:agent:native`).

B. Re-picks
- E13 controller/src/broadcast/dj-agent.ts:506-509 — `varietyWindow = settings.get().llm?.artistVarietyWindow ?? ARTIST_VARIETY_WINDOW`; `neighbourRoots = queue.neighbourArtistRoots(varietyWindow)`; :516-520 a violation calls `repickFromSeen` (`kind: 'djAgentRepick'`, :99).
- E14 controller/src/broadcast/queue.ts:4328-4352 — `neighbourArtistRoots(n)`: last `n` queued + on-air + last `n` distinct plays, as `artistRootKey` keys (up to 2n+1 artists).
- E15 controller/src/broadcast/dj-agent/artist-guard.ts:30-38 — `artistGuardCause`: anchor overlap → `'onair'`, `artistRootIn(pickRoot, recentRoots)` → `'recent'`; :146-153 and :175-182 — `'recent'` is a preference: kept when every alternative is recent or the re-pick fails; :155-160 the re-pick prompt is the first time the model hears "already played in the last few slots".
- E16 controller/src/llm/instructions/pick-criteria.md:27 — `3. VARIETY — avoid the same artist back-to-back; rotate energy.` — the only stated rule; the enforced one is E14/E15.
- E17 dj-agent.ts:998-1006 — the pick event names the anchor and ONE predecessor (`(after "${anchorPriorTrack.title}" by ${anchorPriorTrack.artist})`); :1007 `promptSuffix = `${favClause}${effectClause}...`` is the per-pick model-only channel; controller/src/broadcast/session.ts:861 drops `play` turns ("redundant — current track is in the pick event"), :879-884 keeps the last 3 pick rationales whose text is `object.reason` (dj-agent.ts:713) — a 12-word scratchpad that names no artist (controller/src/broadcast/dj-agent/schemas.ts:32).
- E18 controller/src/llm/internal/tools/picker/slim.ts:83,99 — `artist_last_played_days_ago: daysAgo(...)` in whole days: a play 10 minutes ago and one 20 hours ago both read `0`.
- E19 CLAUDE.md:180 — "Enforce variety at the point of choice, not in the discovery tools. Filtering artists inside the tools gutted the similarity pool (#618)" — annotating/filtering tool results is off the table.
- E20 Live today: 20 `pick.artistGuard` events on 37 picks — 10 `cause: onair` (the model re-picked the anchor artist it had just been told was playing), 10 `cause: recent`; all `relaxed: false` (every one cost a `djAgentRepick`, avg 9,801 input tokens; 23 repicks incl. 3 `pick.repicked` bad-id).
- E21 controller/src/broadcast/likes.ts:352-355 — `favouritesClause(cfg)` returns `''` when nothing applies "so the event turn stays byte-identical" — the existing pattern for a per-pick clause; controller/scripts/fav-placement.test.ts:11-16 pins it with a pure-clause test plus a source-level wiring check.
- E22 controller/scripts/llm-strategy-failover.test.ts:33-62,146-157,183 — `configure()`/`mockGeneration()` run real `djAgent` over `MockLanguageModelV3` with `doGenerate` mocked per call; the mock receives `options` (tool choice included) — the seam for a no-model test of the native pass.
- E23 controller/scripts/instructions.test.ts:110-117 — pins `criteria` only by its `1. FLOW`…`4. INTEREST` skeleton and the final rule; rule 3's wording is free to change.

## Changes
PR 1 — `fix(llm): force a discovery call on the native pass's first step` (E2, E3, E7, E8, E10, E11)
- controller/src/llm/internal/strategy/agent.ts — hoist `const forcedChoice = forcedToolChoice(leg.cfg)` above the native block; add to the native `ToolLoopAgent` `prepareStep: async ({ stepNumber }) => (stepNumber === 0 ? { toolChoice: forcedChoice } : {})`. Step 0 must call a tool (the only tools present are discovery tools — no `activeTools` pinning needed); later steps stay `auto` so the model emits the object once it has candidates. `forcedToolChoice` keeps #570 `'auto'` and thinking-mandatory Claude unchanged (E8). A decline throws `ToolChoiceViolationError` → existing catch at :314 → done-tool, i.e. exactly today's cost (E10). Update the comment at :272-274 and the log at :316 to say the first step is forced.
- controller/scripts/llm-strategy-failover.test.ts — two `test()`s on the `openai` mock leg (E22): (a) first `doGenerate` sees `toolChoice: { type: 'required' }`, answers with a `sample` tool call; second sees `auto`/undefined, answers the object; result `via === 'ai-sdk:agent:native'`, exactly 2 calls; (b) with `llm.toolChoice: 'auto'` in `configure()`, the first call sees `auto`. Test (a) fails on today's code (first call is `auto`). Existing :146 case keeps passing (its step-0 text reply now throws instead of missing; same fallthrough, same 3 calls).
- Expected: miss path today = 1 native call (~12k) + 4 done-tool steps (45-60k) ≈ 60k input/pick; native hit = 2 calls ≈ 20k (E11). ~40k/pick saved on 36 of 37 picks, plus the same shape on `djAgentSegment` and `djAgentRequest` (same function, E1).

PR 2 — `fix(dj-agent): tell the picker which artists the spacing guard excludes` (E13-E17, E19, E21)
- controller/src/broadcast/dj-agent/artist-guard.ts — add pure `artistSpacingClause(roots: Set<string>, window: number): string`: `''` when empty, else `` ` Artists heard in the surrounding ${window} slots (queued, on air, just played) — the station re-picks a repeat, so choose a different artist: ${[...roots].join(', ')}.` ``. Keys, not display names: it is the exact set the guard compares (E14), lowercased/folded, which is what "stated rule equals enforced rule" means. "Re-picks", not "never airs": `'recent'` is a preference (E15).
- controller/src/broadcast/dj-agent.ts (`runTrackEvent`, :1007) — append `artistSpacingClause(queue.neighbourArtistRoots(settings.get().llm?.artistVarietyWindow ?? ARTIST_VARIETY_WINDOW), window)` to `promptSuffix`. Same expression as :506-509; a second read is fine because the guard at :510 is the backstop and reads its own snapshot. The anchor artist is in the set (E14 `add(this.current?.track?.artist)`), which covers the 10 `onair` fires too (E20).
- controller/src/llm/instructions/pick-criteria.md:27 — `3. VARIETY — never the same artist back-to-back, and avoid every artist the pick event lists as recently heard; rotate energy. ...` (rest unchanged; E23 holds).
- controller/scripts/artist-guard.test.ts — `artistSpacingClause(new Set(), 12) === ''`; a two-key set renders both keys and the window; plus the fav-placement-style source check that `dj-agent.ts` calls `artistSpacingClause(` inside `runTrackEvent` (E21). Fails on today's code (function absent / event text names one predecessor only).
- Expected: the 20 guard fires/37 picks (E20) fall to the residue the guard exists for; each avoided fire saves one ~9.8k `djAgentRepick`.

Boundaries: two upstream PRs against `develop`, one commit each, independent files, either can land first. No settings added. Commit messages/comments/tests carry no station, host, domain or persona names.

Operator-side today (no code; the fixes do not depend on these):
- `llm.discoverySteps: 1` — done path shrinks to 2 steps (~20k) but the native miss still precedes it (~12k) and the prompt drops to single-round wording (schemas.ts:332-337), losing the second look.
- `llm.artistVarietyWindow` lower — fewer guard fires, more repeats on air; does nothing for the model not knowing the list.
- `llm.pickerAgent: false` — pool picker at ~6k/pick, no agentic discovery.
- Not in scope but visible: `djAgentLeaningsReview` ran 38× today at ~3.2k input each.

## Check
`cd /home/denis/git/subwave/controller && npm test -- llm-strategy-failover && npm test -- artist-guard && npm run lint`
Live after deploy (one pick cycle): `docker logs sub-wave-controller --since 15m | rg -c 'native output'` is `0` and the newest `djAgentPick` record in the day's events file has `steps: 2`.

## Deferred (YAGNI)
- (iii) learned circuit breaker / (ii) per-provider native skip — reopen if the live check shows OpenRouter rejecting forced tool choice beside `response_format` (then skip native for that leg via the descriptor, not a breaker).
- `via` distinguishing a native miss (E12) — reopen when the next cost investigation needs it from the records instead of the container log.
- Display names instead of keys in the spacing clause — reopen if the model is observed mis-matching a folded key against a candidate credit.
- Marking in-window artists on tool results — closed by E19 (#618) unless that rule is revisited upstream.
- Leanings review cost — separate feature, separate toggle.

## Open questions
- OpenRouter's translation of `tool_choice: required` + `response_format: json_schema` for Anthropic models is unverified (native Anthropic composes the pair, E5). If OpenRouter 400s, the native pass degrades to today's path and the Changes switch to a descriptor-level native skip for that leg.
