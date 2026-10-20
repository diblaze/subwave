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

import type Database from 'better-sqlite3';
import { getDbNonce, requireDb } from './handle.js';
import { safeParseArray } from './rows.js';
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

// As show-filter's trackGenres reads them: the `genres` array, strings or
// OpenSubsonic `{ name }` objects. Always valid JSON: the generated `genre`
// column's index makes SQLite refuse anything else on write.
function genreList(genresJson: string | null): string[] {
  const parsed: unknown[] = genresJson ? JSON.parse(genresJson) : [];
  return parsed
    .map(g => (typeof g === 'string' ? g : String((g as { name?: unknown })?.name ?? '')))
    .filter(Boolean);
}

interface SourceRow {
  id: string;
  title: string | null; artist: string | null; album: string | null;
  genres: string | null;
  moods: string | null; audio_moods: string | null; lastfm_tags: string | null;
}

let refreshedAt: string | null = null;

const changeMark = (): string => {
  const d = requireDb();
  const changes = (d.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  return `${getDbNonce()}:${d.pragma('data_version', { simple: true })}:${changes}`;
};

/** Bring every row's search keys up to date with its source fields. */
export function refreshSearchKeys(): void {
  if (changeMark() === refreshedAt) return;
  const d = requireDb();
  // Outside a write lock first: most refreshes find nothing to do, and waiting
  // for the lock while a tagger walk holds it would stall the event loop.
  if (!d.prepare('SELECT 1 FROM tracks WHERE search_fresh IS NULL LIMIT 1').get()) {
    refreshedAt = changeMark();
    return;
  }
  const select = d.prepare(`SELECT id, ${SOURCE_COLUMNS.join(', ')} FROM tracks WHERE search_fresh IS NULL`);
  const update = d.prepare(
    `UPDATE tracks SET ${SEARCH_KEY_COLUMNS.map(c => `${c} = ?`).join(', ')}, search_fresh = 1 WHERE id = ?`,
  );
  // Read and write under one write lock (IMMEDIATE): the tagger and analyzer are
  // other processes, and a row they change between a separate SELECT and this
  // write would be marked fresh with keys built from its old values.
  d.transaction(() => {
    for (const r of select.all() as SourceRow[]) {
      const genres = genreList(r.genres);
      const moods = [...safeParseArray(r.moods ?? '[]'), ...safeParseArray(r.audio_moods ?? '[]')];
      const lastfm = safeParseArray(r.lastfm_tags ?? '[]');
      const artist = r.artist ?? '';
      update.run(
        nameKey(r.title), nameKey(artist), nameKey(r.album),
        keyList(artist ? [artistNameKey(artist), ...artistParticipantKeys(artist)] : []),
        keyList(genres.map(normGenre)),
        keyList(genres.flatMap(genreRuns)),
        keyList([...genres, ...moods, ...lastfm].map(nameKey)),
        keyList(moods.map(nameKey)),
        r.id,
      );
    }
  }).immediate();
  refreshedAt = changeMark();
}
