// Pre-rendered station idents, per persona. Clips live under
// <stateDir>/talk-pool/ (outside the voice dir, whose reaper deletes after an
// hour) with their text and voice in the <stateDir>/talk-pool.json sidecar.
// A draw hands the air path a COPY, so evicting or clearing a clip can never
// pull the file out from under one that is waiting for its track boundary.

import { readFile, mkdir, unlink, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { extname } from 'node:path';
import { speak } from '../audio/tts.js';
import { measureClipLevel } from '../audio/clip-level.js';
import { config, STATE_DIR } from '../config.js';
import * as settings from '../settings.js';
import * as dj from '../llm/dj.js';
import { resolvePersonaVoiceSlot } from '../schemas/persona.js';
import { ttsCalls } from '../stats.js';
import { writeFileAtomic } from '../util/atomic-file.js';
import { pickRotateJingle } from './jingle-rotate.js';

const DIR = `${STATE_DIR}/talk-pool`;
const META = `${STATE_DIR}/talk-pool.json`;

export const TALK_POOL_MAX = 20;
export const TALK_POOL_BATCH = 10;

interface PoolClip { filename: string; text: string; voiceKey: string; createdAt: string }
type PoolMeta = Record<string, PoolClip[]>;
interface PoolPersona { id: string; name?: string; tts?: unknown }

async function loadMeta(): Promise<PoolMeta> {
  try {
    return JSON.parse(await readFile(META, 'utf8'));
  } catch {
    return {};
  }
}

// Every read-modify-write of the sidecar goes through this one chain: two
// personas render at once, and an interleaved save would drop a clip's entry
// and strand its file. `change` returns the clips whose files should go.
let metaChain: Promise<unknown> = Promise.resolve();
function changeMeta(change: (meta: PoolMeta) => PoolClip[]): Promise<number> {
  const run = metaChain.then(async () => {
    const meta = await loadMeta();
    const dropped = change(meta);
    await writeFileAtomic(META, JSON.stringify(meta, null, 2));
    await Promise.all(dropped.map(c => unlink(`${DIR}/${c.filename}`).catch(() => {})));
    return dropped.length;
  });
  metaChain = run.catch(() => {});
  return run;
}

// The voice a listener would hear from this persona: engine, cloud provider and
// the voice id, with a blank voice filled from the station default the way
// audio/tts.ts speakWith fills it. Gain and speed are dials, not identity, and
// nothing else of the station block (API keys live there) is ever written out.
export function voiceKeyFor(persona: PoolPersona): string {
  const station: any = settings.get().tts ?? {};
  const slot: any = resolvePersonaVoiceSlot(persona.tts as never, station);
  const engine: string = slot?.engine || station.defaultEngine || 'piper';
  const stationVoice = ({
    cloud: station.cloud?.voice,
    gemini: station.gemini?.voice,
    kokoro: station.kokoro?.voice,
    chatterbox: station.chatterbox?.referenceVoice,
    'pocket-tts': station.pocketTts?.voice,
  } as Record<string, unknown>)[engine];
  const provider = engine === 'cloud' ? (slot?.cloudProvider || station.cloud?.provider || '') : '';
  return [engine, provider, slot?.voice || stationVoice || ''].join('|');
}

const usable = (clips: PoolClip[] | undefined, key: string) =>
  (clips ?? []).filter(c => c.voiceKey === key && existsSync(`${DIR}/${c.filename}`));

const rendering = new Set<string>();

// A pooled ident airs on any day, at any hour, in any show. The prompt says so
// and the model still dates about two lines in five ("mitt på
// lördagseftermiddagen", "det är natt"), so a line that names a day, a part of
// the day, a month or a season is thrown away and written again. Swedish and
// English, because those are the languages this fork's station speaks.
// ponytail: a fixed word list; move it to a persona-language table if a third language needs it.
// Stems match anywhere, because Swedish compounds them ("lördagseftermiddagen",
// "nattens"); the short words need a boundary so "maj" does not catch "majoritet".
const DATED_STEM = /måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|morgon|morron|förmiddag|eftermiddag|kväll|natt|helg|januari|februari|augusti|september|oktober|november|december|sommar|höst|vinter|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|tonight|morning|afternoon|evening|midnight/i;
const DATED_WORD = /\b(idag|i dag|i morse|lunch\w*|mars|april|maj|juni|juli|jul|julen|today|night|summer|autumn|winter)\b/i;
export const isDatedIdent = (text: string): boolean => DATED_STEM.test(text) || DATED_WORD.test(text);
const DATED_RETRIES = 3;

export async function counts() {
  const meta = await loadMeta();
  return (settings.get().personas ?? []).map((p: PoolPersona) => ({
    personaId: p.id,
    personaName: p.name ?? p.id,
    count: usable(meta[p.id], voiceKeyFor(p)).length,
    rendering: rendering.has(p.id),
  }));
}

const lastDrawn = new Map<string, string>();

export async function draw(persona: PoolPersona | null | undefined): Promise<{ text: string; wavPath: string } | null> {
  if (!persona?.id) return null;
  const clips = usable((await loadMeta())[persona.id], voiceKeyFor(persona));
  const filename = pickRotateJingle(clips.map(c => c.filename), lastDrawn.get(persona.id) ?? null);
  const clip = clips.find(c => c.filename === filename);
  if (!clip) return null;
  lastDrawn.set(persona.id, clip.filename);
  await mkdir(config.piper.outDir, { recursive: true });
  const wavPath = `${config.piper.outDir}/pool_${crypto.randomBytes(6).toString('hex')}${extname(clip.filename)}`;
  await copyFile(`${DIR}/${clip.filename}`, wavPath);
  // The copy is a new path, so it is measured again for the handoff's trim.
  await measureClipLevel(wavPath);
  return { text: clip.text, wavPath };
}

// One ident, written and voiced. Returns null when the engine fell back to a
// rescue voice: that clip would air as the wrong voice for as long as it stayed
// in the pool, so it is thrown away instead.
async function renderOne(persona: PoolPersona, openers: string[]): Promise<{ text: string; path: string } | null> {
  let text = '';
  for (let attempt = 0; attempt <= DATED_RETRIES; attempt++) {
    text = (await dj.generateStationId({ persona, timeless: true, recentOpeners: openers }))?.trim() ?? '';
    if (text && !isDatedIdent(text)) break;
    text = '';
  }
  if (!text) throw new Error('every attempt named a day, a time or a season');
  const started = Date.now();
  // No outPath: each engine picks its own container (wav or mp3). The persona's
  // own speed, not the daypart's: this clip airs at any hour.
  const slot: any = resolvePersonaVoiceSlot(persona.tts as never, settings.get().tts);
  const path = await speak(text, { kind: 'station-id', persona, speedScale: settings.clampTtsSpeed(slot?.speed ?? 1) });
  // ponytail: speak() returns only a path, so the fallback is read off the TTS
  // ring by kind and time; return it from speak() if a second caller needs it.
  const call = ttsCalls.find(c => c.kind === 'station-id' && c.ok && Date.parse(c.t) >= started);
  if (call?.fellBack) {
    await unlink(path).catch(() => {});
    throw new Error(`${call.requested ?? 'the voice engine'} was unavailable (fell back to ${call.engine})`);
  }
  return { text, path };
}

// Writes and voices `count` idents for one persona, one at a time. Each prompt
// carries the openers already in the pool so the lines do not all start alike.
// `make` is the seam the test renders through.
export async function render(
  persona: PoolPersona,
  count: number,
  log: (msg: string) => void = () => {},
  make: typeof renderOne = renderOne,
): Promise<number> {
  if (rendering.has(persona.id)) return 0;
  rendering.add(persona.id);
  const name = persona.name ?? persona.id;
  let made = 0;
  try {
    await mkdir(DIR, { recursive: true });
    const voiceKey = voiceKeyFor(persona);
    for (let i = 0; i < count; i++) {
      try {
        const have = usable((await loadMeta())[persona.id], voiceKey);
        const clip = await make(persona, have.map(c => c.text.split(/\s+/).slice(0, 5).join(' ')));
        if (!clip) continue;
        const filename = `${crypto.randomBytes(6).toString('hex')}${extname(clip.path) || '.wav'}`;
        // Copy, not rename: PIPER_OUT may sit on another filesystem.
        await copyFile(clip.path, `${DIR}/${filename}`);
        await unlink(clip.path).catch(() => {});
        await changeMeta(meta => {
          const live = new Set((settings.get().personas ?? []).map((p: PoolPersona) => p.id));
          const gone = Object.keys(meta).filter(id => !live.has(id)).flatMap(id => meta[id].splice(0));
          for (const id of Object.keys(meta)) if (!live.has(id)) delete meta[id];
          const all = meta[persona.id] ?? [];
          const kept = [...all.filter(c => c.voiceKey === voiceKey), { filename, text: clip.text, voiceKey, createdAt: new Date().toISOString() }];
          const evicted = kept.splice(0, Math.max(0, kept.length - TALK_POOL_MAX));
          meta[persona.id] = kept;
          return [...gone, ...all.filter(c => c.voiceKey !== voiceKey), ...evicted];
        });
        made++;
      } catch (err) {
        log(`Talk pool: a clip for ${name} failed — ${(err as Error).message}`);
      }
    }
  } finally {
    rendering.delete(persona.id);
  }
  log(`Talk pool: rendered ${made}/${count} for ${name}`);
  return made;
}

// null while that persona is rendering: the next clip would undo the clear.
export async function clear(personaId: string): Promise<number | null> {
  if (rendering.has(personaId)) return null;
  lastDrawn.delete(personaId);
  return changeMeta(meta => {
    const clips = meta[personaId] ?? [];
    delete meta[personaId];
    return clips;
  });
}
