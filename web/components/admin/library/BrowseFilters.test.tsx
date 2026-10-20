import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrowseFilters } from './BrowseFilters';

const noop = () => {};
const render = (over: Partial<Parameters<typeof BrowseFilters>[0]> = {}) => renderToStaticMarkup(createElement(BrowseFilters, {
  moodVocab: [], moodCounts: {}, energyCounts: {}, genreList: [],
  moods: [], setMoods: noop, energy: '' as never, setEnergy: noop, vocal: '' as never, setVocal: noop,
  genre: '', setGenre: noop, yearFrom: '', setYearFrom: noop, yearTo: '', setYearTo: noop,
  q: 'AC/DC', setQ: noop,
  queryError: { message: '"/" is not query syntax here', offset: 2, kind: 'syntax' },
  readsAs: '',
  sort: 'artist', setSort: noop,
  ...over,
}));

test('the search box is described by the live region that reads its query back', () => {
  const html = render();
  const describedBy = /aria-label="Search tracks"[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];
  assert.ok(describedBy, 'the box names a description');
  assert.match(html, new RegExp(`<div id="${describedBy}"[^>]*aria-live="polite"`), 'and it is the live region');
  assert.match(html, /is not query syntax here/, 'which carries the error');
});
