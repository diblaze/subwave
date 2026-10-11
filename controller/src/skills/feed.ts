// Parse RSS/Atom/RDF feeds with fast-xml-parser; see scripts/feed-parse.test.ts.
// A skill with feed frontmatter and no tool.mjs receives makeFeedTool from the loader (#1616).
// News uses the same generic path; config comes from resolveFeedConfig.

import { XMLParser } from 'fast-xml-parser';
import { existsSync, readFileSync } from 'node:fs';
import { config, STATE_DIR } from '../config.js';
import { writeFileAtomicSync } from '../util/atomic-file.js';
import { fetchWithTimeout } from '../util/fetch-timeout.js';

// The frontmatter keys that declare a feed. One spelling, shared by the
// resolver, the admin knobs and the docs.
export const FEED_URL_KEY = 'feed';
export const FEED_MAX_ITEMS_KEY = 'feedMaxItems';

// Upper bound on `feedMaxItems`, and the `max` the admin number field enforces.
export const FEED_MAX_ITEMS_LIMIT = 50;

export interface Headline {
  title: string;
  description: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  ignoreDeclaration: true,
  // Namespace prefixes are noise here and actively harmful: an RDF feed's root
  // is `rdf:RDF`, and plenty of feeds carry `dc:title` / `content:encoded`.
  // Stripping them collapses every dialect onto the same plain tag names.
  removeNSPrefix: true,
  // Keep every value a STRING. With the default numeric coercion a headline of
  // "2026" arrives as the number 2026 and a version-like title ("1.2.3") can
  // lose a component — text is text.
  parseTagValue: false,
  parseAttributeValue: false,
});

// A parsed node is a string, or an object carrying its text under `#text` when
// the element had attributes (`<title type="html">…</title>`), or an array when
// the tag repeated. Flatten all three to a plain string.
function textOf(node: unknown): string {
  if (node == null) return '';
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === 'object') return textOf((node as Record<string, unknown>)['#text']);
  return String(node);
}

// A reference outside Unicode's range is left as the text it was rather than
// throwing out of the parse.
function fromCodePoint(code: number, ref: string): string {
  try { return String.fromCodePoint(code); } catch { return ref; }
}

