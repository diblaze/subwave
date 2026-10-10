// Where a scheduled station ident comes from (settings.talkSource): written and
// rendered when it airs, or drawn from the pre-rendered pool in talk-pool.ts.
// Pure policy, shared by settings.load() and scheduler.talkTick.

import type { TalkSource } from '../schemas/settings.js';

// Anything that is not an explicit opt-in reads as live, so an absent key and a
// hand-edited typo both keep the station as it was.
export function talkSourceOf(s: { talkSource?: unknown } | null | undefined): TalkSource {
  return s?.talkSource === 'mix' || s?.talkSource === 'pool' ? s.talkSource : 'live';
}

// What one ident should try first. Over the daily token budget a live ident is
// muted, so `mix` leans on the pool then instead of going quiet.
export function pickTalkSource(p: {
  mode: TalkSource;
  budgetNormal: boolean;
  rand?: () => number;
}): 'live' | 'pool' {
  if (p.mode === 'live') return 'live';
  if (p.mode === 'pool' || !p.budgetNormal) return 'pool';
  return (p.rand ?? Math.random)() < 0.5 ? 'pool' : 'live';
}
