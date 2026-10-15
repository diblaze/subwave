# Resume into another show airs the old fallback's prepared track
Status: draft
Issue: perminder-klair/subwave#1925 (maintainer review comment, 2026-10-15)

## Goal
After an idle pause that ends in a different show, the first fallback track is the new show's, also when a DJ pick (not the fallback) was frozen on air.

## Evidence
- E1 liquidsoap/radio.liq:386-398 (PR head 3c053ed3) — `auto_playlist = playlist(id="auto", reload_mode="watch", mode="randomize", ...)`; `music = fallback(id="music", track_sensitive=true, [dj_queue, auto_playlist])`.
- E2 Liquidsoap 2.4.5 stdlib /usr/share/liquidsoap/libs/playlist.liq:826-845 — `def reload(~empty_queue=true, p) = ... if empty_queue then q = s.queue() s.set_queue([]) list.iter(request.destroy, q)` — reload clears only `queue()`, never the source's current request; the `auto.reload` server command calls `s.reload()` (:1299-1307).
- E3 Context7 /websites/liquidsoap_info_doc-2_4_0 playlist methods — `current() -> request?` "Get the request currently being played" is separate from `queue() -> [request]`.
- E4 controller/src/broadcast/resume-show.ts:29-31 — "Liquidsoap holds one prefetched request from the old list until a reload drops it" — the assumption E2 contradicts.
- E5 controller/src/broadcast/liquidsoap-control.ts:139-141 `sendCommand('auto.reload', ...) === 'OK'`; scheduler.ts:516 is the only auto.m3u writer and always follows the atomic write with this reload.
- E6 radio.liq:1547-1558 idle gate: `switch(track_sensitive=false, [({idle_mode()}, blank()), ({true}, radio)])`; `skip` → `radio.skip()` (:2079-2088).
- E7 Isolated repro (docs/research/liq-resume-repro, Liquidsoap 2.4.5 from the broadcast image): scenario A today `old1 -> dj -> old2 -> new1`; telnet `auto_state` before and after `auto.reload`: `current=/w/old2.wav queue=["/w/new1.wav"]` — the watch already refilled the queue, the prepared current survives. Scenario B today `old1 -> new1` (passes, as reported).
- E8 Same repro: `auto.skip` after the reload leaves `current=/w/old2.wav` (a skip acts only on a pulled source; the fallback is on dj_queue) and old2 still airs. `check_next` runs when old2 is prepared (:53), not when it airs (:59), so it cannot reject it.
- E9 Same repro, fix: the fallback's auto slot is `source.dynamic(fun () -> pending)`; `auto.reload` (registered by radio.liq, `namespace="auto"`) does a plain reload when the slot is on air (or a swap is pending), else `prepare`s and commits a fresh playlist instance, dropping the stale prepared request. A: `old1 -> dj -> new1`; B: `old1 -> new1`, new1 plays its full length (no double skip); C (3 reloads while auto on air): no cut. `track_sensitive=true` on the slot re-breaks A (the stale request airs as a track first).
- E10 Same repro: with `reload_mode="watch"` per instance, superseded instances can keep their file watcher (20 rapid swaps: 4 reloads per file change vs 2 baseline) and a committed-but-unpulled instance does not watch at all; with `reload_mode="never"` there are no watchers and E5 makes the explicit reload the trigger anyway.

## Root cause
A Liquidsoap request source keeps the request it will play next as its `current`, apart from its queue (E3). When a DJ pick takes over at a track boundary, the `auto` playlist has already advanced to the old show's next track as `current` (E7). `auto.reload` empties only the queue (E2), so after the resume skip the fallback switches back to `auto` and airs that prepared old-show track. The controller assumes the reload drops it (E4).

## Changes
- liquidsoap/radio.liq (E1, E2, E9, E10) — build the fallback's auto slot as `source.dynamic` over a `make_auto()` playlist (`register_server_commands=false`, `reload_mode="never"`); track which music child last started (`dj_queue.on_track` / slot `on_track`); register `auto.reload` (`server.register(namespace="auto", "reload", ...)`): on air or swap pending → `auto_playlist().reload()`, else commit a fresh instance (`prepare` + selector). Same command name and `OK`, so no controller change; the reload's OK now means the old fallback is gone.
- controller/src/broadcast/resume-show.ts:29-31 (E4) — correct the comment.
- controller/src/broadcast/scheduler.ts:513-517 (E5) — the "relying on inotify watch" log line goes (no watch); the hourly refresh retries.
- A mixer test: the repro's scenarios A/B/C as a script next to scripts/liquidsoap-image-smoke.py, run against the built broadcast image.

## Check
Repro scenario A against the real radio.liq in an isolated container: today `... dj -> <old-show track>`, after the change `... dj -> <new-show track>`; B and C unchanged.

## Counter-checks
- V1 Alternative path: B (fallback frozen) is fixed by the existing reload+skip (E7); the bug needs a non-fallback track frozen on air. Matches the report ("a resume where only the fallback was playing passes").
- V2 Crossfade: the maintainer reproduced with crossfade off; my repro has no cross at all and still reproduces, so cross is not the cause.
- V3 Callers of `auto.reload`: only liquidsoap-control.ts (E5). Others of `auto.*`: none (`git grep "'auto\."` → only reload).
- V4 Error path: telnet down → reload not sent; today the watch would still apply the file (backup). With `never` it waits for the next refresh. Trade-off to raise with the maintainer.

## Unverified
- Run against the full radio.liq (cue_cut, cross, music_meta, jingle/voice layers, `mode="randomize"`), because the repro models only the dj_queue/auto/fallback/idle chain; the maintainer's harness covers that.
- Whether superseded playlist instances are freed (memory) after a swap, because Liquidsoap exposes no instance count; watchers are gone with `never`, request objects of the old instance are not destroyed explicitly.

## Open questions
- Keep a watch as a telnet-down backup (with the lifecycle caveats in E10), or rely on the explicit reload only?
