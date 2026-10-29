import fs from 'node:fs';
import path from 'node:path';
import { makeAuditBins } from '../lib/audit-evaluation.ts';

const out = path.resolve(process.argv[2] ?? 'outputs/experiments-20261029');
const { summary, diagnosis, intervals, manual } = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
const pct = (n, d) => `${(n / d * 100).toFixed(1)}%`;
const clock = value => `${Math.floor(value / 60)}分${(value % 60).toFixed(1)}秒`;
const bins = makeAuditBins(summary.scope.from, summary.scope.to);
const overlapsManual = item => manual.some(row => item.start < row.end_seconds && item.end > row.start_seconds);
const failures = diagnosis.filter(row => !row.matched);
const baseline = summary.experiments.find(row => row.name === 'threshold-0.18-top1');
const best = summary.experiments.find(row => row.name === 'shift-three-windows-threshold-0.05');
const high = intervals.filter(row => row.maxBirdScore >= .1);
const lower = intervals.filter(row => row.maxBirdScore < .1);
const noCandidate = bins.filter(bin => !intervals.some(item => item.start < bin.end && item.end > bin.start)).length;
const csv = (headers, rows) => '\ufeff' + [headers, ...rows].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
const report = `# NEST ACOUSTIC 改善実験レポート（2026年10月29日）

④不一致の原因調査 → ③判定条件・切り出し位置の比較 → ①専門家用の正解ラベル追加環境 → ②確認順の振り分け試験を実施しました。①の正解データ作成は依頼者側の専門家にお願いします。

## 同じ単位での比較

対象は${summary.source.name}の録音開始${clock(summary.scope.from)}〜${clock(summary.scope.to)}。確定した手動記録63行です。疑問符付きの1行は除外しています。

| 指標 | 現行・全候補 | ②通常確認側のみ（最大種スコア0.1以上） | ③種名を増やす実験（3窓・通常種0.05） |
|---|---:|---:|---:|
| 手動記録の時間検出率 | 63/63・100% | 63/63・100% | 63/63・100% |
| 手動記録の鳥種一致率 | 42/63・66.7% | 42/63・66.7% | 50/63・79.4% |
| 元の抽出候補 | 487区間 | 362区間を先に確認、125区間も保持 | 元の487区間を維持 |
| 手動記録と時間が重なる元の候補 | 213区間・43.7% | 186区間・${pct(186, 362)} | 元の213区間のまま |
| 手動記録と時間が重ならない元の候補 | 274区間・56.3% | 176区間・${pct(176, 362)} | 元の274区間のまま |
| 種名候補の出力行数 | 175行 | 現行の種名条件を維持 | 802行 |

②は、487区間のうち125区間（25.7%）を確認順の後ろに回す試験です。手動記録外の候補は通常側で274→176区間と98区間減ります。ただし、この98区間も低スコア側に残しており、雑音と確定したわけではありません。低スコア側125区間の内訳は、手動記録と重なる27区間、重ならない98区間です。

手動記録外の候補の割合は通常側で56.3%→${pct(176, 362)}（約7.6ポイント低下）。候補が複数重なっているため、手動記録に重なる元の候補が213→186区間になっても、63件すべてに少なくとも1区間が残ります。これらは「手動記録外の候補」の集計であって真の誤検出率ではありません。

③では鳥種一致が8件・12.7ポイント増えました。一方、出力は175→802行（約4.6倍）です。487区間それぞれに対して元の3秒窓と前後0.75秒ずらした3秒窓の計1,461窓で判定し、実際の窓の時刻と鳥種で照合しました。同じ開始時刻・鳥種だけを重複除去しています。50/63は「手動記録の正解種が候補に含まれた割合」であり、自動出力の79.4%が正しいという意味ではありません。

②と③は別の実験です。362区間だけで50件一致したという結果ではありません。現行アプリの種名採用条件は維持し、②のスコア区分だけを試験機能として追加しました。

## ④ 不一致21件の原因

21件すべてで、現行窓内の正解種の最大音声スコアが採用しきい値未満でした。正解種の地域・季節スコアはしきい値以上です。今回の21件では地域・季節による除外が主因ではありません。これはAI出力上の診断であり、音質や手動ラベルの正否を断定するものではありません。

メジロ7件・ヤマガラ2件は、しきい値0.05、前後0.75秒の移動、手動時刻中央の診断専用窓でも改善を確認できませんでした。専門家に種名・時刻・小音量・重なり音を再確認いただきます。正解時刻を使う中央窓は、実運用方式の成績には含めていません。

| 鳥種 | 手動記録 | 現行一致 | 3窓・0.05で一致 |
|---|---:|---:|---:|
${baseline.by_species.map(row => `| ${row.species} | ${row.confirmed} | ${row.matched} | ${best.by_species.find(item => item.species === row.species).matched} |`).join('\n')}

## ③ 条件比較の全結果

通常種のしきい値・上位候補数・窓位置を比較。重点種のしきい値0.05、Geoしきい値0.03は固定しました。種別しきい値0.05/0.10/0.18/0.25/0.35の試験もresults.jsonのspeciesThresholdsに保存しました。負例不足のため、鳥種別の最適しきい値は確定していません。

| 実験 | 一致した手動記録 | 鳥種一致率 | 種名出力行数 |
|---|---:|---:|---:|
${summary.experiments.map(row => `| ${row.name} | ${row.matched}/63 | ${pct(row.matched, 63)} | ${row.named_rows} |`).join('\n')}

現行175行について、種名・開始時刻・丸めたスコアが既存検証と一致することを確認（baseline_parity=${summary.baseline_parity.matches}）。1,522種類の開始時刻で推論しました。うち実運用比較は1,461窓、残りは重複を除いた手動中央の診断用窓です。

## ① 専門家の追加確認と②の評価

63件は一部の陽性記録で、未記録の時間を鳥声なしとは扱えません。全範囲を3秒ずつ${bins.length}区間（最終区間のみ短い）に分割しました。抽出候補が重ならない${noCandidate}区間も含めて確認します。

確認画面は「鳥声あり／鳥声なし／判断保留」、複数鳥種・雑音メモ、途中保存・JSON出力・再開に対応。前後1.5秒を補助として再生し、中央の範囲だけを判定します。既存ラベルとAI情報は折り畳み、先に原音で確認できるようにしました。録音・回答は外部へ送信しません。

②は「最大の個別鳥種スコア」を確認順に使う試作です。P(鳥声)でも、専用の鳥声／雑音分類器でもありません。低スコアを削除しません。

| 最大種スコアのしきい値 | 通常確認 | 低スコア側に残す | 通常側の時間検出 | 通常側の鳥種一致 |
|---|---:|---:|---:|---:|
${summary.triage.map(row => `| ${row.threshold} | ${row.high_priority_intervals} | ${row.lower_priority_intervals} | ${row.manual_temporal_covered_in_high}/63 | ${row.manual_species_matched_in_high}/63 |`).join('\n')}

0.18に上げると既知63件中3件が通常側から外れるため、強い自動除外は採用しません。専門家の回答後、確認画面でしきい値を変えて、鳥声検出率・適合率・鳥声なし区間の誤検出率・検出中の鳥声なし割合を計算できます。未確認・判断保留は分母に含めません。

## 限界

同一録音・同じ63件を用いた探索的実験です。独立した精度評価ではなく、夜間性能の保証でもありません。時刻は正の重なりがあれば一致とし、鳴き声全体の収録を保証しません。候補を出していない区間を含む全範囲の専門家確認が終わるまで、真の誤検出率・適合率・F1の改善は不明です。

改善案は専門家の正解ラベルで再評価し、条件を固定した後、別日・別地点の録音で独立検証します。

## 関連ファイル

- results.json：実験結果・確認画面の入力。
- scores.jsonl：全推論窓のスコアキャッシュ（専門家キットには含めません）。
- diagnosis.csv：全63件の診断。matched=falseの21件が不一致。
- audit-plan.csv：全${bins.length}区間。人の判定欄は空欄。

評価単位の参考：[BirdNET公式評価手順](https://birdnet-team.github.io/BirdNET-Analyzer/dev/best-practices/evaluation-tool.html)。負例と独立試験データの参考：[BirdNET公式学習手順](https://birdnet-team.github.io/BirdNET-Analyzer/dev/best-practices/training.html)。今回の実験は当アプリのONNX推論で実行しており、公式Analyzer評価ツールの実行結果ではありません。
`;
fs.writeFileSync(path.join(out, '改善実験レポート_20261029.md'), report);
fs.writeFileSync(path.join(out, 'diagnosis.csv'), csv(['species', 'manual_source_row', 'start_seconds', 'end_seconds', 'matched', 'diagnosis', 'best_score', 'geo', 'shifted_score', 'oracle_centered_score'], diagnosis.map(row => [row.species, row.source_row, row.start_seconds, row.end_seconds, row.matched, row.diagnosis, row.best.score, row.best.geo, row.shifted.score, row.oracle_centered.score])));
fs.writeFileSync(path.join(out, 'audit-plan.csv'), csv(['bin_id', 'start_seconds', 'end_seconds', 'candidate_overlap', 'human_bird_noise_uncertain', 'human_species', 'noise_notes'], bins.map(bin => [bin.id, bin.start, bin.end, intervals.some(item => item.start < bin.end && item.end > bin.start), '', '', ''])));
fs.writeFileSync(path.join(out, '比較集計.json'), JSON.stringify({ baseline: { intervals: intervals.length, overlap: intervals.filter(overlapsManual).length, outside: intervals.filter(row => !overlapsManual(row)).length }, standard: { intervals: high.length, overlap: high.filter(overlapsManual).length, outside: high.filter(row => !overlapsManual(row)).length }, lower: { intervals: lower.length, overlap: lower.filter(overlapsManual).length, outside: lower.filter(row => !overlapsManual(row)).length } }, null, 2));
fs.writeFileSync(path.join(out, '専門家への依頼と操作手順.md'), `# 鳥類音声の原音確認のお願い

AIによる候補抽出・種判定を改善するため、鳥声と雑音の正解データ作成をお願いします。

対象は「${summary.source.name}」の録音開始${clock(summary.scope.from)}〜${clock(summary.scope.to)}、全${bins.length}区間です。既存の63件は全鳥声を網羅していません。未記録・候補なしの時間も確認してください。

## 操作

1. キットを展開し、「原音確認.html」をChromeまたはEdgeで開きます。インストール・ログインは不要です。Web版は https://ksp-dev-jp.github.io/nest-acoustic/audit.html です。
2. キットのHTMLでは実験結果を自動で読み込みます。Web版を使う場合は「実験結果JSON」で同梱のresults.jsonを選びます。
3. 「元の録音」で${summary.source.name}を選びます。録音はキットに含めていません。所有者から別途、安全な方法で受領してください。
4. 再生ボタンで前後を含む原音を最後まで聞き、中央の対象区間だけを判定します。
5. 「鳥声あり／鳥声なし／判断保留」を記録します。鳥と雑音が重なる場合は鳥声あり。鳥種が不明でも鳥声ありにできます。複数種は「、」区切り。不確かな区間は保留にしてください。
6. 「次の区間」で進みます。「未確認」表示で残りを絞れます。「候補がない区間」は見逃し確認用です。
7. 区切りごとに「確認結果JSONを保存」を押し、nest-acoustic-audit.jsonを依頼者へ返してください。録音の再送は不要です。

同じブラウザでは復元できますが、消去・端末変更に備えJSONを保存してください。再開時は実験結果・元の録音を選び、必要なら確認結果JSONを読み込みます。古いJSONを読み込んでも新しい記録は日時に基づき保持します。

## 特に確認いただきたい点

- メジロ7件・ヤマガラ2件の種名・時刻・小音量・重なり音。
- diagnosis.csvのmatched=falseに該当する21件。AIのスコアだけで鳥声なしと判断しないでください。
- 手動記録のない鳥声や雑音。最終目標は全${bins.length}区間の確認です。

既存ラベル・AI情報は折り畳んであります。できれば原音の判断後に照合してください。鳥声なしの場合は風・昆虫・車両・その他などをメモしてください。

画面は録音・回答を送信しません。最大鳥種スコアは鳥声の確率ではありません。精度表示は鳥声あり／鳥声なしを記録した区間だけの暫定集計です。判断保留・未確認を含む全範囲の精度とは解釈しないでください。

Webアプリ自体は公開されていますが、同梱の調査データ・原音・回答は公開しないでください。原音は本キットと別に、合意した方法で共有してください。
`);
console.log(JSON.stringify({ failures: failures.length, audit_bins: bins.length, no_candidate_bins: noCandidate, report: path.join(out, '改善実験レポート_20261029.md') }));
