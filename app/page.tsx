'use client';

import {
  AudioWaveform, Bird, CalendarDays, ChevronDown, CircleHelp, Clock3,
  Download, FileAudio, Filter, MapPin, MoonStar, MoreHorizontal, Play,
  Search, Settings2, Sparkles, UploadCloud,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

type Detection = {
  id: number; time: string; species: string; scientific: string;
  confidence: number; band: string; night: boolean; color: string;
};

const detections: Detection[] = [
  { id: 1, time: '00:18:42', species: 'フクロウ', scientific: 'Strix uralensis', confidence: 96, band: '0.4–1.2 kHz', night: true, color: '#e8b45a' },
  { id: 2, time: '01:07:15', species: 'ヨタカ', scientific: 'Caprimulgus indicus', confidence: 91, band: '1.1–2.8 kHz', night: true, color: '#8eb9a9' },
  { id: 3, time: '02:43:08', species: 'トラツグミ', scientific: 'Zoothera aurea', confidence: 87, band: '2.2–4.0 kHz', night: true, color: '#c08fc1' },
  { id: 4, time: '04:51:26', species: 'アオバズク', scientific: 'Ninox scutulata', confidence: 84, band: '0.7–1.5 kHz', night: true, color: '#76aadd' },
  { id: 5, time: '05:12:03', species: 'ウグイス', scientific: 'Horornis diphone', confidence: 79, band: '2.8–6.5 kHz', night: false, color: '#9db866' },
];

const spectrumBars = Array.from({ length: 104 }, (_, index) => {
  const wave = Math.sin(index * 0.73) * 18 + Math.sin(index * 0.17) * 12;
  return Math.max(8, Math.min(73, 30 + wave + (index % 11 === 0 ? 25 : 0)));
});

export default function Home() {
  const [selected, setSelected] = useState(detections[0]);
  const [fileName, setFileName] = useState('SM4_20250608_210000.wav');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(100);
  const [nightOnly, setNightOnly] = useState(true);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAnalyzing) return;
    const timer = window.setInterval(() => {
      setProgress((value) => {
        if (value >= 100) {
          window.clearInterval(timer);
          setIsAnalyzing(false);
          return 100;
        }
        return value + 4;
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  const visibleDetections = useMemo(
    () => detections.filter((item) => (!nightOnly || item.night) && item.species.includes(query)),
    [nightOnly, query],
  );

  function beginAnalysis() {
    setProgress(8);
    setIsAnalyzing(true);
  }

  return (
    <main className="min-h-screen bg-[#081415] text-[#e9f0e9]">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#081415]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-[#d8a64b] text-[#101918] shadow-[0_0_30px_rgba(216,166,75,.16)]">
              <AudioWaveform className="size-[19px]" strokeWidth={2.4} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold tracking-[0.12em]">NEST</span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-[#78918d]">acoustic</span>
              </div>
              <p className="text-[10px] text-[#78918d]">野生動物音声モニタリング</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="hidden border-[#39514c] bg-[#152625] px-2.5 text-[#a9bcb8] sm:flex" variant="outline">
              <span className="size-1.5 rounded-full bg-[#79b997]" /> 試作デモ
            </Badge>
            <Button aria-label="ヘルプ" className="text-[#8da19e] hover:bg-white/5" size="icon" variant="ghost"><CircleHelp /></Button>
            <Button aria-label="設定" className="text-[#8da19e] hover:bg-white/5" size="icon" variant="ghost"><Settings2 /></Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[212px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-64px)] border-r border-white/7 px-4 py-6 lg:flex lg:flex-col">
          <nav aria-label="メインナビゲーション" className="space-y-1">
            <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#536c68]">Workspace</p>
            <a className="flex items-center gap-3 rounded-lg bg-[#192928] px-3 py-2.5 text-sm font-medium text-[#f0f5ef]" href="#analysis"><AudioWaveform className="size-4 text-[#d8a64b]" />音声解析</a>
            <a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#829692] transition hover:bg-white/5" href="#records"><FileAudio className="size-4" />解析履歴</a>
            <a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#829692] transition hover:bg-white/5" href="#species"><Bird className="size-4" />種リスト</a>
          </nav>
          <div className="mt-8 border-t border-white/7 pt-6">
            <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#536c68]">Project</p>
            <button className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-[#a8b8b5] hover:bg-white/5">
              <span className="flex items-center gap-3"><span className="size-2 rounded-full bg-[#d8a64b]" />北摂山系 2025</span><ChevronDown className="size-3.5" />
            </button>
          </div>
          <div className="mt-auto rounded-xl border border-[#263b38] bg-[#0e1d1d] p-3.5">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#c9d4d1]"><MoonStar className="size-3.5 text-[#d8a64b]" />夜間解析モード</div>
            <p className="text-[11px] leading-relaxed text-[#6f8782]">日没後の検出を優先表示しています。</p>
          </div>
        </aside>

        <section className="min-w-0 px-4 py-5 sm:px-6 sm:py-7 xl:px-9" id="analysis">
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#d8a64b]">NEST ACOUSTIC</p>
              <h1 className="text-2xl font-medium tracking-[-0.025em] text-[#f1f5ef] sm:text-[30px]">鳥類音声解析</h1>
            </div>
            <Button className="h-10 shrink-0 rounded-xl bg-[#d8a64b] px-4 text-[#17201f] hover:bg-[#e4b65f]" onClick={() => inputRef.current?.click()}>
              <UploadCloud data-icon="inline-start" />音声を追加
            </Button>
            <input accept="audio/*,.wav" className="hidden" ref={inputRef} type="file" onChange={(event) => event.target.files?.[0] && setFileName(event.target.files[0].name)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0d1c1c] shadow-[0_22px_70px_rgba(0,0,0,.16)]">
              <div className="flex flex-col justify-between gap-3 border-b border-white/7 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#172a28] text-[#d8a64b]"><FileAudio className="size-[17px]" /></div>
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-[#dfe8e5]">{fileName}</p><p className="mt-0.5 text-[11px] text-[#6e8580]">WAV · Mono · 24 kHz · 8時間 00分</p></div>
                </div>
                <div className="flex items-center gap-2">
                  <Button className="border-[#314642] bg-transparent text-[#9aafaa] hover:bg-white/5" size="sm" variant="outline"><MoreHorizontal /></Button>
                  <Button className="bg-[#d8a64b] text-[#17201f] hover:bg-[#e4b65f]" disabled={isAnalyzing} onClick={beginAnalysis} size="sm"><Sparkles data-icon="inline-start" />{isAnalyzing ? '解析中…' : '再解析'}</Button>
                </div>
              </div>

              <div className="px-4 py-5 sm:px-5">
                <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-[#708782]">
                  <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" />2025年6月8日 21:00</span>
                  <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />北摂山系・地点 A-03</span>
                  <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />解析区間 5秒 / 重複 3秒</span>
                </div>

                {isAnalyzing && <div className="mb-5 rounded-xl border border-[#31423e] bg-[#122322] p-3"><div className="mb-2 flex justify-between text-[11px] text-[#9cafaa]"><span>声紋を生成し、候補種と照合しています</span><span>{progress}%</span></div><Progress className="[&_[data-slot=progress-indicator]]:bg-[#d8a64b] [&_[data-slot=progress-track]]:bg-[#273936]" value={progress} /></div>}

                <div className="relative h-[210px] overflow-hidden rounded-xl border border-[#263a37] bg-[#091313]">
                  <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(126,165,153,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(126,165,153,.12)_1px,transparent_1px)] [background-size:100%_42px,8.333%_100%]" />
                  <div className="absolute inset-x-7 bottom-7 top-5 flex items-end gap-[2px] opacity-80">
                    {spectrumBars.map((height, index) => <span className="flex-1 rounded-t-[2px] bg-gradient-to-t from-[#173f3b] via-[#3e8273] to-[#dfaf59]" key={index} style={{ height: `${height}%`, opacity: index % 7 === 0 ? .95 : .4 + (index % 5) * .09 }} />)}
                  </div>
                  <div className="absolute inset-x-7 bottom-[26px] h-px bg-[#45635d]" />
                  <div className="absolute inset-x-7 bottom-2 flex justify-between text-[9px] text-[#4f6b65]"><span>21:00</span><span>23:00</span><span>01:00</span><span>03:00</span><span>05:00</span></div>
                  <div className="absolute left-2 top-3 flex h-[150px] flex-col justify-between text-[9px] text-[#4f6b65]"><span>8k</span><span>4k</span><span>0</span></div>
                  {[11, 26, 49, 73, 88].map((left, index) => <button aria-label={`${detections[index].species} ${detections[index].time}`} className="group absolute bottom-[26px] z-10 -translate-x-1/2" key={left} onClick={() => setSelected(detections[index])} style={{ left: `${left}%` }}><span className="block h-8 w-px bg-[#d8a64b]/60" /><span className="block size-2.5 -translate-x-[4px] rounded-full border-2 border-[#091313] bg-[#d8a64b] shadow-[0_0_0_3px_rgba(216,166,75,.18)] transition group-hover:scale-125" /></button>)}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><span className="text-[11px] text-[#657c77]">表示:</span><button className={`rounded-lg px-3 py-1.5 text-xs transition ${nightOnly ? 'bg-[#263a37] text-[#dce6e2]' : 'text-[#6e8580] hover:bg-white/5'}`} onClick={() => setNightOnly(true)}>夜間のみ</button><button className={`rounded-lg px-3 py-1.5 text-xs transition ${!nightOnly ? 'bg-[#263a37] text-[#dce6e2]' : 'text-[#6e8580] hover:bg-white/5'}`} onClick={() => setNightOnly(false)}>全時間帯</button></div>
                  <div className="flex gap-4 text-[11px] text-[#708782]"><span><b className="mr-1 text-base font-medium text-[#e3ebe8]">32</b>検出</span><span><b className="mr-1 text-base font-medium text-[#e3ebe8]">6</b>候補種</span></div>
                </div>
              </div>
            </section>

            <aside className="rounded-2xl border border-white/8 bg-[#0d1c1c] p-5">
              <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#647c77]">Selected detection</p><h2 className="mt-1 text-sm font-medium text-[#dfe8e5]">選択中の検出</h2></div><Badge className="bg-[#243932] text-[#9bc3a9]" variant="secondary">AI {selected.confidence}%</Badge></div>
              <div className="relative mb-5 grid aspect-[1.72] place-items-center overflow-hidden rounded-xl border border-[#2b3e3a] bg-[#0a1515]">
                <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(126,165,153,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(126,165,153,.16)_1px,transparent_1px)] [background-size:100%_25%,12.5%_100%]" />
                <div className="z-10 flex h-20 w-[75%] items-center justify-center gap-1">
                  {Array.from({ length: 34 }, (_, i) => <i className="w-0.5 rounded-full bg-[#d8a64b]" key={i} style={{ height: `${12 + Math.abs(Math.sin(i * .72)) * 54}%`, opacity: .35 + (i % 6) * .1 }} />)}
                </div>
                <Button aria-label="検出音声を再生" className="absolute grid size-10 place-items-center rounded-full bg-[#edf1e8] text-[#13201e] hover:bg-white" size="icon"><Play className="ml-0.5 fill-current" /></Button>
              </div>
              <div className="space-y-4">
                <div><p className="text-[10px] uppercase tracking-[0.14em] text-[#5f7772]">第一候補</p><div className="mt-1 flex items-end justify-between"><div><h3 className="text-xl font-medium text-[#f0f4ed]">{selected.species}</h3><p className="mt-0.5 text-xs italic text-[#758b87]">{selected.scientific}</p></div><span className="text-2xl font-light text-[#d8a64b]">{selected.confidence}<small className="text-xs">%</small></span></div></div>
                <div className="grid grid-cols-2 gap-2"><div className="rounded-lg bg-[#122322] p-3"><p className="text-[10px] text-[#647c77]">検出時刻</p><p className="mt-1 text-sm font-medium text-[#cedad6]">{selected.time}</p></div><div className="rounded-lg bg-[#122322] p-3"><p className="text-[10px] text-[#647c77]">主要周波数</p><p className="mt-1 text-sm font-medium text-[#cedad6]">{selected.band}</p></div></div>
                <Button className="w-full border-[#324742] bg-transparent text-[#b2c1bd] hover:bg-[#162826]" variant="outline"><Download data-icon="inline-start" />該当区間を書き出す</Button>
              </div>
            </aside>
          </div>

          <section className="mt-4 overflow-hidden rounded-2xl border border-white/8 bg-[#0d1c1c]" id="records">
            <div className="flex flex-col justify-between gap-3 border-b border-white/7 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
              <div><h2 className="text-sm font-medium text-[#dfe8e5]">検出された鳴き声</h2><p className="mt-1 text-[11px] text-[#667e79]">信頼度の高い順に表示 · 確認後にCSVで出力できます</p></div>
              <div className="flex items-center gap-2">
                <label className="flex h-8 items-center gap-2 rounded-lg border border-[#2c413d] bg-[#0a1717] px-2.5 text-xs text-[#809590]"><Search className="size-3.5" /><input aria-label="鳥の種類を検索" className="w-28 bg-transparent text-[#c6d2ce] outline-none placeholder:text-[#526a65]" onChange={(event) => setQuery(event.target.value)} placeholder="種名で検索" value={query} /></label>
                <Button className="border-[#2c413d] bg-transparent text-[#849a95] hover:bg-white/5" size="sm" variant="outline"><Filter data-icon="inline-start" />絞り込み</Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead className="border-b border-white/6 bg-[#0b1818] text-[10px] uppercase tracking-[0.1em] text-[#536c67]"><tr><th className="px-5 py-3 font-medium">時刻</th><th className="px-4 py-3 font-medium">候補種</th><th className="px-4 py-3 font-medium">信頼度</th><th className="px-4 py-3 font-medium">周波数帯</th><th className="px-4 py-3 font-medium">区分</th><th className="px-5 py-3" /></tr></thead>
                <tbody>
                  {visibleDetections.map((item) => <tr className={`cursor-pointer border-b border-white/5 text-xs transition hover:bg-white/[.025] ${selected.id === item.id ? 'bg-[#132523]' : ''}`} key={item.id} onClick={() => setSelected(item)}><td className="px-5 py-3.5 font-mono text-[#a7b8b4]">{item.time}</td><td className="px-4 py-3.5"><div className="flex items-center gap-3"><span className="size-2 rounded-full" style={{ backgroundColor: item.color }} /><div><p className="font-medium text-[#dbe4e1]">{item.species}</p><p className="mt-0.5 text-[10px] italic text-[#607873]">{item.scientific}</p></div></div></td><td className="px-4 py-3.5"><span className="font-mono text-[#d7b267]">{item.confidence}%</span></td><td className="px-4 py-3.5 text-[#809590]">{item.band}</td><td className="px-4 py-3.5"><Badge className={item.night ? 'bg-[#1e3034] text-[#8eb7bd]' : 'bg-[#263324] text-[#a9be91]'} variant="secondary">{item.night ? '夜間' : '薄明'}</Badge></td><td className="px-5 py-3.5"><Button aria-label={`${item.species}を再生`} className="text-[#728984] hover:bg-white/5" size="icon-sm" variant="ghost"><Play /></Button></td></tr>)}
                </tbody>
              </table>
            </div>
          </section>
          <p className="mt-3 text-right text-[10px] text-[#48625d]">この画面はUI・解析フロー確認用の試作です。種判定値はデモデータです。</p>
        </section>
      </div>
    </main>
  );
}
