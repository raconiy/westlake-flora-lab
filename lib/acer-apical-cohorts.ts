import {acerAdultHeightAt,acerJuvenileNodeHeight,acerShootArrival} from './acer-juvenile-shoot.ts';

/** Material-coordinate catalogue, constructed once for a new germination
 * scenario. A formed node never slides as age changes. The old calendar-only
 * 0.3-year spacing and 0.38-year blade expansion left an extending juvenile
 * leader almost bare. Neither these replacements nor the old values are field
 * measurements. This is a bounded organ-formation prior, not carbon physiology.
 */
export const acerApicalCohortPrior = {
 calibrated:false,
 source:'https://ir.nbu.ac.in/bitstreams/f47fcb06-569a-44d6-bfaf-71012bb31117/download',
 sourceScope:'Lama2004 printed112/PDF141: adult Darjiling leaf emergence/colour progression over weeks, not Yungu seedling expansion measurements',
 count:72,
 initialInternodeM:.024,
 expansionYears:.055,
 rule:'successive fixed material internodes; linear spacing gradient conserves the former final catalogue extent; arrival at a real parent node precedes zero-size blade expansion',
 assumptions:'all internode lengths, spacing gradient, expansion duration and juvenile-to-adult transition are engineering priors; normal growing season; no thermal-time, carbon budget, annual preformed-bud or primordium solver',
} as const;
export function acerApicalCohorts(){
 const p=acerApicalCohortPrior,base=acerJuvenileNodeHeight(5),
  oldLastBirth=.45+(p.count-1)*.28+(p.count-1)**2*.018,
  finalHeight=.96*acerAdultHeightAt(oldLastBirth),
  increment=(finalHeight-base-p.count*p.initialInternodeM)/(p.count*(p.count-1)/2);
 return Array.from({length:p.count},(_,i)=>{
  const n=i+1,heightM=base+n*p.initialInternodeM+increment*n*(n-1)/2;
  return {index:i,heightM,birth:acerShootArrival(heightM),expansionYears:p.expansionYears};
 });
}
