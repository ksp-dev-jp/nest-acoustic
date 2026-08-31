export type WavInfo = {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataSize: number;
};

export type AudioSource = {
  file: File;
  duration: number;
  sampleRate: number;
  channels: number;
  wav?: WavInfo;
  decoded?: AudioBuffer;
};

export type Candidate = {
  id: number;
  start: number;
  end: number;
  peakTime: number;
  strength: number;
  dominantHz: number;
  band: string;
  night: boolean;
};

export type Detection = Candidate & {
  species: string;
  scientific: string;
  confidence: number;
  commonEnglish: string;
};

type FrameMetric = {
  time: number;
  db: number;
  birdRatio: number;
  dominantHz: number;
};

const TARGET_RATE = 32_000;
const MODEL_TAG = 'v1.1.2';
const MODEL_BASE = `https://raw.githubusercontent.com/birdnet-team/birdnet-live-app/${MODEL_TAG}/assets/models`;
const MODEL_URL = `https://media.githubusercontent.com/media/birdnet-team/birdnet-live-app/${MODEL_TAG}/assets/models/BirdNET%2B_V3.0-preview3.1_Global_10K-pruned_FP16.onnx`;
const LABELS_URL = `${MODEL_BASE}/BirdNET%2B_V3.0-preview3.1_Global_10K-pruned_Labels.csv`;

const JAPANESE_NAMES: Record<string, string> = {
  'Asio flammeus': 'コミミズク',
  'Asio otus': 'トラフズク',
  'Bubo blakistoni': 'シマフクロウ',
  'Caprimulgus indicus': 'ヨタカ',
  'Caprimulgus jotaka': 'ヨタカ',
  'Glaucidium cuculoides': 'オオスズメフクロウ',
  'Ninox scutulata': 'アオバズク',
  'Otus semitorques': 'オオコノハズク',
  'Otus sunia': 'コノハズク',
  'Strix uralensis': 'フクロウ',
  'Zoothera aurea': 'トラツグミ',
  'Horornis diphone': 'ウグイス',
  'Cuculus poliocephalus': 'ホトトギス',
  'Cuculus optatus': 'ツツドリ',
  'Cuculus canorus': 'カッコウ',
  'Turdus cardis': 'クロツグミ',
  'Turdus pallidus': 'シロハラ',
};

function ascii(view: DataView, offset: number, length: number) {
  return Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('');
}

async function parseWav(file: File): Promise<WavInfo | undefined> {
  const header = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
  const view = new DataView(header);
  if (view.byteLength < 44 || !['RIFF', 'RF64'].includes(ascii(view, 0, 4)) || ascii(view, 8, 4) !== 'WAVE') return;

  let fmt: Omit<WavInfo, 'dataOffset' | 'dataSize'> | undefined;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= view.byteLength) {
      fmt = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    }
    if (id === 'data' && fmt) {
      const dataSize = Math.min(size === 0xffffffff ? file.size - body : size, file.size - body);
      return { ...fmt, dataOffset: body, dataSize };
    }
    offset = body + size + (size % 2);
  }
}

export async function createAudioSource(file: File): Promise<AudioSource> {
  const wav = await parseWav(file);
  if (wav && [1, 3].includes(wav.audioFormat) && [8, 16, 24, 32].includes(wav.bitsPerSample)) {
    return {
      file,
      wav,
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      duration: wav.dataSize / wav.blockAlign / wav.sampleRate,
    };
  }

  if (file.size > 250 * 1024 * 1024) {
    throw new Error('250MBを超える長時間録音は、PCM形式のWAVで読み込んでください。');
  }
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    return { file, decoded, duration: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels };
  } catch {
    throw new Error('音声形式を読み込めませんでした。PCM WAV、MP3、FLAC、OGGのいずれかをお試しください。');
  } finally {
    await context.close();
  }
}

function decodeSample(view: DataView, offset: number, format: number, bits: number) {
  if (format === 3 && bits === 32) return view.getFloat32(offset, true);
  if (bits === 8) return (view.getUint8(offset) - 128) / 128;
  if (bits === 16) return view.getInt16(offset, true) / 32768;
  if (bits === 24) {
    let value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
    if (value & 0x800000) value |= 0xff000000;
    return value / 8388608;
  }
  return view.getInt32(offset, true) / 2147483648;
}

