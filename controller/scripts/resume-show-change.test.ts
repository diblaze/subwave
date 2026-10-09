// What the queue does when the programme resumes into a different show than
// the one it paused in (stream-idle.ts reports it; server.ts calls this after
// the fallback has been rebuilt and reloaded).
//
// Run: npm test -- resume-show-change

import assert from 'node:assert/strict';
import test from 'node:test';
import { queue } from '../src/broadcast/queue.js';

// Same neutralisation the other queue tests use.
(queue as any).persist = () => {};
(queue as any).drainToLiquidsoap = async () => {};

const item = (id: string, extra: Record<string, unknown> = {}) =>
  ({ track: { id, title: id, artist: 'x' }, sent: false, ...extra }) as any;

function onAir(current: any, upcoming: any[]) {
  queue.current = current;
  queue.upcoming = upcoming;
}

test('picks made for the earlier show are dropped and the frozen track is skipped', async () => {
  onAir(item('frozen'), [item('a'), item('b')]);
  let skips = 0;
  const result = await queue.dropProgrammeFromEarlierShow(queue.snapshotProgramme(), async () => { skips += 1; });
  assert.deepEqual(queue.upcoming, []);
  assert.equal(skips, 1);
  assert.deepEqual(result, { dropped: 2, kept: 0, skipped: true });
});

test('a request someone asked for survives, on air or queued', async () => {
  const asked = item('asked', { requestedBy: 'Anna' });
  const studio = item('studio', { requestedBy: 'studio', operator: true });
  onAir(item('requested-on-air', { requestedBy: 'Anna' }), [item('a'), asked, studio]);
  let skips = 0;
  const result = await queue.dropProgrammeFromEarlierShow(queue.snapshotProgramme(), async () => { skips += 1; });
  assert.deepEqual(queue.upcoming, [asked, studio]);
  assert.equal(skips, 0, 'a requested track on air plays out');
  assert.deepEqual(result, { dropped: 1, kept: 0, skipped: false });
});

test('what the new show picked while the fallback rebuilt is left alone', async () => {
  onAir(item('frozen'), [item('old')]);
  const stale = queue.snapshotProgramme();
  // The rebuild takes seconds: the frozen track ends and the new show picks.
  const fresh = item('fresh');
  onAir(item('new-show-track'), [fresh]);
  let skips = 0;
  const result = await queue.dropProgrammeFromEarlierShow(stale, async () => { skips += 1; });
  assert.deepEqual(queue.upcoming, [fresh]);
  assert.equal(skips, 0, 'the track now on air belongs to the new show');
  assert.deepEqual(result, { dropped: 0, kept: 0, skipped: false });
});

test('a pick the mixer will not give back is reported as kept', async () => {
  const stuck = item('stuck');
  onAir(item('frozen'), [stuck]);
  const stale = queue.snapshotProgramme();
  (queue as any).removeUpcomingItem = async () => ({ ok: false, reason: 'already-playing' });
  try {
    const result = await queue.dropProgrammeFromEarlierShow(stale, async () => {});
    assert.deepEqual(result, { dropped: 0, kept: 1, skipped: true });
  } finally {
    delete (queue as any).removeUpcomingItem;
  }
});

test('a failed skip is reported, not thrown', async () => {
  onAir(item('frozen'), [item('a')]);
  const result = await queue.dropProgrammeFromEarlierShow(queue.snapshotProgramme(), async () => { throw new Error('telnet down'); });
  assert.deepEqual(result, { dropped: 1, kept: 0, skipped: false });
});
