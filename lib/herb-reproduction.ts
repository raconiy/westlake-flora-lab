/** Bounded qualitative annual replacement, not tracked multi-year physiology.
 * Day is cyclic; vegetative establishment/readiness belongs to the caller.
 * All window endpoints are uncalibrated presentation priors, not Hangzhou dates.
 */
export type ReproductiveHerb = "iris" | "oxalis";
export const herbReproductionPriors = {
  iris: {
    stalk: [70, 95], petals: [89, 106, 145, 158], drying: [158, 195], collapse: [205, 270],
    source: "https://plants.ces.ncsu.edu/plants/iris-tectorum/",
    sourceBounds: "Spring flowering; perennial spreading rhizomes; 3 standards, 3 falls and white crests. No measured scape senescence dates.",
  },
  oxalis: {
    stalk: [30, 60], petals: [45, 85, 310, 335], drying: [300, 335], collapse: [345, 365],
    source: "https://plants.ces.ncsu.edu/plants/oxalis-corniculata/",
    sourceBounds: "Annual or perennial, year-round presence in warmer climates, rhizomes/stolons; small 5-parted yellow flowers. This cached source supplies no exact flowering dates.",
  },
} as const;

const smooth = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

export function herbReproduction(species: ReproductiveHerb, inputDay: number) {
  const day = Number.isFinite(inputDay) ? ((inputDay - 1) % 365 + 365) % 365 + 1 : 1;
  const prior = herbReproductionPriors[species];
  const emergence = smooth(prior.stalk[0], prior.stalk[1], day);
  const petalExpansion = smooth(prior.petals[0], prior.petals[1], day);
  const petalDecline = smooth(prior.petals[2], prior.petals[3], day);
  const dryFraction = smooth(prior.drying[0], prior.drying[1], day);
  const collapse = smooth(prior.collapse[0], prior.collapse[1], day);
  return {
    day, emergence, petalExpansion, petalDecline, dryFraction, collapse,
    // Collapse contracts the whole support towards its fixed basal insertion.
    support: emergence * (1 - collapse),
    petals: emergence * petalExpansion * (1 - petalDecline),
    inclination: .25 * dryFraction + .9 * collapse, // radians; visual prior only
  };
}
