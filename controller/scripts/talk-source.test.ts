// Where a scheduled station ident comes from (settings.talkSource) and the
// pre-rendered pool it can be drawn from.
//
// Run: npm test -- talk-source (auto-discovered by npm test).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createTempDir } from './test-utils/temp-dir.js';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const STATE = createTempDir(join(tmpdir(), 'subwave-talk-source-'));
process.env.STATE_DIR = STATE;

const { talkSourceOf, pickTalkSource } = await import('../src/broadcast/talk-source.js');
const talkPool = await import('../src/broadcast/talk-pool.js');
const { stationIdPrompt } = await import('../src/llm/internal/prompts/scripts.js');
const settings = await import('../src/settings.js');
const { setCache } = await import('../src/settings/store.js');

test('absent or malformed reads as live', () => {
  for (const bad of [undefined, null, {}, { talkSource: 'Pool' }, { talkSource: 1 }]) {
    assert.equal(talkSourceOf(bad as never), 'live');
  }
  assert.equal(talkSourceOf({ talkSource: 'mix' }), 'mix');
  assert.equal(talkSourceOf({ talkSource: 'pool' }), 'pool');
});

test('the key survives a COLD LOAD and a bad patch is refused', async () => {
  setCache(null);
  assert.equal((await settings.load()).talkSource, 'live', 'default keeps the station as it was');
  await settings.update({ talkSource: 'pool' });
  setCache(null);
  assert.equal((await settings.load()).talkSource, 'pool');
  await assert.rejects(() => settings.update({ talkSource: 'bogus' }));
  await settings.update({ talkSource: 'live' });
});

test('mix splits evenly, and leans on the pool once the budget is spent', () => {
  assert.equal(pickTalkSource({ mode: 'live', budgetNormal: false }), 'live');
  assert.equal(pickTalkSource({ mode: 'pool', budgetNormal: true }), 'pool');
  assert.equal(pickTalkSource({ mode: 'mix', budgetNormal: true, rand: () => 0.49 }), 'pool');
  assert.equal(pickTalkSource({ mode: 'mix', budgetNormal: true, rand: () => 0.5 }), 'live');
  assert.equal(pickTalkSource({ mode: 'mix', budgetNormal: false, rand: () => 0.99 }), 'pool');
});

test('a pooled ident is written without anything that dates it', () => {
  const ctx = { clock: { spokenDaypart: 'in the afternoon' } };
  assert.match(stationIdPrompt({ context: ctx }), /in the afternoon/);
  const timeless = stationIdPrompt({ context: null, timeless: true });
  assert.doesNotMatch(timeless, /nod to the clock/);
  assert.match(timeless, /Never mention the time of day/);
});

test('a draw is a copy, in the persona\'s current voice, never the same clip twice running', async () => {
  const persona = { id: 'p1', name: 'Jocke', tts: null };
  const key = talkPool.voiceKeyFor(persona);
  const dir = join(STATE, 'talk-pool');
  mkdirSync(dir, { recursive: true });
  const clip = (filename: string, voiceKey: string) => {
    writeFileSync(join(dir, filename), filename);
    return { filename, text: `text of ${filename}`, voiceKey, createdAt: '2026-01-01T00:00:00Z' };
  };
  writeFileSync(join(STATE, 'talk-pool.json'), JSON.stringify({
    p1: [clip('a.mp3', key), clip('b.mp3', key), clip('old.mp3', 'another voice')],
  }));

  assert.equal(await talkPool.draw({ id: 'nobody' }), null, 'an empty pool is a miss, not an error');
  let last = '';
  for (let i = 0; i < 12; i++) {
    const drawn = await talkPool.draw(persona);
    assert.ok(drawn);
    assert.notEqual(drawn.text, last, 'repeated a clip while another was available');
    assert.notEqual(drawn.text, 'text of old.mp3', 'drew a clip rendered in a voice the persona no longer has');
    assert.notEqual(dirname(drawn.wavPath), dir, 'handed the air path the pool\'s own file');
    assert.ok(drawn.wavPath.endsWith('.mp3') && existsSync(drawn.wavPath));
    last = drawn.text;
  }
  assert.ok(existsSync(join(dir, 'a.mp3')) && existsSync(join(dir, 'b.mp3')));

  assert.equal(await talkPool.clear('p1'), 3);
  assert.equal(await talkPool.draw(persona), null);
  assert.ok(!existsSync(join(dir, 'a.mp3')));
});

