// A jingle's show list (#1875): where it is stored, what it does to the mixer's
// playlist, and the two paths that rebuild jingle records and could lose it.
//
// Run: npm test -- jingle-shows (auto-discovered by npm test).
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempDir } from './test-utils/temp-dir.js';

const STATE = createTempDir(join(tmpdir(), 'subwave-jingle-shows-'));
process.env.STATE_DIR = STATE;
process.env.ADMIN_USER = 'operator';
process.env.ADMIN_PASS = 'admin-secret';

const express = (await import('express')).default;
const jingles = await import('../src/broadcast/jingles.js');
const settings = await import('../src/settings.js');
const { router } = await import('../src/routes/jingles.js');

const DIR = join(STATE, 'jingles');
const sidecar = () => JSON.parse(readFileSync(join(STATE, 'jingles.json'), 'utf8')).items;
const playlist = () => readFileSync(join(STATE, 'jingles.m3u'), 'utf8').split('\n').filter(Boolean).map(l => l.split('/').pop());

function seed(items: Record<string, unknown>) {
  mkdirSync(DIR, { recursive: true });
  for (const name of Object.keys(items)) writeFileSync(join(DIR, name), 'RIFF');
  writeFileSync(join(STATE, 'jingles.json'), JSON.stringify({ items }));
}

test('the list is stored on the sidecar entry, and the mixer playlist holds open jingles only', async () => {
  seed({
    'open.wav': { text: 'open', createdAt: '2026-01-01T00:00:00Z' },
    'lunch.wav': { text: 'lunch', createdAt: '2026-01-02T00:00:00Z' },
  });
  assert.deepEqual((await jingles.list()).map(j => [j.filename, j.showIds]), [['lunch.wav', []], ['open.wav', []]]);

  assert.deepEqual(await jingles.setShows('lunch.wav', ['lunch_show', 'lunch_show', '']), { filename: 'lunch.wav', showIds: ['lunch_show'] });
  assert.deepEqual(sidecar()['lunch.wav'].showIds, ['lunch_show']);
  assert.deepEqual(playlist(), ['open.wav'], 'a tied jingle left the mixer playlist');
  assert.deepEqual((await jingles.list()).find(j => j.filename === 'lunch.wav')?.showIds, ['lunch_show']);

  await jingles.setShows('lunch.wav', []);
  assert.equal('showIds' in sidecar()['lunch.wav'], false, 'cleared is absent, the shape every older sidecar has');
  assert.deepEqual(playlist().sort(), ['lunch.wav', 'open.wav'], 'and it is back in the playlist');
  await assert.rejects(() => jingles.setShows('nope.wav', []), /unknown jingle/);
});

test('a backup restore keeps each jingle\'s shows and drops anything that is not an id', async () => {
  seed({ 'a.wav': {}, 'b.wav': {}, 'c.wav': {} });
  await jingles.restoreMeta({ items: {
    'a.wav': { text: 'a', showIds: ['lunch_show', 7, null, 'late_show'] },
    'b.wav': { text: 'b', showIds: 'lunch_show' },
    'c.wav': { text: 'c' },
  } });
  assert.deepEqual(sidecar()['a.wav'].showIds, ['lunch_show', 'late_show']);
  assert.equal('showIds' in sidecar()['b.wav'], false, 'a malformed list reads as every show, never as a guess');
  assert.deepEqual(playlist().sort(), ['b.wav', 'c.wav']);
});

test('the boot refresh of the built-in ident replaces the audio and keeps its shows', async () => {
  seed({ 'station_ident_default.wav': { text: 'old render', builtin: true, source: 'tts', createdAt: '2025-01-01T00:00:00Z', showIds: ['late_show'] } });
  await jingles.ensureDefaultIdent();
  const ident = sidecar()['station_ident_default.wav'];
  assert.equal(ident.source, 'builtin', 'the bundled asset was not installed, so this test proves nothing');
  assert.deepEqual(ident.showIds, ['late_show']);
  assert.equal(ident.createdAt, '2025-01-01T00:00:00Z');
});

const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());
const put = (name: string, body: unknown) => fetch(`${base}/jingles/${name}/shows`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from('operator:admin-secret').toString('base64')}` },
  body: JSON.stringify(body),
});

test('the route saves ids from the roster and refuses one that is not on it', async () => {
  seed({ 'lunch.wav': { text: 'lunch' } });
  const current = settings.get();
  await settings.update({
    shows: [...(current.shows ?? []), { id: 'lunch_show', name: 'Lunch', personaId: current.personas[0].id }],
  } as never);

  const ok = await put('lunch.wav', { showIds: ['lunch_show'] });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { filename: 'lunch.wav', showIds: ['lunch_show'] });

  const bad = await put('lunch.wav', { showIds: ['lunch_show', 'gone_show'] });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { fieldErrors: { showIds: string } }).fieldErrors.showIds, /unknown show: gone_show/);
  assert.deepEqual(sidecar()['lunch.wav'].showIds, ['lunch_show'], 'a refused save changed nothing');

  assert.equal((await put('nope.wav', { showIds: [] })).status, 404);
  assert.equal((await put('lunch.wav', { showIds: 'lunch_show' })).status, 400);
  assert.equal((await fetch(`${base}/jingles/lunch.wav/shows`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"showIds":[]}' })).status, 401);
});
