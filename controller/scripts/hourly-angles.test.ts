// The hourly time check forbids light, darkness and weather, and that rule
// overrides tone. A tone that asks for them wins anyway: at 22:00 one aired
// "darkness has already fallen early over the October day".
// Run: npm test -- hourly-angles
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANGLES } from '../src/llm/internal/prompts/context.js';

test('no hourly tone asks for light, darkness or weather', () => {
  const asks = ANGLES.hourly.filter((a) => /\b(dark|light|sun|sky|weather|season)/i.test(a));
  assert.deepEqual(asks, []);
});

// The check airs just after the hour, so a tone about the middle of something
// reads as the middle of the hour: one aired "just after three, and we have
// just passed halfway into the hour".
test('no hourly tone points at the middle of the hour', () => {
  assert.deepEqual(ANGLES.hourly.filter((a) => /\b(half\w*|middle|midpoint)\b/i.test(a)), []);
});
