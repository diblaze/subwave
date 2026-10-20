// Stored search keys for the Library search's query language
// (music/search-query.ts): each track's folded name keys, its credited acts, its
// genre runs and its tag and mood lists, so a query compares stored text with
// native LIKE and = instead of running JS for every row.
//
// Kept current without touching any writer: a pure-SQL trigger
// (tracks_search_stale, no JS functions, so it fires on any connection and on an
// older controller) clears `search_fresh` when a source column's value changes,
// new rows start with it NULL, and before a query search refreshSearchKeys()
// re-keys just those rows, found through a partial index. It does nothing when
// the database has not changed since it last found every row fresh.
//
// The columns are schema (migration 29); the trigger and its index are not.
// Like genre-inputs.ts they sit outside the user_version chain and are checked
// on every open: a migration that rebuilds tracks drops them with the table, and
// the next ensure puts them back. The check compares the trigger's stored
// definition, not only its name, so a changed definition replaces the old one on
// the next open (CREATE ... IF NOT EXISTS would keep it). A trigger that had to
// be put back or replaced may have let writes through unmarked, so every row is
// marked stale with it. A migration that drops a source column must DROP
// TRIGGER tracks_search_stale first: SQLite refuses to drop a column a trigger
// names, and keys built from one column fewer need a new definition here anyway.
// The keys also depend on code (nameKey, artistParticipantKeys, genreRuns,
// normGenre): a change there needs a migration that clears `search_fresh`.
//
// Nothing here may fail an open or a search. A failed ensure or refresh warns,
// and the search answers from the keys it has, wrong only for the rows still
// waiting. A search re-keys at most one chunk before it answers and leaves the
// rest to a background drain, one short write transaction per chunk, so a bulk
// change (a first mood-tagging pass, a scene merge) neither stalls the request
// nor holds the write lock against the tagger.

import type Database from 'better-sqlite3';
import { getDb, requireDb } from './handle.js';
import { safeParseArray } from './rows.js';
import { changeToken } from './stats.js';
import { artistNameKey, artistParticipantKeys, nameKey } from '../recency.js';
import { genreRuns, normGenre } from '../genre-fold.js';

export const SEARCH_KEY_COLUMNS = [
  'title_key', 'artist_key', 'album_key', 'artist_keys',
  'genre_keys', 'genre_runs', 'tag_keys', 'mood_keys',
] as const;

// `genre` is not a source: it is generated from genres[0].
const SOURCE_COLUMNS = ['title', 'artist', 'album', 'genres', 'moods', 'audio_moods', 'lastfm_tags'];

/** The columns migration 29 adds: the keys and the stale marker. */
export const SEARCH_KEY_DDL = {
  columns: [...SEARCH_KEY_COLUMNS, 'search_fresh'] as const,
};

const TRIGGER = 'tracks_search_stale';
const INDEX = 'tracks_search_stale_idx';
// `UPDATE OF` fires whenever a statement names a column, and every tagger walk
// upserts title/artist/album/genres unchanged, so the WHEN marks only a row
// whose value actually changed. Compared verbatim with sqlite_master.sql, which
// keeps a CREATE as written (less IF NOT EXISTS and the `;`), so this text is
// the definition: keep both free of either.
const TRIGGER_SQL = `CREATE TRIGGER ${TRIGGER} AFTER UPDATE OF ${SOURCE_COLUMNS.join(', ')} ON tracks
    WHEN ${SOURCE_COLUMNS.map(c => `NEW.${c} IS NOT OLD.${c}`).join(' OR ')}
    BEGIN UPDATE tracks SET search_fresh = NULL WHERE id = NEW.id; END`;
const INDEX_SQL = `CREATE INDEX ${INDEX} ON tracks(id) WHERE search_fresh IS NULL`;

function stored(d: Database.Database): { trigger?: string; index?: string } {
  const rows = d.prepare(
    `SELECT type, sql FROM sqlite_master WHERE (type = 'trigger' AND name = ?) OR (type = 'index' AND name = ?)`,
  ).all(TRIGGER, INDEX) as Array<{ type: 'trigger' | 'index'; sql: string }>;
  return Object.fromEntries(rows.map(r => [r.type, r.sql]));
}

/**
 * The stale trigger and its index, on every open. Reads first and writes only
 * when one is missing or differs. Warns rather than throws, like
 * ensureGenreInputs; returns whether both are in place.
 */
export function ensureSearchKeys(d: Database.Database): boolean {
  try {
    const now = stored(d);
    if (now.trigger === TRIGGER_SQL && now.index === INDEX_SQL) return true;
    d.transaction(() => {
      // Again under the write lock: a rival opener may have put them in place.
      const s = stored(d);
      if (s.trigger !== TRIGGER_SQL) {
        d.exec(`DROP TRIGGER IF EXISTS ${TRIGGER}`);
        d.exec(TRIGGER_SQL);
        d.prepare('UPDATE tracks SET search_fresh = NULL WHERE search_fresh IS NOT NULL').run();
      }
      if (s.index !== INDEX_SQL) {
        d.exec(`DROP INDEX IF EXISTS ${INDEX}`);
        d.exec(INDEX_SQL);
      }
    }).immediate();
    return true;
  } catch (err) {
    console.warn(
      `[library-db] search keys not ensured (${(err as Error).message}); ` +
        'a library search may miss edits until the next open retries',
    );
    return false;
  }
}

