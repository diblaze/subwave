// Spike: liqe AST -> SQLite WHERE over library.db tracks. Not production code.
import { parse } from 'liqe';
import Database from 'better-sqlite3';
import { RE2JS } from 're2js';

const fold = (s: string) => s.normalize('NFC').toLowerCase();
const TEXT = ['title', 'artist', 'album'] as const;
const NUM: Record<string, string> = { year: 'COALESCE(original_year, year)', bpm: 'bpm' };
const like = (s: string) => s.replace(/[\\%_]/g, '\\$&');

type Out = { sql: string; params: unknown[] };
function text(col: string, e: any, exact: boolean): Out {
  if (e.type === 'RegexExpression') {
    const m = /^\/(.+)\/[a-z]*$/s.exec(e.value)!;
    return { sql: `search_match(?, COALESCE(${col},''))`, params: [m[1]] };
  }
  const v = fold(String(e.value));
  if (exact) return { sql: `fold(COALESCE(${col},'')) = ?`, params: [v] };
  if (!e.quoted && v.includes('*')) return { sql: `fold(COALESCE(${col},'')) LIKE ? ESCAPE '\\'`, params: [like(v).replace(/\*/g, '%')] };
  return { sql: `fold(COALESCE(${col},'')) LIKE ? ESCAPE '\\'`, params: [`%${like(v)}%`] };
}
function compile(n: any): Out {
  switch (n.type) {
    case 'LogicalExpression': {
      const l = compile(n.left), r = compile(n.right);
      const op = n.operator.operator === 'OR' ? 'OR' : 'AND';
      return { sql: `(${l.sql} ${op} ${r.sql})`, params: [...l.params, ...r.params] };
    }
    case 'UnaryOperator': { const o = compile(n.operand); return { sql: `NOT (${o.sql})`, params: o.params }; }
    case 'ParenthesizedExpression': return compile(n.expression);
    case 'Tag': {
      const op = n.operator?.operator ?? ':';
      if (n.field.type === 'ImplicitField') {
        const parts = TEXT.map((c) => text(c, n.expression, false));
        return { sql: `(${parts.map((p) => p.sql).join(' OR ')})`, params: parts.flatMap((p) => p.params) };
      }
      const f = n.field.name;
      if ((TEXT as readonly string[]).includes(f)) return text(f, n.expression, op === ':=');
      if (f in NUM) {
        const col = NUM[f];
        if (n.expression.type === 'RangeExpression') {
          const r = n.expression.range;
          return { sql: `(${col} ${r.minInclusive ? '>=' : '>'} ? AND ${col} ${r.maxInclusive ? '<=' : '<'} ?)`, params: [r.min, r.max] };
        }
        const cmp = ({ ':': '=', ':=': '=', ':>': '>', ':>=': '>=', ':<': '<', ':<=': '<=' } as any)[op];
        return { sql: `${col} ${cmp} ?`, params: [Number(n.expression.value)] };
      }
      if (f === 'energy') return { sql: `energy = ?`, params: [fold(String(n.expression.value))] };
      if (f === 'mood') return { sql: `EXISTS (SELECT 1 FROM json_each(moods) WHERE value = ?)`, params: [fold(String(n.expression.value))] };
      if (f === 'genre') return { sql: `EXISTS (SELECT 1 FROM json_each(genres) WHERE fold(value) = ?)`, params: [fold(String(n.expression.value))] };
      throw new Error(`unknown field ${f} at ${n.field.location?.start}`);
    }
    case 'EmptyExpression': return { sql: '1', params: [] };
  }
  throw new Error(`unsupported node ${n.type}`);
}

const db = new Database('/mnt/black/configs/subwave/library.db', { readonly: true, fileMustExist: true });
db.function('fold', { deterministic: true }, (v: unknown) => fold(String(v ?? '')));
let last: { s: string; re: any } | null = null;
db.function('search_match', { deterministic: true }, (s: unknown, v: unknown) => {
  if (last?.s !== s) last = { s: String(s), re: RE2JS.compile(String(s), RE2JS.CASE_INSENSITIVE) };
  return last.re.matcher(String(v ?? '')).find() ? 1 : 0;
});
const qs = ['live', 'live', 'live', 'title:/\\((live|remix)\\)/', 'artist:the*', 'åsa', 'genre:pop year:[2000 TO 2009]',
  'energy:high -genre:pop', 'title:live OR title:remix', 'NOT (title:live OR title:remix) mood:calm', 'bpm:>140',
  'artist:="ABBA"', 'title:"100%"', 'nosuchfield:x'];
for (const q of qs) {
  try {
    const { sql, params } = compile(parse(q));
    const t = performance.now();
    const n = (db.prepare(`SELECT count(*) c FROM tracks WHERE ${sql}`).get(...params) as any).c;
    const ex = db.prepare(`SELECT title, artist FROM tracks WHERE ${sql} LIMIT 2`).all(...params).map((r: any) => `${r.title} — ${r.artist}`);
    console.log(q.padEnd(42), String(n).padStart(5), `${(performance.now() - t).toFixed(1)}ms`, ex.join(' | ').slice(0, 90));
  } catch (e: any) { console.log(q.padEnd(42), 'ERR', e.message.split('\n')[0]); }
}
