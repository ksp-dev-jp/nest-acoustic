// Offline, resumable experiments. Survey data and generated results stay in outputs/.
// node scripts/experiment-bird-detection.mjs --audio <wav> --manual <json>
//   --candidates <json> --baseline <json> --out outputs/<experiment>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web/wasm';

process.env.TZ = 'Asia/Tokyo';
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
for (const name of ['audio', 'manual', 'candidates', 'baseline', 'out']) {
  if (!args[name]) throw new Error(`Missing --${name}`);
}
const root = process.cwd();
const out = path.resolve(args.out);
if (!out.startsWith(path.join(root, 'outputs') + path.sep)) throw new Error('Use an ignored outputs/ directory');
fs.mkdirSync(out, { recursive: true });
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const cache = path.join(root, 'raw/.birdnet-cache');
const aliases = { 'オオタカ': 'Astur gentilis', 'トラツグミ': 'Zoothera aurea', 'シロハラ': 'Turdus pallidus',
  'ハシブトガラス': 'Corvus macrorhynchos', 'ハシボソガラス': 'Corvus corone', 'カケス': 'Garrulus glandarius',
  'ヒヨドリ': 'Hypsipetes amaurotis', 'メジロ': 'Zosterops japonicus', 'ヤマガラ': 'Sittiparus varius' };
const manual = readJSON(args.manual).filter(row => !row.species.includes('？'));
if (!manual.length || manual.some(row => !aliases[row.species])) throw new Error('Unmapped manual species');
const from = Math.min(...manual.map(row => row.start_seconds));
const to = Math.max(...manual.map(row => row.end_seconds));
const overlap = (a, b) => a.start < b.end_seconds && a.end > b.start_seconds;
const candidates = readJSON(args.candidates).candidates.filter(item => item.start < to && item.end > from);
const baseline = readJSON(args.baseline);
const modelBytes = fs.readFileSync(path.join(cache, 'birdnet.onnx'));
const geoBytes = fs.readFileSync(path.join(cache, 'geomodel.onnx'));
const stat = fs.statSync(args.audio);
const fingerprint = crypto.createHash('sha256').update(modelBytes).update(geoBytes)
  .update(fs.readFileSync(args.manual)).update(fs.readFileSync(args.candidates))
  .update(JSON.stringify([path.resolve(args.audio), stat.size, stat.mtimeMs, from, to, 'offsets-0,-0.75,0.75-v1'])).digest('hex');
const metaFile = path.join(out, 'experiment-metadata.json');
if (fs.existsSync(metaFile) && readJSON(metaFile).fingerprint !== fingerprint) throw new Error('Cache inputs differ');
fs.writeFileSync(metaFile, JSON.stringify({ fingerprint, from, to, model: 'BirdNET+ v3.0-preview3.1',
  geo: 'GeoModel v3.0.4', recordingStart: '2026-03-02T05:50:00+09:00', latitude: 34.4081, longitude: 131.3991,
  warning: 'Exploratory evaluation on one partly annotated recording. No independent accuracy estimate.' }, null, 2));
registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith('@/') ? pathToFileURL(path.resolve(`${specifier.slice(2)}.ts`)).href : specifier, context);
  },
  load(url, context, next) {
    if (url === pathToFileURL(path.join(root, 'lib/audio-analysis.ts')).href) {
      return { format: 'module', source: stripTypeScriptTypes(fs.readFileSync(new URL(url), 'utf8').replace('import.meta.env.BASE_URL', "'/'")), shortCircuit: true };
    }
    return next(url, context);
  },
});
const { createAudioSource, readModelWindow } = await import('../lib/audio-analysis.ts');
const { PRIORITY_SPECIES, birdNetWeek } = await import('../lib/species-filter.ts');
const source = await createAudioSource(new File([await fs.openAsBlob(args.audio)], path.basename(args.audio)));
const labels = fs.readFileSync(path.join(cache, 'labels.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map(line => {
  const [index, , scientific, common, className] = line.split(';');
  return { index: Number(index), scientific, common, bird: className === 'Aves' };
});
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmBinary = new Uint8Array(fs.readFileSync('public/ort/ort-wasm-simd-threaded.wasm'));
const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
const geoSession = await ort.InferenceSession.create(new Uint8Array(geoBytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
const geoResult = await geoSession.run({ [geoSession.inputNames[0]]: new ort.Tensor('float32', new Float32Array([34.4081, 131.3991, birdNetWeek(new Date('2026-03-02T05:50:00+09:00'))]), [1, 3]) });
const geoRaw = geoResult[geoSession.outputNames[0]].data;
const geo = new Map(fs.readFileSync(path.join(cache, 'geomodel-labels.txt'), 'utf8').trim().split(/\r?\n/).map((line, index) => [line.split('\t')[1], Number(geoRaw[index]) || 0]));
await geoSession.release();
const key = start => start.toFixed(6);
const clamp = start => Math.max(0, Math.min(source.duration - 3, start));
const jobs = new Map();
for (const candidate of candidates) for (const offset of [0, -0.75, 0.75]) {
  const start = clamp(candidate.start + offset);
  jobs.set(key(start), { start, end: start + 3 });
}
// These oracle windows diagnose alignment only; they are excluded from deployable comparisons.
for (const row of manual) {
  const start = clamp((row.start_seconds + row.end_seconds) / 2 - 1.5);
  jobs.set(key(start), { start, end: start + 3 });
}
const scoreFile = path.join(out, 'scores.jsonl');
const scored = new Map();
if (fs.existsSync(scoreFile)) {
  // A killed process may leave a partial last line. Rewrite only complete validated lines.
  for (const line of fs.readFileSync(scoreFile, 'utf8').split('\n').filter(Boolean)) {
    try { const row = JSON.parse(line); scored.set(key(row.start), row); } catch { /* retry partial last job */ }
  }
  fs.writeFileSync(scoreFile, [...scored.values()].map(row => JSON.stringify(row) + '\n').join(''));
}
const predictionName = session.outputNames.find(name => name.includes('prediction')) ?? session.outputNames[0];
const targets = new Set(Object.values(aliases));
const started = Date.now();
let completed = 0;
try {
  for (const [id, job] of jobs) {
    if (scored.has(id)) continue;
    const audio = await readModelWindow(source, job.start, 3);
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', audio, [1, audio.length]) });
    const raw = output[predictionName].data;
    const frames = Math.max(1, Math.floor(raw.length / labels.length));
    const ranked = labels.map(label => {
      let score = 0;
      for (let frame = 0; frame < frames; frame++) score = Math.max(score, Number(raw[frame * labels.length + label.index] ?? 0));
      if (score < 0 || score > 1) score = 1 / (1 + Math.exp(-score));
      return { scientific: label.scientific, score, geo: geo.get(label.scientific) ?? 0, bird: label.bird };
    }).sort((a, b) => b.score - a.score);
    const birds = ranked.filter(row => row.bird);
    const regional = birds.filter(row => row.geo >= 0.03);
    const row = { ...job, top: ranked.slice(0, 30), birds: birds.slice(0, 30), regional: regional.slice(0, 30),
      priority: birds.filter(row => PRIORITY_SPECIES.has(row.scientific)).slice(0, 1),
      targets: Object.fromEntries(birds.filter(row => targets.has(row.scientific)).map(row => [row.scientific,
        { score: row.score, geo: row.geo, rank: birds.indexOf(row) + 1, regionalRank: regional.indexOf(row) + 1 }])) };
    fs.appendFileSync(scoreFile, JSON.stringify(row) + '\n');
    scored.set(id, row);
    completed++;
    if (completed === 1 || completed % 50 === 0) console.log(JSON.stringify({ done: scored.size, total: jobs.size, elapsed_seconds: (Date.now() - started) / 1000 }));
  }
} finally { await session.release(); }

function select(row, threshold = 0.18, topN = 1) {
  const selected = [];
  const priority = row.priority[0];
  if (priority?.score >= 0.05) selected.push(priority);
  for (const label of row.regional.slice(0, topN)) if (label.score >= threshold && label.scientific !== priority?.scientific) selected.push(label);
  return selected.map(label => ({ start: row.start, end: row.end, scientific: label.scientific, score: label.score }));
}
function evaluate(name, threshold, topN, offsets) {
  const detections = candidates.flatMap(candidate => offsets.flatMap(offset => select(scored.get(key(clamp(candidate.start + offset))), threshold, topN)));
  const unique = [...new Map(detections.map(row => [`${key(row.start)}|${row.scientific}`, row])).values()];
  const matched = manual.filter(row => unique.some(item => overlap(item, row) && item.scientific === aliases[row.species]));
  return { name, threshold, topN, offsets, confirmed: manual.length, matched: matched.length,
    named_rows: unique.length, named_intervals: new Set(unique.map(row => key(row.start))).size,
    manual_matched_rows: unique.filter(item => manual.some(row => overlap(item, row) && item.scientific === aliases[row.species])).length,
    by_species: Object.keys(aliases).map(species => ({ species, confirmed: manual.filter(row => row.species === species).length, matched: matched.filter(row => row.species === species).length })) };
}
const experiments = [];
for (const threshold of [0.05, 0.1, 0.18, 0.25, 0.35]) for (const topN of [1, 3]) {
  experiments.push(evaluate(`threshold-${threshold}-top${topN}`, threshold, topN, [0]));
}
experiments.push(evaluate('shift-three-windows', 0.18, 1, [0, -0.75, 0.75]));
experiments.push(evaluate('shift-three-windows-top3', 0.18, 3, [0, -0.75, 0.75]));
experiments.push(evaluate('shift-three-windows-threshold-0.1', 0.1, 1, [0, -0.75, 0.75]));
experiments.push(evaluate('shift-three-windows-threshold-0.05', 0.05, 1, [0, -0.75, 0.75]));
const baselineRows = candidates.flatMap(candidate => select(scored.get(key(candidate.start))));
const expected = baseline.detections.filter(row => row.identification !== 'unresolved');
const signature = row => `${key(row.start)}|${row.scientific}|${Math.round(row.score === undefined ? row.confidence : row.score * 100)}`;
const actualSet = new Set(baselineRows.map(signature)), expectedSet = new Set(expected.map(signature));
const parity = { matches: actualSet.size === expectedSet.size && [...actualSet].every(row => expectedSet.has(row)), actual: actualSet.size, expected: expectedSet.size };
if (!parity.matches) throw new Error(`Baseline differs: ${JSON.stringify(parity)}`);
const diagnosis = manual.map(row => {
  const scientific = aliases[row.species];
  const windows = candidates.filter(item => overlap(item, row)).map(item => scored.get(key(item.start)));
  const best = [...windows].sort((a, b) => b.targets[scientific].score - a.targets[scientific].score)[0];
  const shifted = candidates.flatMap(item => [-0.75, 0.75].map(offset => scored.get(key(clamp(item.start + offset))))).filter(item => overlap(item, row));
  const bestShift = shifted.sort((a, b) => b.targets[scientific].score - a.targets[scientific].score)[0];
  const oracle = scored.get(key(clamp((row.start_seconds + row.end_seconds) / 2 - 1.5)));
  const matched = baselineRows.some(item => overlap(item, row) && item.scientific === scientific);
  const target = best.targets[scientific];
  return { ...row, scientific, matched, baseline_windows: windows.length,
    best: { start: best.start, ...target, regional_best: best.regional[0] },
    shifted: { start: bestShift.start, ...bestShift.targets[scientific] },
    oracle_centered: { start: oracle.start, ...oracle.targets[scientific] },
    diagnosis: matched ? 'matched' : target.geo < 0.03 && !PRIORITY_SPECIES.has(scientific) ? 'geo-filter'
      : target.score < (PRIORITY_SPECIES.has(scientific) ? 0.05 : 0.18) ? 'low-acoustic-score' : 'other-species-ranked-first' };
});
const triage = [0.01, 0.03, 0.05, 0.1, 0.18, 0.25, 0.35, 0.5].map(threshold => {
  const high = candidates.filter(item => scored.get(key(item.start)).birds[0].score >= threshold);
  const matched = manual.filter(row => high.some(item => overlap(item, row)));
  const labels = high.flatMap(item => select(scored.get(key(item.start))));
  return { threshold, high_priority_intervals: high.length, lower_priority_intervals: candidates.length - high.length,
    manual_temporal_covered_in_high: matched.length,
    manual_species_matched_in_high: manual.filter(row => labels.some(item => overlap(item, row) && item.scientific === aliases[row.species])).length,
    warning: 'Max species score is a ranking proxy, not P(bird) or validated noise classification. Do not discard low-priority intervals.' };
});
const speciesThresholds = Object.entries(aliases).map(([species, scientific]) => ({ species, scientific,
  trials: [0.05, 0.1, 0.18, 0.25, 0.35].map(threshold => {
    const rows = candidates.filter(item => scored.get(key(item.start)).targets[scientific].geo >= 0.03 && scored.get(key(item.start)).targets[scientific].score >= threshold);
    return { threshold, proposed_rows: rows.length, manual_records_matched: manual.filter(row => row.species === species && rows.some(item => overlap(item, row))).length };
  }) }));
const intervals = candidates.map(item => ({ ...item, maxBirdScore: scored.get(key(item.start)).birds[0].score,
  bestBird: scored.get(key(item.start)).birds[0].scientific,
  manual_overlap: manual.some(row => overlap(item, row)) }));
const summary = { source: { name: path.basename(args.audio), size: stat.size }, fingerprint,
  scope: { from, to, manual_records: manual.length, candidate_intervals: candidates.length },
  baseline_parity: parity, experiments, triage, speciesThresholds,
  unmatched_diagnoses: diagnosis.filter(row => !row.matched).reduce((counts, row) => ({ ...counts, [row.diagnosis]: (counts[row.diagnosis] ?? 0) + 1 }), {}),
  warning: 'Same-recording exploratory comparisons. Unannotated audio is not a negative label. Precision, noise rejection accuracy and generalization remain unknown.' };
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ summary, diagnosis, intervals, manual }, null, 2));
console.log(JSON.stringify(summary, null, 2));
