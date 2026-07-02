import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhase, getNextPhaseId } from '../lib/followupPhase.js';

test('normalizePhase clamps invalid values to a valid range', () => {
  assert.equal(normalizePhase(0), 1);
  assert.equal(normalizePhase(8), 7);
  assert.equal(normalizePhase(3), 3);
});

test('getNextPhaseId advances to the next phase and caps at 7', () => {
  assert.equal(getNextPhaseId(1), 2);
  assert.equal(getNextPhaseId(6), 7);
  assert.equal(getNextPhaseId(7), 7);
});
