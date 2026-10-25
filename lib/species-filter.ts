export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export type SurveyRegion = {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
};

export const SURVEY_REGIONS: SurveyRegion[] = [
  { key: 'hagi', name: '山口県・萩市', latitude: 34.4081, longitude: 131.3991 },
  { key: 'yamaguchi', name: '山口県・山口市', latitude: 34.1785, longitude: 131.4737 },
  { key: 'shimonoseki', name: '山口県・下関市', latitude: 33.9578, longitude: 130.9415 },
  { key: 'iwakuni', name: '山口県・岩国市', latitude: 34.1666, longitude: 132.2197 },
  { key: 'shunan', name: '山口県・周南市', latitude: 34.0552, longitude: 131.8061 },
];

export const PRIORITY_SPECIES = new Set([
  'Strix uralensis',
  'Ninox japonica',
  'Ninox scutulata',
  'Caprimulgus indicus',
  'Caprimulgus jotaka',
  'Zoothera aurea',
  'Gorsachius goisagi',
  'Zapornia fusca',
  'Otus sunia',
  'Vanellus cinereus',
  'Astur gentilis',
]);

export function birdNetWeek(date: Date) {
  const month = date.getMonth();
  const daysInMonth = new Date(date.getFullYear(), month + 1, 0).getDate();
  const weekInMonth = Math.min(4, Math.ceil(date.getDate() / (daysInMonth / 4)));
  return month * 4 + weekInMonth;
}

export function goshawkSeasonLabel(date: Date) {
  const month = date.getMonth() + 1;
  if (month >= 2 && month <= 3) return '鳴き交わし・交尾声の対象時期';
  if (month === 4) return '鳴き交わし・交尾声／雌の餌乞いの対象時期';
  if (month >= 5 && month <= 6) return '雌の餌乞いの対象時期';
  if (month === 7) return '雌・雛／幼鳥の餌乞いの対象時期';
  if (month === 8) return '雛・幼鳥の餌乞いの対象時期';
  return '重点監視期間外（参考候補）';
}

export function reviewStatusLabel(status: ReviewStatus) {
  if (status === 'approved') return '承認';
  if (status === 'rejected') return '却下';
  return '未確認';
}
