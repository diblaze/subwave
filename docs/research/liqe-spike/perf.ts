import { parse } from 'liqe';
const t = performance.now(); for (let i = 0; i < 2000; i++) parse('NOT (title:live OR title:remix) mood:calm year:[2000 TO 2009]');
console.log('parse x2000', (performance.now() - t).toFixed(0), 'ms');
