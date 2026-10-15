// Resuming from the idle pause into another show than the frozen track's
// (stream-idle.ts reports it). Split from server.ts so the order is tested:
// snapshot before any await, rebuild the fallback, drop only after a
// confirmed rebuild and reload.
import type { RefreshResult } from './auto-playlist-refresh.js';
import type { QueueItem } from './queue/types.js';
import { showKeyAt } from './show-boundary.js';

type Programme = { current: unknown; upcoming: unknown[] };

// Preserve stamps across schedule edits. Legacy picks use their selection
// forecast, then enqueue time; an untracked fallback has only its start time.
export function programmeShowKey(item: Pick<QueueItem, 'showKey' | 'selectionShowAt' | 'queuedAt' | 'startedAt'> | null): string | null {
  if (!item) return null;
  if (item.showKey) return item.showKey;
  const at = [item.selectionShowAt, Date.parse(item.queuedAt || ''), Date.parse(item.startedAt || '')]
    .find(ms => typeof ms === 'number' && Number.isFinite(ms));
  return at == null ? null : showKeyAt(at);
}

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
