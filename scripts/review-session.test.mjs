import assert from 'node:assert/strict';
import test from 'node:test';
import { REVIEW_REVISION, loadReviewSession, recordingId, saveReviewSession } from '../lib/review-session.ts';

function memoryStorage() {
  const entries = new Map();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

function fixture() {
  return {
    version: 1, revision: REVIEW_REVISION, fileId: 'test-recording', regionKey: 'hagi',
    recordingStart: '2026-03-02T06:25:54', duration: 90, candidateCount: 1,
    overviewBars: Array(104).fill(10), listenedIds: [1], savedAt: '2026-10-26T01:00:00Z',
    detections: [{
      id: 1, start: 2, end: 5, peakTime: 3, strength: 50, dominantHz: 3000,
      band: '3 kHz', night: false, species: 'オオタカ', scientific: 'Astur gentilis',
      commonEnglish: 'Eurasian Goshawk', confidence: 94, geoProbability: 3.3,
      prioritySpecies: true, filterStatus: '重点種・適期', reviewStatus: 'approved',
      reviewedAt: '2026-10-26T01:00:00Z',
    }],
  };
}

test('same recording restores decisions, region and second-precision start time', () => {
  const storage = memoryStorage();
  const saved = fixture();
  saveReviewSession(storage, saved);
  assert.deepEqual(loadReviewSession(storage, saved.fileId, ['hagi']), saved);
  assert.equal(loadReviewSession(storage, 'different-recording', ['hagi']), undefined);
});

test('approval without completed audio review or timestamp is reset to pending', () => {
  for (const field of ['listenedIds', 'reviewedAt']) {
    const storage = memoryStorage();
    const saved = fixture();
    if (field === 'listenedIds') saved.listenedIds = [];
    else delete saved.detections[0].reviewedAt;
    saveReviewSession(storage, saved);
    assert.equal(loadReviewSession(storage, saved.fileId, ['hagi']).detections[0].reviewStatus, 'pending');
  }
});

test('incompatible revisions, duplicate IDs, unknown regions and invalid times do not restore', () => {
  const changes = [
    (s) => { s.revision = 'older-model'; },
    (s) => { s.detections.push({ ...s.detections[0] }); },
    (s) => { s.regionKey = 'outside-region'; },
    (s) => { s.detections[0].end = 100; },
    (s) => { s.recordingStart = 'invalid'; },
    (s) => { s.listenedIds = [999]; },
  ];
  for (const change of changes) {
    const storage = memoryStorage();
    const saved = fixture();
    change(saved);
    saveReviewSession(storage, saved);
    assert.throws(() => loadReviewSession(storage, saved.fileId, ['hagi']));
  }
});

test('damaged storage and unavailable capacity are reported to the caller', () => {
  assert.throws(() => loadReviewSession({ getItem: () => '{' }, 'recording', ['hagi']));
  assert.throws(() => saveReviewSession({ setItem: () => { throw new Error('quota'); } }, fixture()));
});

test('fingerprint distinguishes same-name recordings and includes the recording tail', async () => {
  const name = 'survey.wav';
  const bytes = new Uint8Array(200_000);
  const first = new File([bytes], name, { lastModified: 1 });
  const copy = new File([bytes], name, { lastModified: 1 });
  bytes[bytes.length - 1] = 1;
  const different = new File([bytes], name, { lastModified: 1 });
  assert.equal(await recordingId(first), await recordingId(copy));
  assert.notEqual(await recordingId(first), await recordingId(different));
  assert.notEqual(await recordingId(first), await recordingId(new File([bytes], name, { lastModified: 2 })));
});
