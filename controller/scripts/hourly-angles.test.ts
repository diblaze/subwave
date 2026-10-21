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
