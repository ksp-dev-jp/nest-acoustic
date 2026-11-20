import type { Detection } from './audio-analysis';
import { birdNetWeek, reviewStatusLabel, type SurveyRegion } from '@/lib/species-filter';

/** Files are produced in the browser; only the recording's file name is known, not its folder. */
export type ExportContext = {
  fileName: string;
  recordingStart: Date;
  region: Pick<SurveyRegion, 'name' | 'latitude' | 'longitude'>;
};

const UNRESOLVED_NAME = '鳥声候補・種未確定';

type Cell = string | number | null | undefined;

function csvCell(value: Cell) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

/** `bom` helps Excel read Japanese; files for other software omit it so their first header stays exact. */
function csv(rows: Cell[][], bom = true) {
  return `${bom ? '﻿' : ''}${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** App scores are stored as whole percentages; BirdNET-style files use 0–1. */
function unitScore(confidence: number | null) {
  return confidence === null ? '' : (confidence / 100).toFixed(2);
}

function seconds(value: number) {
  return value.toFixed(3);
}

function speciesName(item: Detection) {
  return item.scientific ? item.species : UNRESOLVED_NAME;
}

function sorted(detections: Detection[]) {
  return [...detections].sort((a, b) => a.start - b.start || a.id - b.id);
}

/**
 * Same columns as BirdNET-Analyzer's Kaleidoscope output, plus review columns at the end.
 * INDIR and FOLDER are left blank because a browser cannot see where the recording is stored.
 */
export function kaleidoscopeCsv(detections: Detection[], context: ExportContext) {
  const week = birdNetWeek(context.recordingStart);
  return csv([
    ['INDIR', 'FOLDER', 'IN FILE', 'OFFSET', 'DURATION', 'scientific_name', 'common_name', 'confidence',
      'lat', 'lon', 'week', 'overlap', 'sensitivity', 'review_status', 'reviewed_at'],
    ...sorted(detections).map((item) => [
      '', '', context.fileName, seconds(item.start), (item.end - item.start).toFixed(1),
      item.scientific, speciesName(item), unitScore(item.confidence),
      context.region.latitude, context.region.longitude, week, '', '',
      reviewStatusLabel(item.reviewStatus), item.reviewedAt ?? '',
    ]),
  ], false);
}

/** Raven selection table (tab-separated). Extra columns after the standard ones are kept by Raven. */
export function ravenSelectionTable(detections: Detection[], context: ExportContext) {
  const header = ['Selection', 'View', 'Channel', 'Begin Time (s)', 'End Time (s)', 'Low Freq (Hz)',
    'High Freq (Hz)', 'Common Name', 'Species Code', 'Confidence', 'Begin Path', 'File Offset (s)',
    'Scientific Name', 'Review Status'];
  const clean = (value: Cell) => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
  const rows: Cell[][] = sorted(detections).map((item, index) => [
    index + 1, 'Spectrogram 1', 1, seconds(item.start), seconds(item.end), 0, 15000,
    speciesName(item), '', unitScore(item.confidence), context.fileName, seconds(item.start),
    item.scientific, reviewStatusLabel(item.reviewStatus),
  ]);
  return [header, ...rows].map((row) => row.map(clean).join('\t')).join('\r\n') + '\r\n';
}

function clockAt(context: ExportContext, offsetSeconds: number) {
  const time = new Date(context.recordingStart.getTime() + offsetSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} `
    + `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}

function position(offsetSeconds: number) {
  const total = Math.floor(offsetSeconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${Math.floor(total / 3600)}:${pad(Math.floor(total % 3600 / 60))}:${pad(total % 60)}`;
}

/** Per-species counts of candidates and review decisions. Candidates may overlap in time. */
export function speciesSummaryCsv(detections: Detection[], context: ExportContext) {
  type Row = {
    species: string; scientific: string; priority: boolean; total: number; approved: number;
    rejected: number; pending: number; maxConfidence: number | null; first: number; last: number;
  };
  const rows = new Map<string, Row>();
  for (const item of detections) {
    const key = item.scientific || UNRESOLVED_NAME;
    const row = rows.get(key) ?? {
      species: speciesName(item), scientific: item.scientific, priority: item.prioritySpecies, total: 0,
      approved: 0, rejected: 0, pending: 0, maxConfidence: null, first: item.start, last: item.start,
    };
    row.total += 1;
    row[item.reviewStatus] += 1;
    if (item.confidence !== null) row.maxConfidence = Math.max(row.maxConfidence ?? 0, item.confidence);
    row.first = Math.min(row.first, item.start);
    row.last = Math.max(row.last, item.start);
    rows.set(key, row);
  }
  const ordered = [...rows.values()].sort((a, b) =>
    Number(!a.scientific) - Number(!b.scientific) || b.total - a.total || a.first - b.first);
  return csv([
    ['和名', '学名', '重点種', '候補数', '承認', '却下', '未確認', '最大AI候補スコア(%)',
      '最初の検出位置', '最初の検出日時', '最後の検出位置', '最後の検出日時', '地域'],
    ...ordered.map((row) => [
      row.species, row.scientific, row.priority ? '○' : '', row.total, row.approved, row.rejected, row.pending,
      row.maxConfidence ?? '', position(row.first), clockAt(context, row.first),
      position(row.last), clockAt(context, row.last), context.region.name,
    ]),
  ]);
}
