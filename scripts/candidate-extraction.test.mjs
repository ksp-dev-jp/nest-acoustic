import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? pathToFileURL(path.resolve(`${specifier.slice(2)}.ts`)).href : specifier, context);
}});
const { detectCandidates } = await import('../lib/audio-analysis.ts');

function recording(seconds, calls, background = () => 0) {
  const sampleRate = 8_000;
  const data = new Float32Array(Math.ceil(seconds * sampleRate));
  for (let i = 0; i < data.length; i++) data[i] = background(i / sampleRate);
  for (const [start, length, amplitude = 0.1] of calls) {
    for (let i = Math.floor(start * sampleRate); i < Math.min(data.length, (start + length) * sampleRate); i++) {
      data[i] += amplitude * Math.sin(2 * Math.PI * 1700 * i / sampleRate);
    }
  }
  return { duration: seconds, sampleRate, channels: 1, decoded: { numberOfChannels: 1, getChannelData: () => data } };
}
const start = new Date('2026-03-02T05:50:00+09:00');
const scan = (source, signal) => detectCandidates(source, start, () => {}, signal);
const covers = (candidates, time) => candidates.some(item => item.start <= time && item.end > time);

test('short calls between the former sparse sample times are retained', async () => {
  const calls = [[2.02, 0.025], [8.3, 0.04], [19.1, 0.02]];
  const { candidates } = await scan(recording(24, calls));
  for (const [time] of calls) assert.ok(covers(candidates, time), `missing call at ${time}s`);
});

test('quiet calls remain detectable when another minute is much louder', async () => {
  const { candidates } = await scan(recording(125, [[20, 0.1, 0.002], [90, 0.1, 0.5]]));
  assert.ok(covers(candidates, 20));
  assert.ok(covers(candidates, 90));
});

test('more than 160 separated calls remain available, including the recording tail', async () => {
  const calls = Array.from({ length: 180 }, (_, index) => [index * 4 + 1, 0.04]);
  const { candidates } = await scan(recording(721, calls));
  assert.ok(candidates.length > 160);
  for (const [time] of calls) assert.ok(covers(candidates, time), `missing call at ${time}s`);
  assert.equal(new Set(candidates.map(x => x.id)).size, candidates.length);
});

test('minute boundaries, file edges and clips shorter than 3 seconds are valid', async () => {
  for (const [duration, calls] of [[61, [[0, 0.02], [59.99, 0.04], [60.98, 0.02]]], [0.2, [[0.05, 0.02]]]]) {
    const { candidates } = await scan(recording(duration, calls));
    for (const [time] of calls) assert.ok(covers(candidates, time));
    for (const item of candidates) assert.ok(item.start >= 0 && item.end <= duration && item.end > item.start);
  }
});

test('silence and a steady background do not become bird candidates', async () => {
  assert.equal((await scan(recording(10, []))).candidates.length, 0);
  const steady = await scan(recording(10, [], t => 0.05 * Math.sin(2 * Math.PI * 1000 * t)));
  // The padded file ending may form a transient; the steady interior must not.
  assert.equal(steady.candidates.filter(x => x.peakTime < 9.9).length, 0);
});

test('a cancelled long scan stops without returning partial candidates as complete', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scan(recording(10, [[1, 0.1]]), controller.signal), { name: 'AbortError' });
});
