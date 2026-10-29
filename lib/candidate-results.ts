import type { Candidate, Detection } from './audio-analysis';

export function isUnresolvedDetection(item: Pick<Detection, 'identification'>) {
  return item.identification === 'unresolved';
}

export function scoreGroup(item: Pick<Detection, 'maxBirdScore'>): 'standard' | 'lower' | 'unmeasured' {
  if (item.maxBirdScore === undefined) return 'unmeasured';
  return item.maxBirdScore >= 0.1 ? 'standard' : 'lower';
}

export function scoreGroupLabel(item: Pick<Detection, 'maxBirdScore'>) {
  return { standard: '通常確認', lower: '低スコア・要確認', unmeasured: '未計測' }[scoreGroup(item)];
}

/** Keep every selected audio interval reviewable, even without a species label. */
export function retainCandidateResults(
  candidate: Candidate,
  namedResults: Detection[],
  fallbackId: number,
  reason: Detection['unresolvedReason'] = 'species-not-selected',
): Detection[] {
  if (namedResults.length) return namedResults;
  return [{
    ...candidate,
    id: fallbackId,
    identification: 'unresolved',
    unresolvedReason: reason,
    species: '鳥声候補・種未確定',
    scientific: '',
    commonEnglish: '',
    confidence: null,
    geoProbability: null,
    filterStatus: '種未確定',
    prioritySpecies: false,
    reviewStatus: 'pending',
    reviewedAt: undefined,
    goshawkSeason: undefined,
  }];
}
