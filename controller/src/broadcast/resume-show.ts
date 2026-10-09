// Resuming from the idle pause into another show than the frozen track's
// (stream-idle.ts reports it). Split from server.ts so the order is tested:
// snapshot before any await, rebuild the fallback, drop only after a
// confirmed rebuild and reload.
import type { RefreshResult } from './auto-playlist-refresh.js';

type Programme = { current: unknown; upcoming: unknown[] };

export async function resumeIntoAnotherShow<P extends Programme>({ snapshot, rebuild, drop, log }: {
  snapshot: () => P;
  rebuild: () => Promise<RefreshResult>;
  drop: (stale: P) => Promise<unknown>;
  log: (line: string) => void;
}): Promise<boolean> {
  // Before any await: the new show may start picking while the fallback rebuilds.
  const stale = snapshot();
  // The skip must land on the new show's fallback. Liquidsoap holds one
  // prefetched request from the old list until a reload drops it, so do
  // nothing unless the rebuild and its reload both went through.
  if ((await rebuild()) !== 'refreshed') {
    log('show changed while the programme was paused — fallback not rebuilt, leaving the queue as it is');
    return false;
  }
  await drop(stale);
  return true;
}