function stripHtml(s: string): string {
  return (s || '')
    // Entities are decoded by the parser; these handle a doubly-encoded feed,
    // where the decoded text still contains &amp;-style escapes.
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Numeric character references. The parser decodes only the five named XML
    // entities, so WordPress punctuation (&#8217;, &#038;) reached the model as
    // literal text. Runs after &amp; so a doubly-encoded &amp;#8217; decodes too.
    .replace(/&#(\d+);/g, (ref, dec) => fromCodePoint(Number(dec), ref))
    .replace(/&#x([0-9a-f]+);/gi, (ref, hex) => fromCodePoint(parseInt(hex, 16), ref))
    .replace(/\s+/g, ' ')
    .trim();
}

function asRecord(node: unknown): Record<string, unknown> | null {
  return node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>) : null;
}

// Locate the entry list across the three dialects in the wild:
//   RSS 2.0    <rss><channel><item>…
//   RSS 1.0    <RDF><item>…            (items are siblings of <channel>, not children)
//   Atom       <feed><entry>…
// Returns [] when the document is not a feed at all.
function entriesOf(doc: Record<string, unknown>): Record<string, unknown>[] {
  const roots: Record<string, unknown>[] = [];
  for (const value of Object.values(doc)) {
    const root = asRecord(value);
    if (!root) continue;
    roots.push(root);
    // RSS 2.0 nests the items one level deeper, under <channel>.
    const channel = asRecord(root.channel);
    if (channel) roots.push(channel);
  }
  for (const root of roots) {
    const found = root.item ?? root.entry;
    if (found == null) continue;
    const list = Array.isArray(found) ? found : [found];
    return list.map(asRecord).filter((e): e is Record<string, unknown> => e !== null);
  }
  return [];
}

// Parse a feed document into at most `cap` headlines. Entries with no title are
// dropped — a headline the DJ cannot read is not a headline.
export function parseFeed(xml: string, cap: number): Headline[] {
  let doc: Record<string, unknown> | null = null;
  try {
    doc = asRecord(parser.parse(xml));
  } catch {
    // Malformed XML — treat it as an empty feed rather than throwing into the
    // segment director, which is what the regex scanner did by construction.
    return [];
  }
  if (!doc) return [];

  const out: Headline[] = [];
  for (const entry of entriesOf(doc)) {
    if (out.length >= cap) break;
    const title = stripHtml(textOf(entry.title));
    if (!title) continue;
    // RSS carries the blurb in <description>; Atom uses <summary>, falling back
    // to <content> (which, post-removeNSPrefix, is also where RSS's
    // <content:encoded> lands).
    const description = stripHtml(textOf(entry.description ?? entry.summary ?? entry.content));
    out.push({ title, description });
  }
  return out;
}

export function hashHeadline(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = ((h << 5) - h + title.charCodeAt(i)) | 0;
  return h.toString(36);
}

export async function fetchHeadlines({ feedUrl, maxItems }: { feedUrl?: string; maxItems?: number } = {}) {
  const url = feedUrl || config.news.feedUrl;
  const cap = maxItems || config.news.maxItems;
  // Bounded like the web-search backends. The feed URL is operator-set
  // (skills/news/SKILL.md `feed:`), so this is not an injection sink — the
  // deadline is about liveness. It runs inside the segment director on the
  // autonomous DJ path, where a hung socket would otherwise park the whole
  // segment on undici's ~300s default and eat the agent's own 45s budget many
  // times over. 15s is generous for an RSS document.
  const res = await fetchWithTimeout(url, { timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`News feed HTTP ${res.status}`);
  return parseFeed(await res.text(), cap);
}

// ---------------------------------------------------------------------------
// The generic feed tool (#1616)
//
// A skill declares `feed:` in its own SKILL.md frontmatter and gets a
// `skill_<name>` fetch tool over that feed — the same dedupe and truncation the
// built-in news skill used to hand-roll in its own tool.mjs. The policy lives
// here rather than at the loader call site because three things ask about it:
// the loader (does this skill get a tool?), the admin form (which knobs does it
// render?) and the tool itself (what does a fire return?).
// ---------------------------------------------------------------------------

// The operator knobs a feed-capable skill exposes in /admin/skills. Handed to
// `parseConfigFields` by the loader, exactly like a tool.mjs `configFields`
// export — one sanitiser, not a second copy. Kept as the raw declaration so the
// shape a skill author writes and the shape the built-in path uses are the same.
export const FEED_CONFIG_FIELDS = {
  feed: {
    type: 'url',
    label: 'Feed URL · RSS or Atom',
    placeholder: 'https://…/rss.xml',
    hint: 'Set this and the skill fetches the feed before it speaks.',
  },
  feedMaxItems: {
    type: 'number',
    label: 'Max items',
    min: 1,
    max: FEED_MAX_ITEMS_LIMIT,
    integer: true,
    placeholder: '10',
  },
} as const;

// How many FRESH items one fire hands the model. This is the news skill's
// historical return cap, kept for every feed skill: `feedMaxItems` caps how much
// of the feed is read (and so lowers this ceiling when it is smaller), while
// this caps how much of it is spent — burning a whole 50-item feed on one
// between-track aside leaves nothing for the next break.
export const FEED_ITEMS_PER_FIRE = 6;

// What each feed skill has already offered the DJ, kept on disk so a restart or
// a manual Run now does not start the feed over. An item may be offered TWICE,
// the second time no sooner than FEED_REPEAT_GAP_MS after the first: a story is
// worth a second mention to whoever tuned in later, and never a third. Offers
// are counted, not broadcasts, because the tool cannot know which of the items
// it handed over the model chose; the count is therefore an upper bound on how
// often a story can air.
export const FEED_MAX_AIRINGS = 2;
export const FEED_REPEAT_GAP_MS = 3 * 60 * 60 * 1000;
const LEDGER_PATH = `${STATE_DIR}/feed-aired.json`;
const LEDGER_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

interface Aired { n: number; at: number }
type Ledger = Record<string, Record<string, Aired>>;
let ledger: Ledger | null = null;

function loadLedger(): Ledger {
  if (ledger) return ledger;
  try {
    ledger = existsSync(LEDGER_PATH) ? JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Ledger : {};
  } catch {
    ledger = {};  // unreadable: the cost is one repeat, never a silent feed
  }
  return ledger!;
}

// Test seam: forget everything, in memory and on disk.
export function resetFeedLedger(): void {
  ledger = {};
  try { writeFileAtomicSync(LEDGER_PATH, '{}'); } catch { /* nothing to reset */ }
}

export interface ResolvedFeed {
  url: string;
  maxItems: number;
}

export interface FeedResolution {
  /** null when this skill declares no usable feed — it stays prompt-only. */
  feed: ResolvedFeed | null;
  /**
   * Operator-facing problems with what was declared. The loader logs each one:
   * a `feed:` line that cannot be fetched must say so, because the failure it
   * replaces (issue #1616) was a field that validated, saved, read back and
   * then silently did nothing.
   */
  warnings: string[];
}

// Read a skill's own frontmatter into a feed declaration.
//
// Absent or cleared is not an error — a skill without a feed is the ordinary
// prompt-only skill. A PRESENT but unusable value is: it is the operator saying
// "fetch this" in the one place that means it.
export function resolveFeedConfig(config: Record<string, unknown> | null | undefined): FeedResolution {
  const warnings: string[] = [];
  const raw = config?.[FEED_URL_KEY];
  const url = raw == null ? '' : String(raw).replace(/[\r\n\t]/g, '').trim();
  if (!url) return { feed: null, warnings };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    warnings.push(`feed: "${url}" is not a URL — no feed tool was generated`);
    return { feed: null, warnings };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    warnings.push(`feed: "${url}" is not an http(s) URL — no feed tool was generated`);
    return { feed: null, warnings };
  }

  return { feed: { url, maxItems: resolveMaxItems(config?.[FEED_MAX_ITEMS_KEY], warnings) }, warnings };
}

// `feedMaxItems` is lenient where the URL is strict: a broken count still has an
// obvious right answer (the station default), while a broken URL has none.
function resolveMaxItems(raw: unknown, warnings: string[]): number {
  const fallback = config.news.maxItems;
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > FEED_MAX_ITEMS_LIMIT) {
    warnings.push(`feedMaxItems: "${raw}" is not a whole number between 1 and ${FEED_MAX_ITEMS_LIMIT} — using ${fallback}`);
    return fallback;
  }
  return n;
}

