import * as THREE from 'three';
import {organGrowth} from './development.ts';
import {tagWoodTube} from './wood-loads.ts';

export type EstablishmentSpecies = 'camphor' | 'acer';
/** Metres/years, all dimensions, burial and clocks are engineering priors.
 * This continuation viewed the private NBU p.129/PDF158 and Plate 6.1.m.
 * The Himalayan qualitative sequence is not Hangzhou calibration.
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
    urls: ['https://landscapeplants.oregonstate.edu/plants/acer-palmatum',
      'https://propg.ifas.ufl.edu/04-seeds/03-germination/05-seedsgermination-patterns.html',
      'https://ir.nbu.ac.in/bitstreams/f47fcb06-569a-44d6-bfaf-71012bb31117/download'],
    verification: 'Continuation directly viewed private NBU PDF158 (physical p.129) and Plate 6.1.m: Acer palmatum epigeal hook, opposite ovate paracotyledons and subsequent lobed true leaves; qualitative Himalayan material, not Hangzhou calibration',
    cotyledons: 'epigeal/phanerocotylar; apically curved hypocotyl at emergence; two opposite ovate paracotyledons green on exposure, persist through two-leaved stage then yellow and shrivel; first true pair deeply 5–7 lobed',
    unsupported: 'candidate only; public 0.5.5/29f02d6 excludes this work. First true-leaf proportions at .12 y remain a visual blocker. All clocks, 18 mm hypocotyl and seasonal limits are qualitative priors. Cotyledons have one age-limited exposure (.04-.36 y), age senescence after .14 y, plus a permissive day 65-300 warm-season proxy; no annual rebirth. Age and annual day are independent snapshot inputs, not a germination date/history. Frost-free, sufficiently warm emergence is assumed; temperature, chilling, frost, dormancy and survival are not simulated. Himalayan observations are not Hangzhou calibration. Coat carry/release/decay and internal anatomy unresolved; separate buried coat remains a remnant proxy',
  },
};

/** Candidate Acer epigeal trajectory. Metres/years are illustrative engineering
 * priors, NOT universal species measurements or Hangzhou samples. Primary growth
 * strains the IMMATURE hypocotyl and carries its cotyledon node. After .07 y its
 * added length persists forever; old woody material never slides or retracts.
 * The original above-hypocotyl axis retains its own reference geometry.
 */
export const acerEstablishmentPriors = {
  calibrated: false, sourceType: 'engineering-prior',
  hypocotylBirth: .025, hypocotylDuration: .045, hypocotylLength: .018,
  hookMaximum: .04, hookResolved: .07,
  cotyledonBirth: .04, expansionDuration: .065, unfoldBirth: .045, unfoldDuration: .055,
  cotyledonLength: .008, cotyledonWidth: .0036, petioleLength: .0012,
  senescenceBirth: .14, senescenceDuration: .16, abscissionBirth: .30, abscissionDuration: .06,
  // A permissive frost-free exposure proxy, separate from true-leaf phenology.
  // These day numbers are NOT measured local temperature or emergence dates.
  warmSeasonStart: 65, warmSeasonFull: 95, coolingStart: 255, coolingEnd: 300,
  extraMeshBudget: 3, extraVertexBudget: 1000, hypocotylSegments: 32,
};
export function acerHypocotylState(age: number, epicotylTangent = new THREE.Vector3(0,1,0)) {
  const p = acerEstablishmentPriors, growth = organGrowth(p.hypocotylBirth, p.hypocotylDuration, age),
    hook = organGrowth(p.hypocotylBirth, p.hookMaximum - p.hypocotylBirth, age)
      * (1 - organGrowth(p.hookMaximum, p.hookResolved - p.hookMaximum, age)),
    length = p.hypocotylLength * growth, angle = 2 * hook,
    frame = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), -angle);
  // A distributed circular hook avoids the old near-cusp at the distal end.
  // Rotate the entire immature epicotyl AND cotyledon frame with that endpoint.
  // A zero-endpoint Hermite correction matches the original epicotyl tangent;
  // it does not translate the mature crown or rotate its reference frame.
  const correction = epicotylTangent.clone().divideScalar(epicotylTangent.y)
    .sub(new THREE.Vector3(0,1,0)).applyQuaternion(frame).multiplyScalar(length);
  class Hypocotyl extends THREE.Curve<THREE.Vector3> {
    constructor(){super();}
    getPoint(t: number, target = new THREE.Vector3()) {
      return target.set(angle ? length*(1-Math.cos(angle*t))/angle : 0,
        angle ? length*Math.sin(angle*t)/angle : length*t, 0)
        .addScaledVector(correction, t*t*(t-1));
    }
    getTangent(t: number, target = new THREE.Vector3()) {
      return target.set(Math.sin(angle*t),Math.cos(angle*t),0).multiplyScalar(length)
        .addScaledVector(correction,3*t*t-2*t).normalize();
    }
  }
  const curve = new Hypocotyl();
  return {growth, hook, frame, length: curve.getLength(), curve, node: curve.getPoint(1),
    permanentHeightOffset: p.hypocotylLength, strain: 'immature primary growth and endpoint-frame transport only; frozen after .07 y'};
}
/** A single seedling organ cohort: age never wraps with annual day. The finite
 * lifespan approximates reserve transfer/first true-leaf establishment, then
 * yellowing and loss. Season can shorten exposure, never restart that lifespan.
 * Independent age/day snapshots contain no germination event history; winter
 * absence is a qualitative feasibility prior, not a simulated frost death.
 */
