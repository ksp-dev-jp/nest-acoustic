'use client';

import {
  AudioWaveform, Bird, CalendarDays, CircleHelp, Download, FileAudio,
  MapPin, MoonStar, Pause, Play, Search, Sparkles, Square, UploadCloud,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  type AudioSource, type Detection, classifyCandidates, createAudioSource, createWavClip,
  detectCandidates, formatClock, formatDuration, inferRecordingStart,
} from '@/lib/audio-analysis';

const emptyBars = Array.from({ length: 104 }, () => 8);
const colors = ['#e8b45a', '#8eb9a9', '#c08fc1', '#76aadd', '#9db866', '#d38b72'];

function toLocalInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Home() {
  const [source, setSource] = useState<AudioSource>();
  const [detections, setDetections] = useState<Detection[]>([]);
  const [selected, setSelected] = useState<Detection>();
  const [overviewBars, setOverviewBars] = useState(emptyBars);
  const [candidateCount, setCandidateCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('音声ファイルを選択してください');
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [nightOnly, setNightOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [recordingStart, setRecordingStart] = useState('');
  const [location, setLocation] = useState('');
  const [playing, setPlaying] = useState<number>();
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const visibleDetections = useMemo(
    () => detections.filter((item) => (!nightOnly || item.night) && (`${item.species} ${item.scientific} ${item.commonEnglish}`).toLowerCase().includes(query.toLowerCase())),
    [detections, nightOnly, query],
  );

  const speciesCount = new Set(detections.map((item) => item.scientific)).size;

  async function handleFile(file: File) {
    abortRef.current?.abort();
    setIsBusy(true);
    setError('');
    setStatus('録音情報を読み込んでいます');
    setProgress(2);
    setDetections([]);
    setSelected(undefined);
    setCandidateCount(0);
    setOverviewBars(emptyBars);
    try {
      const loaded = await createAudioSource(file);
      setSource(loaded);
      setRecordingStart(toLocalInput(inferRecordingStart(file)));
      setStatus('解析準備完了');
      setProgress(0);
    } catch (reason) {
      setSource(undefined);
      setError(reason instanceof Error ? reason.message : '音声を読み込めませんでした。');
      setStatus('読込に失敗しました');
    } finally {
      setIsBusy(false);
    }
  }

  async function beginAnalysis() {
    if (!source || !recordingStart) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsBusy(true);
    setError('');
    setDetections([]);
    setSelected(undefined);
    setCandidateCount(0);
    try {
      const result = await detectCandidates(source, new Date(recordingStart), (value, detail) => {
        setProgress(value);
        setStatus(detail);
      }, controller.signal);
      setOverviewBars(result.bars);
      setCandidateCount(result.candidates.length);
      setProgress(35);
      if (!result.candidates.length) {
        setStatus('鳴き声候補は検出されませんでした');
        setProgress(100);
        return;
      }
      const identified = await classifyCandidates(source, result.candidates, (value, detail) => {
        setProgress(value);
        setStatus(detail);
      }, controller.signal);
      setDetections(identified);
      setSelected(identified[0]);
      setProgress(100);
      setStatus(identified.length ? `${identified.length}件の鳥類音声を検出しました` : '鳥種を特定できる候補はありませんでした');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') setStatus('解析を中止しました');
      else {
        setError(reason instanceof Error ? reason.message : '解析中にエラーが発生しました。');
        setStatus('解析に失敗しました');
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function playDetection(item: Detection) {
    if (!source) return;
    if (playing === item.id) {
      audioRef.current?.pause();
      setPlaying(undefined);
      return;
    }
    setSelected(item);
    const clip = await createWavClip(source, item.start, item.end - item.start);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = URL.createObjectURL(clip);
    if (audioRef.current) {
      audioRef.current.src = audioUrlRef.current;
      await audioRef.current.play();
      setPlaying(item.id);
    }
  }

  async function downloadClip(item: Detection) {
    if (!source) return;
    const clip = await createWavClip(source, item.start, item.end - item.start);
    saveBlob(clip, `${source.file.name.replace(/\.[^.]+$/, '')}_${formatClock(item.start).replaceAll(':', '-')}_${item.species}.wav`);
  }

  function downloadCsv() {
    if (!source || !detections.length) return;
    const start = new Date(recordingStart);
    const rows = detections.map((item) => [
      source.file.name, formatClock(item.start), new Date(start.getTime() + item.start * 1000).toISOString(),
      item.species, item.scientific, item.commonEnglish, item.confidence, item.band,
      item.night ? '夜間' : '昼間・薄明', location,
    ]);
    const csv = [
      ['ファイル', '開始位置', '検出日時', '候補種', '学名', '英名', '信頼度(%)', '主要周波数', '時間区分', '地点'],
      ...rows,
    ].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    saveBlob(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }), `${source.file.name.replace(/\.[^.]+$/, '')}_detections.csv`);
  }

  const timelineLabels = source
    ? [0, .25, .5, .75, 1].map((ratio) => formatClock(source.duration * ratio))
    : ['00:00:00', '—', '—', '—', '—'];

  return (
    <main className="min-h-screen bg-[#081415] text-[#e9f0e9]">
      <audio onEnded={() => setPlaying(undefined)} ref={audioRef} />
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#081415]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-[#d8a64b] text-[#101918] shadow-[0_0_30px_rgba(216,166,75,.16)]"><AudioWaveform className="size-[19px]" strokeWidth={2.4} /></div>
            <div><div className="flex items-center gap-2"><span className="text-[15px] font-semibold tracking-[0.12em]">NEST</span><span className="text-[10px] uppercase tracking-[0.18em] text-[#78918d]">acoustic</span></div><p className="text-[10px] text-[#78918d]">野生動物音声モニタリング</p></div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="hidden border-[#39514c] bg-[#152625] px-2.5 text-[#a9bcb8] sm:flex" variant="outline"><span className="size-1.5 rounded-full bg-[#79b997]" />端末内AI解析</Badge>
            <Button aria-label="解析について" className="text-[#8da19e] hover:bg-white/5" onClick={() => window.alert('録音はブラウザ内で処理されます。鳴き声候補を抽出後、BirdNET+で鳥種候補を照合します。AI判定は現地確認・専門家確認と併用してください。')} size="icon" variant="ghost"><CircleHelp /></Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[212px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-64px)] border-r border-white/7 px-4 py-6 lg:flex lg:flex-col">
          <nav aria-label="メインナビゲーション" className="space-y-1">
            <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#536c68]">Workspace</p>
            <a className="flex items-center gap-3 rounded-lg bg-[#192928] px-3 py-2.5 text-sm font-medium text-[#f0f5ef]" href="#analysis"><AudioWaveform className="size-4 text-[#d8a64b]" />音声解析</a>
            <a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#829692] transition hover:bg-white/5" href="#records"><FileAudio className="size-4" />検出結果</a>
            <a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#829692] transition hover:bg-white/5" href="https://github.com/birdnet-team/birdnet-live-app" rel="noreferrer" target="_blank"><Bird className="size-4" />判定モデル</a>
          </nav>
          <div className="mt-auto rounded-xl border border-[#263b38] bg-[#0e1d1d] p-3.5"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#c9d4d1]"><MoonStar className="size-3.5 text-[#d8a64b]" />夜間を優先</div><p className="text-[11px] leading-relaxed text-[#6f8782]">18:00〜翌6:00の検出を先頭に表示します。</p></div>
        </aside>

        <section className="min-w-0 px-4 py-5 sm:px-6 sm:py-7 xl:px-9" id="analysis">
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#d8a64b]">NEST ACOUSTIC</p><h1 className="text-2xl font-medium tracking-[-0.025em] text-[#f1f5ef] sm:text-[30px]">鳥類音声解析</h1></div>
            <Button className="h-10 shrink-0 rounded-xl bg-[#d8a64b] px-4 text-[#17201f] hover:bg-[#e4b65f]" disabled={isBusy} onClick={() => inputRef.current?.click()}><UploadCloud data-icon="inline-start" />音声を追加</Button>
            <input accept="audio/*,.wav,.flac,.mp3,.ogg" className="hidden" ref={inputRef} type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ''; }} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0d1c1c] shadow-[0_22px_70px_rgba(0,0,0,.16)]">
              <div className="flex flex-col justify-between gap-3 border-b border-white/7 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                <div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#172a28] text-[#d8a64b]"><FileAudio className="size-[17px]" /></div><div className="min-w-0"><p className="truncate text-sm font-medium text-[#dfe8e5]">{source?.file.name ?? '音声ファイルが未選択です'}</p><p className="mt-0.5 text-[11px] text-[#6e8580]">{source ? `${source.wav ? 'PCM WAV' : source.file.type || '音声'} · ${source.channels}ch · ${(source.sampleRate / 1000).toFixed(1)} kHz · ${formatDuration(source.duration)}` : '長時間録音はPCM WAVに対応'}</p></div></div>
                <div className="flex items-center gap-2">{isBusy ? <Button className="border-[#744f45] bg-transparent text-[#d39887] hover:bg-[#2d1d1a]" onClick={() => abortRef.current?.abort()} size="sm" variant="outline"><Square data-icon="inline-start" />中止</Button> : <Button className="bg-[#d8a64b] text-[#17201f] hover:bg-[#e4b65f]" disabled={!source || !recordingStart} onClick={() => void beginAnalysis()} size="sm"><Sparkles data-icon="inline-start" />解析開始</Button>}</div>
              </div>

              <div className="px-4 py-5 sm:px-5">
                <div className="mb-4 grid gap-2 sm:grid-cols-2">
                  <label className="rounded-lg border border-[#293d39] bg-[#0a1717] px-3 py-2"><span className="mb-1 flex items-center gap-1.5 text-[10px] text-[#607873]"><CalendarDays className="size-3" />録音開始日時</span><input className="w-full bg-transparent text-xs text-[#cbd7d3] outline-none [color-scheme:dark]" disabled={!source || isBusy} onChange={(event) => setRecordingStart(event.target.value)} type="datetime-local" value={recordingStart} /></label>
                  <label className="rounded-lg border border-[#293d39] bg-[#0a1717] px-3 py-2"><span className="mb-1 flex items-center gap-1.5 text-[10px] text-[#607873]"><MapPin className="size-3" />録音地点（任意）</span><input className="w-full bg-transparent text-xs text-[#cbd7d3] outline-none placeholder:text-[#48615c]" disabled={!source || isBusy} onChange={(event) => setLocation(event.target.value)} placeholder="例：北摂山系・地点 A-03" value={location} /></label>
                </div>

                {(isBusy || progress > 0 || error) && <div className={`mb-5 rounded-xl border p-3 ${error ? 'border-[#663f38] bg-[#251816]' : 'border-[#31423e] bg-[#122322]'}`}><div className="mb-2 flex justify-between gap-4 text-[11px]"><span className={error ? 'text-[#e0a394]' : 'text-[#9cafaa]'}>{error || status}</span><span className="shrink-0 text-[#8fa29d]">{progress}%</span></div><Progress className="[&_[data-slot=progress-indicator]]:bg-[#d8a64b] [&_[data-slot=progress-track]]:bg-[#273936]" value={progress} /></div>}

                <div className="relative h-[210px] overflow-hidden rounded-xl border border-[#263a37] bg-[#091313]">
                  <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(126,165,153,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(126,165,153,.12)_1px,transparent_1px)] [background-size:100%_42px,8.333%_100%]" />
                  <div className="absolute inset-x-7 bottom-7 top-5 flex items-end gap-[2px] opacity-80">{overviewBars.map((height, index) => <span className="flex-1 rounded-t-[2px] bg-gradient-to-t from-[#173f3b] via-[#3e8273] to-[#dfaf59]" key={index} style={{ height: `${height.toFixed(2)}%`, opacity: index % 7 === 0 ? .95 : Number((.4 + (index % 5) * .09).toFixed(2)) }} />)}</div>
                  <div className="absolute inset-x-7 bottom-[26px] h-px bg-[#45635d]" />
                  <div className="absolute inset-x-7 bottom-2 flex justify-between text-[9px] text-[#4f6b65]">{timelineLabels.map((label, index) => <span key={index}>{label}</span>)}</div>
                  <div className="absolute left-2 top-3 flex h-[150px] flex-col justify-between text-[9px] text-[#4f6b65]"><span>12k</span><span>6k</span><span>0</span></div>
                  {source && detections.map((item) => <button aria-label={`${item.species} ${formatClock(item.start)}`} className="group absolute bottom-[26px] z-10 -translate-x-1/2" key={item.id} onClick={() => setSelected(item)} style={{ left: `${Math.min(99, Math.max(1, item.peakTime / source.duration * 100))}%` }}><span className="block h-8 w-px bg-[#d8a64b]/60" /><span className="block size-2.5 -translate-x-[4px] rounded-full border-2 border-[#091313] bg-[#d8a64b] shadow-[0_0_0_3px_rgba(216,166,75,.18)] transition group-hover:scale-125" /></button>)}
                  {!source && <button className="absolute inset-0 z-20 m-auto flex h-fit w-fit flex-col items-center gap-2 text-xs text-[#6d837e]" onClick={() => inputRef.current?.click()}><UploadCloud className="size-7 text-[#9e814a]" /><span>録音データを選択</span></button>}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="text-[11px] text-[#657c77]">表示:</span><button className={`rounded-lg px-3 py-1.5 text-xs transition ${nightOnly ? 'bg-[#263a37] text-[#dce6e2]' : 'text-[#6e8580] hover:bg-white/5'}`} onClick={() => setNightOnly(true)}>夜間のみ</button><button className={`rounded-lg px-3 py-1.5 text-xs transition ${!nightOnly ? 'bg-[#263a37] text-[#dce6e2]' : 'text-[#6e8580] hover:bg-white/5'}`} onClick={() => setNightOnly(false)}>全時間帯</button></div><div className="flex gap-4 text-[11px] text-[#708782]"><span><b className="mr-1 text-base font-medium text-[#e3ebe8]">{detections.length}</b>検出</span><span><b className="mr-1 text-base font-medium text-[#e3ebe8]">{speciesCount}</b>候補種</span></div></div>
              </div>
            </section>

            <aside className="rounded-2xl border border-white/8 bg-[#0d1c1c] p-5">
              <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#647c77]">Selected detection</p><h2 className="mt-1 text-sm font-medium text-[#dfe8e5]">選択中の検出</h2></div>{selected && <Badge className="bg-[#243932] text-[#9bc3a9]" variant="secondary">AI {selected.confidence}%</Badge>}</div>
              {selected ? <>
                <div className="relative mb-5 grid aspect-[1.72] place-items-center overflow-hidden rounded-xl border border-[#2b3e3a] bg-[#0a1515]"><div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(126,165,153,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(126,165,153,.16)_1px,transparent_1px)] [background-size:100%_25%,12.5%_100%]" /><div className="z-10 flex h-20 w-[75%] items-center justify-center gap-1">{Array.from({ length: 34 }, (_, index) => <i className="w-0.5 rounded-full bg-[#d8a64b]" key={index} style={{ height: `${(12 + Math.abs(Math.sin(index * .72)) * 54).toFixed(2)}%`, opacity: Number((.35 + (index % 6) * .1).toFixed(2)) }} />)}</div><Button aria-label="検出音声を再生" className="absolute grid size-10 place-items-center rounded-full bg-[#edf1e8] text-[#13201e] hover:bg-white" onClick={() => void playDetection(selected)} size="icon">{playing === selected.id ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}</Button></div>
                <div className="space-y-4"><div><p className="text-[10px] uppercase tracking-[0.14em] text-[#5f7772]">第一候補</p><div className="mt-1 flex items-end justify-between"><div><h3 className="text-xl font-medium text-[#f0f4ed]">{selected.species}</h3><p className="mt-0.5 text-xs italic text-[#758b87]">{selected.scientific}</p>{selected.species !== selected.commonEnglish && <p className="mt-0.5 text-[10px] text-[#607873]">{selected.commonEnglish}</p>}</div><span className="text-2xl font-light text-[#d8a64b]">{selected.confidence}<small className="text-xs">%</small></span></div></div><div className="grid grid-cols-2 gap-2"><div className="rounded-lg bg-[#122322] p-3"><p className="text-[10px] text-[#647c77]">検出位置</p><p className="mt-1 text-sm font-medium text-[#cedad6]">{formatClock(selected.start)}</p></div><div className="rounded-lg bg-[#122322] p-3"><p className="text-[10px] text-[#647c77]">主要周波数</p><p className="mt-1 text-sm font-medium text-[#cedad6]">{selected.band}</p></div></div><Button className="w-full border-[#324742] bg-transparent text-[#b2c1bd] hover:bg-[#162826]" onClick={() => void downloadClip(selected)} variant="outline"><Download data-icon="inline-start" />該当区間を書き出す</Button></div>
              </> : <div className="grid min-h-[310px] place-items-center rounded-xl border border-dashed border-[#2b3e3a] bg-[#0a1515] px-6 text-center"><div><Bird className="mx-auto mb-3 size-8 text-[#536d67]" /><p className="text-sm text-[#94a7a2]">検出結果がありません</p><p className="mt-2 text-[11px] leading-relaxed text-[#5f7772]">録音データを追加し、解析を開始してください。</p></div></div>}
            </aside>
          </div>

          <section className="mt-4 overflow-hidden rounded-2xl border border-white/8 bg-[#0d1c1c]" id="records">
            <div className="flex flex-col justify-between gap-3 border-b border-white/7 px-4 py-4 sm:flex-row sm:items-center sm:px-5"><div><h2 className="text-sm font-medium text-[#dfe8e5]">検出された鳴き声</h2><p className="mt-1 text-[11px] text-[#667e79]">{candidateCount ? `${candidateCount}区間をAI照合 · 確認後にCSVで出力できます` : '鳴き声候補をBirdNET+で照合します'}</p></div><div className="flex items-center gap-2"><label className="flex h-8 items-center gap-2 rounded-lg border border-[#2c413d] bg-[#0a1717] px-2.5 text-xs text-[#809590]"><Search className="size-3.5" /><input aria-label="鳥の種類を検索" className="w-28 bg-transparent text-[#c6d2ce] outline-none placeholder:text-[#526a65]" onChange={(event) => setQuery(event.target.value)} placeholder="種名で検索" value={query} /></label><Button className="border-[#2c413d] bg-transparent text-[#849a95] hover:bg-white/5" disabled={!detections.length} onClick={downloadCsv} size="sm" variant="outline"><Download data-icon="inline-start" />CSV</Button></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-white/6 bg-[#0b1818] text-[10px] uppercase tracking-[0.1em] text-[#536c67]"><tr><th className="px-5 py-3 font-medium">位置</th><th className="px-4 py-3 font-medium">候補種</th><th className="px-4 py-3 font-medium">信頼度</th><th className="px-4 py-3 font-medium">周波数帯</th><th className="px-4 py-3 font-medium">区分</th><th className="px-5 py-3" /></tr></thead><tbody>
              {visibleDetections.map((item, index) => <tr className={`cursor-pointer border-b border-white/5 text-xs transition hover:bg-white/[.025] ${selected?.id === item.id ? 'bg-[#132523]' : ''}`} key={item.id} onClick={() => setSelected(item)}><td className="px-5 py-3.5 font-mono text-[#a7b8b4]">{formatClock(item.start)}</td><td className="px-4 py-3.5"><div className="flex items-center gap-3"><span className="size-2 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} /><div><p className="font-medium text-[#dbe4e1]">{item.species}</p><p className="mt-0.5 text-[10px] italic text-[#607873]">{item.scientific}</p></div></div></td><td className="px-4 py-3.5"><span className="font-mono text-[#d7b267]">{item.confidence}%</span></td><td className="px-4 py-3.5 text-[#809590]">{item.band}</td><td className="px-4 py-3.5"><Badge className={item.night ? 'bg-[#1e3034] text-[#8eb7bd]' : 'bg-[#263324] text-[#a9be91]'} variant="secondary">{item.night ? '夜間' : '昼間・薄明'}</Badge></td><td className="px-5 py-3.5"><Button aria-label={`${item.species}を再生`} className="text-[#728984] hover:bg-white/5" onClick={(event) => { event.stopPropagation(); void playDetection(item); }} size="icon-sm" variant="ghost">{playing === item.id ? <Pause /> : <Play />}</Button></td></tr>)}
              {!visibleDetections.length && <tr><td className="px-5 py-10 text-center text-xs text-[#5f7772]" colSpan={6}>{detections.length ? '条件に一致する検出はありません。' : '解析結果はここに表示されます。'}</td></tr>}
            </tbody></table></div>
          </section>
          <div className="mt-3 flex flex-col justify-between gap-2 text-[10px] text-[#48625d] sm:flex-row"><p>録音データはアップロードされず、ブラウザ内で処理されます。</p><p>BirdNET+ v3.0-preview3.1 · AI候補は専門家による確認を推奨</p></div>
        </section>
      </div>
    </main>
  );
}
