# Jingle voice select
Status: done
Issue: diblaze/subwave#8

FORK-ONLY FILE. Never commit it to a branch that is pushed upstream or included in the PR.

## Goal
`POST /jingles` takes an optional `tts` voice slot (same shape and validator as a persona's), the Create-jingle modal offers "Station default" or the Personas engine/voice pickers through the existing `EngineVoiceFields`, and the rendered WAV is in that voice.

## Evidence
All paths on `upstream/develop` (9770f02f).

E1 controller/src/routes/jingles.ts:23-26 — `validateBody(jingleCreateSchema)` / `const { text } = req.body as { text: string };` / `await jingles.create(text);` — the only input is text.
E2 controller/src/schemas/imaging.ts:93-99 — `export const jingleCreateSchema = z.object({ text: … })` — mirrored module; may import only `zod`.
E3 controller/src/broadcast/jingles.ts:96,104 — `export async function create(text: string, { builtin = false } …)` / `await speak(text, { kind: 'jingle', outPath });` — no persona, no voice.
E4 controller/src/audio/tts.ts:28-30 — `// Kinds NOT voiced by the on-air persona: they use the global defaultEngine.` `const GLOBAL_VOICE_KINDS = new Set(['jingle', 'default']);` — why a jingle ignores any persona.
E5 controller/src/audio/tts.ts:34-36,41-45 — `personaFor(persona) { return persona ?? settings.getEffectivePersona(); }` / `djPersonaTts: if (GLOBAL_VOICE_KINDS.has(kind)) return null; … return resolvePersonaVoiceSlot(slot, settings.get().tts);` — the one seam that resolves a slot (incl. `inherit`).
E6 controller/src/audio/tts.ts:440-442 — `speak(text, { kind = 'default', outPath, speedScale, persona })` — `persona` already exists; :446-448, :460, :477, :486-488, :498 — seven `GLOBAL_VOICE_KINDS.has(kind) ? … : personaFor(persona)…` ternaries; :195-197 — `speechPaceScale` zeroes persona speed and daypart for global kinds.
E7 controller/src/audio/tts.ts:368-371 — `// Synthetic persona so speakWith()'s per-engine branches pick up the requested voice/provider.` `const personaTts = { engine, voice, cloudProvider };` — a bare `{ tts }` object is an accepted persona.
E8 controller/src/schemas/persona.ts:237-242 — `ttsVoiceSlotSchema(where, opts?: { allowInherit })` … `.optional() so an ABSENT block reaches the transform and is refused` — reusable validator; absence must be gated by hand, not by `.optional()`. :117 `PERSONA_TTS_INHERIT = 'inherit'`; :820-825 `resolvePersonaVoiceSlot` returns the slot unchanged unless `inherit`.
E9 controller/eslint.config.mjs:26-27,45 — `files: ['src/schemas/*.ts'], ignores: ['src/schemas/*-server.ts']` / `import only from "zod". Put anything else in a *-server.ts sibling.` — so the slot cannot be added inside `imaging.ts`.
E10 controller/src/middleware/validate.ts:27-38 — `validateBody` answers `{ error: flatError(..), fieldErrors: flattenIssues(r.error) }` and rewrites `req.body` — any schema, including an extended one.
E11 web/components/admin/imaging/JinglesSection.tsx:47-63 — `JingleCreateModal` holds `useZodForm(jingleCreateSchema, { text: '' })` and calls `createJingle(values)`; :70 `sub="we'll voice it in your station's configured TTS voice"`; :31-45 the section already receives `data: SettingsData` and `adminFetch`; :432-434 the modal mount.
E12 web/components/admin/imaging/ImagingPanel.tsx:138-149 — `createJingle = async (values: { text: string })` → `body: JSON.stringify(values)` — passes through whatever it is given.
E13 web/components/admin/tts/EngineVoiceFields.tsx:35-39 — `interface VoiceSlot { engine; voice; cloudProvider }`; :85-111 — `data: EngineVoiceData | null`, `unavailableNote` required, `allowInherit`, `inheritResolvesTo?: VoiceSlot | null` ("What 'inherit' resolves to … caller-supplied").
E14 web/components/admin/personas/PersonaVoiceCard.tsx:64-79 — the Personas pickers: `<EngineVoiceFields value={tts} onChange={patch => field.onChange({ ...tts, ...patch })} data={data} adminFetch={adminFetch} … allowInherit inheritResolvesTo={resolved ?? null}`; web/components/admin/personas/helpers.ts:7,20 — `resolvePersonaVoiceSlot` is already imported from `schemas.generated`.
E15 web/components/admin/settings/TtsSection.tsx:1633-1640 — `<EngineVoiceFields value={form.tts.fallback} onChange={…setForm…} data={data} adminFetch={adminFetch}` — plain-state (non-RHF) usage with `data: SettingsData`; web/components/admin/settings/shared.tsx:465-475 `values.tts { defaultEngine, cloud }`, :542 `tts?`, :580 `env?` — SettingsData already satisfies `EngineVoiceData` and `StationVoiceDefaults`.
E16 web/components/admin/tts/engineMeta.ts:46-49 — `INHERIT_ENGINE = { id: 'inherit', label: 'Station default', … }` — "standard röst" is a row the picker already has.
E17 controller/scripts/remote-tts-speed.test.ts:22-28,38-49,95-100 — settings.json with `defaultEngine: 'remote'`, a `globalThis.fetch` stub capturing `body`, `await remoteTts.refresh()`, then `tts.speak('…', { kind: 'default', … })` — the pattern that drives the dispatcher end to end without engines.
E18 Scope: controller/src/schemas/imaging.ts:68-90 — sfx/beds take a `prompt` (sound/music generation, no voice); controller/src/broadcast/jingles.ts:171-201 — `ensureDefaultIdent` copies the prebaked WAV, TTS only when the asset is missing, at boot, no operator; no re-render route exists (routes/jingles.ts:15-94). Fork-only talk pool (`controller/src/broadcast/talk-pool.ts:115-116` on the deploy branch) already does `speak(text, { kind: 'station-id', persona, … })`.
E19 controller/src/broadcast/queue.ts:2377,2623,3152 — every caller passing `persona` uses a DJ kind (`kind`, `item.introKind || 'dj-speak'`); `git grep "'default'" -- controller/src/broadcast/queue.ts` is empty — no existing caller pairs `persona` with a global kind, so E4's semantics change reaches jingles only.
E20 `git diff --stat upstream/develop...feat/show-scoped-jingles` — touches routes/jingles.ts (import line 9), broadcast/jingles.ts (`create()` tail, line 113), JinglesSection.tsx (props block `@@ -40,10 +41,70`), ImagingPanel.tsx — same files, different hunks.

## Changes
- Branch: `feat/jingle-voice` off `upstream/develop`, independent of `feat/show-scoped-jingles` (E20). Merge both into the fork deploy branch; expect hand-resolved overlaps in routes/jingles.ts imports, jingles.ts `create()`, JinglesSection props/`JinglesSection()` signature, ImagingPanel `createJingle`.
- controller/src/audio/tts.ts — an explicit `persona` always voices the segment; `GLOBAL_VOICE_KINDS` only suppresses the implicit on-air persona (E4, E19). `personaFor(kind, persona)` → `persona ?? (GLOBAL_VOICE_KINDS.has(kind) ? null : settings.getEffectivePersona())`; `djPersonaTts` drops its kind guard and resolves `personaFor(kind, persona)?.tts` (E5); in `speak()` compute `const speaking = personaFor(kind, persona)` once and collapse the seven ternaries to `speaking ? … : …` (E6); `speechPaceScale` applies `personaTts.speed` when a slot is present but keeps the daypart factor off for global kinds (E6:195-197). Reword the E4 comment.
- controller/src/broadcast/jingles.ts — `create(text, { builtin = false, tts }: { builtin?: boolean; tts?: TtsVoiceSlot })` → `speak(text, { kind: 'jingle', outPath, persona: tts ? { tts } : undefined })` (E3, E7). Nothing stored.
- controller/src/schemas/imaging-server.ts (new, ~10 lines) — `jingleCreateBodySchema = jingleCreateSchema.extend({ tts: z.unknown().transform((raw, ctx) => raw == null ? undefined : <ttsVoiceSlotSchema('tts', { allowInherit: true }).safeParse(raw), forwarding issues to ctx>) })` (E8, E9). Absent/null = station default; `inherit` resolves to it anyway (E8:820-825).
- controller/src/routes/jingles.ts — `validateBody(jingleCreateBodySchema)`; `const { text, tts } = req.body`; `jingles.create(text, { tts })` (E1, E10). Text-only callers (onboarding, CLI, MCP) are unchanged.
- web/components/admin/imaging/JinglesSection.tsx — `JingleCreateModal` gets `data` and `adminFetch` (E11:31-45); holds `const [tts, setTts] = useState<VoiceSlot>({ engine: INHERIT_ENGINE.id, voice: '', cloudProvider: 'openai' })` (E15 pattern, E16); renders `<EngineVoiceFields value={tts} onChange={p => setTts({ ...tts, ...p })} data={data} adminFetch={adminFetch} allowInherit inheritResolvesTo={resolvePersonaVoiceSlot(tts, data?.values?.tts ?? null) ?? null} unavailableNote={…} engineHint={…} inheritNote={…} />` (E13, E14); submits `createJingle({ ...values, tts })` — always sent, an older controller's `z.object` strips it; `sub` becomes "station default voice, or pick one" (E11:70). `createJingle` prop type widens to `{ text: string; tts?: VoiceSlot }`.
- web/components/admin/imaging/ImagingPanel.tsx — `createJingle(values: { text: string; tts?: VoiceSlot })` (E12). No query/key change.
- controller/scripts/jingle-voice.test.ts (new) — the Check below (E17 pattern).
- controller/CLAUDE.md — one sentence on the `broadcast/jingles.js` bullet: `POST /jingles` takes an optional `tts` slot (persona shape, `inherit` allowed); absent = station default.

## Check
```
cd controller && npx tsx --test scripts/jingle-voice.test.ts && npm run lint && cd ../web && npm run lint
```
`jingle-voice.test.ts`: settings.json `tts.defaultEngine: 'remote'` + fetch stub (E17). Asserts (1) `speak('Station ident.', { kind: 'jingle', persona: { tts: { engine: 'remote', voice: 'ident-voice', cloudProvider: 'openai', gainDb: 0, speed: 1 } } })` posts `body.voice === 'ident-voice'`; (2) `speak('Station ident.', { kind: 'jingle' })` posts a voice that is not `'ident-voice'`; (3) `jingleCreateBodySchema.parse({ text: 'x' }).tts === undefined`, `parse({ text: 'x', tts: null }).tts === undefined`, `safeParse({ text: 'x', tts: { engine: 'nope' } })` fails with an issue whose path is `['tts']`.

## Deferred (YAGNI)
- Persist the slot in `jingles.json` (+ `list()` "voiced by" badge, `restoreMeta` carry) — reopen when a re-render/regenerate action or a per-row voice label is asked for.
- Re-render an existing jingle in another voice — reopen on request; today: create a new one with the same text, delete the old.
- Pick a persona (id) instead of a slot — reopen if operators want "voice this as <persona>"; the slot already reaches any persona's voice by picking the same engine/voice.
- SFX/beds voice choice — not a gap, they are prompt→audio with no voice (E18).
- Default ident voice — not a gap, boot-time prebaked asset (E18).

## Open questions
- Slot (recommended; literal ask "standard röst eller dropdown pickers som finns under personas", and it reaches voices no persona uses) vs persona id. If persona id: schemas/imaging.ts gains `personaId: z.string().optional()` (mirrorable, no `-server` file), the route looks the id up in `settings.get().personas` (400 on miss), and the modal uses a bound `SelectField` over `data.values.personas` instead of `EngineVoiceFields` — Changes 4-7 differ.