test('the voice key is the audible voice and nothing else of the station block', async () => {
  await settings.update({ tts: { cloud: { apiKey: 'sk-secret-key', voice: 'station-voice', provider: 'elevenlabs' } } });
  const explicit = { id: 'a', tts: { engine: 'cloud', cloudProvider: 'elevenlabs', voice: 'v1', gainDb: 0, speed: 1 } };
  assert.equal(talkPool.voiceKeyFor(explicit), 'cloud|elevenlabs|v1');
  assert.equal(
    talkPool.voiceKeyFor({ ...explicit, tts: { ...explicit.tts, gainDb: 4, speed: 1.2 } }), 'cloud|elevenlabs|v1',
    'a level or pace trim must not orphan the pool',
  );
  assert.notEqual(talkPool.voiceKeyFor({ ...explicit, tts: { ...explicit.tts, voice: 'v2' } }), 'cloud|elevenlabs|v1');
  for (const p of [explicit, { id: 'b', tts: null }, { id: 'c', tts: { engine: 'inherit' } }]) {
    assert.doesNotMatch(talkPool.voiceKeyFor(p), /sk-secret-key/);
  }
});

test('rendering keeps the newest twenty, drops other voices, and two hosts do not lose each other\'s clips', async () => {
  const dir = join(STATE, 'talk-pool');
  const voice = join(STATE, 'voice');
  mkdirSync(voice, { recursive: true });
  // Real personas: a pool for an id settings does not know is pruned.
  const [one, two = null] = settings.get().personas as { id: string }[];
  let n = 0;
  const make = async (persona: { id: string }) => {
    const path = join(voice, `${persona.id}-${n++}.mp3`);
    writeFileSync(path, 'x');
    await new Promise(r => setTimeout(r, 1));
    return { text: `line ${n}`, path };
  };
  const read = () => JSON.parse(readFileSync(join(STATE, 'talk-pool.json'), 'utf8'));

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stale.mp3'), 'x');
  writeFileSync(join(dir, 'ghost.mp3'), 'x');
  writeFileSync(join(STATE, 'talk-pool.json'), JSON.stringify({
    [one.id]: [{ filename: 'stale.mp3', text: 'old voice', voiceKey: 'gone', createdAt: '' }],
    deleted_persona: [{ filename: 'ghost.mp3', text: 'ghost', voiceKey: 'x', createdAt: '' }],
  }));

  const logs: string[] = [];
  const [a, b] = await Promise.all([
    talkPool.render(one, 12, m => logs.push(m), make),
    two ? talkPool.render(two, 12, m => logs.push(m), make) : 0,
    talkPool.clear(one.id).then(r => assert.equal(r, null, 'a clear during a render must be refused')),
  ]);
  assert.equal(a, 12);
  const meta = read();
  assert.equal(meta[one.id].length, 12);
  if (two) { assert.equal(b, 12); assert.equal(meta[two.id].length, 12, 'an interleaved save dropped clips'); }
  assert.ok(!('deleted_persona' in meta) && !existsSync(join(dir, 'ghost.mp3')), 'a deleted persona keeps its pool');
  assert.ok(!existsSync(join(dir, 'stale.mp3')), 'a clip in a voice the persona no longer has was kept');
  assert.equal(readdirSync(voice).filter(f => f.startsWith(one.id)).length, 0, 'the rendered file was left in the voice dir');

  assert.equal(await talkPool.render(one, 12, () => {}, make), 12);
  const after = read()[one.id];
  assert.equal(after.length, talkPool.TALK_POOL_MAX);
  assert.equal(after.at(-1).text, `line ${n}`, 'eviction dropped the newest instead of the oldest');
  assert.equal(readdirSync(dir).length, Object.values(read()).flat().length, 'a file outlived its entry');
  assert.deepEqual((await talkPool.counts()).find((c: { personaId: string }) => c.personaId === one.id)?.count, talkPool.TALK_POOL_MAX);
});
