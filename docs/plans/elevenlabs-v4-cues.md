# ElevenLabs v4 audio-tag cues
Status: done
Issue: diblaze/subwave#9 (upstream PR from branch `feat/elevenlabs-v4-cues`, base `upstream/develop`, PR targets `develop`)

FORK-ONLY FILE. Never commit it to a branch that is pushed upstream or included in the PR.

## Goal
A persona whose cloud TTS resolves to `eleven_v4` or `eleven_v4_turbo` gets the same bracketed audio-tag hint, keep-on-primary and strip-on-fallback behaviour as `eleven_v3`, while the v3-only stability snap stays v3-only.

## Evidence
All paths are at `upstream/develop`.

- E1 `controller/src/llm/internal/core/pure.ts:664-669` — `// ElevenLabs eleven_v3* family: bracketed audio tags render as expressive cues, and \`stability\` is discrete (snapV3Stability).` / `export function isElevenLabsV3(model: string): boolean { return /^eleven[_-]?v3/i.test(model || ''); }` — one predicate currently serves two unrelated rules (tags, stability snap). v4 needs the first, not the second.
- E2 `controller/src/llm/internal/core/pure.ts:677-681` — `export function cloudExpressionCueFamily(provider: string, model: string): 'fish-s21' | 'elevenlabs-v3' | null { … if (provider === 'elevenlabs' && isElevenLabsV3(model)) return 'elevenlabs-v3';` — the single gate every tag consumer routes through.
- E3 `controller/src/llm/internal/core/pure.ts:683-685` — `// eleven_v3 only accepts stability ∈ {0, 0.5, 1}; any other value 400s the request.` / `export function snapV3Stability` — verified by the operator on a live station, 2026-10-11: `eleven_v4` and `eleven_v4_turbo` return HTTP 200 with stability 0.3, so they must not be snapped.
- E4 `controller/src/llm/internal/speech/cloud-speech.ts:387` — `stability: isElevenLabsV3(c.model) ? snapV3Stability(c.voiceStability) : c.voiceStability,` — the only other caller of `isElevenLabsV3`; must keep matching v3 only.
- E5 `controller/src/llm/internal/prompts/system.ts:18-29` — `// ElevenLabs v3 renders bracketed audio tags … only eleven_v3* families support this` / `const ELEVENLABS_V3_TAG_HINT = '\n\nYou may sparingly insert non-verbal audio cues in square brackets: [laughs], [sighs], [whispers], [excited]. …'` — the vocabulary is a subset of the v4 list (`[laughs]`, `[whispers]`, `[sighs]`, `[sarcastic]`, `[excited]`, `[crying]`, `[snorts]`), and the ElevenLabs guide states v4 prompting (audio tags included) applies to v3; no vocabulary change needed.
- E6 `controller/src/llm/internal/prompts/system.ts:72-77` — `const cueFamily = cloudExpressionCueFamily(resolveCloudProviderForPersona(persona), cloudModel); … if (cueFamily === 'elevenlabs-v3') return base + ELEVENLABS_V3_TAG_HINT;` — hint keyed on the family string, not on the model.
- E7 `controller/src/audio/tts-fallback.ts:3-9` — `const expressiveRequest = requested === 'chatterbox' || requested === 'gemini' || cloudCueFamily === 'fish-s21' || cloudCueFamily === 'elevenlabs-v3';` — fallback strip keyed on the same family string.
- E8 `controller/src/audio/tts.ts:478-481` and `controller/src/llm/internal/speech/cloud-speech.ts:133-145` — `cloud.requestedCloudExpressionCueFamilyForPersona(speakingPersona)` → `cloudExpressionCueFamily(resolveCloudProvider(…), resolveCloudModel(…))` — runtime strip resolves through E2; no per-caller change.
- E9 `controller/scripts/llm-pure.test.ts:1476-1482` — `await test('cue families require both the matching provider and model family', () => { … assert.equal(cloudExpressionCueFamily('elevenlabs', 'eleven_v3'), 'elevenlabs-v3');` — existing test block to extend. `:1484-1497` pins `isElevenLabsV3` (`eleven_ttv_v3` → false, `eleven_flash_v2_5` → false). `:10` imports the pure helpers under test.
- E10 `controller/scripts/tts-fallback.test.ts:25-29` — `fallbackTextFor('cloud', 'elevenlabs-v3', 'And now [whispers] the deep cut.')` → strips — unchanged if the family string is kept.
- E11 `web/components/admin/settings/TtsSection.tsx:239` — `Note: the <code>eleven_v3</code> model only accepts 0%, 50% or 100%; other values round to the nearest.` — still true and v3-specific; v4 is continuous (E3), so the copy needs no edit.
- E12 `web/lib/cloudVoices.ts:40-42` — `elevenlabs: ['eleven_flash_v2_5', 'eleven_multilingual_v2', 'eleven_turbo_v2_5'],` — suggestion list carries no v3 either; operators type the id. Parity needs no change.
- E13 `CHANGELOG.md:872` + `.release-please-manifest.json` present — changelog is release-please generated; do not hand-edit.
- E14 `AGENTS.md:64-66` — `### Pull requests target \`develop\`, never \`main\`` ; `AGENTS.md:58` — `npm run lint` (`eslint . && tsc --noEmit`) is the merge gate.

