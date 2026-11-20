import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? pathToFileURL(path.resolve(`${specifier.slice(2)}.ts`)).href : specifier, context);
} });

const { kaleidoscopeCsv, ravenSelectionTable, speciesSummaryCsv } = await import('../lib/exports.ts');

const context = {
  fileName: '001D_260302_0550_1.wav',
  recordingStart: new Date(2026, 2, 2, 5, 50, 0),
  region: { name: '山口県・萩市', latitude: 34.4081, longitude: 131.3991 },
};

function detection(overrides) {
  return {
    id: 1, start: 2135.5, end: 2138.5, peakTime: 2136, strength: 20, dominantHz: 2000, band: '2 kHz',
    night: false, identification: 'species', species: 'オオタカ', scientific: 'Astur gentilis',
    commonEnglish: 'Eurasian Goshawk', confidence: 94, geoProbability: 3.3, prioritySpecies: true,
    filterStatus: '重点種・適期', reviewStatus: 'approved', reviewedAt: '2026-11-20T01:00:00.000Z',
    ...overrides,
  };
}

const unresolved = detection({
  id: 3, start: 10, end: 13, identification: 'unresolved', species: '鳥声候補・種未確定', scientific: '',
  commonEnglish: '', confidence: null, geoProbability: null, prioritySpecies: false, filterStatus: '種未確定',
  reviewStatus: 'pending', reviewedAt: undefined,
});
const crow = detection({
  id: 2, start: 2069, end: 2072, species: 'ハシブトガラス', scientific: 'Corvus macrorhynchos',
  confidence: 41, prioritySpecies: false, filterStatus: '山口県・季節適合', reviewStatus: 'rejected',
});
const items = [detection(), crow, unresolved, detection({ id: 4, start: 2199, end: 2202, confidence: 60, reviewStatus: 'pending', reviewedAt: undefined })];

/** Minimal RFC 4180 reader for fully quoted cells. */
function parseCsv(text, { bom = true } = {}) {
  assert.equal(text.startsWith('﻿'), bom, bom ? 'Excel-facing CSV starts with a BOM' : 'no BOM before the first header');
  const rows = [[]];
  let cell = '', quoted = false;
  for (let i = bom ? 1 : 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { rows.at(-1).push(cell); cell = ''; }
    else if (char === '\r' && text[i + 1] === '\n') { rows.at(-1).push(cell); cell = ''; rows.push([]); i++; }
    else cell += char;
  }
  if (rows.at(-1).length === 0) rows.pop();
  return rows;
}

test('Kaleidoscope CSV keeps BirdNET-Analyzer columns, 0-1 scores and time order', () => {
  const rows = parseCsv(kaleidoscopeCsv(items, context), { bom: false });
  assert.deepEqual(rows[0].slice(0, 13), ['INDIR', 'FOLDER', 'IN FILE', 'OFFSET', 'DURATION', 'scientific_name',
    'common_name', 'confidence', 'lat', 'lon', 'week', 'overlap', 'sensitivity']);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.slice(1).map((row) => row[3]), ['10.000', '2069.000', '2135.500', '2199.000']);
  const goshawk = rows[3];
  assert.deepEqual(goshawk.slice(0, 11), ['', '', '001D_260302_0550_1.wav', '2135.500', '3.0', 'Astur gentilis',
    'オオタカ', '0.94', '34.4081', '131.3991', '9']);
  assert.equal(goshawk[13], '承認');
  // Unresolved candidates stay in the file with blank species and score instead of an invented label.
  assert.deepEqual(rows[1].slice(5, 8), ['', '鳥声候補・種未確定', '']);
});

test('Raven selection table is tab-separated with numbered selections', () => {
  const lines = ravenSelectionTable(items, context).trimEnd().split('\r\n').map((line) => line.split('\t'));
  assert.deepEqual(lines[0].slice(0, 12), ['Selection', 'View', 'Channel', 'Begin Time (s)', 'End Time (s)',
    'Low Freq (Hz)', 'High Freq (Hz)', 'Common Name', 'Species Code', 'Confidence', 'Begin Path', 'File Offset (s)']);
  assert.deepEqual(lines.slice(1).map((line) => line[0]), ['1', '2', '3', '4']);
  assert.deepEqual(lines[2].slice(3, 11), ['2069.000', '2072.000', '0', '15000', 'ハシブトガラス', '', '0.41',
    '001D_260302_0550_1.wav']);
  assert.equal(lines[2][13], '却下');
  assert.ok(lines.every((line) => line.length === 14));
});

test('species summary counts decisions per species and keeps unresolved candidates last', () => {
  const rows = parseCsv(speciesSummaryCsv(items, context));
  assert.equal(rows[0][0], '和名');
  assert.deepEqual(rows.slice(1).map((row) => row[0]), ['オオタカ', 'ハシブトガラス', '鳥声候補・種未確定']);
  const [goshawk] = rows.slice(1);
  assert.deepEqual(goshawk.slice(0, 8), ['オオタカ', 'Astur gentilis', '○', '2', '1', '0', '1', '94']);
  assert.deepEqual(goshawk.slice(8, 12), ['0:35:35', '2026-03-02 06:25:35', '0:36:39', '2026-03-02 06:26:39']);
  assert.deepEqual(rows[3].slice(0, 8), ['鳥声候補・種未確定', '', '', '1', '0', '0', '1', '']);
});

test('quotes and line breaks in names cannot break the file structure', () => {
  const odd = detection({ species: 'A "quoted"\tname', scientific: 'X y' });
  const rows = parseCsv(kaleidoscopeCsv([odd], context), { bom: false });
  assert.equal(rows.length, 2);
  assert.equal(rows[1][6], 'A "quoted"\tname');
  const raven = ravenSelectionTable([odd], context).trimEnd().split('\r\n')[1].split('\t');
  assert.equal(raven.length, 14);
  assert.equal(raven[7], 'A "quoted" name');
});
