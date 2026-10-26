# Proposal

Status: done
Issue: diblaze/subwave#6

## Why
Operators want each show to sound like itself: the lunch show should air its own idents and its own instrumental beds, not the whole station library. Upstream perminder-klair/subwave#1875 (jingles per show) and #1188 (beds per show) asked for one shared design; this is it, with the lists stored on the show.

## What Changes
- A show carries two optional lists, picked from the station's existing library: allowed jingles and allowed beds. An empty list means every jingle / every bed is allowed (today's behaviour).
- The controller-counted jingle rotate and the over-music ID draw only from the on-air show's jingle list. If no listed jingle exists any more, the slot is skipped. Another jingle is never substituted.
- A link or request bed is chosen only from the on-air show's bed list. If no listed bed fits, the link airs without a bed.
- An operator's manual jingle press ignores the lists.
- The lists survive editor save, restart and backup restore, and stay out of the public schedule.
- The show editor gains an Imaging section with a jingle picker and a bed picker. Deleted entries stay visible, marked "(deleted)", so they can be removed.
- When none of a show's listed jingles or beds exist any more, the editor shows a notice that its jingle slots or beds are skipped and why. The doctor reports the same, naming the show.
- When the mixer counts the rotate, it ignores jingle lists. The doctor and the show editor both warn about this.

## Capabilities
### New Capabilities
- `show-imaging-allowlists`: per-show jingle and bed allowlists, how automatic draws honour them, persistence, the editor pickers and the mixer-counted warning.
### Modified Capabilities

## Impact
- Controller: `schemas/show.ts` (two fields + load repair), `settings/persona.ts` `resolveShowShape`, new pure `broadcast/show-allowlist.ts`, `broadcast/queue.ts` (three draw sites), `doctor/checks-content.ts`.
- Web: `components/admin/shows/{types,lib,ShowPickers,ShowEditor}.ts(x)`, `components/admin/ShowsPanel.tsx`, regenerated `lib/schemas.generated.ts`.
- Docs: `docs/internals/broadcast.md`, `docs/jingle-audio.md`.
- API: `POST /shows` and `GET/POST /settings` show objects gain `allowedJingles`/`allowedBeds` (string arrays, default `[]`). No new route, no migration, no dependency.
