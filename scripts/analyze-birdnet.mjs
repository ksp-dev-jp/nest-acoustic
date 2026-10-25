import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-web/wasm';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), list[index + 1]]);
  return pairs;
}, []));

for (const required of ['input', 'model', 'labels', 'output']) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const SEGMENT_SECONDS = 3;
const TARGET_RATE = 32_000;
const TARGET_SAMPLES = SEGMENT_SECONDS * TARGET_RATE;
const BATCH_SIZE = Number(args.batch || 8);
const THREAD_COUNT = Number(args.threads || 1);
const LIMIT_SECONDS = args['limit-seconds'] ? Number(args['limit-seconds']) : undefined;
const RECORDING_START = args['recording-start'] || '2026-03-02T05:50:00+09:00';

const japaneseNames = {
  'Astur gentilis': 'オオタカ',
  'Caprimulgus indicus': 'ヨタカ',
  'Caprimulgus jotaka': 'ヨタカ',
  'Corvus corone': 'ハシボソガラス',
  'Corvus macrorhynchos': 'ハシブトガラス',
  'Garrulus glandarius': 'カケス',
  'Gorsachius goisagi': 'ミゾゴイ',
  'Hypsipetes amaurotis': 'ヒヨドリ',
  'Ninox japonica': 'アオバズク',
  'Ninox scutulata': 'アオバズク',
  'Otus sunia': 'コノハズク',
  'Sittiparus varius': 'ヤマガラ',
  'Strix uralensis': 'フクロウ',
  'Turdus chrysolaus': 'アカハラ',
  'Turdus pallidus': 'シロハラ',
  'Vanellus cinereus': 'ケリ',
  'Zapornia fusca': 'ヒクイナ',
  'Zoothera aurea': 'トラツグミ',
  'Zosterops japonicus': 'メジロ',
};

const priorityScientificNames = new Set([
  'Strix uralensis',
  'Ninox japonica',
  'Ninox scutulata',
  'Caprimulgus indicus',
  'Caprimulgus jotaka',
  'Zoothera aurea',
  'Gorsachius goisagi',
  'Zapornia fusca',
  'Otus sunia',
  'Vanellus cinereus',
  'Astur gentilis',
]);

const manualAliases = {
  'オオタカ': ['Astur gentilis'],
  'カケス': ['Garrulus glandarius'],
  'シロハラ': ['Turdus pallidus'],
  'トラツグミ': ['Zoothera aurea'],
  'ハシブトガラス': ['Corvus macrorhynchos'],
  'ハシボソガラス': ['Corvus corone'],
  'ヒヨドリ': ['Hypsipetes amaurotis'],
  'メジロ': ['Zosterops japonicus'],
  'ヤマガラ': ['Sittiparus varius'],
  'アカハラ？': ['Turdus chrysolaus'],
};

function parseWavHeader(fileHandle) {
  const buffer = Buffer.alloc(1024 * 1024);
  const { bytesRead } = fs.readSync(fileHandle, buffer, 0, buffer.length, 0);
  const data = buffer.subarray(0, bytesRead);
  if (!['RIFF', 'RF64'].includes(data.toString('ascii', 0, 4)) || data.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Only RIFF/RF64 WAV is supported');
  }
  let offset = 12;
  let format;
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16) {
      format = {
        audioFormat: data.readUInt16LE(body),
        channels: data.readUInt16LE(body + 2),
        sampleRate: data.readUInt32LE(body + 4),
        blockAlign: data.readUInt16LE(body + 12),
        bitsPerSample: data.readUInt16LE(body + 14),
      };
    }
    if (id === 'data' && format) {
      const fileSize = fs.fstatSync(fileHandle).size;
      return {
        ...format,
        dataOffset: body,
        dataSize: Math.min(size === 0xffffffff ? fileSize - body : size, fileSize - body),
      };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV fmt/data chunks were not found');
}

function decodeSample(buffer, byteOffset, format, bits) {
  if (format === 3 && bits === 32) return buffer.readFloatLE(byteOffset);
  if (bits === 8) return (buffer.readUInt8(byteOffset) - 128) / 128;
  if (bits === 16) return buffer.readInt16LE(byteOffset) / 32768;
  if (bits === 24) return buffer.readIntLE(byteOffset, 3) / 8388608;
  if (bits === 32) return buffer.readInt32LE(byteOffset) / 2147483648;
  throw new Error(`Unsupported WAV sample format: ${format}/${bits}`);
}

