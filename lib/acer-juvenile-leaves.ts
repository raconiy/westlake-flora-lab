/** A single establishment cohort, distinct from permanent woody insertion sites.
 * NBU Lama (2004), printed p129 / Plate6.1m, describes an early opposite
 * 5–7-lobed true pair approximately5–7mm long in that sampled population.
 * This constrains one early stage, NOT a final species maximum, all cultivars or Yungu.
 * This finite first cohort retains its stage-sized target; subsequent independent
 * cohorts can expand further. No immutable mature size limit is inferred.
 * Subsequent sizes, 16-day expansion and retirement dates are engineering
 * priors. Annual day/age snapshots do not encode germination weather/history.
 */
export const acerJuvenileLeafPrior = {
  status: 'literature-constrained juvenile outline/first-pair size; uncalibrated developmental clocks',
  source: 'https://ir.nbu.ac.in/bitstreams/f47fcb06-569a-44d6-bfaf-71012bb31117/download',
  sourceLocation: 'printed129 / PDF158 and Plate6.1m / PDF168; lead viewed private pages',
  firstPairLengthM: [.005, .007],
  firstPairWidthM: [.004, .005],
  targetLengthsM: [.006, .010, .014, .020, .025, .030],
  targetWidthsM: [.0045, .0075, .0105, .015, .019, .023],
  expansionYears: .045,
  senescenceStartYears: .55,
  cohortEndYears: .80,
  siteRule: 'cumulative juvenile internode targets; each leaf waits for actual parent arrival; formed sites and their leaf/petiole supports persist while age advances' ,
  event: 'senescence window remains metadata for future seasonal turnover; age-only growth does not retract an established leaf or its petiole' ,
  limits: 'one illustrative seedling phenotype; no measured phyllochron, cultivar-specific heteroblasty, temperature, light competition or carbon allocation; later leaf cohorts retain existing phenology proxy',
} as const;
const smooth = (a:number,b:number,x:number) => {const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function acerJuvenileLeafState(age:number,birth:number,index:number) {
 const targetLengthM=acerJuvenileLeafPrior.targetLengthsM[Math.max(0,Math.min(5,index))];
 const targetWidthM=acerJuvenileLeafPrior.targetWidthsM[Math.max(0,Math.min(5,index))];
 const expansion=smooth(birth,birth+acerJuvenileLeafPrior.expansionYears,age);
 const senescence=smooth(acerJuvenileLeafPrior.senescenceStartYears,acerJuvenileLeafPrior.cohortEndYears,age);
 return {targetLengthM,targetWidthM,expansion,senescence,retained:1-senescence,
  envelopeScale:expansion*(1-senescence),event:senescence>0?'establishment-leaf-senescence':'establishment-leaf-expansion'};
}
