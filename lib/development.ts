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
/** Stable cohort identity shared by the visible basal rosettes and underground rhizomes. */
export function ophiopogonRamet(index: number, age: number) {
  const birth = index === 0 ? .025 : .55 + index * .48;
  const growth = organGrowth(birth, .9, age), angle = index * 2.39996;
  const spread = index === 0 ? 0 : .047 * Math.sqrt(index) * growth;
  return { birth, growth, x: Math.cos(angle) * spread, z: Math.sin(angle) * spread };
}