function resampleSegment(buffer, firstFrame, availableFrames, wav, destination, destinationOffset) {
  const bytesPerSample = wav.bitsPerSample / 8;
  const ratio = wav.sampleRate / TARGET_RATE;
  const sampleAt = (frame) => {
    if (frame < 0 || frame >= availableFrames) return 0;
    let value = 0;
    const frameOffset = (firstFrame + frame) * wav.blockAlign;
    for (let channel = 0; channel < wav.channels; channel++) {
      value += decodeSample(buffer, frameOffset + channel * bytesPerSample, wav.audioFormat, wav.bitsPerSample);
    }
    return value / wav.channels;
  };
  for (let index = 0; index < TARGET_SAMPLES; index++) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = sampleAt(left);
    const b = sampleAt(left + 1);
    destination[destinationOffset + index] = a + (b - a) * fraction;
  }
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function csvRow(values) {
  return `${values.map(csvCell).join(',')}\r\n`;
}

function formatOffset(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
    .map((value) => String(value).padStart(2, '0')).join(':');
}

function recordingClock(seconds) {
  const start = new Date(RECORDING_START);
  return new Date(start.getTime() + seconds * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(' ', 'T');
}

function topBirds(scores, labels, birdIndices, count = 3) {
  const top = [];
  for (const index of birdIndices) {
    const score = Number(scores[index]);
    if (!Number.isFinite(score)) continue;
    if (top.length < count || score > top[top.length - 1].score) {
      top.push({ label: labels[index], score });
      top.sort((a, b) => b.score - a.score);
      if (top.length > count) top.pop();
    }
  }
  return top;
}

function aggregateManualValidation(manual, storedScores, topBySegment, labelByScientific) {
  const rows = [];
  for (const item of manual) {
    const aliases = manualAliases[item.species] || [];
    const labelIndices = aliases.map((name) => labelByScientific.get(name)?.index).filter(Number.isInteger);
    const firstSegment = Math.max(0, Math.floor(item.start_seconds / SEGMENT_SECONDS));
    const lastSegment = Math.min(storedScores.length - 1, Math.floor(Math.max(item.start_seconds, item.end_seconds - 0.001) / SEGMENT_SECONDS));
    let best = { score: 0, scientific: aliases[0] || '', segment: firstSegment };
    for (let segment = firstSegment; segment <= lastSegment; segment++) {
      for (const labelIndex of labelIndices) {
        const score = storedScores[segment]?.get(labelIndex) || 0;
        if (score > best.score) best = { score, scientific: labelByScientific.get(aliases.find((name) => labelByScientific.get(name)?.index === labelIndex))?.scientific || '', segment };
      }
    }
    const top = topBySegment[best.segment] || {};
    rows.push({
      ...item,
      expected_scientific: aliases.join(' / '),
      ai_score: best.score,
      ai_detected_10pct: best.score >= 0.10,
      ai_detected_25pct: best.score >= 0.25,
      best_segment_start: best.segment * SEGMENT_SECONDS,
      ai_top1_scientific: top.scientific || '',
      ai_top1_species: top.japanese || top.common || '',
      ai_top1_score: top.score || 0,
    });
  }
  return rows;
}

await fs.promises.mkdir(args.output, { recursive: true });
const labelsText = await fs.promises.readFile(args.labels, 'utf8');
const labels = labelsText.trim().split(/\r?\n/).slice(1).map((line) => {
  const [index, , scientific, common, className, order] = line.split(';');
  return { index: Number(index), scientific, common, className, order };
});
const labelByScientific = new Map(labels.map((label) => [label.scientific, label]));
const birdIndices = labels.filter((label) => label.className === 'Aves').map((label) => label.index);
const trackedIndices = new Set([
  ...priorityScientificNames,
  ...Object.values(manualAliases).flat(),
].map((name) => labelByScientific.get(name)?.index).filter(Number.isInteger));

const input = fs.openSync(args.input, 'r');
const wav = parseWavHeader(input);
if (![1, 3].includes(wav.audioFormat)) throw new Error(`Unsupported WAV format ${wav.audioFormat}`);
const totalFrames = Math.floor(wav.dataSize / wav.blockAlign);
const durationSeconds = totalFrames / wav.sampleRate;
const analysisSeconds = Math.min(durationSeconds, LIMIT_SECONDS || durationSeconds);
const segmentCount = Math.ceil(analysisSeconds / SEGMENT_SECONDS);
const framesPerSegment = Math.round(wav.sampleRate * SEGMENT_SECONDS);

// Node では複数スレッド版がローカル WASM を fetch しようとして失敗する
// 場合がある。推論はバッチ処理するため、安定する単一スレッド版を使う。
ort.env.wasm.numThreads = THREAD_COUNT;
ort.env.wasm.proxy = false;
if (args['wasm-binary']) {
  ort.env.wasm.wasmBinary = new Uint8Array(await fs.promises.readFile(args['wasm-binary']));
}
const modelBytes = new Uint8Array(await fs.promises.readFile(args.model));
console.log(JSON.stringify({ stage: 'model-loading', bytes: modelBytes.length }));
const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
const inputName = session.inputNames[0];
const predictionName = session.outputNames.find((name) => name.includes('prediction')) || session.outputNames[0];

const allStream = fs.createWriteStream(path.join(args.output, 'all_candidates.csv'), { encoding: 'utf8' });
const targetStream = fs.createWriteStream(path.join(args.output, 'priority_candidates.csv'), { encoding: 'utf8' });
const scoreStream = fs.createWriteStream(path.join(args.output, 'tracked_species_scores.csv'), { encoding: 'utf8' });
allStream.write('\uFEFF' + csvRow(['segment', 'offset_start', 'recording_time', 'rank', 'species_ja', 'scientific_name', 'common_name', 'confidence']));
targetStream.write('\uFEFF' + csvRow(['segment', 'offset_start', 'recording_time', 'species_ja', 'scientific_name', 'common_name', 'confidence']));
scoreStream.write('\uFEFF' + csvRow(['segment', 'offset_start', 'recording_time', 'species_ja', 'scientific_name', 'common_name', 'confidence']));

const storedScores = Array.from({ length: segmentCount }, () => new Map());
const topBySegment = Array(segmentCount);
const topSpeciesCounts = new Map();
const priorityCounts = new Map();
const startedAt = Date.now();

for (let batchStart = 0; batchStart < segmentCount; batchStart += BATCH_SIZE) {
  const currentBatch = Math.min(BATCH_SIZE, segmentCount - batchStart);
  const startFrame = batchStart * framesPerSegment;
  const remainingFrames = Math.max(0, totalFrames - startFrame);
  const wantedFrames = currentBatch * framesPerSegment;
  const framesToRead = Math.min(wantedFrames, remainingFrames);
  const readBuffer = Buffer.alloc(framesToRead * wav.blockAlign);
  fs.readSync(input, readBuffer, 0, readBuffer.length, wav.dataOffset + startFrame * wav.blockAlign);
  const tensorData = new Float32Array(currentBatch * TARGET_SAMPLES);
  for (let batchIndex = 0; batchIndex < currentBatch; batchIndex++) {
    const available = Math.max(0, Math.min(framesPerSegment, framesToRead - batchIndex * framesPerSegment));
    resampleSegment(readBuffer, batchIndex * framesPerSegment, available, wav, tensorData, batchIndex * TARGET_SAMPLES);
  }

  const result = await session.run({ [inputName]: new ort.Tensor('float32', tensorData, [currentBatch, TARGET_SAMPLES]) });
  const predictions = result[predictionName].data;
  for (let batchIndex = 0; batchIndex < currentBatch; batchIndex++) {
    const segment = batchStart + batchIndex;
    const offsetSeconds = segment * SEGMENT_SECONDS;
    const scores = predictions.subarray(batchIndex * labels.length, (batchIndex + 1) * labels.length);
    const top = topBirds(scores, labels, birdIndices, 3);
    const first = top[0];
    topBySegment[segment] = first ? {
      scientific: first.label.scientific,
      common: first.label.common,
      japanese: japaneseNames[first.label.scientific],
      score: first.score,
    } : {};
    if (first?.score >= 0.10) topSpeciesCounts.set(first.label.scientific, (topSpeciesCounts.get(first.label.scientific) || 0) + 1);

    top.forEach((entry, rank) => {
      if (entry.score < 0.05) return;
      allStream.write(csvRow([
        segment, formatOffset(offsetSeconds), recordingClock(offsetSeconds), rank + 1,
        japaneseNames[entry.label.scientific] || entry.label.common,
        entry.label.scientific, entry.label.common, entry.score.toFixed(6),
      ]));
    });

    for (const labelIndex of trackedIndices) {
      const score = Number(scores[labelIndex]);
      if (!Number.isFinite(score)) continue;
      storedScores[segment].set(labelIndex, score);
      const label = labels[labelIndex];
      if (score >= 0.02) {
        scoreStream.write(csvRow([
          segment, formatOffset(offsetSeconds), recordingClock(offsetSeconds),
          japaneseNames[label.scientific] || label.common, label.scientific, label.common, score.toFixed(6),
        ]));
      }
      if (priorityScientificNames.has(label.scientific) && score >= 0.05) {
        targetStream.write(csvRow([
          segment, formatOffset(offsetSeconds), recordingClock(offsetSeconds),
          japaneseNames[label.scientific] || label.common, label.scientific, label.common, score.toFixed(6),
        ]));
        priorityCounts.set(label.scientific, (priorityCounts.get(label.scientific) || 0) + 1);
      }
    }
  }

  if (batchStart === 0 || batchStart % (BATCH_SIZE * 10) === 0 || batchStart + currentBatch >= segmentCount) {
    const processed = batchStart + currentBatch;
    const elapsed = (Date.now() - startedAt) / 1000;
    const eta = processed ? elapsed * (segmentCount - processed) / processed : 0;
    console.log(JSON.stringify({
      stage: 'inference', processed, total: segmentCount,
      percent: Number((processed / segmentCount * 100).toFixed(1)),
      elapsed_seconds: Number(elapsed.toFixed(1)), eta_seconds: Number(eta.toFixed(1)),
    }));
  }
}

fs.closeSync(input);
await Promise.all([allStream, targetStream, scoreStream].map((stream) => new Promise((resolve, reject) => {
  stream.on('error', reject);
  stream.end(resolve);
})));

let manualValidation = [];
if (args.manual && fs.existsSync(args.manual)) {
  const manual = JSON.parse(await fs.promises.readFile(args.manual, 'utf8'));
  manualValidation = aggregateManualValidation(manual, storedScores, topBySegment, labelByScientific);
  const validationCsv = fs.createWriteStream(path.join(args.output, 'manual_validation.csv'), { encoding: 'utf8' });
  validationCsv.write('\uFEFF' + csvRow([
    'manual_species', 'call_type', 'start_seconds', 'end_seconds', 'expected_scientific',
    'ai_score', 'ai_detected_10pct', 'ai_detected_25pct', 'ai_top1_species',
    'ai_top1_scientific', 'ai_top1_score', 'best_segment_start', 'note',
  ]));
  for (const item of manualValidation) validationCsv.write(csvRow([
    item.species, item.call_type, item.start_seconds, item.end_seconds, item.expected_scientific,
    item.ai_score.toFixed(6), item.ai_detected_10pct, item.ai_detected_25pct,
    item.ai_top1_species, item.ai_top1_scientific, Number(item.ai_top1_score).toFixed(6),
    item.best_segment_start, item.note || '',
  ]));
  await new Promise((resolve, reject) => { validationCsv.on('error', reject); validationCsv.end(resolve); });
}

const byManualSpecies = Object.values(manualValidation.reduce((groups, item) => {
  groups[item.species] ||= { species: item.species, annotations: 0, detected_10pct: 0, detected_25pct: 0, max_score: 0 };
  const group = groups[item.species];
  group.annotations += 1;
  group.detected_10pct += Number(item.ai_detected_10pct);
  group.detected_25pct += Number(item.ai_detected_25pct);
  group.max_score = Math.max(group.max_score, item.ai_score);
  return groups;
}, {}));

const topSpecies = [...topSpeciesCounts.entries()].map(([scientific, count]) => ({
  scientific,
  species: japaneseNames[scientific] || labelByScientific.get(scientific)?.common || scientific,
  common: labelByScientific.get(scientific)?.common || '',
  segments_over_10pct: count,
})).sort((a, b) => b.segments_over_10pct - a.segments_over_10pct);

const prioritySpecies = [...priorityCounts.entries()].map(([scientific, count]) => ({
  scientific,
  species: japaneseNames[scientific] || labelByScientific.get(scientific)?.common || scientific,
  common: labelByScientific.get(scientific)?.common || '',
  segments_over_5pct: count,
})).sort((a, b) => b.segments_over_5pct - a.segments_over_5pct);

const summary = {
  input_file: path.basename(args.input),
  recording_start: RECORDING_START,
  duration_seconds: durationSeconds,
  analyzed_seconds: analysisSeconds,
  channels: wav.channels,
  sample_rate: wav.sampleRate,
  bits_per_sample: wav.bitsPerSample,
  segment_seconds: SEGMENT_SECONDS,
  segment_count: segmentCount,
  model: 'BirdNET+ V3.0-preview3.1 Global 10K-pruned FP16',
  inference_thresholds: { general_top1: 0.10, priority_candidates: 0.05, manual_validation: [0.10, 0.25] },
  top_species: topSpecies,
  priority_species: prioritySpecies,
  manual_validation_by_species: byManualSpecies,
  elapsed_seconds: (Date.now() - startedAt) / 1000,
};
await fs.promises.writeFile(path.join(args.output, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
await session.release();
console.log(JSON.stringify({ stage: 'complete', output: path.resolve(args.output), elapsed_seconds: summary.elapsed_seconds }));