export async function readMono(source: AudioSource, start: number, duration: number) {
  const startFrame = Math.max(0, Math.floor(start * source.sampleRate));
  const wantedFrames = Math.max(1, Math.ceil(duration * source.sampleRate));
  const availableFrames = Math.max(0, Math.min(wantedFrames, Math.floor(source.duration * source.sampleRate) - startFrame));
  const output = new Float32Array(wantedFrames);

  if (source.decoded) {
    for (let channel = 0; channel < source.decoded.numberOfChannels; channel++) {
      const data = source.decoded.getChannelData(channel);
      for (let i = 0; i < availableFrames; i++) output[i] += data[startFrame + i] / source.decoded.numberOfChannels;
    }
    return output;
  }

  const wav = source.wav!;
  const bytesPerSample = wav.bitsPerSample / 8;
  const byteStart = wav.dataOffset + startFrame * wav.blockAlign;
  const buffer = await source.file.slice(byteStart, byteStart + availableFrames * wav.blockAlign).arrayBuffer();
  const view = new DataView(buffer);
  for (let frame = 0; frame < availableFrames; frame++) {
    let sample = 0;
    const frameOffset = frame * wav.blockAlign;
    for (let channel = 0; channel < wav.channels; channel++) {
      sample += decodeSample(view, frameOffset + channel * bytesPerSample, wav.audioFormat, wav.bitsPerSample);
    }
    output[frame] = sample / wav.channels;
  }
  return output;
}

function resample(input: Float32Array, sourceRate: number, targetRate: number, targetLength?: number) {
  const length = targetLength ?? Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(length);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    output[i] = (input[left] ?? 0) * (1 - fraction) + (input[left + 1] ?? input[left] ?? 0) * fraction;
  }
  return output;
}

export async function readModelWindow(source: AudioSource, start: number, seconds = 3) {
  const input = await readMono(source, start, seconds);
  return resample(input, source.sampleRate, TARGET_RATE, seconds * TARGET_RATE);
}

function fftMagnitude(input: Float32Array) {
  const n = input.length;
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let i = 0; i < n; i++) real[i] = input[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = -2 * Math.PI / size;
    const half = size >> 1;
    for (let offset = 0; offset < n; offset += size) {
      for (let k = 0; k < half; k++) {
        const c = Math.cos(angle * k);
        const s = Math.sin(angle * k);
        const even = offset + k;
        const odd = even + half;
        const tr = c * real[odd] - s * imag[odd];
        const ti = s * real[odd] + c * imag[odd];
        real[odd] = real[even] - tr;
        imag[odd] = imag[even] - ti;
        real[even] += tr;
        imag[even] += ti;
      }
    }
  }
  return Array.from({ length: n / 2 }, (_, i) => real[i] * real[i] + imag[i] * imag[i]);
}

