import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { evaluateAudit, makeAuditBins, validateAuditAnnotations, type AuditAnnotation, type AuditBin, type AuditCandidate, type AuditLabel } from '../lib/audit-evaluation';
import './audit.css';

type Experiment = {
  summary: { source: { name: string; size: number }; fingerprint: string; scope: { from: number; to: number } };
  intervals: (AuditCandidate & { bestBird: string; manual_overlap: boolean })[];
  manual: { start_seconds: number; end_seconds: number; species: string }[];
};
const clock = (value: number) => `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, '0')}`;
const pct = (value: number | null) => value === null ? '未算出' : `${(value * 100).toFixed(1)}%`;
function save(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [experiment, setExperiment] = useState<Experiment>();
  const [bins, setBins] = useState<AuditBin[]>([]);
  const [annotations, setAnnotations] = useState<AuditAnnotation[]>([]);
  const [file, setFile] = useState<File>();
  const [audioUrl, setAudioUrl] = useState('');
  const [selected, setSelected] = useState(0);
  const [listened, setListened] = useState(false);
  const [mode, setMode] = useState<'all' | 'pending' | 'outside' | 'lower'>('all');
  const [threshold, setThreshold] = useState(0.1);
  const [species, setSpecies] = useState('');
  const [noise, setNoise] = useState('');
  const [notice, setNotice] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const playRange = useRef<{ start: number; end: number; expected: number } | undefined>(undefined);
  const key = experiment ? `nest-audit:v1:${experiment.summary.fingerprint}` : '';
  useEffect(() => {
    if (!file) { setAudioUrl(''); return; }
    const url = URL.createObjectURL(file); setAudioUrl(url); return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    audio.current?.pause(); playRange.current = undefined; setListened(false);
    const previous = annotations.find(row => row.id === selected);
    setSpecies(previous?.species.join('、') ?? ''); setNoise(previous?.noise ?? '');
  }, [selected, file, experiment]);
  const persist = (rows: AuditAnnotation[]) => {
    setAnnotations(rows);
    try { localStorage.setItem(key, JSON.stringify(rows)); setNotice('このブラウザに保存しました。JSONも定期的に保存してください。'); }
    catch { setNotice('ブラウザに保存できませんでした。確認結果JSONを保存してください。'); }
  };
  async function loadExperiment(input: File) {
    try {
      if (input.size > 20_000_000) throw new Error('実験結果JSONが大きすぎます。');
      const value = JSON.parse(await input.text()) as Experiment;
      const scope = value.summary?.scope;
      if (!value.summary?.source || typeof value.summary.source.name !== 'string' || !Number.isFinite(value.summary.source.size)
        || !/^[a-f0-9]{64}$/.test(value.summary.fingerprint) || !scope
        || !Array.isArray(value.intervals) || !value.intervals.every(row => Number.isFinite(row.start) && row.start >= 0 && Number.isFinite(row.end) && row.end > row.start && Number.isFinite(row.maxBirdScore) && row.maxBirdScore >= 0 && row.maxBirdScore <= 1)
        || !Array.isArray(value.manual) || !value.manual.every(row => Number.isFinite(row.start_seconds) && Number.isFinite(row.end_seconds) && typeof row.species === 'string')) throw new Error('実験結果JSONの形式が違います。');
      const nextBins = makeAuditBins(scope.from, scope.to);
      let saved: AuditAnnotation[] = [];
      let warning = '';
      try { const json = localStorage.getItem(`nest-audit:v1:${value.summary.fingerprint}`); if (json) saved = validateAuditAnnotations(JSON.parse(json), nextBins); }
      catch { warning = '保存結果を復元できませんでした。JSONから読み込んでください。'; }
      setExperiment(value); setBins(nextBins); setAnnotations(saved); setSelected(0); setFile(undefined); setNotice(warning || '実験結果を読み込みました。次に元の録音を選んでください。');
    } catch (error) { setNotice((error as Error).message); }
  }
  async function loadReviews(input: File) {
    try {
      if (input.size > 20_000_000) throw new Error('確認結果JSONが大きすぎます。');
      const value = JSON.parse(await input.text());
      if (!experiment || value.version !== 1 || value.fingerprint !== experiment.summary.fingerprint) throw new Error('別の実験の確認結果です。');
      const rows = validateAuditAnnotations(value.annotations, bins);
      // Merge imported rows by timestamp. Importing an older export must not erase newer work.
      const merged = new Map(annotations.map(row => [row.id, row]));
      for (const row of rows) if (!merged.has(row.id) || Date.parse(merged.get(row.id)!.reviewedAt) < Date.parse(row.reviewedAt)) merged.set(row.id, row);
      persist([...merged.values()]);
    } catch (error) { setNotice((error as Error).message); }
  }
  useEffect(() => {
    // Only the private, portable expert kit embeds survey data. Public pages have no payload.
    const initial = document.getElementById('initial-experiment')?.textContent;
    if (initial) void loadExperiment(new File([initial], 'results.json', { type: 'application/json' }));
  }, []);
  const current = bins[selected];
  const annotationMap = new Map(annotations.map(row => [row.id, row]));
  const currentLabel = annotationMap.get(selected);
  const matchedFile = !!file && file.name === experiment?.summary.source.name && file.size === experiment?.summary.source.size;
  const overlap = (row: { start: number; end: number }, bin: AuditBin) => row.start < bin.end && row.end > bin.start;
  const candidates = current ? experiment!.intervals.filter(row => overlap(row, current)) : [];
  const manual = current ? experiment!.manual.filter(row => row.start_seconds < current.end && row.end_seconds > current.start) : [];
  const visible = bins.filter(bin => mode === 'pending' ? !annotations.some(row => row.id === bin.id)
    : mode === 'outside' ? !experiment!.intervals.some(row => overlap(row, bin))
    : mode === 'lower' ? experiment!.intervals.some(row => overlap(row, bin)) && !experiment!.intervals.some(row => overlap(row, bin) && row.maxBirdScore >= threshold) : true);
  function play() {
    if (!current || !matchedFile || !audio.current) return;
    const start = Math.max(0, current.start - 1.5), end = Math.min(audio.current.duration || Infinity, current.end + 1.5);
    setListened(false); audio.current.currentTime = start;
    playRange.current = { start, end, expected: start };
    audio.current.play().catch(() => setNotice('再生できません。元のWAVファイルを選択してください。'));
  }
  function mark(label: AuditLabel) {
    if (!current || !listened || !matchedFile) return;
    const row: AuditAnnotation = { ...current, label, species: label === 'bird' ? species.split(/[、,\n]/).map(name => name.trim()).filter(Boolean) : [], noise, reviewedAt: new Date().toISOString() };
    persist([...annotations.filter(row => row.id !== current.id), row]);
  }
  const metrics = evaluateAudit(bins, annotations, experiment?.intervals ?? [], threshold);
  return <main>
    <header><a href={window.location.protocol === 'file:' ? 'https://ksp-dev-jp.github.io/nest-acoustic/' : import.meta.env.BASE_URL}>NEST ACOUSTIC</a><span>精度検証 · 原音確認</span></header>
    <h1>既存録音を、正解データにする。</h1>
    <p>3秒ごとに全範囲を確認します。判定するのは表示中の区間です。前後1.5秒は聞き取りの補助です。鳥と雑音が重なる区間は「鳥声あり」にします。</p>
    <section className="files"><label>1. 実験結果JSON<input aria-label="実験結果JSON" type="file" accept=".json" onChange={event => { const input = event.target.files?.[0]; if (input) void loadExperiment(input); event.target.value = ''; }}/></label>
      <label>2. 元の録音（端末内で再生）<input aria-label="元の録音" type="file" accept="audio/*,.wav" disabled={!experiment} onChange={event => setFile(event.target.files?.[0])}/></label>
      <label>確認結果を読み込む<input aria-label="確認結果を読み込む" type="file" accept=".json" disabled={!experiment} onChange={event => { const input = event.target.files?.[0]; if (input) void loadReviews(input); event.target.value = ''; }}/></label>
    </section>
    <p role="status">{notice}</p>
    {experiment && <>
      <p>対象：{experiment.summary.source.name} · {clock(experiment.summary.scope.from)}〜{clock(experiment.summary.scope.to)} · {bins.length}区間 · 確認済み {annotations.length}区間</p>
      {file && !matchedFile && <p role="alert">実験に使った録音とファイル名・サイズが一致しません。元の録音を選び直してください。</p>}
      <div className="layout"><section>
        <div className="toolbar"><label>表示<select aria-label="確認対象の表示" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="all">全区間</option><option value="pending">未確認</option><option value="outside">候補がない区間（見逃し確認）</option><option value="lower">AIスコアが低い候補</option></select></label><span>{visible.length}区間</span></div>
        <div className="bins" role="list" aria-label="確認区間一覧">{visible.map(bin => <button className={selected === bin.id ? 'active' : ''} key={bin.id} onClick={() => setSelected(bin.id)}>{clock(bin.start)}〜{clock(bin.end)}<small>{annotationMap.has(bin.id) ? ({ bird: '鳥声あり', noise: '鳥声なし', uncertain: '判断保留' } as const)[annotationMap.get(bin.id)!.label] : '未確認'}</small></button>)}</div>
      </section><section>
        <h2>{clock(current.start)}〜{clock(current.end)}</h2>
        <p>記録済み：{currentLabel ? { bird: '鳥声あり', noise: '鳥声なし', uncertain: '判断保留' }[currentLabel.label] : '未確認'}</p>
        <button disabled={!matchedFile} onClick={play}>前後を含めて原音を再生</button>
        <audio ref={audio} src={audioUrl || undefined} preload="metadata" controls onEnded={() => {
          if (playRange.current && audio.current && audio.current.currentTime >= playRange.current.end - 0.05) {
            setListened(true); playRange.current = undefined;
          }
        }} onSeeking={() => {
          const range = playRange.current;
          if (range && audio.current && Math.abs(audio.current.currentTime - range.expected) > 0.8) { playRange.current = undefined; setListened(false); }
        }} onTimeUpdate={() => {
          const range = playRange.current, player = audio.current;
          if (!range || !player) return;
          range.expected = player.currentTime;
          if (player.currentTime >= range.end) { player.pause(); setListened(true); playRange.current = undefined; }
        }}/>
        <p>{listened ? '再生完了。中央の3秒区間について記録してください。' : '再生ボタンから最後まで聞くと記録できます。'}</p>
        <label>鳥種（複数は「、」区切り・不明なら空欄）<input aria-label="確認した鳥種" value={species} onChange={event => setSpecies(event.target.value)}/></label>
        <label>雑音の種類・メモ<input aria-label="雑音の種類とメモ" value={noise} onChange={event => setNoise(event.target.value)}/></label>
        <div className="toolbar"><button disabled={!listened || !matchedFile} onClick={() => mark('bird')}>鳥声あり</button><button disabled={!listened || !matchedFile} onClick={() => mark('noise')}>鳥声なし</button><button disabled={!listened || !matchedFile} onClick={() => mark('uncertain')}>判断保留</button></div>
        <div className="toolbar"><button disabled={!selected} onClick={() => setSelected(selected - 1)}>前の区間</button><button disabled={selected + 1 >= bins.length} onClick={() => setSelected(selected + 1)}>次の区間</button><button disabled={!currentLabel} onClick={() => persist(annotations.filter(row => row.id !== selected))}>この記録を未確認に戻す</button></div>
        <details><summary>既存ラベル・AI候補（確認後の照合用）</summary><p>手動記録：{manual.length ? manual.map(row => row.species).join('、') : '記録なし（鳥声なしを意味しません）'}</p><p>抽出候補：{candidates.length}区間</p><p>最大鳥種スコア：{candidates.length ? pct(Math.max(...candidates.map(row => row.maxBirdScore))) : '候補なし'}</p><p>スコアは鳥声の確率ではありません。</p></details>
      </section></div>
      <section><h2>② 鳥声・雑音の振り分け試験</h2><p>最大鳥種スコアによる優先度付けの試作です。下位候補も残します。精度を確かめてから採否を決めます。</p>
        <label>優先確認のしきい値<select aria-label="振り分け試験のしきい値" value={threshold} onChange={event => setThreshold(Number(event.target.value))}>{[0, .01, .03, .05, .1, .18, .25, .35, .5].map(value => <option key={value} value={value}>{value === 0 ? '全候補（現行）' : value}</option>)}</select></label>
        <p>{metrics.complete ? '全区間の確認完了' : '一部区間のみの暫定集計（範囲全体の精度ではありません）'} · 判断保留 {metrics.uncertain}区間</p>
        <div className="stats"><p>鳥声検出率 <b>{pct(metrics.recall)}</b></p><p>検出の適合率 <b>{pct(metrics.precision)}</b></p><p>鳥声なし区間の誤検出率 <b>{pct(metrics.falsePositiveRate)}</b></p><p>検出中の鳥声なし割合 <b>{pct(metrics.falseDiscoveryRate)}</b></p></div>
        <p>鳥声あり・検出あり {metrics.tp} / 鳥声あり・検出なし {metrics.fn} / 鳥声なし・検出あり {metrics.fp} / 鳥声なし・検出なし {metrics.tn}。3秒区間単位で、候補と時刻が重なると検出ありです。未確認・判断保留は分母に含みません。</p>
        <button onClick={() => save({ version: 1, fingerprint: experiment.summary.fingerprint, source: experiment.summary.source, annotations, threshold, metrics, exportedAt: new Date().toISOString() }, 'nest-acoustic-audit.json')}>確認結果JSONを保存</button>
      </section>
    </>}
    <footer>録音・実験結果・確認内容は送信しません。結果は同じブラウザに保存します。モデルの推測で正解ラベルを補完しません。</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
