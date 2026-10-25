import type { Detection } from './audio-analysis';

// Bump this revision when a model or filtering rule changes the saved candidates.
export const REVIEW_REVISION = 'birdnet3-preview3.1-geo3.0.4-filter1';
const PREFIX = 'nest-acoustic:review:v1:';

type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type ReviewSession = {
  version: 1;
  revision: string;
  fileId: string;
  recordingStart: string;
  regionKey: string;
  duration: number;
  candidateCount: number;
  detections: Detection[];
  overviewBars: number[];
  listenedIds: number[];
  savedAt: string;
};

// Sample only the file edges so opening a multi-hour recording stays inexpensive.
// Metadata and audio bytes together distinguish recordings with identical names.
export async function recordingId(file: File) {
  const edgeBytes = 65_536;
  const metadata = new TextEncoder().encode(JSON.stringify([file.name, file.size, file.lastModified]));
  const [head, tail] = await Promise.all([
    file.slice(0, edgeBytes).arrayBuffer(),
    file.slice(Math.max(edgeBytes, file.size - edgeBytes)).arrayBuffer(),
  ]);
  const bytes = new Uint8Array(metadata.length + head.byteLength + tail.byteLength);
  bytes.set(metadata);
  bytes.set(new Uint8Array(head), metadata.length);
  bytes.set(new Uint8Array(tail), metadata.length + head.byteLength);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isDetection(value: unknown, duration: number): value is Detection {
  if (!isRecord(value)) return false;
  if (!['id', 'start', 'end', 'peakTime', 'strength', 'dominantHz', 'confidence', 'geoProbability']
    .every((key) => finite(value[key]))) return false;
  if (!Number.isInteger(value.id) || (value.id as number) < 0
    || (value.start as number) < 0 || (value.end as number) <= (value.start as number)
    || (value.end as number) > duration + 0.01) return false;
  if (!['species', 'scientific', 'commonEnglish', 'band'].every((key) => typeof value[key] === 'string')) return false;
  if (typeof value.night !== 'boolean' || typeof value.prioritySpecies !== 'boolean') return false;
  if (!['pending', 'approved', 'rejected'].includes(value.reviewStatus as string)) return false;
  if (!['山口県・季節適合', '重点種・適期', '重点種・参考'].includes(value.filterStatus as string)) return false;
  if (value.goshawkSeason !== undefined && typeof value.goshawkSeason !== 'string') return false;
  if (value.reviewedAt !== undefined && (typeof value.reviewedAt !== 'string' || !Number.isFinite(Date.parse(value.reviewedAt)))) return false;
  return true;
}

export function loadReviewSession(storage: SessionStorage, fileId: string, regionKeys: readonly string[]) {
  const json = storage.getItem(PREFIX + fileId);
  if (!json) return undefined;
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || value.version !== 1 || value.revision !== REVIEW_REVISION
    || value.fileId !== fileId || !regionKeys.includes(value.regionKey as string)
    || typeof value.recordingStart !== 'string' || !Number.isFinite(Date.parse(value.recordingStart))
    || !finite(value.duration) || value.duration <= 0
    || !Number.isInteger(value.candidateCount) || (value.candidateCount as number) < 0
    || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))
    || !Array.isArray(value.overviewBars) || value.overviewBars.length !== 104
    || !value.overviewBars.every((bar) => finite(bar) && bar >= 0 && bar <= 100)
    || !Array.isArray(value.detections) || !value.detections.every((item) => isDetection(item, value.duration as number))
    || !Array.isArray(value.listenedIds) || !value.listenedIds.every(Number.isInteger)) {
    throw new Error('保存された確認結果の形式が一致しません。音声を再解析してください。');
  }
  const session = value as unknown as ReviewSession;
  const ids = new Set(session.detections.map((item) => item.id));
  if (ids.size !== session.detections.length || session.listenedIds.some((id) => !ids.has(id))) {
    throw new Error('保存された候補情報が不正です。音声を再解析してください。');
  }
  // An incomplete or older approval must never bypass the original-audio review.
  const listened = new Set(session.listenedIds);
  session.detections = session.detections.map((item) =>
    item.reviewStatus !== 'pending' && (!listened.has(item.id) || !item.reviewedAt)
      ? { ...item, reviewStatus: 'pending', reviewedAt: undefined } : item);
  return session;
}

export function saveReviewSession(storage: SessionStorage, session: ReviewSession) {
  storage.setItem(PREFIX + session.fileId, JSON.stringify(session));
}
