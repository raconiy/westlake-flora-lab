/** Shared shoot/root illustration clock; years are independent of season and motion.
 * None of these thresholds or dimensions are campus measurements or fitted growth data.
 */
export const osmanthusPriors = {
  source: 'project engineering construction, not empirical growth data',
  unit: 'age: years; geometry: metres; angles: radians; counts: drawn organs',
  scope: 'illustrative Osmanthus fragrans seed-to-branched-plant geometry, no cultivar inference',
  confidence: 'low', calibration: 'uncalibrated-engineering-prior',
  thresholds: { radicle: [.012, .08], shoot: [.035, .12], trueLeaves: [.10, .30], branching: [.8, 2.4], seedLoss: [.25, .9] },
  dimensions: { seedHalfAxes: [.0045, .007, .0035], seedCenterY: -.004, adultCollarY: -.004, firstYearHeight: .28, matureHeightAsymptote: 5.4 },
  geometry: 'staggered smoothstep cohorts; node/petiole/flower dimensions and growth curves are engineering priors',
  botanicalSource: 'https://plants.ces.ncsu.edu/plants/osmanthus-fragrans/',
  botanicalScope: 'evergreen; opposite simple petiolate leaves; small four-lobed axillary flowers; timing below is not inferred from this source',
} as const;

export function osmanthusGrowth(start: number, end: number, age: number) {
  const t = Math.max(0, Math.min(1, (age - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function osmanthusLifecycle(inputAge: number) {
  const age = Math.max(0, Number.isFinite(inputAge) ? inputAge : 0);
  const seedScale = 1 - osmanthusGrowth(.25, .9, age);
  const seedCenterY = osmanthusPriors.dimensions.seedCenterY;
  const collarY = osmanthusPriors.dimensions.adultCollarY - .007 * seedScale;
  const emerged = osmanthusGrowth(.035, .12, age);
  const height = age <= 1 ? (.012 + .268 * age) * emerged : .28 + 5.12 * (1 - Math.exp(-(age - 1) / 15));
  return {
    age, seedScale, seedCenterY, collarY, height,
    radius: (.00065 + .00185 * Math.min(age, 1) + .09 * (1 - Math.exp(-Math.max(0, age - 1) / 28))) * emerged,
    radicle: osmanthusGrowth(.012, .08, age),
    // As the seed coat disappears the radicle origin approaches the shoot collar smoothly.
    rootOriginY: collarY,
    stageLabel: age < .012 ? '种子' : age < .10 ? '萌发 · 胚根与芽' : age < .8 ? '真叶幼苗' : age < 5 ? '分枝幼株' : '常绿成株',
  };
}
