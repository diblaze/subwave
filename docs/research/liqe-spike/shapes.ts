import { parse } from 'liqe';
const strip = (n: any): any => Array.isArray(n) ? n.map(strip) : n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'location').map(([k, v]) => [k, strip(v)])) : n;
for (const q of ['title:/(live|remix)/i', 'artist:the*', 'year:[2000 TO 2009]', 'bpm:>120', '-album:"greatest hits"', 'live remix', '"Song Name"'])
  console.log(q, '\n ', JSON.stringify(strip(parse(q))));
