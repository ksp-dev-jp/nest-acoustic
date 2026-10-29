'use client';

import {
  AudioWaveform, Bird, CalendarDays, CheckCircle2, CircleHelp, Download, FileAudio,
  Filter, Headphones, MapPin, MoonStar, Pause, Play, RotateCcw, Search,
  ShieldCheck, Sparkles, Square, UploadCloud, XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  type AudioSource, type Detection, classifyCandidates, createAudioSource, createWavClip,
  detectCandidates, formatClock, formatDuration, inferRecordingStart,
} from '@/lib/audio-analysis';
import {
  SURVEY_REGIONS, reviewStatusLabel, type ReviewStatus,
} from '@/lib/species-filter';
import {
  REVIEW_REVISION, loadReviewSession, recordingId, saveReviewSession,
} from '@/lib/review-session';
import { isUnresolvedDetection, retainCandidateResults, scoreGroup, scoreGroupLabel } from '@/lib/candidate-results';

const emptyBars = Array.from({ length: 104 }, () => 8);
const colors = ['#e8b45a', '#8eb9a9', '#c08fc1', '#76aadd', '#9db866', '#d38b72'];

function toLocalInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
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
  const [nightOnly, setNightOnly] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<'all' | ReviewStatus>('all');
  const [identificationFilter, setIdentificationFilter] = useState<'all' | 'species' | 'unresolved'>('all');
  const [scoreFilter, setScoreFilter] = useState<'all' | ReturnType<typeof scoreGroup>>('all');
  const [query, setQuery] = useState('');
  const [resultPage, setResultPage] = useState(0);
  const [recordingStart, setRecordingStart] = useState('');
  const [regionKey, setRegionKey] = useState('hagi');
  const [listenedIds, setListenedIds] = useState<Set<number>>(new Set());
  const [playing, setPlaying] = useState<number>();
  const [fileId, setFileId] = useState('');
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [analysisRevision, setAnalysisRevision] = useState(REVIEW_REVISION);
  const [saveNotice, setSaveNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const playbackRequestRef = useRef(0);
  const playbackIdRef = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    abortRef.current?.abort();
    playbackRequestRef.current++;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  useEffect(() => {
    if (!source || !fileId || !hasAnalysis || isBusy) return;
    try {
      saveReviewSession(window.localStorage, {
        version: 1, revision: analysisRevision, fileId, recordingStart, regionKey,
        duration: source.duration, candidateCount, detections, overviewBars,
        listenedIds: [...listenedIds], savedAt: new Date().toISOString(),
      });
      setSaveNotice(analysisRevision === REVIEW_REVISION
        ? '確認結果をこのブラウザに保存済み。同じ音声を選択すると再開できます。'
        : '以前の抽出条件による確認結果です。見逃し抑制の新しい抽出を使うには、CSVを保存したうえで再解析してください。');
    } catch {
      setSaveNotice('確認結果を保存できませんでした。ブラウザの保存設定・空き容量を確認し、CSVを出力してください。');
    }
  }, [source, fileId, hasAnalysis, analysisRevision, isBusy, recordingStart, regionKey, candidateCount, detections, overviewBars, listenedIds]);

  const region = SURVEY_REGIONS.find((item) => item.key === regionKey) ?? SURVEY_REGIONS[0];
  const visibleDetections = useMemo(() => detections.filter((item) =>
    (!nightOnly || item.night)
    && (reviewFilter === 'all' || item.reviewStatus === reviewFilter)
    && (identificationFilter === 'all' || (isUnresolvedDetection(item) ? 'unresolved' : 'species') === identificationFilter)
    && (scoreFilter === 'all' || scoreGroup(item) === scoreFilter)
    && (`${item.species} ${item.scientific} ${item.commonEnglish}`).toLowerCase().includes(query.toLowerCase())),
  [detections, nightOnly, query, reviewFilter, identificationFilter, scoreFilter]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(visibleDetections.length / pageSize));
  const currentPage = Math.min(resultPage, pageCount - 1);
  const pageDetections = visibleDetections.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  useEffect(() => { setResultPage(0); }, [nightOnly, query, reviewFilter, identificationFilter, scoreFilter, source]);

  const speciesCount = new Set(detections.filter((item) => !isUnresolvedDetection(item)).map((item) => item.scientific)).size;
  const unresolvedCount = detections.filter(isUnresolvedDetection).length;
  const selectedUnresolved = selected ? isUnresolvedDetection(selected) : false;
  const pendingCount = detections.filter((item) => item.reviewStatus === 'pending').length;
  const approvedCount = detections.filter((item) => item.reviewStatus === 'approved').length;

  function stopPlayback() {
    playbackRequestRef.current++;
    playbackIdRef.current = undefined;
    audioRef.current?.pause();
    if (audioRef.current) {
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = undefined;
    setPlaying(undefined);
  }

  function invalidateAnalysis() {
    stopPlayback();
    setHasAnalysis(false);
    setDetections([]);
    setSelected(undefined);
    setListenedIds(new Set());
    setCandidateCount(0);
    setOverviewBars(emptyBars);
    setProgress(0);
    setError('');
    setSaveNotice('解析条件を変更しました。「解析開始」で候補を更新してください。');
  }

  async function handleFile(file: File) {
    abortRef.current?.abort();
    stopPlayback();
    setHasAnalysis(false);
    setFileId('');
    setAnalysisRevision(REVIEW_REVISION);
    setSaveNotice('');
    setIsBusy(true);
    setError('');
    setStatus('録音情報を読み込んでいます');
    setProgress(2);
    setDetections([]);
    setSelected(undefined);
    setCandidateCount(0);
    setListenedIds(new Set());
    setOverviewBars(emptyBars);
    try {
      const [loaded, id] = await Promise.all([createAudioSource(file), recordingId(file)]);
      setSource(loaded);
      setFileId(id);
      setRecordingStart(toLocalInput(inferRecordingStart(file)));
      setStatus('解析準備完了');
      setProgress(0);
      try {
        const saved = loadReviewSession(window.localStorage, id, SURVEY_REGIONS.map((item) => item.key));
        if (saved && Math.abs(saved.duration - loaded.duration) < 0.01) {
          setRecordingStart(saved.recordingStart);
          setAnalysisRevision(saved.revision);
          setRegionKey(saved.regionKey);
          setDetections(saved.detections);
          setSelected(saved.detections.find((item) => item.reviewStatus === 'pending') ?? saved.detections[0]);
          setListenedIds(new Set(saved.listenedIds));
          setOverviewBars(saved.overviewBars);
          setCandidateCount(saved.candidateCount);
          setHasAnalysis(true);
          setProgress(100);
          setStatus(`保存済みの確認結果を復元しました（${saved.detections.length}候補）`);
        }
      } catch {
        setSaveNotice('保存済みの確認結果を読み込めませんでした。音声を再解析してください。');
      }
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
    stopPlayback();
    setHasAnalysis(false);
    setAnalysisRevision(REVIEW_REVISION);
    setListenedIds(new Set());
    setSaveNotice('');
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
        setHasAnalysis(true);
        return;
      }
      let identified: Detection[];
      try {
        identified = await classifyCandidates(source, result.candidates, {
          latitude: region.latitude,
          longitude: region.longitude,
          recordingStart: new Date(recordingStart),
        }, (value, detail) => {
          setProgress(value);
          setStatus(detail);
        }, controller.signal);
      } catch {
        controller.signal.throwIfAborted();
        identified = result.candidates.flatMap((candidate, index) =>
          retainCandidateResults(candidate, [], index + 1, 'classification-unavailable'));
        setError('鳥種の照合に失敗しました。音声候補は「種未確定」で残しています。原音を確認するか、接続環境を確認して再解析してください。');
      }
      controller.signal.throwIfAborted();
      setDetections(identified);
      setSelected(identified[0]);
      setProgress(100);
      setHasAnalysis(true);
      setStatus(`${identified.length}件の音声候補を表示しています（種未確定 ${identified.filter(isUnresolvedDetection).length}件）`);
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
      stopPlayback();
      return;
    }
    stopPlayback();
    const request = playbackRequestRef.current;
    setSelected(item);
    setError('');
    try {
      const clip = await createWavClip(source, item.start, item.end - item.start);
      if (request !== playbackRequestRef.current) return;
      audioUrlRef.current = URL.createObjectURL(clip);
      if (audioRef.current) {
        audioRef.current.src = audioUrlRef.current;
        playbackIdRef.current = item.id;
        setPlaying(item.id);
        await audioRef.current.play();
      }
    } catch {
      if (request !== playbackRequestRef.current) return;
      stopPlayback();
      setError('音声を再生できませんでした。ブラウザの音声出力設定を確認してください。');
    }
  }

  function completePlayback() {
    if (!audioRef.current?.ended) return;
    const id = playbackIdRef.current;
    if (id !== undefined) setListenedIds((current) => new Set(current).add(id));
    playbackIdRef.current = undefined;
    setPlaying(undefined);
  }

  function updateReview(item: Detection, reviewStatus: ReviewStatus) {
    if (reviewStatus !== 'pending' && !listenedIds.has(item.id)) return;
    const reviewedAt = reviewStatus === 'pending' ? undefined : new Date().toISOString();
    setDetections((current) => current.map((detection) =>
      detection.id === item.id ? { ...detection, reviewStatus, reviewedAt } : detection));
    setSelected((current) => current?.id === item.id ? { ...current, reviewStatus, reviewedAt } : current);
  }

  async function downloadClip(item: Detection) {
    if (!source) return;
    const clip = await createWavClip(source, item.start, item.end - item.start);
    saveBlob(clip, `${source.file.name.replace(/\.[^.]+$/, '')}_${formatClock(item.start).replaceAll(':', '-')}_${item.species}.wav`);
  }

  function downloadCsv(scope: 'all' | 'approved' = 'all') {
    if (!source || !detections.length) return;
    const start = new Date(recordingStart);
    const exported = scope === 'approved' ? detections.filter((item) => item.reviewStatus === 'approved') : detections;
    const rows = exported.map((item) => [
      source.file.name, formatClock(item.start), new Date(start.getTime() + item.start * 1000).toISOString(),
      item.species, item.scientific, item.commonEnglish, item.confidence ?? '', item.band,
      item.night ? '夜間' : '昼間・薄明', region.name, region.latitude, region.longitude,
      item.geoProbability ?? '', item.filterStatus, reviewStatusLabel(item.reviewStatus), item.goshawkSeason ?? '', item.reviewedAt ?? '',
      isUnresolvedDetection(item) ? '種未確定' : '種名候補あり',
      item.maxBirdScore === undefined ? '' : Math.round(item.maxBirdScore * 1000) / 10, scoreGroupLabel(item),
    ]);
    const csv = [
      ['ファイル', '開始位置', '検出日時', '候補種', '学名', '英名', 'AI候補スコア(%)', '主要周波数', '時間区分', '地域', '緯度', '経度', '地域季節スコア(%)', 'フィルター判定', '原音確認結果', 'オオタカ時期区分', '判定登録日時(UTC)', '種名の状態', '最大鳥種スコア(%)・鳥声確率ではない', '確認順の参考(試験)'],
      ...rows,
    ].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    saveBlob(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }), `${source.file.name.replace(/\.[^.]+$/, '')}_${scope === 'approved' ? 'approved' : 'detections'}.csv`);
  }

  const timelineLabels = source
    ? [0, .25, .5, .75, 1].map((ratio) => formatClock(source.duration * ratio))
    : ['00:00:00', '—', '—', '—', '—'];

  return (
    <main className="min-h-screen bg-[#081415] text-[#e9f0e9]">
      <audio onEnded={completePlayback} onError={() => { if (playbackIdRef.current !== undefined) { stopPlayback(); setError('音声を再生できませんでした。原音確認は未完了です。'); } }} ref={audioRef} />
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#081415]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-[#d8a64b] text-[#101918] shadow-[0_0_30px_rgba(216,166,75,.16)]"><AudioWaveform className="size-[19px]" strokeWidth={2.4} /></div>
            <div><div className="flex items-center gap-2"><span className="text-[15px] font-semibold tracking-[0.12em]">NEST</span><span className="text-[10px] uppercase tracking-[0.18em] text-[#78918d]">acoustic</span></div><p className="text-[10px] text-[#78918d]">野生動物音声モニタリング</p></div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="hidden border-[#39514c] bg-[#152625] px-2.5 text-[#a9bcb8] sm:flex" variant="outline"><span className="size-1.5 rounded-full bg-[#79b997]" />山口県・季節フィルター</Badge>
            <Button aria-label="解析について" className="text-[#8da19e] hover:bg-white/5" onClick={() => window.alert('録音はブラウザ内で処理されます。音声を連続して測定し、1分ごとの周波数帯別の背景音から候補を抽出します。候補の160区間制限はありません。山口県・録音時期で種名候補を選び、種名を付けられない音声区間も「鳥声候補・種未確定」で残します。鳥の声かどうかも原音で確認してください。種未確定の候補は承認後も種未確定のまま保存されます。AI候補スコアは正解率ではありません。小さな声や雑音と重なる声の見逃しは残ります。')} size="icon" variant="ghost"><CircleHelp /></Button>
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
          <div className="mt-auto space-y-2">
            <div className="rounded-xl border border-[#263b38] bg-[#0e1d1d] p-3.5"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#c9d4d1]"><Filter className="size-3.5 text-[#79b997]" />地域・季節で選別</div><p className="text-[11px] leading-relaxed text-[#6f8782]">地域・季節で種名候補を絞り込みます。種名を付けられない音声も原音確認用に残します。</p></div>
            <div className="rounded-xl border border-[#263b38] bg-[#0e1d1d] p-3.5"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#c9d4d1]"><MoonStar className="size-3.5 text-[#d8a64b]" />夜間を優先</div><p className="text-[11px] leading-relaxed text-[#6f8782]">18:00〜翌6:00の検出を先頭に表示します。</p></div>
          </div>
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
                  <label className="rounded-lg border border-[#293d39] bg-[#0a1717] px-3 py-2"><span className="mb-1 flex items-center gap-1.5 text-[10px] text-[#607873]"><CalendarDays className="size-3" />録音開始日時</span><input className="w-full bg-transparent text-xs text-[#cbd7d3] outline-none [color-scheme:dark]" disabled={!source || isBusy} onChange={(event) => { invalidateAnalysis(); setRecordingStart(event.target.value); }} step="1" type="datetime-local" value={recordingStart} /></label>
                  <label className="rounded-lg border border-[#293d39] bg-[#0a1717] px-3 py-2"><span className="mb-1 flex items-center gap-1.5 text-[10px] text-[#607873]"><MapPin className="size-3" />地域・季節フィルター</span><select className="w-full bg-[#0a1717] text-xs text-[#cbd7d3] outline-none" disabled={!source || isBusy} onChange={(event) => { invalidateAnalysis(); setRegionKey(event.target.value); }} value={regionKey}>{SURVEY_REGIONS.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
                </div>
                {source && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#243a35] bg-[#0a1717] px-3 py-2 text-[10px] text-[#718983]"><ShieldCheck className="size-3.5 text-[#79b997]" /><span>{region.name}（{region.latitude.toFixed(3)}, {region.longitude.toFixed(3)}）</span><span className="text-[#49635d]">•</span><span>録音月から48週区分を自動設定</span><span className="text-[#49635d]">•</span><span>重点種は5%以上を確認対象</span></div>}
                <div className="mb-4 rounded-lg border border-[#354638] bg-[#142219] px-3 py-2 text-[11px] leading-relaxed text-[#a0baa2]"><b className="font-medium text-[#c5d9bd]">見逃し抑制の抽出</b> · 短い音も連続測定し、周囲の雑音に合わせて抽出します。候補数の上限なし。候補の増加により解析と原音確認に時間がかかります。</div>

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

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><span className="text-[11px] text-[#657c77]">表示:</span><button className={`rounded-lg px-3 py-1.5 text-xs transition ${nightOnly ? 'bg-[#263a37] text-[#dce6e2]' : 'text-[#6e8580] hover:bg-white/5'}`} onClick={() => setNightOnly(true)}>夜間のみ</button><button className={`rounded-lg px-3 py-1.5 text-xs transition ${!nightOnly ? 'bg-[#263a37] text-[#dce6e2]' : 'text-[#6e8580] hover:bg-white/5'}`} onClick={() => setNightOnly(false)}>全時間帯</button></div>
                  <div className="flex flex-wrap gap-4 text-[11px] text-[#708782]"><span><b className="mr-1 text-base font-medium text-[#e3ebe8]">{detections.length}</b>候補</span><span><b className="mr-1 text-base font-medium text-[#e3ebe8]">{speciesCount}</b>候補種</span><span><b className="mr-1 text-base font-medium text-[#c4a8dd]">{unresolvedCount}</b>種未確定</span><span><b className="mr-1 text-base font-medium text-[#d8a64b]">{pendingCount}</b>未確認</span><span><b className="mr-1 text-base font-medium text-[#79b997]">{approvedCount}</b>承認</span></div>
                </div>
              </div>
            </section>

            <aside className="rounded-2xl border border-white/8 bg-[#0d1c1c] p-5">
              <div className="mb-5 flex items-center justify-between">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#647c77]">Review candidate</p><h2 className="mt-1 text-sm font-medium text-[#dfe8e5]">原音確認・承認</h2></div>
                {selected && <Badge className={selected.reviewStatus === 'approved' ? 'bg-[#20382d] text-[#8fd0a7]' : selected.reviewStatus === 'rejected' ? 'bg-[#3a2523] text-[#dfa095]' : 'bg-[#3b3422] text-[#dbbd73]'} variant="secondary">{reviewStatusLabel(selected.reviewStatus)}</Badge>}
              </div>
              {selected ? <>
                <div className="relative mb-4 grid aspect-[1.72] place-items-center overflow-hidden rounded-xl border border-[#2b3e3a] bg-[#0a1515]"><div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(126,165,153,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(126,165,153,.16)_1px,transparent_1px)] [background-size:100%_25%,12.5%_100%]" /><div className="pointer-events-none z-10 flex h-20 w-[75%] items-center justify-center gap-1">{Array.from({ length: 34 }, (_, index) => <i className="w-0.5 rounded-full bg-[#d8a64b]" key={index} style={{ height: `${(12 + Math.abs(Math.sin(index * .72)) * 54).toFixed(2)}%`, opacity: Number((.35 + (index % 6) * .1).toFixed(2)) }} />)}</div><Button aria-label={playing === selected.id ? '検出音声を停止' : '検出音声を再生'} className="absolute z-20 grid size-11 place-items-center rounded-full bg-[#edf1e8] text-[#13201e] hover:bg-white" onClick={() => void playDetection(selected)} size="icon">{playing === selected.id ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}</Button></div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex items-center gap-2"><p className="text-[10px] uppercase tracking-[0.14em] text-[#5f7772]">{selectedUnresolved ? 'Audio candidate' : 'AI candidate'}</p>{selected.prioritySpecies && <Badge className="bg-[#3b3020] text-[#e3bd67]" variant="secondary">重点種</Badge>}</div>
                    <div className="flex items-end justify-between gap-2"><div><h3 className={`${selectedUnresolved ? 'text-lg' : 'text-xl'} font-medium text-[#f0f4ed]`}>{selected.species}</h3><p className="mt-0.5 text-xs italic text-[#758b87]">{selectedUnresolved ? '原音での確認が必要です' : selected.scientific}</p></div>{selected.confidence !== null && <div className="shrink-0 text-right"><p className="text-[9px] text-[#758b87]">AI候補スコア</p><span className="text-2xl font-light text-[#d8a64b]">{selected.confidence}<small className="text-xs">%</small></span></div>}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2"><div className="rounded-lg bg-[#122322] p-3"><p className="text-[10px] text-[#647c77]">検出位置</p><p className="mt-1 text-sm font-medium text-[#cedad6]">{formatClock(selected.start)}</p></div><div className="rounded-lg bg-[#122322] p-3"><p className="text-[10px] text-[#647c77]">地域・季節</p><p className="mt-1 text-xs font-medium text-[#9fc4b5]">{selected.filterStatus}</p><p className="mt-0.5 text-[10px] text-[#5d7771]">{selected.geoProbability === null ? '種名の照合は未確定' : `Geo ${selected.geoProbability}%`}</p></div></div>
                  {selectedUnresolved && <div className="rounded-lg border border-[#493854] bg-[#211a29] px-3 py-2 text-[11px] leading-relaxed text-[#cbb5da]">{selected.unresolvedReason === 'classification-unavailable' ? '鳥種の照合を完了できなかった区間です。' : '種名候補を選べなかった区間です。'}鳥の声かどうかも原音で確認してください。承認しても種名は未確定のまま保存・出力されます。</div>}
                  {selected.goshawkSeason && <div className="rounded-lg border border-[#493c24] bg-[#241f15] px-3 py-2 text-[11px] leading-relaxed text-[#d8bd7d]">オオタカ: {selected.goshawkSeason}</div>}
                  <div aria-live="polite" className={`rounded-lg border px-3 py-2 text-[11px] ${listenedIds.has(selected.id) ? 'border-[#2d5143] bg-[#142a22] text-[#8fc8a5]' : 'border-[#4a3e26] bg-[#241f15] text-[#cdb375]'}`}><div className="flex items-center gap-2"><Headphones className="size-3.5" />{listenedIds.has(selected.id) ? '原音を最後まで再生済みです。判定を登録できます。' : playing === selected.id ? '原音を再生中です。再生完了後に判定できます。' : '先に原音を最後まで再生してから判定してください。'}</div></div>
                  <div className="grid grid-cols-2 gap-2"><Button className="bg-[#2f704f] text-white hover:bg-[#38815c]" disabled={!listenedIds.has(selected.id)} onClick={() => updateReview(selected, 'approved')}><CheckCircle2 data-icon="inline-start" />{selectedUnresolved ? '候補を承認' : '承認'}</Button><Button className="border-[#6a3d37] bg-transparent text-[#d89a90] hover:bg-[#2c1a18]" disabled={!listenedIds.has(selected.id)} onClick={() => updateReview(selected, 'rejected')} variant="outline"><XCircle data-icon="inline-start" />却下</Button></div>
                  <div className="grid grid-cols-[1fr_auto] gap-2"><Button className="border-[#324742] bg-transparent text-[#b2c1bd] hover:bg-[#162826]" onClick={() => void downloadClip(selected)} variant="outline"><Download data-icon="inline-start" />区間WAV</Button><Button aria-label="未確認に戻す" className="border-[#324742] bg-transparent text-[#819690] hover:bg-[#162826]" onClick={() => updateReview(selected, 'pending')} size="icon" variant="outline"><RotateCcw /></Button></div>
                </div>
              </> : <div className="grid min-h-[390px] place-items-center rounded-xl border border-dashed border-[#2b3e3a] bg-[#0a1515] px-6 text-center"><div><Bird className="mx-auto mb-3 size-8 text-[#536d67]" /><p className="text-sm text-[#94a7a2]">検出結果がありません</p><p className="mt-2 text-[11px] leading-relaxed text-[#5f7772]">録音データを追加し、解析を開始してください。</p></div></div>}
            </aside>
          </div>

          <section className="mt-4 overflow-hidden rounded-2xl border border-white/8 bg-[#0d1c1c]" id="records">
            {saveNotice && <p className="border-b border-white/7 px-5 py-3 text-[11px] text-[#99afa7]" role="status">{saveNotice}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/7 bg-[#101c20] px-5 py-3">
              <label className="flex items-center gap-2 text-[11px] text-[#93a6a2]">種名の状態<select aria-label="種名の状態で絞り込み" className="h-8 rounded-lg border border-[#3b3548] bg-[#151721] px-2.5 text-xs text-[#c2aecf] outline-none" onChange={(event) => setIdentificationFilter(event.target.value as 'all' | 'species' | 'unresolved')} value={identificationFilter}><option value="all">すべての候補</option><option value="unresolved">種未確定のみ</option><option value="species">種名候補あり</option></select></label>
              <label className="flex items-center gap-2 text-[11px] text-[#93a6a2]">確認順の参考（試験）<select aria-label="AIスコア区分で絞り込み" className="h-8 rounded-lg border border-[#2c413d] bg-[#0a1717] px-2.5 text-xs" value={scoreFilter} onChange={(event) => setScoreFilter(event.target.value as typeof scoreFilter)}><option value="all">全候補を残す</option><option value="standard">通常確認（最大種スコア0.1以上）</option><option value="lower">低スコア・要確認</option><option value="unmeasured">未計測（過去結果など）</option></select></label>
              <p className="text-[11px] text-[#8b819a]">低スコアは雑音確定ではありません。全候補を残し、原音で確認します。過去結果の区分には再解析が必要です。</p>
            </div>
            <div className="flex flex-col justify-between gap-3 border-b border-white/7 px-4 py-4 xl:flex-row xl:items-center sm:px-5">
              <div><h2 className="text-sm font-medium text-[#dfe8e5]">AI候補 → 原音確認</h2><p className="mt-1 text-[11px] text-[#667e79]">{candidateCount ? `${candidateCount}区間の音声候補 · 種未確定 ${unresolvedCount}件 · 未確認 ${pendingCount}件 · 承認 ${approvedCount}件` : '種名を付けられない音声候補も原音確認用に残します'}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex h-8 items-center gap-2 rounded-lg border border-[#2c413d] bg-[#0a1717] px-2.5 text-xs text-[#809590]"><Search className="size-3.5" /><input aria-label="鳥の種類を検索" className="w-24 bg-transparent text-[#c6d2ce] outline-none placeholder:text-[#526a65]" onChange={(event) => setQuery(event.target.value)} placeholder="種名で検索" value={query} /></label>
                <select aria-label="確認状態で絞り込み" className="h-8 rounded-lg border border-[#2c413d] bg-[#0a1717] px-2.5 text-xs text-[#9aada8] outline-none" onChange={(event) => setReviewFilter(event.target.value as 'all' | ReviewStatus)} value={reviewFilter}><option value="all">全確認状態</option><option value="pending">未確認</option><option value="approved">承認</option><option value="rejected">却下</option></select>
                <Button className="border-[#2c413d] bg-transparent text-[#849a95] hover:bg-white/5" disabled={!detections.length} onClick={() => downloadCsv('all')} size="sm" variant="outline"><Download data-icon="inline-start" />全件CSV</Button>
                <Button className="border-[#315342] bg-[#173126] text-[#91c7a7] hover:bg-[#1d3c2e]" disabled={!approvedCount} onClick={() => downloadCsv('approved')} size="sm" variant="outline"><CheckCircle2 data-icon="inline-start" />承認済み</Button>
              </div>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left"><thead className="border-b border-white/6 bg-[#0b1818] text-[10px] uppercase tracking-[0.1em] text-[#536c67]"><tr><th className="px-5 py-3 font-medium">位置</th><th className="px-4 py-3 font-medium">候補種</th><th className="px-4 py-3 font-medium">AI</th><th className="px-4 py-3 font-medium">地域・季節</th><th className="px-4 py-3 font-medium">時間</th><th className="px-4 py-3 font-medium">原音確認</th><th className="px-5 py-3" /></tr></thead><tbody>
              {pageDetections.map((item, index) => <tr className={`cursor-pointer border-b border-white/5 text-xs transition hover:bg-white/[.025] ${selected?.id === item.id ? 'bg-[#132523]' : ''} ${item.reviewStatus === 'rejected' ? 'opacity-55' : ''}`} key={item.id} onClick={() => setSelected(item)}>
                <td className="px-5 py-3.5 font-mono text-[#a7b8b4]">{formatClock(item.start)}</td>
                <td className="px-4 py-3.5"><div className="flex items-center gap-3"><span className="size-2 rounded-full" style={{ backgroundColor: isUnresolvedDetection(item) ? '#c4a8dd' : colors[index % colors.length] }} /><div><div className="flex items-center gap-1.5"><p className={`font-medium ${isUnresolvedDetection(item) ? 'text-[#cbb5da]' : 'text-[#dbe4e1]'}`}>{item.species}</p>{item.prioritySpecies && <span className="rounded bg-[#46391f] px-1.5 py-0.5 text-[9px] text-[#dbb85f]">重点</span>}</div><p className="mt-0.5 text-[10px] italic text-[#607873]">{item.scientific || '原音確認待ち'}</p></div></div></td>
                <td className="px-4 py-3.5"><span className="font-mono text-[#d7b267]">{item.confidence === null ? '—' : `${item.confidence}%`}</span></td>
                <td className="px-4 py-3.5"><p className="text-[#91b7aa]">{item.filterStatus}</p><p className="mt-0.5 text-[10px] text-[#526a65]">{item.geoProbability === null ? '要原音確認' : `Geo ${item.geoProbability}%`}</p></td>
                <td className="px-4 py-3.5"><Badge className={item.night ? 'bg-[#1e3034] text-[#8eb7bd]' : 'bg-[#263324] text-[#a9be91]'} variant="secondary">{item.night ? '夜間' : '昼間・薄明'}</Badge></td>
                <td className="px-4 py-3.5"><Badge className={item.reviewStatus === 'approved' ? 'bg-[#20382d] text-[#8fd0a7]' : item.reviewStatus === 'rejected' ? 'bg-[#3a2523] text-[#dfa095]' : 'bg-[#3b3422] text-[#dbbd73]'} variant="secondary">{reviewStatusLabel(item.reviewStatus)}</Badge></td>
                <td className="px-5 py-3.5"><Button aria-label={`${item.species}を再生`} className="text-[#728984] hover:bg-white/5" onClick={(event) => { event.stopPropagation(); void playDetection(item); }} size="icon-sm" variant="ghost">{playing === item.id ? <Pause /> : <Play />}</Button></td>
              </tr>)}
              {!visibleDetections.length && <tr><td className="px-5 py-10 text-center text-xs text-[#5f7772]" colSpan={7}>{detections.length ? '条件に一致する検出はありません。' : '解析結果はここに表示されます。'}</td></tr>}
            </tbody></table></div>
            {visibleDetections.length > 0 && <nav aria-label="候補一覧のページ" className="flex flex-wrap items-center justify-between gap-3 border-t border-white/7 px-5 py-3 text-[11px] text-[#849b94]"><span>{visibleDetections.length}件中 {currentPage * pageSize + 1}〜{Math.min(visibleDetections.length, (currentPage + 1) * pageSize)}件 · CSVは全ページを出力</span><div className="flex items-center gap-3"><Button aria-label="前の候補ページ" disabled={currentPage === 0} onClick={() => setResultPage(currentPage - 1)} size="sm" variant="ghost">前へ</Button><span>{currentPage + 1} / {pageCount}</span><Button aria-label="次の候補ページ" disabled={currentPage + 1 >= pageCount} onClick={() => setResultPage(currentPage + 1)} size="sm" variant="ghost">次へ</Button></div></nav>}
          </section>
          <div className="mt-3 flex flex-col justify-between gap-2 text-[10px] text-[#48625d] sm:flex-row"><p>録音データと確認結果はアップロードされず、ブラウザ内で処理されます。</p><p>BirdNET+ v3.0-preview3.1 + GeoModel v3.0.4 · 最終同定は専門家確認を推奨</p></div>
          <p className="mt-3 text-[11px] text-[#94b7a6]"><a href="./audit.html" className="underline underline-offset-4">精度検証用の原音確認</a><span className="ml-2 text-[#667e79]">実験結果JSONから、候補がない区間も確認できます。</span></p>
        </section>
      </div>
    </main>
  );
}
