import { parse } from 'liqe';
const qs = ['live', 'title:"(live)"', 'artist:the*', '-album:"greatest hits"', 'genre:rock OR genre:metal',
  'year:[2000 TO 2009]', 'energy:high mood:calm', 'title:/\\b(live|remix)\\b/', 'title:/(live|remix)/i',
  'åsa', 'artist:"Åsa Jinder"', 'title:(live OR remix)', 'NOT title:live', 'bpm:>120',
  // errors
  'title:"unclosed', 'title:(live', 'AND live', 'title:/(live/'];
for (const q of qs) {
  try { const ast = parse(q); console.log('OK ', q.padEnd(28), JSON.stringify(ast).slice(0, 230)); }
  catch (e: any) { console.log('ERR', q.padEnd(28), e.name, '|', String(e.message).split('\n')[0].slice(0, 140)); }
}
