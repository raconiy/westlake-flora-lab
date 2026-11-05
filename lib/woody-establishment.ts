import * as THREE from 'three';
import {organGrowth} from './development.ts';

export type EstablishmentSpecies = 'camphor' | 'acer';
/** Metres/years, all dimensions, burial and clocks are engineering priors.
 * Institutional source text was retrieved and checked by the lead in the
 * private research cache; the implementation worker could not browse it directly.
 * No source photograph is copied or redistributed here.
 */
export const woodyEstablishmentPriors = {
  calibrated: false, sourceType: 'engineering-prior',
  camphor: {poleY: -.012, coatHeight: .008, coatRadius: .004, wingLength: 0},
  acer: {poleY: -.009, coatHeight: .006, coatRadius: .003, wingLength: .018},
  shootOnset: .012, collarArrival: .025, connectorRadius: .00035,
};
export const woodyEstablishmentEvidence = {
  camphor: {
    urls: ['https://apps.lucidcentral.org/rainforest/text/entities/cinnamomum_camphora.htm',
      'https://apps.lucidcentral.org/rainforest/pdf/entities/cinnamomum_camphora.pdf'],
    verification: 'lead checked CSIRO institutional text/caption from retrieved HTML; seedling image not yet viewed',
    cotyledons: 'hypogeal per CSIRO source caption; retained inside buried seed; no green aerial cotyledons',
    unsupported: 'internal cotyledon anatomy, coat opening/decay and first-leaf heteroblasty unresolved',
  },
  acer: {
    urls: ['https://landscapeplants.oregonstate.edu/plants/acer-palmatum'],
    verification: 'lead checked Oregon State institutional text; samara morphology described, species-level seedling anatomy pending additional verification',
    cotyledons: 'not rendered: species-level epigeal emergence and cotyledon shape not independently verified',
    unsupported: 'hypocotyl hook, cotyledon pair and their lifting/release from coat unresolved; first true leaves use adult blade outline as an engineering proxy, juvenile heteroblasty is not reconstructed; buried coat is a retained remnant proxy, NOT evidence of hypogeal germination',
  },
};

export function woodySeedPole(species: EstablishmentSpecies) {
  return new THREE.Vector3(0, woodyEstablishmentPriors[species].poleY, 0);
}

/** A single, fixed material axis from the real lower coat pole to y=0.
 * Extension adds a prefix; already formed points never move. The independent
 * aboveground leader starts at exactly its terminal collar, after arrival.
 */
export function woodyEstablishmentState(species: EstablishmentSpecies, inputAge: number) {
  const age = Number.isFinite(inputAge) ? Math.max(0, inputAge) : 0;
  const {shootOnset, collarArrival, connectorRadius} = woodyEstablishmentPriors;
  const pole = woodySeedPole(species), growth = organGrowth(shootOnset, collarArrival - shootOnset, age);
  return {pole, collar: new THREE.Vector3(), tip: new THREE.Vector3(0, pole.y * (1 - growth), 0),
    length: -pole.y * growth, radius: connectorRadius * growth};
}

/** Keep separate organ ranges in one small vertex-coloured mesh. It lives on
 * the fixed plant group, outside wind-driven wood pivots; roots share poleY.
 * The persistent coat is a remnant proxy, not a simulated decay mechanism.
 */
export function woodyEstablishmentGeometry(species: EstablishmentSpecies, age: number) {
  const prior = woodyEstablishmentPriors[species], state = woodyEstablishmentState(species, age);
  const parts: THREE.BufferGeometry[] = [], ranges: {organ: string; start: number; count: number}[] = [];
  let count = 0;
  function add(geometry: THREE.BufferGeometry, organ: string, colour: string) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    const color = new THREE.Color(colour), p = flat.attributes.position;
    flat.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({length: p.count}, () => color.toArray()).flat(), 3));
    ranges.push({organ, start: count, count: p.count}); count += p.count; parts.push(flat);
  }
  // A blunt lower pole has actual vertices on the radicle plane, rather than
  // a sphere merely placed near a root. The axial connector intersects it.
  const profile = [new THREE.Vector2(0, prior.poleY), new THREE.Vector2(.00055, prior.poleY)];
  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    profile.push(new THREE.Vector2(prior.coatRadius * Math.sin(Math.PI * t), prior.poleY + prior.coatHeight * t));
  }
  profile.push(new THREE.Vector2(0, prior.poleY + prior.coatHeight));
  add(new THREE.LatheGeometry(profile, 20), 'seed-coat', species === 'camphor' ? '#76513a' : '#92704b');
  if (species === 'acer') {
    // One detached samara (one mericarp), laid in soil. No fruit pair is
    // invented at a single germination axis. Wing dimensions are priors.
    const wing = new THREE.Shape(); wing.moveTo(.0015, 0);
    wing.bezierCurveTo(.007, -.001, .013, -.002, .021, -.001);
    wing.bezierCurveTo(.018, .0045, .008, .007, .0015, .0015); wing.closePath();
    const g = new THREE.ShapeGeometry(wing, 10), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {const z = p.getY(i); p.setY(i, prior.poleY + prior.coatHeight / 2); p.setZ(i, z);}
    g.computeVertexNormals(); add(g, 'samara-wing', '#b79c6b');
  }
  if (state.length > 0) {
    // Fixed rings every 0.5 mm plus the moving tip, not a rescaled whole stem.
    const levels = [prior.poleY];
    for (let y = prior.poleY + .0005; y < state.tip.y - 1e-10; y += .0005) levels.push(y);
    levels.push(state.tip.y);
    const p: number[] = [], ix: number[] = [], sides = 12;
    for (let i = 0; i < levels.length; i++) for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2; p.push(state.radius * Math.cos(a), levels[i], state.radius * Math.sin(a));
      if (i + 1 < levels.length) {const n = i * sides + j, next = i * sides + (j + 1) % sides; ix.push(n, n + sides, next, next, n + sides, next + sides);}
    }
    // Close both ends: a newborn narrow leader meets a real collar disk,
    // rather than sitting inside a wider, open tube with no shared surface.
    const bottom = p.length / 3; p.push(0, levels[0], 0);
    const top = p.length / 3; p.push(0, levels.at(-1)!, 0);
    for (let j = 0; j < sides; j++) {
      const next = (j + 1) % sides, last = (levels.length - 1) * sides;
      ix.push(bottom, j, next, top, last + next, last + j);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix); g.computeVertexNormals();
    add(g, 'embryonic-axis', '#bcb384');
  }
  const geometry = new THREE.BufferGeometry();
  for (const key of ['position', 'normal', 'color']) {
    const values = new Float32Array(count * 3); let offset = 0;
    for (const part of parts) {values.set(part.attributes[key].array, offset); offset += part.attributes[key].array.length;}
    geometry.setAttribute(key, new THREE.BufferAttribute(values, 3));
  }
  parts.forEach(g => g.dispose()); geometry.userData.organs = ranges;
  return geometry;
}
