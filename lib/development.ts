/** Continuity construction in years, NOT measured emergence dates or growth rates.
 * No cultivar, transplant age, material constants or campus calibration is inferred.
 * Ophiopogon uses establishment of a new ramet, not a seed germination clock.
 */
export const developmentPriors = {
  sourceType: 'engineering-prior', calibrated: false, units: 'metres and years',
  timing: 'illustrative cohort onsets; not measured germination or flowering ages',
  establishment: 'woody seed establishment; ophiopogon new vegetative ramet',
};
export function organGrowth(birth: number, duration: number, age: number) {
  const t = Math.max(0, Math.min(1, (age - birth) / duration));
  return t * t * (3 - 2 * t);
}
export function additionalDevelopment(species: 'camphor' | 'acer' | 'ophiopogon', inputAge: number) {
  const age = Number.isFinite(inputAge) ? Math.max(0, inputAge) : 0;
  const herb = species === 'ophiopogon';
  return { age, radicle: organGrowth(.008, .12, age), shoot: organGrowth(.025, .25, age),
    maturity: 1 - Math.exp(-age / (herb ? 1.4 : species === 'acer' ? 15 : 24)),
    stage: (herb ? age === 0 : age <= .025) ? (herb ? '营养繁殖起点 · 未建立叶丛' : '种子 · 地下建立，尚未出苗') :
      species === 'acer' && age < .07 ? '弯钩出苗 · 子叶抬升' :
      species === 'acer' && age >= .55 && age < .8 ? '首批幼叶衰老 · 木质节点保留' :
      age < .3 ? (herb ? '营养繁殖建立' : species === 'acer' ? '子叶展开 · 真叶建立' : '萌发 · 主轴与真叶建立') :
      age < (herb ? 2 : 3) ? (herb ? '基生叶丛形成' : '幼苗 · 叶序建立') :
      age < (herb ? 4 : 18) ? (herb ? '根茎扩展 · 子株建立' : '幼树 · 枝序建立') : '成熟结构 · 持续更新' };
}
/** Ophiopogon only: inverse of the illustrative smoothstep extension clock. */
export function ophiopogonArrival(fraction: number) {
  return .5 - Math.sin(Math.asin(1 - 2 * Math.max(0, Math.min(1, fraction))) / 3);
}
/** Relative packing control, never plants per square metre. The supplied
 * botanical descriptions constrain habit; all distances/clocks are priors.
 * A pioneer reaches the patch edge, followed by irregular lateral infill.
 * Higher density adds more sites inside the same patch envelope; existing
 * material nodes are never resampled or moved.
 */
export const clonalArchitecturePrior = {
  calibrated: false, sourceType: 'engineering-prior',
  densityMeaning: 'relative clonal packing, not measured campus planting counts',
  allocation: 'seeded low-discrepancy pioneer and lateral infill; finite lifetime catalogue',
  evidence: 'institutional habit descriptions and clonal architecture research; no fitted response coefficients',
  sources: [
    'https://plants.ces.ncsu.edu/plants/ophiopogon-japonicus/',
    'https://www.missouribotanicalgarden.org/gardens-gardening/your-garden/help-for-the-home-gardener/advice-tips-resources/gardening-help-faqs/question/1480/how-do-i-divide-my-iris-plants',
    'https://pubmed.ncbi.nlm.nih.gov/25216101/',
    'https://besjournals.onlinelibrary.wiley.com/doi/full/10.1111/1365-2745.12066',
  ],
};
export function clonalDensity(value: number) {
  return Math.max(.15, Math.min(2, Number.isFinite(value) ? value : 1));
}
export function clonalSample(seed: number, key: number) {
  let t = (seed + Math.imul(key, 104729)) >>> 0;
  t = Math.imul(t ^ t >>> 16, 0x21f0aaad);
  t = Math.imul(t ^ t >>> 15, 0x735a2d97);
  return ((t ^ t >>> 15) >>> 0) / 4294967296;
}
export function clonalPatchNode(index: number, seed: number, _inputDensity: number, radius: number) {
  if (index === 0) return { x: 0, z: 0 };
  // The catalogue is keyed by seed and site index. Density selects a prefix
  // of these sites; it must not resample or move the sites that were already
  // formed when a denser stand adds later ramets.
  const phase = clonalSample(seed, 1) * Math.PI * 2;
  const angle = phase + (index - 1) * 2.3999632297 + (clonalSample(seed, 100 + index) - .5) * .7;
  const radialSample = (index * .754877666 + clonalSample(seed, 2)) % 1;
  const spread = radius * (index === 1 ? 1 : .25 + .48 * Math.sqrt(radialSample));
  return { x: Math.cos(angle) * spread, z: Math.sin(angle) * spread };
}
/** Stable material nodes shared by shoots and underground axes.
 * NC State's cached species description: underground lateral stolons terminate
 * in daughter plants. Distances and clocks below remain engineering priors.
 * Preserve cohort establishment dates, extending the precursor BEFORE birth.
 * The original division starts at its collar and extends downwards; it does
 * not need a lateral precursor to reach an already present main collar.
 */
export function ophiopogonRamet(index: number, age: number, seed = 42, density = 1) {
  const birth = index === 0 ? .025 : .55 + index * .48;
  const extensionDuration = .9, extensionBirth = index === 0 ? birth : birth - extensionDuration;
  const growth = organGrowth(birth, .9, age), extension = organGrowth(extensionBirth, extensionDuration, age);
  const { x, z } = clonalPatchNode(index, seed, density, .115);
  return { birth, growth, x, z, extensionBirth, extensionDuration, extension,
    nodeAt: (t: number) => ({ x: x * t, y: -.008 - (index === 0 ? .006 * t : 0), z: z * t }),
    arrivalAt: (t: number) => extensionBirth + extensionDuration * ophiopogonArrival(t) };
}