// Build the data tool for a declared feed. Same signature as a skill's own
// tool.mjs default export, so the loader attaches it to `cap.toolFn` and every
// caller (llm/internal/tools/segment-tools.ts, the forced path, the co-hosted
// path) is unchanged — including the timeout and the `{ error }` degradation.
//
// Returns the news shape, `{ headlines: [{ title, detail }] }`, when there is
// something fresh, and `{ available: false, reason }` when there is not — never
// an empty list (#1830). An empty list read as usable data to
// abstain-policy.ts, so Run now, a skill cron or a programme beat on a drained
// feed ordered a line with no items in it, and the model invented a headline.
// `available: false` is the shape every data tool already uses for "nothing
// worth airing", which stands those runs down and lets the pool path back off.
export function makeFeedTool(kind: string, feed: ResolvedFeed) {
  return async function fetchFeedItems(_ctx?: unknown, _state?: unknown) {
    const items = await fetchHeadlines({ feedUrl: feed.url, maxItems: feed.maxItems });
    // A feed that fetched fine but carries no readable items is the same
    // answer as one that has all aired. It touches no dedup memory.
    if (!items.length) return { available: false, reason: 'the feed has no items' };
    const now = Date.now();
    const all = loadLedger();
    // Namespaced by kind: two skills reading two feeds must not suppress each
    // other's items just because a headline hashes the same.
    const aired = (all[kind] ??= {});
    const due = (it: { title: string }) => {
      const a = aired[hashHeadline(it.title)];
      return !a || (a.n < FEED_MAX_AIRINGS && now - a.at >= FEED_REPEAT_GAP_MS);
    };
    // Never-offered items first, so a second mention only fills what is left.
    const fresh = [
      ...items.filter(it => due(it) && !aired[hashHeadline(it.title)]),
      ...items.filter(it => due(it) && aired[hashHeadline(it.title)]),
    ].slice(0, FEED_ITEMS_PER_FIRE);
    if (!fresh.length) return { available: false, reason: 'every item on the feed has already aired' };
    // Burn on read so a later tick doesn't re-offer the same item.
    for (const it of fresh) {
      const h = hashHeadline(it.title);
      aired[h] = { n: (aired[h]?.n ?? 0) + 1, at: now };
    }
    for (const k of Object.keys(all)) {
      for (const [h, a] of Object.entries(all[k]!)) if (now - a.at > LEDGER_KEEP_MS) delete all[k]![h];
    }
    try { writeFileAtomicSync(LEDGER_PATH, JSON.stringify(all)); } catch { /* memory still holds it */ }
    return { headlines: fresh.map(it => ({ title: it.title, detail: it.description || null })) };
  };
}
