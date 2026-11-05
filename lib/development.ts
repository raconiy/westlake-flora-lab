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
      age < .3 ? (herb ? '营养繁殖建立' : '萌发 · 主轴与真叶建立') :
      age < (herb ? 2 : 3) ? (herb ? '基生叶丛形成' : '幼苗 · 叶序建立') :
      age < (herb ? 4 : 18) ? (herb ? '根茎扩展 · 子株建立' : '幼树 · 枝序建立') : '成熟结构 · 持续更新' };
}
/** Ophiopogon only: inverse of the illustrative smoothstep extension clock. */
export function ophiopogonArrival(fraction: number) {
  return .5 - Math.sin(Math.asin(1 - 2 * Math.max(0, Math.min(1, fraction))) / 3);
}
/** Stable material nodes shared by shoots and underground axes.
 * NC State's cached species description: underground lateral stolons terminate
 * in daughter plants. Distances and clocks below remain engineering priors.
 * Preserve cohort establishment dates, extending the precursor BEFORE birth.
 * The original division starts at its collar and extends downwards; it does
 * not need a lateral precursor to reach an already present main collar.
 */
export function ophiopogonRamet(index: number, age: number) {
  const birth = index === 0 ? .025 : .55 + index * .48;
  const extensionDuration = .9, extensionBirth = index === 0 ? birth : birth - extensionDuration;
  const growth = organGrowth(birth, .9, age), extension = organGrowth(extensionBirth, extensionDuration, age);
  const angle = index * 2.39996, spread = index === 0 ? 0 : .047 * Math.sqrt(index);
  const x = Math.cos(angle) * spread, z = Math.sin(angle) * spread;
  return { birth, growth, x, z, extensionBirth, extensionDuration, extension,
    nodeAt: (t: number) => ({ x: x * t, y: -.008 - (index === 0 ? .006 * t : 0), z: z * t }),
    arrivalAt: (t: number) => extensionBirth + extensionDuration * ophiopogonArrival(t) };
}