export function acerCotyledonState(age: number, day = 180) {
  const p = acerEstablishmentPriors;
  const annualDay = Number.isFinite(day) ? Math.max(1, Math.min(365, day)) : 180;
  const growth = organGrowth(p.cotyledonBirth, p.expansionDuration, age),
    unfold = organGrowth(p.unfoldBirth, p.unfoldDuration, age),
    ageSenescence = organGrowth(p.senescenceBirth, p.senescenceDuration, age),
    seasonalStress = organGrowth(p.coolingStart, p.coolingEnd - p.coolingStart, annualDay),
    seasonExposure = organGrowth(p.warmSeasonStart, p.warmSeasonFull - p.warmSeasonStart, annualDay) * (1 - seasonalStress),
    senescence = 1 - (1 - ageSenescence) * (1 - seasonalStress),
    retained = 1 - organGrowth(p.abscissionBirth, p.abscissionDuration, age);
  return {growth, unfold, ageSenescence, seasonalStress, seasonExposure, senescence, retained,
    scale: growth * (1 - .78 * senescence) * retained * seasonExposure};
}

/** One indexed surface and one set of load sections. Parallel transport starts
 * at the exact epicotyl basal polygon and proceeds backwards along the hook.
 * No separately overlapping tissue, omitted triangles or detached seam rings.
 * After establishment all original epicotyl vertices retain their reference
 * positions plus 18 mm; its frame is exactly identity.
 */
export function acerPrimaryGeometry(epicotyl: THREE.BufferGeometry, age: number, radius: number) {
  const segments = acerEstablishmentPriors.hypocotylSegments,
    sides = epicotyl.userData.woodTube.sides, epicSegments = epicotyl.userData.woodTube.segments,
    ep = epicotyl.attributes.position, eu = epicotyl.attributes.uv,
    positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const centre = (ring: number) => {
    const c = new THREE.Vector3();
    for(let j=0;j<sides;j++)c.add(new THREE.Vector3().fromBufferAttribute(ep,ring*(sides+1)+j));
    return c.divideScalar(sides);
  };
  const tangent = new THREE.Vector3();
  for(let j=0;j<sides;j++)tangent.add(new THREE.Vector3().fromBufferAttribute(ep,j)
    .cross(new THREE.Vector3().fromBufferAttribute(ep,(j+1)%sides)));
  tangent.normalize();
  const state = acerHypocotylState(age,tangent),
    tangents = Array.from({length:segments+1},(_,i)=>state.curve.getTangentAt(i/segments)),
    frames: THREE.Quaternion[] = [];
  frames[segments] = state.frame.clone();
  for(let i=segments-1;i>=0;i--)frames[i] = new THREE.Quaternion()
    .setFromUnitVectors(tangents[i+1],tangents[i]).multiply(frames[i+1]);
  for(let i=0;i<segments;i++){
    const c=state.curve.getPointAt(i/segments);
    for(let j=0;j<=sides;j++){
      const v=new THREE.Vector3().fromBufferAttribute(ep,j).normalize().multiplyScalar(radius).applyQuaternion(frames[i]);
      // Exact soil-plane boundary, eliminating floating roundoff in transport.
      if(i===0){v.y=0;v.normalize().multiplyScalar(radius);}
      positions.push(...v.add(c).toArray());uvs.push(j/sides,(i/segments-1)*state.length);
    }
  }
  for(let i=0;i<ep.count;i++){
    const v=new THREE.Vector3().fromBufferAttribute(ep,i).applyQuaternion(state.frame).add(state.node);
    positions.push(...v.toArray());uvs.push(eu.getX(i),eu.getY(i));
  }
  for(let i=0;i<segments+epicSegments;i++)for(let j=0;j<sides;j++){
    const v=i*(sides+1)+j;indices.push(v,v+1,v+sides+1,v+1,v+sides+2,v+sides+1);
  }
  // Original curvedTube winding is inward; the combined Acer surface uses
  // outward winding throughout, including all retained epicotyl triangles.
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  // The angular UV seam duplicates positions, so average its two normal copies.
  const normals=geometry.attributes.normal;
  for(let i=0;i<=segments+epicSegments;i++){
    const a=i*(sides+1),b=a+sides,n=new THREE.Vector3().fromBufferAttribute(normals,a)
      .add(new THREE.Vector3().fromBufferAttribute(normals,b)).normalize();
    normals.setXYZ(a,n.x,n.y,n.z);normals.setXYZ(b,n.x,n.y,n.z);
  }
  geometry.userData.primarySegments={hypocotyl:segments,epicotyl:epicSegments,node:state.node.toArray(),
    endpointTangent:tangents[segments].toArray(),epicotylTangent:tangent.applyQuaternion(state.frame).toArray(),
    persistentOffset:acerEstablishmentPriors.hypocotylLength,primaryStrain:state.strain};
  epicotyl.dispose();return tagWoodTube(geometry,segments+epicSegments,sides);
}

/** Unlobed ovate cotyledon blade, distinct from the adult palmate template.
 * Two instances allow existing triangle-based leaf loads to count two organs.
 * The blade origin is exactly the petiole endpoint; folding never moves it.
 */
export function acerCotyledonBlade(age: number, day = 180) {
  const p=acerEstablishmentPriors,state=acerCotyledonState(age,day),v:number[]=[],ix:number[]=[],segments=16;
  for(let i=0;i<=segments;i++){
    const t=i/segments,width=p.cotyledonWidth*.5*Math.sin(Math.PI*t)**.8;
    for(const edge of [-1,1])v.push(edge*width,p.cotyledonLength*t,
      Math.sin(Math.PI*t)*(.0006*(1-state.unfold)-.0012*state.senescence));
    if(i<segments){const n=i*2;ix.push(n,n+2,n+1,n+1,n+2,n+3);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();return g;
}

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
