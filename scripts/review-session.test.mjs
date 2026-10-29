import assert from 'node:assert/strict';
import test from 'node:test';
import { REVIEW_REVISION, PREVIOUS_REVIEW_REVISION, LEGACY_REVIEW_REVISION, loadReviewSession, recordingId, saveReviewSession } from '../lib/review-session.ts';
import { isUnresolvedDetection, retainCandidateResults } from '../lib/candidate-results.ts';

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

test('audio interval with no accepted species remains reviewable without invented scores', () => {
  const candidate = { id: 42, start: 2, end: 5, peakTime: 3, strength: 10, dominantHz: 1500, band: '1 kHz', night: true };
  const result = retainCandidateResults(candidate, [], 7);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 7);
  assert.equal(result[0].start, candidate.start);
  assert.equal(result[0].end, candidate.end);
  assert.equal(result[0].night, true);
  assert.equal(isUnresolvedDetection(result[0]), true);
  assert.equal(result[0].scientific, '');
  assert.equal(result[0].confidence, null);
  assert.equal(result[0].geoProbability, null);
  assert.equal(result[0].reviewStatus, 'pending');
});

test('accepted species results retain their identities and do not gain a duplicate unresolved row', () => {
  const named = fixture().detections;
  assert.equal(retainCandidateResults(named[0], named, 999), named);
  assert.equal(isUnresolvedDetection(named[0]), false);
});

test('approved unresolved audio stays unresolved after save and restore', () => {
  const saved = fixture();
  saved.detections = retainCandidateResults(saved.detections[0], [], 1);
  saved.detections[0].reviewStatus = 'approved';
  saved.detections[0].reviewedAt = saved.savedAt;
  const storage = memoryStorage();
  saveReviewSession(storage, saved);
  const restored = loadReviewSession(storage, saved.fileId, ['hagi']);
  assert.equal(restored.detections[0].reviewStatus, 'approved');
  assert.equal(restored.detections[0].identification, 'unresolved');
  assert.equal(restored.detections[0].scientific, '');
  assert.equal(restored.detections[0].confidence, null);
});

test('unresolved results cannot restore with a fabricated score or assigned species', () => {
  for (const change of [(s) => { s.confidence = 90; }, (s) => { s.scientific = 'Astur gentilis'; }, (s) => { s.geoProbability = 0; }]) {
    const saved = fixture();
    saved.detections = retainCandidateResults(saved.detections[0], [], 1);
    change(saved.detections[0]);
    const storage = memoryStorage();
    saveReviewSession(storage, saved);
    assert.throws(() => loadReviewSession(storage, saved.fileId, ['hagi']));
  }
});

test('legacy decisions remain readable and keep their original analysis revision', () => {
  const saved = fixture();
  saved.revision = LEGACY_REVIEW_REVISION;
  const storage = memoryStorage();
  saveReviewSession(storage, saved);
  const restored = loadReviewSession(storage, saved.fileId, ['hagi']);
  assert.equal(restored.revision, LEGACY_REVIEW_REVISION);
  assert.equal(restored.detections[0].reviewStatus, 'approved');
});

test('classification service failure keeps the audio available as unresolved', () => {
  const candidate = fixture().detections[0];
  const [result] = retainCandidateResults(candidate, [], 1, 'classification-unavailable');
  assert.equal(result.unresolvedReason, 'classification-unavailable');
  assert.equal(result.reviewStatus, 'pending');
  assert.equal(result.confidence, null);
});

test('previous unresolved sessions keep their revision and approved audio decisions', () => {
  const saved = fixture();
  saved.revision = PREVIOUS_REVIEW_REVISION;
  saved.detections = retainCandidateResults(saved.detections[0], [], 1);
  saved.detections[0].reviewStatus = 'approved';
  saved.detections[0].reviewedAt = saved.savedAt;
  const storage = memoryStorage();
  saveReviewSession(storage, saved);
  const restored = loadReviewSession(storage, saved.fileId, ['hagi']);
  assert.equal(restored.revision, PREVIOUS_REVIEW_REVISION);
  assert.equal(restored.detections[0].reviewStatus, 'approved');
  assert.equal(restored.detections[0].identification, 'unresolved');
});
