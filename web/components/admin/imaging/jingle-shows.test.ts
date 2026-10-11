import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jingleShowsLabel, tiedJingleCount } from './jingle-shows';

const shows = [{ id: 'lunch_show', name: 'Lunch' }, { id: 'late_show', name: 'Late' }];

test('an untied jingle reads as all shows', () => {
  assert.equal(jingleShowsLabel(undefined, shows), 'all shows');
  assert.equal(jingleShowsLabel([], shows), 'all shows');
});

test('a tied jingle names its shows, and a deleted one is called that', () => {
  assert.equal(jingleShowsLabel(['lunch_show', 'late_show'], shows), 'Lunch, Late');
  assert.equal(jingleShowsLabel(['lunch_show', 'gone_show'], shows), 'Lunch, (deleted show)');
  assert.equal(jingleShowsLabel(['gone_show'], []), '(deleted show)', 'never falls back to all shows');
});

test('the tied count ignores empty lists', () => {
  assert.equal(tiedJingleCount([{ showIds: ['a'] }, { showIds: [] }, {}]), 1);
});
