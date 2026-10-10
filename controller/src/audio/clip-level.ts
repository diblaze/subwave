// Evens out voice clips. A cloud voice hands back takes that differ by 10 dB
// and more from one line to the next (ElevenLabs measured -13 to -27 LUFS on
// one voice), so one speaker of an exchange lands far under the other and
// under the music. Each rendered clip is measured once, and the handoff to the
// mixer trims it toward one level on top of the operator's own gain.

import { spawn } from 'node:child_process';

export const VOICE_TARGET_LUFS = -18;
// A take further off than this is trimmed only this far: past it the measure
// is more likely wrong (near-silence, a cough) than the take that quiet.
export const VOICE_TRIM_MAX_DB = 12;
// Under this the clip is silence or too short for the meter's gate.
const MEASURABLE_FLOOR_LUFS = -50;
const REMEMBERED = 400;

const levels = new Map<string, number>();

// Integrated loudness from ffmpeg's ebur128 summary, or null when it has none.
export function parseIntegratedLufs(ffmpegStderr: string): number | null {
  const summary = ffmpegStderr.slice(ffmpegStderr.lastIndexOf('Summary:'));
  const m = /\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/.exec(summary);
  if (!m) return null;
  const lufs = Number(m[1]);
  return Number.isFinite(lufs) && lufs > MEASURABLE_FLOOR_LUFS ? lufs : null;
}

export function trimDbFor(lufs: number | null | undefined): number {
  if (lufs == null) return 0;
  const trim = Math.max(-VOICE_TRIM_MAX_DB, Math.min(VOICE_TRIM_MAX_DB, VOICE_TARGET_LUFS - lufs));
  return Math.round(trim * 10) / 10;
}

// Measures a clip and remembers it for levelTrimDb. Never throws and never
// fails a render: no ffmpeg, an unreadable file or a clip too short to meter
// all leave it unmeasured, which airs at the operator's gain as before.
export function measureClipLevel(path: string, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (lufs: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (lufs != null) {
        levels.set(path, lufs);
        if (levels.size > REMEMBERED) levels.delete(levels.keys().next().value as string);
      }
      resolve(lufs);
    };
    const timer = setTimeout(() => { proc?.kill(); finish(null); }, timeoutMs);
    let proc: ReturnType<typeof spawn> | null = null;
    try {
      proc = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-']);
      proc.stderr?.on('data', (chunk) => { out += chunk; });
      proc.on('error', () => finish(null));
      proc.on('close', () => finish(parseIntegratedLufs(out)));
    } catch {
      finish(null);
    }
  });
}

// Synchronous on purpose: the handoff to the mixer must not wait on a process.
export function levelTrimDb(path: string): number {
  return trimDbFor(levels.get(path));
}