## Changes
- `controller/src/llm/internal/core/pure.ts` — add one predicate next to `isElevenLabsV3` (E1): `isElevenLabsAudioTagModel(model)` = `/^eleven[_-]?v[34]/i` (same shape as E1 so `eleven_v3_conversational`, `eleven_v4_turbo` match and `eleven_ttv_v3`, `eleven_flash_v2_5` do not). `cloudExpressionCueFamily` (E2) calls it instead of `isElevenLabsV3`. Reword the E1 comment: `isElevenLabsV3` is now only the stability-snap gate (E3, E4); the new predicate carries the "renders audio tags: v3 and v4, verified by the operator on a live station, 2026-10-11; v4 takes continuous stability so it is deliberately outside isElevenLabsV3" note. Explicit `[34]`, not `[3-9]`: an unannounced future family would otherwise get tags it may read aloud, which is the failure this gate exists to prevent.
- `controller/src/llm/internal/core/pure.ts` — keep the family id `'elevenlabs-v3'` and the union type unchanged (E2). Reason: it is a private tag compared in exactly two places (E6, E7) plus two tests (E9, E10); renaming buys nothing at runtime and touches five files. Add a one-line comment on the union: `'elevenlabs-v3'` means "ElevenLabs audio-tag family (v3 and v4)"; the name is historical.
- `controller/src/llm/internal/prompts/system.ts` — comment only (E5): "only eleven_v3* families" → "eleven_v3* and eleven_v4* families". Constant name and tag vocabulary unchanged (E5: existing four tags are all in v4's documented set). `cloud-speech.ts:387` (E4), `tts-fallback.ts` (E7), `tts.ts` (E8) untouched.
- `controller/scripts/llm-pure.test.ts` — extend E9: add `isElevenLabsAudioTagModel` to the `:10` import; in the `cue families` test add `('elevenlabs', 'eleven_v4') → 'elevenlabs-v3'`, `('elevenlabs', 'eleven_v4_turbo') → 'elevenlabs-v3'`, `('elevenlabs', 'eleven_v5') → null`; in the `isElevenLabsV3` reject test add `isElevenLabsV3('eleven_v4') === false` and `isElevenLabsV3('eleven_v4_turbo') === false` (pins E4 narrow). No new test file.
- Branch `feat/elevenlabs-v4-cues` off `upstream/develop`, one commit `feat(dj): extend ElevenLabs audio-tag cues to eleven_v4 models`, PR against `develop` (E14). No CHANGELOG edit (E13). No station/host/domain names in code, commit or PR.

## Check
`cd /home/denis/git/subwave/controller && npx tsx scripts/llm-pure.test.ts && npx tsx scripts/tts-fallback.test.ts && npm run lint` — fails before the change on `cloudExpressionCueFamily('elevenlabs', 'eleven_v4') === 'elevenlabs-v3'`, and fails after it if `isElevenLabsV3('eleven_v4')` ever becomes true.

## Deferred (YAGNI)
- Add `eleven_v3` / `eleven_v4` / `eleven_v4_turbo` to `CLOUD_MODELS.elevenlabs` (E12) — reopen when an operator reports not finding v4 in the model combobox; today v3 is not listed either and the field accepts free text.
- Widen the hint vocabulary with v4's `[sarcastic]`, `[crying]`, `[snorts]` (E5) — reopen when a persona's scripts would benefit; the gate, not the list, is this change.
- Mention v4 in the stability slider copy (E11) — reopen if an operator on v4 asks why the slider is continuous; the copy is accurate as written.

## Open questions
- Regex breadth: `v[34]` (recommended, fail-closed) vs `v[3-9]` (no code change when ElevenLabs ships v5). If the owner prefers forward-matching, the pure.ts predicate and the `eleven_v5 → null` assertion flip; nothing else changes.
