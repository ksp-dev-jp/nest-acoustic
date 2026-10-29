export type AuditLabel = 'bird' | 'noise' | 'uncertain';
export type AuditBin = { id: number; start: number; end: number };
export type AuditAnnotation = AuditBin & { label: AuditLabel; species: string[]; noise: string; reviewedAt: string };
export type AuditCandidate = { start: number; end: number; maxBirdScore: number };

export function makeAuditBins(from: number, to: number, seconds = 3): AuditBin[] {
  if (![from, to, seconds].every(Number.isFinite) || from < 0 || to <= from || seconds <= 0
    || Math.ceil((to - from) / seconds) > 100_000) throw new Error('確認範囲が不正です。');
  return Array.from({ length: Math.ceil((to - from) / seconds) }, (_, id) => ({ id, start: from + id * seconds, end: Math.min(to, from + (id + 1) * seconds) }));
}

/** Unknown/unreviewed bins are never negative examples. Count fixed time bins, not rows. */
export function evaluateAudit(bins: AuditBin[], annotations: AuditAnnotation[], candidates: AuditCandidate[], threshold: number) {
  const labels = new Map(annotations.map(item => [item.id, item]));
  let tp = 0, fn = 0, fp = 0, tn = 0, uncertain = 0;
  for (const bin of bins) {
    const label = labels.get(bin.id);
    if (!label) continue;
    if (label.label === 'uncertain') { uncertain++; continue; }
    const detected = candidates.some(item => item.maxBirdScore >= threshold && item.start < bin.end && item.end > bin.start);
    if (label.label === 'bird') { if (detected) tp++; else fn++; }
    else if (detected) fp++; else tn++;
  }
  const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
  return { tp, fn, fp, tn, uncertain, reviewed: labels.size, total: bins.length,
    complete: tp + fn + fp + tn === bins.length,
    recall: ratio(tp, tp + fn), precision: ratio(tp, tp + fp),
    falsePositiveRate: ratio(fp, fp + tn), falseDiscoveryRate: ratio(fp, tp + fp) };
}

export function validateAuditAnnotations(value: unknown, bins: AuditBin[]): AuditAnnotation[] {
  if (!Array.isArray(value) || value.length > bins.length) throw new Error('確認データの件数が不正です。');
  const ids = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.id) || ids.has(item.id)
      || !bins[item.id] || item.start !== bins[item.id].start || item.end !== bins[item.id].end
      || !['bird', 'noise', 'uncertain'].includes(item.label)
      || !Array.isArray(item.species) || !item.species.every((name: unknown) => typeof name === 'string' && name.length <= 200)
      || (item.label !== 'bird' && item.species.length > 0)
      || typeof item.noise !== 'string' || item.noise.length > 1000
      || typeof item.reviewedAt !== 'string' || !Number.isFinite(Date.parse(item.reviewedAt))) throw new Error('確認データの形式が不正です。');
    ids.add(item.id);
  }
  return value as AuditAnnotation[];
}
