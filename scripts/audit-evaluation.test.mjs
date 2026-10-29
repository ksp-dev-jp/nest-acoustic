import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAuditBins, evaluateAudit, validateAuditAnnotations } from '../lib/audit-evaluation.ts';

const annotate = (bin, label) => ({ ...bin, label, species: [], noise: '', reviewedAt: '2026-10-29T01:00:00Z' });
test('fixed bins cover full range, including gaps and a short last bin', () => {
  const bins = makeAuditBins(1952.2, 3503);
  assert.equal(bins.length, 517);
  assert.equal(bins[0].start, 1952.2);
  assert.equal(bins.at(-1).end, 3503);
  for (let i = 1; i < bins.length; i++) assert.equal(bins[i - 1].end, bins[i].start);
  assert.throws(() => makeAuditBins(0, Infinity));
});
test('partial manual records never turn unknown bins into negative examples', () => {
  const bins = makeAuditBins(0, 15);
  const labels = [annotate(bins[0], 'bird'), annotate(bins[2], 'noise'), annotate(bins[3], 'uncertain')];
  const result = evaluateAudit(bins, labels, [{ start: 0, end: 15, maxBirdScore: .9 }], .1);
  assert.deepEqual([result.tp, result.fn, result.fp, result.tn, result.uncertain], [1, 0, 1, 0, 1]);
  assert.equal(result.precision, .5);
  assert.equal(result.complete, false);
});
test('threshold tradeoff counts distinct time bins, not repeated candidate rows', () => {
  const bins = makeAuditBins(0, 12);
  const labels = bins.map((bin, id) => annotate(bin, id < 2 ? 'bird' : 'noise'));
  const candidates = [{ start: 0, end: 3, maxBirdScore: .9 }, { start: 0, end: 3, maxBirdScore: .9 }, { start: 6, end: 9, maxBirdScore: .1 }];
  const low = evaluateAudit(bins, labels, candidates, .1);
  assert.deepEqual([low.tp, low.fn, low.fp, low.tn], [1, 1, 1, 1]);
  assert.equal(low.recall, .5); assert.equal(low.falsePositiveRate, .5); assert.equal(low.complete, true);
  const high = evaluateAudit(bins, labels, candidates, .5);
  assert.deepEqual([high.tp, high.fn, high.fp, high.tn], [1, 1, 0, 2]);
  assert.equal(high.precision, 1);
  assert.equal(evaluateAudit(bins, [], candidates, .1).recall, null);
});
test('imports reject duplicates, altered intervals, invented states and conflicting species', () => {
  const bins = makeAuditBins(0, 3);
  const valid = annotate(bins[0], 'bird');
  assert.deepEqual(validateAuditAnnotations([valid], bins), [valid]);
  for (const records of [[valid, valid], [{ ...valid, end: 4 }], [{ ...valid, label: 'auto' }], [{ ...valid, label: 'noise', species: ['メジロ'] }]]) {
    assert.throws(() => validateAuditAnnotations(records, bins));
  }
});