/** Separates the keys in a list column; a typed query can never contain it. */
export const KEY_SEP = '\u001f';

const keyList = (keys: Iterable<string>): string => {
  const set = new Set([...keys].filter(Boolean));
  return set.size ? `${KEY_SEP}${[...set].join(KEY_SEP)}${KEY_SEP}` : '';
};

interface SourceRow {
  id: string;
  title: string | null; artist: string | null; album: string | null;
  genres: string | null;
  moods: string | null; audio_moods: string | null; lastfm_tags: string | null;
}

// The key columns in SEARCH_KEY_COLUMNS order. Lists read as rowToTrack reads
// them (safeParseArray: strings only, and a value that is not an array is none).
function keysOf(r: SourceRow): string[] {
  const genres = safeParseArray(r.genres ?? '[]');
  const moods = [...safeParseArray(r.moods ?? '[]'), ...safeParseArray(r.audio_moods ?? '[]')];
  const lastfm = safeParseArray(r.lastfm_tags ?? '[]');
  const artist = r.artist ?? '';
  return [
    nameKey(r.title), nameKey(artist), nameKey(r.album),
    keyList(artist ? [artistNameKey(artist), ...artistParticipantKeys(artist)] : []),
    keyList(genres.map(normGenre)),
    keyList(genres.flatMap(genreRuns)),
    keyList([...genres, ...moods, ...lastfm].map(nameKey)),
    keyList(moods.map(nameKey)),
  ];
}

// Rows re-keyed per write transaction, and by a search before it answers: about
// 12 ms of work, measured over 50k synthetic tracks on a desktop SSD.
const CHUNK_ROWS = 1000;
// How long a re-key waits for another process's write lock before leaving the
// rows for a later search. The connection's own busy timeout (5 s) would stall
// the request, and the event loop with it.
const LOCK_WAIT_MS = 100;

// The changeToken() at which no row was stale.
let freshAt: string | null = null;
let draining = false;
// One warning per run of failures: a search box fires on every pause in typing.
let warned = false;

// Re-keys up to `limit` stale rows in one write transaction; returns how many.
// Read and written under one write lock (IMMEDIATE): the tagger and analyzer are
// other processes, and a row they change between a separate SELECT and this
// write would be marked fresh with keys built from its old values.
function rekeyChunk(d: Database.Database, limit: number): number {
  const select = d.prepare(`SELECT id, ${SOURCE_COLUMNS.join(', ')} FROM tracks WHERE search_fresh IS NULL LIMIT ?`);
  const update = d.prepare(
    `UPDATE tracks SET ${SEARCH_KEY_COLUMNS.map(c => `${c} = ?`).join(', ')}, search_fresh = 1 WHERE id = ?`,
  );
  const busyTimeout = d.pragma('busy_timeout', { simple: true }) as number;
  d.pragma(`busy_timeout = ${LOCK_WAIT_MS}`);
  try {
    const n = d.transaction(() => {
      const rows = select.all(limit) as SourceRow[];
      for (const r of rows) update.run(...keysOf(r), r.id);
      return rows.length;
    }).immediate();
    warned = false;
    return n;
  } finally {
    d.pragma(`busy_timeout = ${busyTimeout}`);
  }
}

function warn(err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(
    `[library-db] search keys not refreshed (${(err as Error)?.message}); ` +
      'searches may miss recent edits until a later search retries',
  );
}

// The rest of a bulk re-key, one chunk per turn of the event loop. A closed
// database, or a chunk that fails, ends it; the next search starts another.
function drainSoon(): void {
  if (draining) return;
  draining = true;
  const step = () => {
    try {
      const d = getDb();
      if (d && rekeyChunk(d, CHUNK_ROWS) === CHUNK_ROWS) {
        setImmediate(step);
        return;
      }
    } catch (err) {
      warn(err);
    }
    draining = false;
  };
  setImmediate(step);
}

/**
 * Bring the search keys up to date before a query search: up to `rows` stale
 * rows now (one chunk by default), the rest in the background. Never throws;
 * returns false when a re-key failed (and warned).
 */
export function refreshSearchKeys({ rows = CHUNK_ROWS }: { rows?: number } = {}): boolean {
  try {
    const d = requireDb();
    // Before the check: a write that lands after it moves the token, so the
    // next search looks again rather than trusting this one's answer.
    const mark = changeToken();
    if (mark === freshAt) return true;
    // Outside a write lock first: most refreshes find nothing to do, and waiting
    // for the lock while a tagger walk holds it would stall the event loop.
    if (!d.prepare('SELECT 1 FROM tracks WHERE search_fresh IS NULL LIMIT 1').get()) {
      freshAt = mark;
      return true;
    }
    for (let done = 0; done < rows;) {
      const limit = Math.min(CHUNK_ROWS, rows - done);
      const n = rekeyChunk(d, limit);
      if (n < limit) return true;
      done += n;
    }
    drainSoon();
    return true;
  } catch (err) {
    warn(err);
    return false;
  }
}

/** Migration 29's one-time fill, logged with its time. Never throws. */
export function fillSearchKeys(): void {
  const started = performance.now();
  console.log('[library-db] building search keys (one-time)…');
  if (refreshSearchKeys({ rows: Infinity })) {
    console.log(`[library-db] search keys built in ${Math.round(performance.now() - started)}ms`);
  }
}
