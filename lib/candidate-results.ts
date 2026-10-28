import type { Candidate, Detection } from './audio-analysis';

export function isUnresolvedDetection(item: Pick<Detection, 'identification'>) {
  return item.identification === 'unresolved';
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
