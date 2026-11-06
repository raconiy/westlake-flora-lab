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
  geometry: 'persistent original branch/leaf anchors plus bounded successive material sites in large extension intervals; birth when the parent reaches each site, zero-size pair expansion; opposite decussate petiolate leaves; independent unequal shoot vigour, axillary angles and extension clocks; broad 3D extension envelope, not a prescribed pruned sphere; retained leaf-area proxy and persistent wood; all timings, spacings, angles, density and dimensions are engineering priors, not measured campus data',
  botanicalSource: 'https://plants.ces.ncsu.edu/plants/osmanthus-fragrans/',
  botanicalScope: 'dense evergreen shrub/small tree, responds to pruning; opposite simple petiolate leaves; small four-lobed axillary flowers; exact ages, scaffold angles, pruning history and turnover are not inferred from this source',
  continuity: {
    botanicalEvidence: 'existing NCSU description: evergreen woody habit, opposite simple petiolate leaves and four-lobed axillary flowers; no measured seedling growth trajectory',
    engineeringPrior: '90-degree decussate pair planes, birth/expansion clocks, seed-loss collar rise and fixed adult-collar envelope are construction choices, not source-derived measurements',
    collar: 'actual collar rises continuously by 7 mm during .25–.9 illustrative years; rootOriginY follows it; formed shoot material translates with this hierarchy, without retargeting its lifetime geometry',
    wood: 'retain every formed axis and material node; only scheduled births add axes; no natural-death events are modeled, so no age-only retirement is allowed',
  },
  spatialExtension: {
    status: 'uncalibrated-engineering-prior', unit: 'material coordinates: metres; birth clock: illustrative years',
    construction: 'subdivide large fixed extension intervals into thirds, inserting two opposite pairs to retain original decussate planes; invert the parent extension law for each material target; retain every original branch site; deliberately place leaf-only tail sites after the last branch support at .985 of historical extension at their unchanged birth clocks (order 3 retains its first two sites)',
    apicalLengthFractionAtBirth: .985, minimumIntervalM: .006,
    leafOnlyRevision: 'allocate supplementary sites from the original .96 base-node intervals before moving base leaf-only tails; preserve original supplementary sites, birth clocks, angles and expansion; cross-version base tail coordinates change once, not the woody support catalogue; all sites are fixed for the entire new lifecycle; leaf-axis rise .55–1.0 is an uncalibrated arrangement prior',
    budgets: 'allocate only unused slots below the original 28,704-leaf / 869-axis lifetime bounds; saturated density catalogues receive no extra sites; <=5,216 main-pass mesh batches including flowers, shadow/other passes additional',
    limits: 'fixed keyed curved axes are qualitative construction, not measured tropism/path growth; no measured internode/flush schedule, light competition or evergreen leaf turnover; private habit photos supply qualitative appearance only, not individual campus scale, ages or pruning history',
  },
  secondaryThickening: {
    status: 'uncalibrated-engineering-prior',
    referenceLengthM: 1, referenceBasalDiameterM: .01, leafAreaPerSapwoodArea: 2500,
    rule: 'radius is max(existing age/order floor, .005 m * (length / 1 m)^1.5, sqrt(cumulative supported leaf area / (pi * 2500)))',
    rationale: 'elastic-similarity length exponent plus pipe-model area accounting; coefficients are illustrative design choices, not measured Osmanthus constants or an inverse fit to wind/angle limits',
    coefficientRationale: '1 m / 10 mm specifies a round reference basal length/diameter ratio of 100 for a multi-year woody axis; 2500 m² leaf / m² equivalent sapwood budgets 40 mm² basal section per 0.10 m² blades (about 7.1 mm diameter). These are explicit support budgets for an illustrative asset, not an optimal design or empirical species range',
    support: 'sum actual one-sided blade mesh area at age-driven expansion over this axis and its descendants, once each; retained leaf cohorts proxy cumulative support, independent of season, wind and stiffness',
    limits: 'whole basal section is treated as equivalent conducting area; no heartwood, sapwood turnover, carbon budget, cultivar calibration or reaction-wood model; max rules are continuous but may have derivative kinks',
    references: [
      'Shinozaki et al. (1964), A quantitative analysis of plant form — the pipe model theory I, Japanese Journal of Ecology 14:97–105, https://doi.org/10.18960/seitai.14.3_97',
      'McMahon & Kronauer (1976), Tree structures: deducing the principle of mechanical design, Journal of Theoretical Biology 59:443–466, https://doi.org/10.1016/0022-5193(76)90182-X',
    ],
    sourceAccess: 'primary-literature conceptual references; full texts not verified in this offline task (external proxy unavailable); numerical coefficients are not attributed to these papers',
  },
} as const;

/** Metres, m² -> metres. The supported area must be a persistent architectural
 * quantity, not a seasonal rendered-area sample. No load, E or angle-limit input.
 * Each argument is nondecreasing with axis age, hence so is this radius.
 */
export function osmanthusSupportedRadius(lengthM: number, supportedLeafAreaM2: number, ageOrderFloorM: number) {
  const p = osmanthusPriors.secondaryThickening;
  const elasticRadius = p.referenceBasalDiameterM / 2 * (Math.max(0, lengthM) / p.referenceLengthM) ** 1.5;
  const pipeRadius = Math.sqrt(Math.max(0, supportedLeafAreaM2) / (Math.PI * p.leafAreaPerSapwoodArea));
  return Math.max(ageOrderFloorM, elasticRadius, pipeRadius);
}

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
    // Baseline clock only: the rendered shoot can thicken further from its
    // actual length/descendant support; consumers needing its collar radius
    // must use the built BranchJoint.radius (as PlantScene already does).
    radius: (.00065 + .00185 * Math.min(age, 1) + .09 * (1 - Math.exp(-Math.max(0, age - 1) / 28))) * emerged,
    radicle: osmanthusGrowth(.012, .08, age),
    // As the seed coat disappears the radicle origin approaches the shoot collar smoothly.
    rootOriginY: collarY,
    stageLabel: age < .012 ? '种子' : age < .10 ? '萌发 · 胚根与芽' : age < .8 ? '真叶幼苗' : age < 5 ? '分枝幼株' : '常绿成株',
  };
}
