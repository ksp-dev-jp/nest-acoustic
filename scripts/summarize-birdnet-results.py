from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def as_float(value: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def build_events(rows: list[dict[str, str]], max_gap_seconds: int = 6) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[row["scientific_name"]].append(row)

    events: list[dict[str, object]] = []
    for scientific, species_rows in grouped.items():
        species_rows.sort(key=lambda row: int(row["segment"]))
        current: list[dict[str, str]] = []
        for row in species_rows:
            offset = int(row["segment"]) * 3
            if current and offset - int(current[-1]["segment"]) * 3 > max_gap_seconds:
                events.append(summarize_event(scientific, current))
                current = []
            current.append(row)
        if current:
            events.append(summarize_event(scientific, current))
    return sorted(events, key=lambda event: (-float(event["peak_confidence"]), int(event["start_seconds"])))


def summarize_event(scientific: str, rows: list[dict[str, str]]) -> dict[str, object]:
    peak = max(rows, key=lambda row: as_float(row["confidence"]))
    start_seconds = int(rows[0]["segment"]) * 3
    end_seconds = int(rows[-1]["segment"]) * 3 + 3
    return {
        "species_ja": peak["species_ja"],
        "scientific_name": scientific,
        "common_name": peak["common_name"],
        "start_seconds": start_seconds,
        "end_seconds": end_seconds,
        "offset_start": rows[0]["offset_start"],
        "offset_end": format_offset(end_seconds),
        "recording_time_start": rows[0]["recording_time"],
        "recording_time_end": rows[-1]["recording_time"],
        "peak_confidence": as_float(peak["confidence"]),
        "peak_offset": peak["offset_start"],
        "segments": len(rows),
    }


def format_offset(seconds: int) -> str:
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def percent(numerator: int, denominator: int) -> str:
    return f"{numerator / denominator * 100:.1f}%" if denominator else "-"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("analysis_dir", type=Path)
    args = parser.parse_args()
    directory = args.analysis_dir
    summary = json.loads((directory / "summary.json").read_text(encoding="utf-8"))
    priority = read_csv(directory / "priority_candidates.csv")
    manual = read_csv(directory / "manual_validation.csv")
    events = build_events(priority)
    for event in events:
        matches = [
            row for row in manual
            if str(event["scientific_name"]) in row["expected_scientific"].split(" / ")
            and int(event["start_seconds"]) < as_float(row["end_seconds"])
            and int(event["end_seconds"]) > as_float(row["start_seconds"])
        ]
        event["manual_match_count"] = len(matches)
        peak = float(event["peak_confidence"])
        if matches:
            event["review_class"] = "手動記録と一致"
        elif peak >= 0.25:
            event["review_class"] = "手動記録なし・優先確認"
        elif peak >= 0.10:
            event["review_class"] = "手動記録なし・要確認"
        else:
            event["review_class"] = "低スコア参考候補"
    write_csv(directory / "priority_events.csv", events)

    event_counts = Counter(str(event["scientific_name"]) for event in events)
    peaks: dict[str, float] = defaultdict(float)
    names: dict[str, str] = {}
    for event in events:
        scientific = str(event["scientific_name"])
        peaks[scientific] = max(peaks[scientific], float(event["peak_confidence"]))
        names[scientific] = str(event["species_ja"])

    lines = [
        "# 夜間鳥類音声 AI 解析レポート",
        "",
        "## 解析対象",
        "",
        f"- 音声: `{summary['input_file']}`",
        f"- 録音開始: {summary['recording_start']}",
        f"- 解析時間: {summary['analyzed_seconds'] / 3600:.2f} 時間（{summary['segment_count']:,} 区間、1区間 {summary['segment_seconds']} 秒）",
        f"- 音声仕様: {summary['sample_rate']:,} Hz / {summary['channels']} ch / {summary['bits_per_sample']} bit",
        f"- モデル: {summary['model']}",
        "",
        "## 夜間重要種・重点確認種の候補",
        "",
        "| 種 | 学名 | 5%以上の区間 | 連結イベント | 最大スコア |",
        "|---|---|---:|---:|---:|",
    ]
    priority_by_scientific = {row["scientific"]: row for row in summary.get("priority_species", [])}
    for scientific, row in sorted(priority_by_scientific.items(), key=lambda item: (-peaks[item[0]], item[0])):
        lines.append(
            f"| {names.get(scientific, row['species'])} | {scientific} | {row['segments_over_5pct']} | "
            f"{event_counts[scientific]} | {peaks[scientific]:.3f} |"
        )
    if not priority_by_scientific:
        lines.append("| 該当なし | - | 0 | 0 | - |")

    lines.extend([
        "",
        "### 個別候補と照合状況",
        "",
        "| 種 | 録音オフセット | 実時刻 | 最大スコア | 判定区分 |",
        "|---|---:|---:|---:|---|",
    ])
    for event in events:
        lines.append(
            f"| {event['species_ja']} | {event['offset_start']}–{event['offset_end']} | "
            f"{str(event['recording_time_start']).replace('T', ' ')} | {float(event['peak_confidence']):.3f} | "
            f"{event['review_class']} |"
        )

    lines.extend([
        "",
        "### 一次評価",
        "",
        "- オオタカ3イベント（00:35:54、00:36:39、00:44:42）とトラツグミ2イベント（00:33:27、00:33:48）は手動記録の時刻と一致しました。",
        "- オオタカ00:53:06（スコア0.252）は照合表に対応記録がなく、今回の追加確認で最も優先度が高い候補です。",
        "- オオタカ02:26:06（0.127）は低〜中スコアの追加候補です。原音確認前には採用しません。",
        "- フクロウ候補4イベントはすべて0.10未満（0.063〜0.077）で、地域外種も競合候補に出ているため、現段階では検出根拠として扱わない参考候補です。",
        "- トラツグミ2件目は手動記録と一致する一方で0.073でした。夜間重要種の見落としを減らすには、5%程度で候補抽出して人が確認する運用が適しています。",
        "",
        "上表は自動抽出候補です。種の確定には `priority_events.csv` の時刻から原音を聴取し、声紋を確認してください。",
        "",
        "## 全体で上位に出た鳥種",
        "",
        "| 種 | 学名 | top-1かつ10%以上の区間数 |",
        "|---|---|---:|",
    ])
    for row in summary.get("top_species", [])[:15]:
        lines.append(f"| {row['species']} | {row['scientific']} | {row['segments_over_10pct']} |")

    grouped: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "d10": 0, "d25": 0})
    for row in manual:
        item = grouped[row["manual_species"]]
        item["total"] += 1
        item["d10"] += row["ai_detected_10pct"].lower() == "true"
        item["d25"] += row["ai_detected_25pct"].lower() == "true"
    lines.extend([
        "",
        "## 手動記録との照合",
        "",
        "| 手動記録種 | 記録数 | AI 10%以上 | AI 25%以上 |",
        "|---|---:|---:|---:|",
    ])
    for species, values in grouped.items():
        lines.append(
            f"| {species} | {values['total']} | {values['d10']} ({percent(values['d10'], values['total'])}) | "
            f"{values['d25']} ({percent(values['d25'], values['total'])}) |"
        )

    lines.extend([
        "",
        "## 判定上の注意",
        "",
        "- 録音開始は 05:50 で、解析範囲は早朝から午前にかけての2時間30分です。終夜録音ではありません。",
        "- BirdNET のスコアは種同定の確率そのものではなく、録音条件・雑音・地域・季節に左右されます。",
        "- 5%は見落としを減らすための候補抽出閾値、10%と25%は手動記録との比較用閾値です。",
        "- 今回は全世界種モデルを地域・季節フィルターなしで使用しています。地域外種の候補が混在するため、全体上位種は参考値です。",
        "- 保全上重要な判断や報告書への採用前に、専門家による原音・スペクトログラム確認が必要です。",
        "",
    ])
    (directory / "analysis_report.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