function frameMetric(frame: Float32Array, sampleRate: number, time: number): FrameMetric {
  let sum = 0;
  for (const value of frame) sum += value * value;
  const db = 20 * Math.log10(Math.sqrt(sum / frame.length) + 1e-8);
  const spectrum = fftMagnitude(frame);
  let total = 0;
  let bird = 0;
  let dominant = 0;
  let dominantPower = 0;
  for (let bin = 1; bin < spectrum.length; bin++) {
    const hz = bin * sampleRate / frame.length;
    const power = spectrum[bin];
    total += power;
    if (hz >= 250 && hz <= Math.min(12_000, sampleRate / 2)) {
      bird += power;
      if (power > dominantPower) {
        dominantPower = power;
        dominant = hz;
      }
    }
  }
  return { time, db, birdRatio: bird / Math.max(total, 1e-12), dominantHz: dominant };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isNightAt(offsetSeconds: number, recordingStart: Date) {
  const time = new Date(recordingStart.getTime() + offsetSeconds * 1000);
  const hour = time.getHours() + time.getMinutes() / 60;
  return hour >= 18 || hour < 6;
}

function frequencyBand(hz: number) {
  const low = Math.max(0.1, hz * 0.72 / 1000).toFixed(1);
  const high = Math.max(0.2, hz * 1.35 / 1000).toFixed(1);
  return `${low}–${high} kHz`;
}

export async function detectCandidates(
  source: AudioSource,
  recordingStart: Date,
  onProgress: (value: number, detail: string) => void,
  signal?: AbortSignal,
) {
  const metrics: FrameMetric[] = [];
  const chunkSeconds = 60;
  const hopSeconds = 2.5;
  const fftSize = 1024;
  const totalChunks = Math.ceil(source.duration / chunkSeconds);

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (signal?.aborted) throw new DOMException('解析を中止しました', 'AbortError');
    const chunkStart = chunkIndex * chunkSeconds;
    const chunkDuration = Math.min(chunkSeconds, source.duration - chunkStart);
    const samples = await readMono(source, chunkStart, chunkDuration);
    for (let local = 0; local < chunkDuration; local += hopSeconds) {
      let bestFrame: Float32Array | undefined;
      let bestDb = -Infinity;
      let bestTime = chunkStart + local;
      for (const fraction of [0.1, 0.35, 0.6, 0.85]) {
        const start = Math.min(Math.max(0, samples.length - fftSize), Math.floor((local + hopSeconds * fraction) * source.sampleRate));
        const frame = samples.slice(start, start + fftSize);
        if (frame.length < fftSize) continue;
        let sum = 0;
        for (const value of frame) sum += value * value;
        const db = 20 * Math.log10(Math.sqrt(sum / frame.length) + 1e-8);
        if (db > bestDb) {
          bestDb = db;
          bestFrame = frame;
          bestTime = chunkStart + start / source.sampleRate;
        }
      }
      if (bestFrame) metrics.push(frameMetric(bestFrame, source.sampleRate, bestTime));
    }
    onProgress(5 + Math.round(30 * (chunkIndex + 1) / totalChunks), `録音を走査中 ${chunkIndex + 1}/${totalChunks}`);
    if (chunkIndex % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const noiseFloor = median(metrics.map((item) => item.db));
  const mad = median(metrics.map((item) => Math.abs(item.db - noiseFloor)));
  const threshold = noiseFloor + Math.max(5, mad * 2.8);
  const ranked = metrics
    .filter((item) => item.db >= threshold && item.birdRatio >= 0.22 && item.dominantHz >= 250)
    .map((item) => ({ ...item, strength: item.db - threshold }))
    .sort((a, b) => b.strength - a.strength);

  const accepted: typeof ranked = [];
  for (const item of ranked) {
    if (accepted.some((existing) => Math.abs(existing.time - item.time) < 2.7)) continue;
    accepted.push(item);
  }

  const candidates = accepted
    .sort((a, b) => Number(isNightAt(b.time, recordingStart)) - Number(isNightAt(a.time, recordingStart)) || b.strength - a.strength)
    .slice(0, 160)
    .map<Candidate>((item, index) => {
      const start = Math.max(0, Math.min(source.duration - 3, item.time - 1.5));
      return {
        id: index + 1,
        start,
        end: Math.min(source.duration, start + 3),
        peakTime: item.time,
        strength: item.strength,
        dominantHz: item.dominantHz,
        band: frequencyBand(item.dominantHz),
        night: isNightAt(item.time, recordingStart),
      };
    });

  const bucketCount = 104;
  const overview = Array.from({ length: bucketCount }, (_, bucket) => {
    const from = bucket * source.duration / bucketCount;
    const to = (bucket + 1) * source.duration / bucketCount;
    const values = metrics.filter((item) => item.time >= from && item.time < to).map((item) => item.db);
    return values.length ? Math.max(...values) : noiseFloor;
  });
  const low = Math.min(...overview);
  const high = Math.max(...overview);
  const bars = overview.map((value) => 10 + 68 * (value - low) / Math.max(1, high - low));
  return { candidates, bars, noiseFloor, threshold };
}

type BirdLabel = { index: number; scientific: string; common: string; bird: boolean };

async function fetchCached(url: string, onDownload?: (loaded: number, total?: number) => void) {
  const cache = 'nest-acoustic-birdnet-v1';
  const cached = 'caches' in window ? await caches.open(cache).then((store) => store.match(url)).catch(() => undefined) : undefined;
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  const response = await fetch(url);
  if (!response.ok) throw new Error(`AIモデルを取得できませんでした (${response.status})`);
  const total = Number(response.headers.get('content-length')) || undefined;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onDownload?.(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if ('caches' in window) {
    const copy = bytes.slice();
    caches.open(cache).then((store) => store.put(url, new Response(copy))).catch(() => undefined);
  }
  return bytes;
}

async function loadLabels(): Promise<BirdLabel[]> {
  const response = await fetch(LABELS_URL);
  if (!response.ok) throw new Error('鳥種リストを取得できませんでした。');
  const lines = (await response.text()).trim().split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const [index, , scientific, common, className] = line.split(';');
    return { index: Number(index), scientific, common, bird: className === 'Aves' };
  });
}

export async function classifyCandidates(
  source: AudioSource,
  candidates: Candidate[],
  onProgress: (value: number, detail: string) => void,
  signal?: AbortSignal,
): Promise<Detection[]> {
  if (!candidates.length) return [];
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = {
    mjs: '/ort/ort-wasm-simd-threaded.mjs',
    wasm: '/ort/ort-wasm-simd-threaded.wasm',
  };
  const labelsPromise = loadLabels();
  const modelBytes = await fetchCached(MODEL_URL, (loaded, total) => {
    const ratio = total ? loaded / total : Math.min(0.95, loaded / 65_000_000);
    onProgress(36 + Math.round(ratio * 12), `BirdNET+モデルを準備中 ${Math.round(loaded / 1024 / 1024)}MB`);
  });
  if (signal?.aborted) throw new DOMException('解析を中止しました', 'AbortError');
  onProgress(49, 'BirdNET+モデルを起動中');
  const [labels, session] = await Promise.all([
    labelsPromise,
    ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }),
  ]);

  const inputName = session.inputNames[0];
  const predictionName = session.outputNames.find((name) => name.includes('prediction')) ?? session.outputNames[0];
  const detections: Detection[] = [];
  for (let index = 0; index < candidates.length; index++) {
    if (signal?.aborted) throw new DOMException('解析を中止しました', 'AbortError');
    const candidate = candidates[index];
    const audio = await readModelWindow(source, candidate.start, 3);
    const tensor = new ort.Tensor('float32', audio, [1, audio.length]);
    const output = await session.run({ [inputName]: tensor });
    const raw = output[predictionName].data as Float32Array;
    const classCount = labels.length;
    const frameCount = Math.max(1, Math.floor(raw.length / classCount));
    let bestLabel: BirdLabel | undefined;
    let bestScore = 0;
    for (const label of labels) {
      if (!label.bird) continue;
      let score = 0;
      for (let frame = 0; frame < frameCount; frame++) score = Math.max(score, Number(raw[frame * classCount + label.index] ?? 0));
      if (score < 0 || score > 1) score = 1 / (1 + Math.exp(-score));
      if (score > bestScore) {
        bestScore = score;
        bestLabel = label;
      }
    }
    if (bestLabel && bestScore >= 0.18) {
      detections.push({
        ...candidate,
        species: JAPANESE_NAMES[bestLabel.scientific] ?? bestLabel.common,
        scientific: bestLabel.scientific,
        commonEnglish: bestLabel.common,
        confidence: Math.round(bestScore * 100),
      });
    }
    onProgress(50 + Math.round(49 * (index + 1) / candidates.length), `鳥種を照合中 ${index + 1}/${candidates.length}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return detections.sort((a, b) => Number(b.night) - Number(a.night) || b.confidence - a.confidence || a.start - b.start);
}

export async function createWavClip(source: AudioSource, start: number, duration: number) {
  const samples = await readMono(source, start, duration);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, source.sampleRate, true);
  view.setUint32(28, source.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 32767, true));
  return new Blob([buffer], { type: 'audio/wav' });
}

export function inferRecordingStart(file: File) {
  const match = file.name.match(/(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})?/);
  if (match) {
    const [, year, month, day, hour, minute, second = '00'] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  }
  return new Date(file.lastModified || Date.now());
}

export function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
}

export function formatDuration(seconds: number) {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}時間${Math.floor((seconds % 3600) / 60)}分`;
  return `${Math.floor(seconds / 60)}分${Math.floor(seconds % 60)}秒`;
}
