import type {SpeciesId} from './species';
/** Role-based defaults for simulation experiments, not species-specific measurements.
 * No numeric species claim is inferred from the 39-species experiment:
 * https://doi.org/10.1111/j.1469-8137.2011.03887.x
 * Radius/architecture and small-deflection adequacy must be checked separately;
 * increasing E to conceal a clipped response is not material calibration. */
export function physicalPriors(species:SpeciesId,age:number){
 const herb=['iris','oxalis','ophiopogon'].includes(species);
 const lignification=herb?0:Math.min(1,Math.max(0,age/3));
 return {youngModulusPa:herb?3e8:3e8+(8e9-3e8)*lignification,woodDensityKgM3:herb?900:550,leafArealMassKgM2:.12,dragCoefficient:herb?1.1:.8,dampingRatio:herb?.35:.28,sourceLevel:'engineering-assumption' as const,note:herb?'柔性草本的等效梁先验，未求解叶片各向异性':'木本成熟刚度的实验先验，未以校园材料试验校准'};
}
