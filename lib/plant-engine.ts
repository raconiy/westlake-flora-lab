import {geometryHeight} from './geometry-height.ts';
import * as THREE from "three";
import {tagWoodTube} from "./wood-loads.ts";
import {mergeWoodGeometries} from "./wood-geometry-merge.ts";
import {mapWoodyBarkUV,wireWoodyBarkSurface,wireWoodyLeafSurface} from "./woody-materials.ts";
import {irisFallSurface,irisCrestSurface,herbPigment} from "./herb-surfaces.ts";
import {tagLeafStrip} from "./herb-leaf-dynamics.ts";
import {herbReproduction,herbReproductionPriors} from "./herb-reproduction.ts";
import {clonalArchitecturePrior,clonalDensity,clonalPatchNode} from "./development.ts";
// @ts-ignore Explicit suffix is required by the native Node TypeScript test runner.
import { osmanthusLifecycle, osmanthusPriors, osmanthusSupportedRadius } from "./osmanthus-lifecycle.ts";
import { assertOsmanthusWoodSupport, createOsmanthusAxis, osmanthusAxisPrior, type OsmanthusAxis } from "./osmanthus-axis.ts";

/** Parameterized, uncalibrated morphology. Age is years; day is 1–365; motion time is seconds. */
export type PlantSpecies = "ginkgo" | "osmanthus" | "iris" | "oxalis";
export interface PlantParams { age: number; day: number; seed: number; density: number; }
export interface BranchJoint {
  pivot: THREE.Group;
  rest: THREE.Quaternion;
  length: number;
  radius: number;
  order: number;
  phase: number;
  flexibility: number;
  sag: number;
}
export interface PlantModel {
  group: THREE.Group;
  branches: BranchJoint[];
  leafCount: number;
  height: number;
  stageLabel?: string;
  update(time: number, wind: number, gravity: number, stiffness: number): void;
  dispose(): void;
}
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function rng(seed: number) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function fanGeometry() {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(.045, .026);
  for (let i = 0; i <= 24; i++) { const a = .20 * Math.PI + i / 24 * .60 * Math.PI; const notch = Math.exp(-Math.pow((a - Math.PI / 2) / .08, 2)); const r = .155 * (1 + .035 * Math.cos(a * 28)) * (1 - .16 * notch); s.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  s.lineTo(-.045, .026); s.lineTo(0, 0);
  const g = new THREE.ShapeGeometry(s, 8); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, .010 * Math.sin(p.getY(i) * 14) - .012 * Math.pow(p.getX(i) / .15, 2));
  g.scale(.295, .50, .50); g.computeVertexNormals(); return g;
}
function ovalGeometry() {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(.056, .055, .064, .12, 0, .205); s.bezierCurveTo(-.064, .12, -.056, .055, 0, 0);
  const g = new THREE.ShapeGeometry(s, 10); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, .012 * Math.sin(p.getY(i) / .205 * Math.PI) - .010 * Math.abs(p.getX(i)) / .06);
  g.scale(.435, .58, .50); g.computeVertexNormals(); return g;
}
function heartGeometry() {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(.012, .006, .035, .025, .023, .040); s.bezierCurveTo(.014, .050, .003, .036, 0, .030); s.bezierCurveTo(-.003, .036, -.014, .050, -.023, .040); s.bezierCurveTo(-.035, .025, -.012, .006, 0, 0);
  const g=new THREE.ShapeGeometry(s,10),p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);p.setZ(i,.0012*Math.sin(y/.05*Math.PI)-.0005*Math.abs(x)/.025);uv.setXY(i,.5+x/.055,y/.05);}g.computeVertexNormals();return g;
}
function petalGeometry(length: number, width: number, bend: number) {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(width, length * .24, width, length * .96, 0, length); s.bezierCurveTo(-width, length * .96, -width, length * .24, 0, 0);
  const g = new THREE.ShapeGeometry(s, 14); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, bend * Math.pow(p.getY(i) / length, 2));
  g.computeVertexNormals(); return g;
}
function bladeGeometry(length: number, width: number, lean: number, yaw: number) {
  const points: number[] = [], indices: number[] = [],uvs:number[]=[]; const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n, w = width * smooth(0,.08,t) * (1-smooth(.65,1,t)) * .5;
    const y = length * (t - .24 * t * t * Math.abs(lean)); const x = lean * length * t * t;
    for (let j = 0; j < 3; j++) { const z = (j - 1) * w; points.push(x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw));uvs.push(j/2,t); }
    if (i < n) for (let j = 0; j < 2; j++) { const a = i * 3 + j; indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3)); g.setIndex(indices);g.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2)); g.computeVertexNormals(); return g;
}

export function buildPlant(species: PlantSpecies, params: PlantParams): PlantModel {
  const natural = species === "ginkgo" ? buildNaturalGinkgo(params) : null;
  if (natural) return natural;
  const age = Math.max(0, Number.isFinite(params.age) ? params.age : 12), day = clamp(params.day, 1, 365);
  const density = clonalDensity(params.density);
  const group = new THREE.Group(); group.name = `plant:${species}:seed:${params.seed}`;
  const branches: BranchJoint[] = []; let leafCount = 0;
  const bark = new THREE.MeshStandardMaterial({ color: species === "ginkgo" ? "#786950" : "#6e6d53", roughness: .96 });
  const youngBark = new THREE.MeshStandardMaterial({ color: "#8e9270", roughness: .9 });
  const foliage = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: .76, side: THREE.DoubleSide });
  const stemMat = new THREE.MeshStandardMaterial({ color: "#637a3d", roughness: .9 });
  const materials: THREE.Material[] = [bark, youngBark, foliage, stemMat];
  const col = new THREE.Color();
  const extraGeometries: THREE.BufferGeometry[] = [];const extraTextures:THREE.Texture[]=[];
  const leafGeometry = species === "ginkgo" ? fanGeometry() : species === "osmanthus" ? ovalGeometry() : heartGeometry();
  if (species === 'osmanthus') {
    const ownTexture = (t: THREE.DataTexture) => { extraTextures.push(t); };
    wireWoodyLeafSurface(foliage, leafGeometry, species, ownTexture);
    wireWoodyBarkSurface(bark, species, age, false, params.seed, ownTexture);
    wireWoodyBarkSurface(youngBark, species, age, true, params.seed, ownTexture);
  }
  const leafPresence = species === "ginkgo" ? smooth(65, 105, day) * (1 - smooth(320, 350, day)) : 1;

  function direction(theta: number, inclination: number) { return new THREE.Vector3(Math.cos(theta) * Math.sin(inclination), Math.cos(inclination), Math.sin(theta) * Math.sin(inclination)); }

  let stageLabel: string | undefined;
  if (species === "osmanthus") {
    const life = osmanthusLifecycle(age), h = life.height, r = life.radius;
    foliage.roughness = .48; // Leathery evergreen surface; an appearance prior.
    stageLabel = life.stageLabel;
    group.userData = { stageLabel, lifecycle: life, priors: osmanthusPriors,
      architecture: { coordinates: "fixed material sites; pair birth when the extending parent reaches the site; persistent local supports", maxOrder: 3,
        maxAxisBudget: 869, maxLeafBudget: 28704, maxDrawBudget: 5216,
        leafTurnover: "uncalibrated; persistent foliage proxy, not a physiology solver",
        habit: "connected 3D evergreen crown; unequal axillary shoot vigour and fixed material curvature within a broad extension envelope",
        woodyAxis: osmanthusAxisPrior,
        persistence: osmanthusPriors.continuity.invariants,
        leafAxisArrangement: "fixed keyed .55–1.0 nodal rise before normalization; opposite/decussate in actual section frames; unchanged centimetre-scale blades; engineering prior",
        extensionNodes: "finite pairs of successive material nodes fill large extension gaps using unallocated lifetime leaf slots; woody branch anchors retained; leaf-only tail nodes use .985 of historical birth extension at fixed clocks/count bound; saturated density catalogues have no extra slots",
        calibration: "timing, angles, envelope and density are engineering priors, not measured campus data",
        references: "NCSU Osmanthus fragrans description and two private habit photographs; no photograph redistribution",
        pruning: "source describes pruning response; no pruning history or age-only wood removal inferred" },
      reproduction: "four-lobed axillary flowers; pollination, fruit and seed dispersal not modeled" };
    const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 5);
    const seedGeo = new THREE.SphereGeometry(1, 12, 8), flowerCenterGeo = new THREE.SphereGeometry(.0007, 6, 4);
    const flowerGeo = petalGeometry(.004, .002, .0005);
    extraGeometries.push(unitCylinder, seedGeo, flowerGeo, flowerCenterGeo);
    const seedMat = new THREE.MeshStandardMaterial({ color: "#92724d", roughness: .95 });
    const flowerMat = new THREE.MeshStandardMaterial({ color: "#f0df9d", side: THREE.DoubleSide, roughness: .8 });
    materials.push(seedMat, flowerMat);
    if (life.seedScale > 0) {
      const seed = new THREE.Mesh(seedGeo, seedMat); seed.name = "osmanthus-seed"; seed.userData.organ = "seed";
      seed.position.y = life.seedCenterY;
      seed.scale.set(.0045, .007, .0035).multiplyScalar(life.seedScale); group.add(seed);
    }
    const bloom = smooth(243, 263, day) * (1 - smooth(292, 310, day)) * smooth(2, 5, age);
    const phase = rng((params.seed || 1) * 211)() * Math.PI * 2;
    // Leaf size is unchanged. Fill the crown with actual opposite leaf nodes on
    // connected fine shoots, rather than enlarged blades or detached filler.
    const lp = leafGeometry.getAttribute("position"), li = leafGeometry.index;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    let bladeArea = 0, oneSidedLeafAreaM2 = 0;
    for (let i = 0; i < (li ? li.count : lp.count); i += 3) {
      va.fromBufferAttribute(lp, li ? li.getX(i) : i);
      vb.fromBufferAttribute(lp, li ? li.getX(i + 1) : i + 1);
      vc.fromBufferAttribute(lp, li ? li.getX(i + 2) : i + 2);
      bladeArea += vb.sub(va).cross(vc.sub(va)).length() * .5;
    }
    function segmentMatrix(start: THREE.Vector3, end: THREE.Vector3, radius: number) {
      return new THREE.Matrix4().compose(start.clone().lerp(end, .5),
        new THREE.Quaternion().setFromUnitVectors(UP, end.clone().sub(start).normalize()),
        new THREE.Vector3(radius, start.distanceTo(end), radius));
    }
    type AxisNode = { index: number; birth: number; attachment: number[]; angle: number; lengthAtBirth: number; materialS?: number; sectionFrame?: number[] };
    type AxisPlan = { id: string; birth: number; order: number; key: number; matureLength: number;
      lengthAt: (atAge: number) => number; nodes: AxisNode[]; leafNodes: AxisNode[]; curve: OsmanthusAxis };
    const axisPlans = new Map<THREE.Group, AxisPlan>();
    function woodyJoint(parent: THREE.Object3D, position: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, plan: AxisPlan) {
      const pivot = new THREE.Group(); pivot.position.copy(position); pivot.quaternion.setFromUnitVectors(UP, dir.clone().normalize()); parent.add(pivot);
      branches.push({ pivot, rest: pivot.quaternion.clone(), length, radius, order: plan.order, phase: rng(plan.key)() * Math.PI * 2,
        flexibility: clamp(.004 * Math.pow(length / Math.max(radius, .003), 1.12), .04, 1.7) * (.45 + plan.order * .22), sag: Math.min(.15, length * .035 * (plan.order + 1)) });
      axisPlans.set(pivot, plan); return pivot;
    }
    // Reserve within the EXISTING whole-life catalogue, not a larger hard limit.
    // There are <=28/168/672 lateral axes of orders 1/2/3. Extra leaf sites never
    // sprout new axes. Both sites and their budgets are age-independent; adding
    // a later branch cannot displace an earlier axis's allocation.
    const counts = [16, Math.max(2, Math.min(20, Math.round(12 * density))),
      Math.max(2, Math.min(14, Math.round(8 * density))), Math.max(2, Math.min(17, Math.round(16 * density)))];
    const basePairs = counts[0] + 28 * counts[1] + 168 * counts[2] + 672 * counts[3];
    const reserveScale = Math.min(density, (28704 / 2 - basePairs) / (40 + 28 * 16 + 168 * 8));
    // Insert TWO successive pairs per interval to preserve the old decussate
    // planes on either side of the new fixed catalogue; wood-support sites stay fixed.
    const extraPairs = [40, 16, 8, 0].map(n => 2 * Math.floor(n * reserveScale / 2));
    group.userData.architecture.leafCatalogue = { basePairsBound: basePairs, extraPairsPerAxis: extraPairs,
      lifetimePairsBound: basePairs + extraPairs[0] + 28 * extraPairs[1] + 168 * extraPairs[2],
      drawDefinition: "single main-pass mesh batches, excluding shadow/other passes: at most six per axis (wood, blades, petioles, three flower batches) plus seed and terminal bud" };
    // Explicit, finite architecture: each axis owns its extension clock. Nodes
    // establish just behind its apex at BIRTH, never at a fraction of today's wood.
    // Later distal cohorts continue through mature ages instead of translating
    // first-year nodes up the trunk. All timings below are engineering priors.
    function axisArchitecture(id: string, order: number, birth: number, key: number, matureLength: number): AxisPlan {
      const onsets = order === 0 ? [.10, .32, .54, .76, 1.2, 1.8, 3.2, 4.8, 7, 10, 14, 19, 25, 33, 44, 60]
        : order === 1 ? [.10, .32, .54, .76, 1.2, 2, 3.2, 4.8, 7, 10, 14, 20]
        : order === 2 ? [.10, .32, .54, .76, 1.2, 2, 3.2, 5] : [.10, .22, .36, .52, .72, .96, 1.3, 1.8, 2.4, 3.2];
      // Density changes lateral node sampling, not leader height or its late cohorts.
      // Fixed maxima prove a whole-life budget of at most 28,704 leaves / 869 axes.
      const count = counts[order];
      const vigour = rng(key + 407)();
      const lengthAt = order === 0 ? (atAge: number) => osmanthusLifecycle(atAge).height : (atAge: number) => {
        const elapsed = Math.max(0, atAge - birth);
        return matureLength * smooth(0, .25, elapsed) * (1 - Math.exp(-elapsed / ((order === 1 ? 5 : order === 2 ? 2.4 : 1.3) * (.8 + .4 * vigour))));
      };
      const nodes = Array.from({ length: count }, (_, index) => {
        const sample = index * (onsets.length - 1) / (count - 1), lo = Math.floor(sample), hi = Math.ceil(sample);
        const nodeBirth = birth + onsets[lo] + (onsets[hi] - onsets[lo]) * (sample - lo);
        const lengthAtBirth = lengthAt(nodeBirth);
        return { index, birth: nodeBirth, lengthAtBirth, attachment: [0, .96 * lengthAtBirth, 0],
          angle: phase + (order === 0 ? 0 : rng(key + 809)() * Math.PI * 2) + index * Math.PI / 2 };
      });
      // Leaf-only catalogue revision: establish tail nodes closer behind the
      // apex at their ORIGINAL birth clocks (.985 instead of .96 of historical
      // extension). Wood-bearing nodes, timings and angles remain untouched.
      // Do not stretch the catalogue to a far-future tip: that delays juvenile
      // foliage and opens transient gaps. These are fixed lifetime coordinates,
      // not a fraction of current-age wood; order 3 retains its first two sites.
      const lastSupport = order === 0 ? count - 1 : order === 1
        ? Math.round(.9 * (count - 1)) : order === 2 ? Math.round(.8 * (count - 1)) : Math.min(1, count - 1);
      const leafNodes = nodes.map(node => ({ ...node, attachment: [...node.attachment] }));
      // Subdivide the largest *material* intervals, including the terminal
      // extension. This is a bounded construction catalogue, never an age-time
      // loop or a percentage of today's length. Original branch-cohort nodes
      // remain in `nodes`; supplementary sites are only leaf/flower supports.
      const intervals = leafNodes.map((node, i) => ({
        left: node, end: leafNodes[i + 1]?.attachment[1] ?? matureLength * .985 * .999,
        serial: i,
      })).filter(g => (order !== 0 || g.left.index >= 3) && g.end > g.left.attachment[1]);
      for (let pair = 0; pair < extraPairs[order] / 2; pair++) {
        intervals.sort((a, b) => (b.end - b.left.attachment[1]) - (a.end - a.left.attachment[1]) || a.serial - b.serial);
        const gap = intervals.shift(); if (!gap || gap.end - gap.left.attachment[1] < .006) break;
        const inserted: AxisNode[] = [];
        for (let j = 1; j <= 2; j++) {
          const y = gap.left.attachment[1] + (gap.end - gap.left.attachment[1]) * j / 3;
          // Invert the actual parent extension law at a fixed material target.
          // The 1.5% apical offset is an explicit illustration prior. The birth
          // clock cannot precede the previous established node, even in a tiny
          // internode. Expansion starts at zero and is independent of season.
          let lo = gap.left.birth, hi = birth + 512;
          for (let k = 0; k < 48; k++) {
            const mid = (lo + hi) / 2;
            if (lengthAt(mid) < y / .985) lo = mid; else hi = mid;
          }
          const nodeBirth = hi, lengthAtBirth = lengthAt(nodeBirth);
          const node = { index: 1000 + pair * 2 + j - 1, birth: nodeBirth, lengthAtBirth,
            attachment: [0, y, 0], angle: gap.left.angle + j * Math.PI / 2 };
          inserted.push(node); leafNodes.push(node);
        }
        const chain = [gap.left, ...inserted];
        chain.forEach((left, j) => intervals.push({ left, end: inserted[j]?.attachment[1] ?? gap.end,
          serial: nodes.length + pair * 3 + j }));
      }
      // Allocate from the ORIGINAL material intervals before moving leaf-only
      // tail sites. Otherwise an interval can win a different subdivision slot,
      // silently changing supplementary births and losing early leaf area.
      // The original supplementary sites/clocks/angles and blade expansion stay
      // exact. Only base tail supports move, once per fixed lifecycle catalogue.
      for (let i = lastSupport + 1; i < count; i++) {
        leafNodes[i].attachment = [0, .985 * leafNodes[i].lengthAtBirth, 0];
      }
      leafNodes.sort((a, b) => a.attachment[1] - b.attachment[1]);
      const curve = createOsmanthusAxis(key, id, matureLength, order, leafNodes.map(n => n.attachment[1]));
      // Catalogue calculations above use axial material s. Transform once only
      // after subdivision, so later age/length cannot relocate a mature site.
      for (const node of [...nodes, ...leafNodes] as AxisNode[]) {
        node.materialS = node.attachment[1]; node.sectionFrame = curve.frame(node.materialS).toArray();
        node.attachment = curve.point(node.materialS).toArray();
      }
      return { id, birth, order, key, matureLength, lengthAt, nodes, leafNodes, curve };
    }
    function axisLeaves(parent: THREE.Group, plan: AxisPlan) {
      const key = plan.key;
      let supportAreaM2 = 0;
      const matrices: THREE.Matrix4[] = [], petioles: THREE.Matrix4[] = [];
      const nodes: (AxisNode & { scale: number })[] = [];
      const petals: THREE.Matrix4[] = [], peduncles: THREE.Matrix4[] = [], centers: THREE.Matrix4[] = [];
      const flowerSites: { node: number; side: number; center: number[]; attachment: number[]; orientation: number[] }[] = [];
      for (const node of plan.leafNodes) {
        const n = node.index, expansion = smooth(node.birth, node.birth + .20, age);
        if (expansion <= 0) continue;
        const attachment = new THREE.Vector3(...node.attachment);
        const theta = node.angle, nodalFrame = plan.curve.frame(node.materialS!);
        const nodalUp = UP.clone().applyQuaternion(nodalFrame);
        // A fixed nodal elevation breaks identical comb-like blade poses while
        // preserving the opposite pair and its 90-degree decussate azimuths.
        const petioleRise = .55 + .45 * rng(key + n * 331 + 23)();
        const scale = (.20 + .80 * smooth(.10, 2, age)) * expansion;
        nodes.push({ ...node, scale });
        // Age-driven, persistent leaf cohorts reserve equivalent support area.
        // Keep this independent of bloom/seasonal visibility and load controls.
        supportAreaM2 += 2 * bladeArea * scale * scale;
        for (let side = 0; side < 2; side++) {
          // A single node, a single expansion factor, exactly opposite petioles;
          // the next node's pair rotates 90 degrees (decussate phyllotaxis).
          const angle = theta + side * Math.PI;
          const dir = new THREE.Vector3(Math.cos(angle), petioleRise, Math.sin(angle)).normalize().applyQuaternion(nodalFrame);
          const bladeBase = attachment.clone().addScaledVector(dir, .008 * scale);
          const normal = nodalUp.clone().addScaledVector(dir, -nodalUp.dot(dir)).normalize();
          const widthAxis = new THREE.Vector3().crossVectors(dir, normal).normalize();
          const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(widthAxis, dir, normal));
          matrices.push(new THREE.Matrix4().compose(bladeBase, q, new THREE.Vector3(scale, scale, scale)));
          oneSidedLeafAreaM2 += bladeArea * scale * scale;
          petioles.push(segmentMatrix(attachment, bladeBase, .00055 * scale));
          if (bloom <= 0) continue;
          const fr = rng(key + n * 197 + side * 31);
          for (let f = 0; f < 2; f++) {
            // Each floret has ONE centre and frame. Its four lobes differ only in
            // rotation about that frame's normal, and a peduncle reaches the axil.
            const out = new THREE.Vector3(Math.cos(angle + (f - .5) * .6), .55 + fr() * .15, Math.sin(angle + (f - .5) * .6)).normalize().applyQuaternion(nodalFrame);
            const flowerScale = bloom * expansion;
            const center = attachment.clone().addScaledVector(out, (.009 + f * .004) * flowerScale);
            const frame = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), out);
            peduncles.push(segmentMatrix(attachment, center, .00035 * flowerScale));
            centers.push(new THREE.Matrix4().compose(center, frame, new THREE.Vector3().setScalar(flowerScale)));
            flowerSites.push({ node: n, side, center: center.toArray(), attachment: attachment.toArray(), orientation: frame.toArray() });
            for (let p = 0; p < 4; p++) {
              const q = frame.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p * Math.PI / 2));
              petals.push(new THREE.Matrix4().compose(center, q, new THREE.Vector3().setScalar(flowerScale)));
            }
          }
        }
      }
      parent.userData.ownLeafSupportAreaM2 = supportAreaM2;
      if (matrices.length) {
        const leaves = new THREE.InstancedMesh(leafGeometry, foliage, matrices.length);
        const stalks = new THREE.InstancedMesh(unitCylinder, stemMat, petioles.length);
        leaves.userData = { organ: "leaf", axisId: plan.id, connectedBy: "petiole", phyllotaxis: "opposite-decussate", nodes };
        stalks.userData = { organ: "leaf", axisId: plan.id, role: "petiole" };
        matrices.forEach((m, i) => { leaves.setMatrixAt(i, m); stalks.setMatrixAt(i, petioles[i]); col.setHSL(.27, .40, .22 + rng(key + Math.floor(i / 2) * 17)() * .06); leaves.setColorAt(i, col); });
        leaves.castShadow = leaves.receiveShadow = true; parent.add(stalks, leaves); leafCount += matrices.length;
      }
      if (petals.length) {
        const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, petals.length);
        const stalks = new THREE.InstancedMesh(unitCylinder, stemMat, peduncles.length);
        const cores = new THREE.InstancedMesh(flowerCenterGeo, flowerMat, centers.length);
        flowers.userData = { organ: "flower", axisId: plan.id, role: "corolla-lobes", lobesPerFlower: 4, sites: flowerSites };
        stalks.userData = { organ: "flower", axisId: plan.id, role: "axillary-peduncle" };
        cores.userData = { organ: "flower", role: "center" };
        petals.forEach((m, i) => flowers.setMatrixAt(i, m));
        centers.forEach((m, i) => { cores.setMatrixAt(i, m); stalks.setMatrixAt(i, peduncles[i]); });
        flowers.castShadow = true; parent.add(stalks, cores, flowers);
      }
    }
    if (h > 0) {
      const leaderPlan = axisArchitecture("leader", 0, 0, params.seed || 1, osmanthusPriors.dimensions.matureHeightAsymptote);
      const leader = woodyJoint(group, new THREE.Vector3(0, life.collarY, 0), UP, h, r, leaderPlan);
      leader.userData = { axis: "leader", axisId: leaderPlan.id, birth: 0 };
      axisLeaves(leader, leaderPlan);
      // Reach belongs to the fixed lifetime catalogue. Seed loss raises the
      // actual collar by 7 mm; using that moving origin here would retarget
      // already formed axes. Plan against the adult collar, while rendering
      // pivots in the actual parent hierarchy to retain root/organ contact.
      const adultCollarOrigin = new THREE.Vector3(0, osmanthusPriors.dimensions.adultCollarY, 0);
      function branchCohort(parent: THREE.Group, plan: AxisPlan, worldRest: THREE.Quaternion,
        catalogueOrigin: THREE.Vector3) {
        if (plan.order >= 3) return;
        // Branches use the SAME node records as the rendered leaf/petiole pairs.
        // Sparse supporting nodes include distal cohorts on every branching order.
        const supports = plan.order === 0 ? plan.nodes.filter(n => n.index === 1 || n.index >= 3)
          : [...new Set((plan.order === 1 ? [.1, .45, .9] : [.2, .8]).map(f => Math.round(f * (plan.nodes.length - 1))))].map(i => plan.nodes[i]);
        for (const node of supports) for (let side = 0; side < 2; side++) {
          const order = plan.order + 1;
          const axisKey = Math.imul(plan.key, 1664525) + (node.index * 2 + side + 1) * 1013904223;
          const rr = rng(axisKey);
          // Opposite leaves specify two axils, not twin scaffold axes. Each bud
          // has its own fixed vigour, delay, azimuth and inclination. The keyed
          // variation describes connected shoots; it adds no decorative organs.
          const dominantSide = rng(plan.key + node.index * 9173 + 199)() < .5 ? 0 : 1;
          const vigour = side === dominantSide ? .65 + .35 * rr() : .05 + .50 * rr();
          const delay = rr() * .32;
          const onset = Math.max(plan.birth + (order === 1 ? .8 : 1.2), node.birth + (order === 1 ? .45 : .65)) + delay;
          if (age <= onset) continue;
          const position = new THREE.Vector3(...node.attachment);
          const origin = position.clone().applyQuaternion(worldRest).add(catalogueOrigin);
          const angle = node.angle + side * Math.PI + (rr() - .5) * 1.25;
          const inclination = (order === 1 ? .72 : .65) + rr() * (order === 1 ? .72 : 1.05);
          const parentFrame = plan.curve.frame(node.materialS!);
          const worldDirection = direction(angle, inclination).applyQuaternion(parentFrame).applyQuaternion(worldRest);
          // Fine axes turn toward light; using the parent's fixed rest frame
          // avoids the repeated planar fork produced by a common local angle.
          if (order > 1) worldDirection.addScaledVector(UP, .65 + .3 * rr()).normalize();
          // A fixed, broad ellipsoid limits *extension*, never moves an existing
          // support or retires old wood. It is a habit prior, not a clipping mesh
          // or an assumed measured/pruned campus specimen. Ray intersection
          // gives upper branches shorter reach without imposing equal tiers.
          const radii = new THREE.Vector3(2.45, 2.85, 2.45);
          const offset = origin.clone().sub(new THREE.Vector3(0, 2.65, 0)).divide(radii);
          const ray = worldDirection.clone().divide(radii);
          const aa = ray.lengthSq(), bb = offset.dot(ray), cc = offset.lengthSq() - 1;
          const reach = Math.max(.015, (-bb + Math.sqrt(Math.max(0, bb * bb - aa * cc))) / aa);
          const potential = plan.matureLength * (order === 1 ? .68 : order === 2 ? .52 : .62) * (.68 + .65 * vigour);
          const matureLength = Math.min(potential, reach * (.60 + .38 * vigour));
          const child = axisArchitecture(`${plan.id}/${node.index}:${side}`, order, onset, axisKey, matureLength);
          const len = child.lengthAt(age), growth = len / matureLength;
          if (growth <= 0) continue;
          const radius = r * Math.pow(.32, order) * Math.sqrt(growth);
          const localDirection = worldDirection.clone().applyQuaternion(worldRest.clone().invert());
          const axis = woodyJoint(parent, position, localDirection, len, radius, child);
          axis.userData = { axis: "lateral", axisId: child.id, birth: onset, node: node.index,
            supportNode: node, supportAxisId: plan.id, side, growth, matureLength, inclination, vigour };
          axisLeaves(axis, child);
          branchCohort(axis, child, worldRest.clone().multiply(axis.quaternion), origin);
        }
      }
      branchCohort(leader, leaderPlan, leader.quaternion.clone(), adultCollarOrigin);
      // A short weak axillary shoot and a long vigorous terminal axis must not
      // share one order-only diameter. Postorder sums supported blade area ONCE
      // through real attachments; radius changes neither length nor material
      // node positions. Allometry constants and limitations live in the priors.
      const support = new Map<THREE.Object3D, number>();
      for (const branch of [...branches].reverse()) {
        const area = (branch.pivot.userData.ownLeafSupportAreaM2 ?? 0) + (support.get(branch.pivot) ?? 0);
        const ageOrderFloorM = branch.radius;
        branch.radius = osmanthusSupportedRadius(branch.length, area, ageOrderFloorM);
        branch.pivot.userData.secondaryThickening = { supportedLeafAreaM2: area, ageOrderFloorM,
          radiusM: branch.radius, status: osmanthusPriors.secondaryThickening.status };
        if (branch.pivot.parent) support.set(branch.pivot.parent, (support.get(branch.pivot.parent) ?? 0) + area);
        const plan = axisPlans.get(branch.pivot)!;
        const geometry = plan.curve.geometry(branch.length, branch.radius);
        // Validate formed cohorts against actual indexed wood; never hide a
        // stranded leaf or retire/retarget its parent to mask a support error.
        assertOsmanthusWoodSupport(geometry, plan.leafNodes.filter(node => age > node.birth));
        mapWoodyBarkUV(geometry, branch.radius, branch.length);
        const wood = new THREE.Mesh(geometry, branch.order > 2 ? youngBark : bark);
        wood.name = "osmanthus-wood-axis"; wood.castShadow = wood.receiveShadow = true;
        branch.pivot.add(wood);
        branch.pivot.userData.axisGeometry = geometry.userData.osmanthusAxis;
      }
      const bud = new THREE.Mesh(seedGeo, stemMat); bud.name = "osmanthus-terminal-bud"; bud.userData.organ = "bud";
      bud.position.copy(leaderPlan.curve.point(h)); bud.quaternion.copy(leaderPlan.curve.frame(h)); bud.scale.set(.0007, .0015, .0007).multiplyScalar(smooth(.035, .12, age)); leader.add(bud);
    }
    // Build-time diagnostic only. Animation rotates the existing hierarchy and
    // never regenerates axes, instances, bounds or area/projection metrics.
    group.updateMatrixWorld(true);
    const crown = new THREE.Box3(), instance = new THREE.Matrix4(), point = new THREE.Vector3();
    group.traverse(object => {
      const leaves = object as THREE.InstancedMesh;
      if (!leaves.isInstancedMesh || leaves.userData.connectedBy !== "petiole") return;
      for (let i = 0; i < leaves.count; i++) {
        leaves.getMatrixAt(i, instance);
        crown.expandByPoint(point.setFromMatrixPosition(instance).applyMatrix4(leaves.matrixWorld));
      }
    });
    const span = crown.isEmpty() ? new THREE.Vector3() : crown.getSize(new THREE.Vector3());
    const projectedCrownAreaM2 = Math.PI * span.x * span.z / 4;
    group.userData.canopyMetrics = { oneSidedLeafAreaM2, projectedCrownAreaM2,
      leafAreaRatio: projectedCrownAreaM2 > 0 ? oneSidedLeafAreaM2 / projectedCrownAreaM2 : 0,
      crownSpanM: span.toArray(), maxLeafBudget: 28704,
      projectionDefinition: "horizontal ellipse of leaf-base bounds in the fixed rest pose",
      calibration: "actual one-sided mesh area / horizontal crown bounding ellipse; engineering density proxy, not measured stand LAI" };
  } else if (species === "iris" || species === "oxalis") {
    // Botanical constraints supplied by NCSU Plant Toolbox; geometry is in metres.
    // Durations, cohort budgets and flowering windows below are uncalibrated
    // presentation priors, NOT measured germination or first-flowering ages.
    const iris = species === "iris";
    const reproductiveCycle = herbReproduction(species, day);
    const source = iris ? "https://plants.ces.ncsu.edu/plants/iris-tectorum/" : "https://plants.ces.ncsu.edu/plants/oxalis-corniculata/";
    const keyed = (key: number) => rng((params.seed || 1) + key * 104729)();
    const phase = keyed(1) * Math.PI * 2;
    const unit = new THREE.CylinderGeometry(1, 1, 1, 7);
    const sphere = new THREE.SphereGeometry(1, 10, 6);
    extraGeometries.push(unit, sphere);
    const green = new THREE.MeshStandardMaterial({ color: iris ? "#617b42" : "#5f8e49", side: THREE.DoubleSide, roughness: .8 });
    const storage = new THREE.MeshStandardMaterial({ color: "#9d885d", roughness: .95 });
    const petalMat = new THREE.MeshStandardMaterial({ color: iris ? "#7c73bf" : "#f4ce3d", side: THREE.DoubleSide, roughness: .7 });
    const light = new THREE.MeshStandardMaterial({ color: "#b3a5df", side: THREE.DoubleSide, roughness: .7 });
    const reproductiveStem = new THREE.MeshStandardMaterial({ color: "#637a3d", roughness: .95 });
    reproductiveStem.color.lerp(new THREE.Color("#a8916d"), reproductiveCycle.dryFraction);
    materials.push(reproductiveStem);
    materials.push(green, storage, petalMat, light);const leafMap=herbPigment(iris?"iris-blade":"oxalis-blade");green.map=leafMap;green.bumpMap=leafMap;green.bumpScale=iris?.00018:.00008;extraTextures.push(leafMap);
    stageLabel = iris
      ? age < .025 ? "根茎分株 · 带芽繁殖体" : age < .14 ? "分株建立 · 首叶展开" : age < .5 ? "二列扇叶 · 新叶建立" : "根茎横走 · 分株扩展（繁殖结构为季节先验）"
      : age < .018 ? "带根匍匐茎节 · 营养繁殖体" : age < .10 ? "茎节建立 · 首片三出复叶" : age < .35 ? "匍匐伸长 · 新节生根" : "匍匐群落 · 连续展叶（繁殖结构为季节先验）";
    group.userData = { stageLabel, development: {
      origin: iris ? "rhizome-division" : "rooted-stolon-node", ageClock: "years-since-vegetative-propagule-establishment",
      seedGerminationModeled: false, source, evidence: "NCSU institutional text cache, retrieved 2026-11-05T17:18:47.175Z; not locally measured",
      calibration: "uncalibrated-engineering-prior", timing: "cohort expansion is a presentation prior, not a biological flowering-age estimate",
      flowering: { dayWindow: herbReproductionPriors[species].petals, status: "engineering-season-prior", firstFloweringAge: null },
      reproduction: "flowers and annually replaced reproductive supports only; pollination, capsules and seed dispersal not modeled",
      seasonalSkeleton: "living vegetative axes and buds retained; reproductive supports emerge, dry and collapse continuously to zero before annual replacement",
      reproductiveCycle: { ...herbReproductionPriors[species],
        scope: "bounded qualitative annual cycle; not tracked multi-year plant physiology",
        clocks: "cyclic input day controls reproduction; age controls vegetative establishment/readiness without random rerolling",
        timing: "all exact day windows are uncalibrated Hangzhou presentation priors; source bounds are not universal dates",
        ownership: "support and flower share the same leaf/fan branch and a common endpoint, including under wind/gravity",
        mechanics: "reproductive mass, centre of mass and drag are excluded from the load estimator; shared branch motion is not a calibrated reproductive load solver",
        units: "geometry in metres; inclination in radians; day 1–365; age in years since vegetative establishment; cycle factors dimensionless",
      },
    } };
    group.userData.clonalArchitecture = { ...clonalArchitecturePrior, density };
    function segment(parent: THREE.Object3D, start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material, role: string) {
      const mesh = new THREE.Mesh(unit, material);
      mesh.position.copy(start).lerp(end, .5);
      const delta = end.clone().sub(start), length = delta.length();
      if (length > 0) mesh.quaternion.setFromUnitVectors(UP, delta.multiplyScalar(1 / length));
      mesh.scale.set(radius, length, radius); mesh.name = role;
      mesh.userData = { role, start: start.toArray(), end: end.toArray() };
      parent.add(mesh); return mesh;
    }
    function root(parent: THREE.Object3D, size: number) {
      const mesh = segment(parent, new THREE.Vector3(), new THREE.Vector3(.003 * size, -.022 * size, 0), .00065 * size, storage, "adventitious-root");
      mesh.userData.organ = "root";
      mesh.userData.axisId=`${parent.name}:root`;mesh.userData.parentNodeId=parent.userData.rametId;
    }
    function bud(parent: THREE.Object3D, size: number) {
      const mesh = new THREE.Mesh(sphere, green); mesh.scale.set(.0015, .003, .0015).multiplyScalar(size);
      mesh.userData.organ = "bud"; parent.add(mesh);
    }
    function sway(parent: THREE.Object3D, key: number, length: number) {
      // Only above-ground organs sway: surface runners and their rooted nodes stay connected.
      const pivot = new THREE.Group(); parent.add(pivot);
      branches.push({ pivot, rest: pivot.quaternion.clone(), length, radius: iris ? .003 : .0008,
        order: 2, phase: keyed(key) * Math.PI * 2, flexibility: iris ? .85 : 1.3, sag: .015 });
      return pivot;
    }
    function reproductiveSite(parent: THREE.Object3D, readiness: number, matureTip: THREE.Vector3, radius: number, role: string, site: number) {
      const assembly = new THREE.Group(); assembly.name = `annual-reproductive-axis-${site}`;
      assembly.rotation.z = reproductiveCycle.inclination;
      // As with the axillary flower assemblies above, "flower" includes its
      // reproductive support. It must not be mistaken for a persistent stem.
      assembly.userData = { organ: "flower", role: "annual-reproductive-axis", site, readiness,
        lifecycle: "annual-replacement", cycle: { ...reproductiveCycle }, ownerBranch: branches.findIndex(branch => branch.pivot === parent) };
      parent.add(assembly);
      const tip = matureTip.clone().multiplyScalar(readiness * reproductiveCycle.support);
      const stalk = segment(assembly, new THREE.Vector3(), tip,
        radius * readiness * reproductiveCycle.support, reproductiveStem, role);
      stalk.userData = { ...stalk.userData, organ: "flower", organPart: "reproductive-support", site, lifecycle: "annual-replacement" };
      const flower = new THREE.Group(); flower.position.copy(tip);
      flower.scale.setScalar(readiness * reproductiveCycle.petals);
      flower.rotation.z = .18 * reproductiveCycle.petalDecline;
      assembly.add(flower); return flower;
    }
    if (iris) {
      const outerGeo = irisFallSurface(),crestGeo=irisCrestSurface(), innerGeo = petalGeometry(.055, .014, .008);
      const styleGeo = petalGeometry(.042, .007, .004);
      extraGeometries.push(outerGeo, innerGeo, styleGeo,crestGeo);const fallMap=herbPigment("iris-fall");petalMat.map=fallMap;petalMat.color.set("#ffffff");extraTextures.push(fallMap);const crestMat=new THREE.MeshStandardMaterial({color:"#f1edf8",side:THREE.DoubleSide,roughness:.82});materials.push(crestMat);
      // A density value controls both cohort count and the occupied rhizome
      // footprint. It is a relative packing prior, never a campus plant count.
      const fanCount = 1 + Math.round(3 * density);
      const origin = new THREE.Vector3(.015, -.003, 0);
      const nodes = Array.from({length:fanCount},(_,c)=>{
        const p=clonalPatchNode(c,params.seed,density,.065);
        return origin.clone().add(new THREE.Vector3(p.x,0,p.z));
      });
      segment(group, new THREE.Vector3(-.015, -.003, 0), origin, .004, storage, "rhizome-propagule").userData.axisId='iris:propagule';
      for (let c = 0; c < fanCount; c++) {
        const birth = c === 0 ? 0 : .5 + (c - 1) * .55;
        const extension = c === 0 ? 1 : smooth(birth, birth + .22, age);
        // Attach to the closest already established material node. This
        // produces lateral branches and clumps rather than one zigzag chain.
        let parent = 0;
        for(let p=1;p<c;p++)if(nodes[p].distanceToSquared(nodes[c])<nodes[parent].distanceToSquared(nodes[c]))parent=p;
        const start=nodes[parent],node=c===0?origin.clone():start.clone().lerp(nodes[c],extension);
        if (c > 0) {
          const rhizome = segment(group, start, node, .0035 * extension, storage, "rhizome");
          rhizome.userData = { ...rhizome.userData, cohort: c, birth, growth: extension,axisId:`iris:rhizome:${c}`,parentNodeId:`iris:ramet:${parent}`,nodeId:`iris:ramet:${c}` };
        }
        const fanBirth = c === 0 ? 0 : birth + .22;
        const establishment = c === 0 ? 1 : smooth(fanBirth, fanBirth + .10, age);
        const base = new THREE.Group(); base.name = `iris-fan-${c}`; base.position.copy(node); base.rotation.y = phase+(keyed(150+c)-.5)*.65;
        base.userData = { role: "rhizome-node", cohort: c, birth: fanBirth,rametId:`iris:ramet:${c}`,established:age>=fanBirth }; group.add(base);
        root(base, establishment); bud(base, establishment);
        const expanded = Array.from({ length: 8 }, (_, i) => smooth(fanBirth + .025 + i * .07, fanBirth + .14 + i * .07, age));
        // Do not register a dynamics branch before the first blade cohort has
        // formed.  At age zero the fan is a propagule with a real root/bud
        // anchor, but its aerial support has zero length; putting that support
        // in `branches` created a phantom zero-length joint that could be
        // mistaken for formed wood by continuity and load audits.
        if (expanded[0] <= 0) continue;
        const fan = sway(base, 200 + c, .40 * expanded[0]);
        for (let i = 0; i < 8; i++) {
          const expansion = expanded[i]; if (expansion <= 0) continue;
          const side = i % 2 === 0 ? -1 : 1;
          const length = (.30 + .12 * keyed(300 + c * 17 + i)) * expansion;
          const geometry = bladeGeometry(length, (.019 + .006 * keyed(500 + c * 17 + i)) * expansion, side * (.12 + .065 * (3 - Math.floor(i / 2))), 0);
          // The generic ribbon bends perpendicular to its width. Iris blades
          // instead expand and spread in the common plane of the equitant fan.
          const vertices = geometry.attributes.position;
          for (let v = 0; v < vertices.count; v++) {
            vertices.setX(v, vertices.getX(v) + vertices.getZ(v)); vertices.setZ(v, (v%3===1?.0006:0)*expansion*Math.sin(vertices.getY(v)/Math.max(1e-8,length)*Math.PI));
          }
          geometry.computeVertexNormals(); tagLeafStrip(geometry);
          const leaf = new THREE.Mesh(geometry, green);
          // All sword blades share the same x/y plane, in two basal ranks.
          leaf.position.x = side * .0007 * (4 - Math.floor(i / 2)) * expansion;
          leaf.userData = { organ: "leaf", leafDynamics: "material-strip", role: "sword-blade", arrangement: "distichous-fan", cohort: c, index: i, expansion };
          leaf.castShadow = true; fan.add(leaf); leafCount++;
        }
        const readiness = smooth(4, 7, expanded.reduce((a, b) => a + b, 0));
        const flower = reproductiveSite(fan, readiness, new THREE.Vector3(0, .32, 0), .0022, "flower-scape", c);
        flower.userData = { organ: "flower", role: "iris-flower", outerTepals: 3, innerTepals: 3, styleBranches: 3 };
        for (let p = 0; p < 3; p++) {
          const frame = new THREE.Group(); frame.rotation.y = p * Math.PI * 2 / 3; flower.add(frame);
          const fall = new THREE.Mesh(outerGeo, petalMat); fall.rotation.x = -Math.PI / 2; fall.userData.role = "drooping-outer-tepal"; frame.add(fall);const crest=new THREE.Mesh(crestGeo,crestMat);crest.rotation.copy(fall.rotation);crest.userData.role="fringed-white-crest";frame.add(crest);
          const style = new THREE.Mesh(styleGeo, light); style.rotation.x = -Math.PI / 2 + .22; style.userData.role = "style-branch"; frame.add(style);
          const standardFrame = new THREE.Group(); standardFrame.rotation.y = Math.PI / 3; frame.add(standardFrame);
          const standard = new THREE.Mesh(innerGeo, light); standard.rotation.x = .22; standard.userData.role = "upright-inner-tepal"; standardFrame.add(standard);
        }
      }
    } else {
      const petalGeo = petalGeometry(.006, .003, -.0006); extraGeometries.push(petalGeo);
      const origin = new THREE.Group(); origin.position.y = .003; origin.name = "oxalis-rooted-propagule"; group.add(origin);
      origin.userData={role:'rooting-stolon-node',rametId:'oxalis:ramet:0',birth:0};
      segment(origin, new THREE.Vector3(-.008, 0, 0), new THREE.Vector3(), .0009, stemMat, "stolon-propagule").userData.axisId='oxalis:propagule';
      root(origin, 1); bud(origin, 1);
      const runnerCount = Math.max(1, Math.round(3 * density));
      const nodeLimit = 4 + Math.round(2 * density), catalogueLimit = 8;
      // Keep each canonical runner's material coordinates fixed for a seed;
      // density adds later runners/nodes inside the same patch instead of
      // moving an already formed stolon when the display density changes.
      const reach = .24, runners:THREE.Object3D[][]=[];
      function nodeOrgans(parent: THREE.Object3D, birth: number, key: number) {
        const establishment = smooth(birth, birth + .05, age); if (key !== 0) root(parent, establishment);
        const expansion = smooth(birth + .018, birth + .10, age);
        if (expansion <= 0) return;
        const height = (.035 + .035 * keyed(800 + key)) * expansion;
        const pivot = sway(parent, 900 + key, height);
        segment(pivot, new THREE.Vector3(), new THREE.Vector3(0, height, 0), .00065 * expansion, stemMat, "petiole");
        const leaf = new THREE.Group(); leaf.position.y = height; leaf.rotation.y = phase + keyed(1000 + key) * Math.PI;
        leaf.userData = { organ: "leaf", role: "trifoliate-leaf", node: key, birth, expansion }; pivot.add(leaf);
        for (let p = 0; p < 3; p++) {
          const frame = new THREE.Group(); frame.rotation.y = p * Math.PI * 2 / 3; leaf.add(frame);
          const mesh = new THREE.Mesh(leafGeometry, green); mesh.rotation.x = -Math.PI / 2;
          mesh.scale.setScalar((.38 + .10 * keyed(1100 + key)) * expansion);
          if (!leafGeometry.hasAttribute('leafMaterial')) tagLeafStrip(leafGeometry, true);
          mesh.userData = { organ: "leaf", leafDynamics: "material-strip", role: "heart-shaped-leaflet", insertion: "leaflet-base-at-petiole-tip", leaflet: p }; mesh.castShadow = true; frame.add(mesh);
        }
        leafCount++; // Count compound leaves, not their three leaflets.
        const readiness = smooth(.85, 1, expansion) * smooth(.10, .28, age);
        const flower = reproductiveSite(pivot, readiness, new THREE.Vector3(.016, height, .008), .00045, "axillary-peduncle", key);
        flower.userData = { organ: "flower", role: "oxalis-flower", petals: 5 };
        for (let p = 0; p < 5; p++) {
          const frame = new THREE.Group(); frame.rotation.y = p * Math.PI * 2 / 5;
          const mesh = new THREE.Mesh(petalGeo, petalMat); mesh.rotation.x = -Math.PI / 2 + .15; frame.add(mesh); flower.add(frame);
        }
      }
      nodeOrgans(origin, 0, 0);
      for (let r = 0; r < runnerCount; r++) {
        const branchNode=Math.max(1,Math.floor(catalogueLimit*.3)),limit=Math.max(3,nodeLimit-r%3);
        let parent: THREE.Object3D = r===0?origin:runners[0][branchNode-1];
        const onset=r===0?.12:.12+.84*branchNode/catalogueLimit+.08+r*.045;
        const duration=.84,angle=phase+r*2.399963+(keyed(1200+r)-.5)*.65;
        const length=reach*(r===0?1:.48),bend=(keyed(1300+r)-.5)*.24;
        const path=(t:number)=>new THREE.Vector3(Math.cos(angle)*t-Math.sin(angle)*bend*Math.sin(Math.PI*t)*t,0,Math.sin(angle)*t+Math.cos(angle)*bend*Math.sin(Math.PI*t)*t).multiplyScalar(length);
        const catalogue:THREE.Object3D[]=[];runners.push(catalogue);
        for (let n = 1; n <= limit; n++) {
          const birth = onset + (n - 1) / catalogueLimit * duration;
          // Constant advancing front, subdivided into density-dependent fixed
          // spacers. Born nodes never slide when another node is added by age.
          const extension = clamp((age-birth)/(duration/catalogueLimit));
          const end=path(n/catalogueLimit).sub(path((n-1)/catalogueLimit)).multiplyScalar(extension);
          const internode = segment(parent, new THREE.Vector3(), end, .0008 * extension, stemMat, "stolon-internode");
          internode.userData = { ...internode.userData, runner: r, node: n, birth, growth: extension,axisId:`oxalis:stolon:${r}:${n}`,nodeId:`oxalis:ramet:${r}:${n}`,parentNodeId:parent.userData.rametId };
          const node = new THREE.Group(); node.name = `oxalis-node-${r}-${n}`; node.position.copy(end);
          node.userData = { role: "rooting-stolon-node", runner: r, node: n, birth: birth + duration/catalogueLimit,rametId:`oxalis:ramet:${r}:${n}` }; parent.add(node);catalogue.push(node);
          nodeOrgans(node, birth + duration/catalogueLimit, 1+r*32+n); parent = node;
        }
      }
    }
  }
  // Copy organ labels to descendants as well as roots: skeleton renderers can toggle
  // every object independently without making an unlabelled petal/leaf visible again.
  group.traverse(obj => { if (!obj.userData.organ && obj.parent?.userData.organ) obj.userData.organ = obj.parent.userData.organ; });
  group.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(group); const height = geometryHeight(group);
  // Compute gravity in each branch's undeformed local frame. This is a rest-pose
  // cantilever approximation: descendants inherit parent deformation, while local
  // torque axes are not re-solved with the fully deformed geometry as in FEA.
  const gravityFrames = branches.map(j => {
    const world = j.pivot.getWorldQuaternion(new THREE.Quaternion());
    const localDown = new THREE.Vector3(0, -1, 0).applyQuaternion(world.invert());
    const axis = new THREE.Vector3().crossVectors(UP, localDown);
    const perpendicular = axis.length();
    if (perpendicular > 1e-8) axis.multiplyScalar(1 / perpendicular);
    else axis.set(1, 0, 0); // Arbitrary valid axis; its rotation angle will be zero.
    return { axis, perpendicular };
  });
  const windRotation = new THREE.Quaternion(), gravityRotation = new THREE.Quaternion(), tilt = new THREE.Euler();
  function update(time: number, wind: number, gravity: number, stiffness: number) {
    const speed = clamp(Number.isFinite(wind) ? wind : 0, 0, 25), grav = clamp(gravity, 0, 30), rigid = Math.max(.1, stiffness);
    // SI input: gravity is m/s². Torque is proportional to the perpendicular load;
    // a straight vertical branch has no gravity bending in this approximation.
    // Drag's 24% woody / 76% foliage split is an uncalibrated engineering assumption;
    // leaf-off ginkgo retains wood drag but loses its foliage-area contribution.
    const windAreaFactor = .24 + .76 * leafPresence * density;
    for (let i = 0; i < branches.length; i++) {
      const j = branches[i], gravityFrame = gravityFrames[i];
      const f = j.flexibility / rigid, load = speed * speed * .00023 * f * windAreaFactor;
      const oscillation = Math.sin(time * (1.15 + j.order * .33) + j.phase) * .65 + Math.sin(time * .51 + j.phase * .7) * .35;
      const bend = Math.min(.19, load) * (.65 + oscillation * .35);
      const sag = Math.min(.16, j.sag * grav / 9.81 / rigid * gravityFrame.perpendicular);
      gravityRotation.setFromAxisAngle(gravityFrame.axis, sag);
      tilt.set(Math.min(.25, bend * .42), 0, -Math.min(.28, bend)); windRotation.setFromEuler(tilt);
      j.pivot.quaternion.copy(j.rest).multiply(gravityRotation).multiply(windRotation);
    }
  }

  let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true;
    const geometries = new Set<THREE.BufferGeometry>([leafGeometry, ...extraGeometries]); const mats = new Set<THREE.Material>(materials);
    group.traverse(obj => { const m = obj as THREE.Mesh; if (m.geometry) geometries.add(m.geometry); if (m.material) { const material = Array.isArray(m.material) ? m.material : [m.material]; material.forEach(x => mats.add(x)); } if (obj instanceof THREE.InstancedMesh) obj.dispose(); });
    geometries.forEach(g => g.dispose()); mats.forEach(m => m.dispose());extraTextures.forEach(t=>t.dispose()); group.clear();
  }
  return { group, branches, leafCount, height, stageLabel, update, dispose };
}

/** Silver-ginkgo architecture v3. Shape priors are not a fitted campus individual.
 * Botanical constraints: hypogeal germination, persistent long/short shoots,
 * petiolate fan blades with dichotomous veins, deciduous foliage, no assumed sex.
 * Flora of China: https://efloras.org/florataxon.aspx?flora_id=2&taxon_id=200005235
 * USDA: https://plants.usda.gov/DocumentLibrary/plantguide/pdf/pg_ginkg.pdf
 * Curves below are unmeasured engineering priors, not campus age/DBH observations.
 */
function buildNaturalGinkgo(params: PlantParams): PlantModel {
  const age = Math.max(0, Number.isFinite(params.age) ? params.age : 12), day = clamp(params.day, 1, 365), density = clamp(params.density, .15, 2);
  const seed = params.seed || 1, group = new THREE.Group();
  // Density samples permanent sites, never changes their geometry or reallocates
  // a neighbouring cohort's slots. This saturating display prior is not field LAI.
  // Main-stem seedling leaves retain the complete alternate sequence.
  const densityPresence=1-Math.pow(1-density/2,4);
  function siteSample(id:string,salt:number) {let key=seed*113+salt;for(const c of id)key=Math.imul(key^c.charCodeAt(0),16777619);return rng(key)();}
  group.name = `plant:ginkgo:natural:${seed}`;
  group.userData.reproduction = "not-modeled: sex and reproductive maturity require independent observations";
  const stageLabel = age < .02 ? "种子 · 地下子叶" : age < .12 ? "萌发 · 胚根与芽" : age < 2 ? "幼苗 · 初生茎与真叶" : age < 20 ? "幼树 · 长短枝建立" : age < 100 ? "成树 · 冠层展开" : "老龄 · 持续增粗";
  group.userData.stageLabel = stageLabel;
  const leafPresence = smooth(65, 105, day) * (1 - smooth(320, 350, day));
  const autumn = smooth(266, 312, day), maturity = smooth(4, 50, age);
  const heightAt = (a:number) => a < 1 ? (.025 + .42 * a) * smooth(.035,.12,a) : .445 + 13.5 * (1 - Math.exp(-(a - 1) / 25));
  const h = heightAt(age);
  group.userData.priors = { calibration: "uncalibrated-engineering-prior", source: "Flora of China / USDA morphology; growth curves not empirical age/DBH data" };
  // Primary emergence starts from zero length AND cross-section. Thereafter
  // the fixed material centreline extends distally; secondary thickening only
  // changes radii, never stretches established material nodes.
  const emerged = smooth(.035, .12, age);
  const radius = (age < 1 ? .001 + .003 * age : .004 + .25 * (1 - Math.exp(-(age - 1) / 42))) * emerged;
  const branches: BranchJoint[] = [], textures: THREE.Texture[] = [], geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  let leafCount = 0;
  function ownGeometry<T extends THREE.BufferGeometry>(g: T) { geometries.add(g); return g; }
  function ownMaterial<T extends THREE.Material>(m: T) { materials.add(m); return m; }
  function texture(width: number, height: number, pixels: Uint8Array) {
    const t = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter=THREE.LinearFilter; t.minFilter=THREE.LinearMipmapLinearFilter; t.generateMipmaps=true; t.anisotropy=4; t.needsUpdate = true; textures.push(t); return t;
  }
  // Deterministic elongated fissures and fine grain. Standard material shader uses
  // this generated texture for both bark pigment and micro-normal bump response.
  const bw = 128, bh = 512, barkPixels = new Uint8Array(bw * bh * 4), barkRng = rng(seed * 271 + 5);
  const furrows = Array.from({ length: 21 }, (_, i) => ({ x: i / 21 + (barkRng() - .5) * .025, phase: barkRng() * 6.28, depth: .3 + barkRng() * .4 }));
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    let crack = 0; const u = x / bw, v = y / bh;
    for (const f of furrows) { const line = f.x + Math.sin(v * 11 + f.phase) * .008 + Math.sin(v * 39 + f.phase) * .002; const d = Math.min(Math.abs(u - line), Math.abs(u - line - 1), Math.abs(u - line + 1)); crack = Math.max(crack, (1 - smooth(.0015, .009, d)) * f.depth * (.45 + .55 * smooth(-.8, .5, Math.sin(v * 19 + f.phase)))); }
    const grain = barkRng() * .15 + Math.sin(u * 620 + Math.sin(v * 30)) * .035, shade = .91 + grain - crack;
    const o = (y * bw + x) * 4; barkPixels[o] = 137 * shade; barkPixels[o + 1] = 127 * shade; barkPixels[o + 2] = 107 * shade; barkPixels[o + 3] = 255;
  }
  const barkTexture = texture(bw, bh, barkPixels);
  const bark = ownMaterial(new THREE.MeshStandardMaterial({ color: "#c0b59e", map: barkTexture, bumpMap: barkTexture, bumpScale: .008 * smooth(1, 30, age) + .0003, roughness: .96 }));
  const twigMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: age < 1 ? "#7c8d48" : "#8a7955", roughness: .83 }));
  const petioleMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(.23 - autumn * .10, .44, .41), roughness: .8 }));
  const budMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: "#6d4b32", roughness: .91 }));
  const seedMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: "#c4ac79", roughness: .91 }));
  const leafGeometry = ownGeometry(naturalFanBlade());
  // Dichotomous leaf veins: each radial segment splits into two toward the margin.
  const vw = 128, vh = 128, veinPixels = new Uint8Array(vw * vh * 4), veins: number[][] = [];
  function vein(a: number, radiusA: number, radiusB: number, depth: number) {
    const x0 = .5 + Math.sin(a) * radiusA, y0 = Math.cos(a) * radiusA, x1 = .5 + Math.sin(a) * radiusB, y1 = Math.cos(a) * radiusB; veins.push([x0,y0,x1,y1]);
    if (depth > 0) { const split = .085 / (4 - depth); vein(a - split, radiusB, Math.min(1.05, radiusB + .22), depth - 1); vein(a + split, radiusB, Math.min(1.05, radiusB + .22), depth - 1); }
  }
  for (let i = -5; i <= 5; i++) vein(i * .17, .015, .30, 3);
  for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) {
    const px = x / vw, py = y / vh; let distance = 1;
    for (const [ax,ay,bx,by] of veins) { const dx = bx-ax, dy=by-ay, t=clamp(((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)); distance=Math.min(distance,Math.hypot(px-ax-t*dx,py-ay-t*dy)); }
    const line = 1 - smooth(.002, .008, distance), shade = 1 - .10 * line + .012 * Math.sin(x * 1.8 + y * .4); const o=(y*vw+x)*4; veinPixels[o]=238*shade; veinPixels[o+1]=249*shade; veinPixels[o+2]=211*shade; veinPixels[o+3]=255;
  }
  const leafTexture = texture(vw, vh, veinPixels); leafTexture.wrapS = leafTexture.wrapT = THREE.ClampToEdgeWrapping;
  // A small diffuse-through-leaf approximation keeps the unlit back of a thin
  // blade readable; it is not a calibrated spectral transmission material.
  const leafMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: "#ffffff", map: leafTexture, side: THREE.DoubleSide, roughness: .73,
    emissive: new THREE.Color().setHSL(.265-autumn*.145,.44,.24,THREE.SRGBColorSpace), emissiveIntensity: .13 }));
  const unitPetiole = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 4, 1));
  const unitBud = ownGeometry(new THREE.SphereGeometry(1, 6, 4));
  const dummy = new THREE.Object3D(), color = new THREE.Color();

  function tube(curve: THREE.CatmullRomCurve3, r: number, tipR: number, segments = 13, sides = 7) {
    const frames = curve.computeFrenetFrames(segments, false), positions:number[]=[], uv:number[]=[], indices:number[]=[];
    const length = curve.getLength();
    for(let i=0;i<=segments;i++) { const t=i/segments, p=curve.getPointAt(t), rr=tipR+(r-tipR)*Math.pow(1-t,.88);
      for(let j=0;j<=sides;j++) {const a=j/sides*Math.PI*2, irregular=1+.035*Math.sin(j*5.1+i*.7); const n=frames.normals[i].clone().multiplyScalar(Math.cos(a)*rr*irregular).addScaledVector(frames.binormals[i],Math.sin(a)*rr*irregular);positions.push(p.x+n.x,p.y+n.y,p.z+n.z);uv.push(j/sides,t*Math.max(.18,length)*1.8);if(i<segments&&j<sides){const v=i*(sides+1)+j;indices.push(v,v+sides+1,v+1,v+1,v+sides+1,v+sides+2);}}
    }
    const g = new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return tagWoodTube(g,segments,sides);
  }
  function mergeGeometries(parts: THREE.BufferGeometry[]) {
    return ownGeometry(mergeWoodGeometries(parts));
  }
  function meshParts(parent:THREE.Object3D,parts:THREE.BufferGeometry[],mat:THREE.Material) {if(!parts.length)return;const mesh=new THREE.Mesh(mergeGeometries(parts),mat);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);}
  // An extending axis reveals more of a fixed material centreline. Scaling a
  // complete curve by today's length would move every previously formed node.
  function axisPoint(y:number,phase:number,target=new THREE.Vector3()) {const fade=smooth(0,.2,y);return target.set(.045*y+.015*Math.sin(y*1.7+phase)*fade,y,.018*Math.sin(y*1.1)*Math.sin(phase));}
  function curveFor(length:number, _bend:number, phase:number) {
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(),new THREE.Vector3(0,length,0)]);
    curve.arcLengthDivisions=32;
    curve.getPoint=(t:number,target=new THREE.Vector3())=>axisPoint(t*length,phase,target);
    return curve;
  }
  function branchJoint(parent:THREE.Object3D,pos:THREE.Vector3,dir:THREE.Vector3,length:number,r:number,order:number,key:number) {
    const pivot=new THREE.Group();pivot.position.copy(pos);pivot.quaternion.setFromUnitVectors(UP,dir.clone().normalize());parent.add(pivot);
    const j:BranchJoint={pivot,rest:pivot.quaternion.clone(),length,radius:r,order,phase:rng(key)()*6.28,flexibility:clamp(.003*Math.pow(length/Math.max(.002,r),1.05),.02,1.25),sag:Math.min(.12,length*.027*(order+1))};branches.push(j);return pivot;
  }
  type LeafRecord={matrix:THREE.Matrix4;petiole:THREE.Matrix4;tone:number;nodeId?:string};
  type FillSite={curve:THREE.CatmullRomCurve3;frame:THREE.Matrix4;scale:number;up:THREE.Vector3;key:number;axis:number;index:number;fraction:number};
  type PendingCanopy={parent:THREE.Group;wood:THREE.BufferGeometry[];fine:THREE.BufferGeometry[];records:LeafRecord[];buds:THREE.Matrix4[];sites:FillSite[]};
  const pendingCanopies:PendingCanopy[]=[];
  const leafPosition=leafGeometry.attributes.position,leafIndex=leafGeometry.index;
  const areaA=new THREE.Vector3(),areaB=new THREE.Vector3(),areaC=new THREE.Vector3();let bladeAreaM2=0;
  for(let i=0;i<(leafIndex?leafIndex.count:leafPosition.count);i+=3){areaA.fromBufferAttribute(leafPosition,leafIndex?leafIndex.getX(i):i);areaB.fromBufferAttribute(leafPosition,leafIndex?leafIndex.getX(i+1):i+1);areaC.fromBufferAttribute(leafPosition,leafIndex?leafIndex.getX(i+2):i+2);bladeAreaM2+=areaB.sub(areaA).cross(areaC.sub(areaA)).length()*.5;}
  function recordArea(record:LeafRecord){const e=record.matrix.elements;return bladeAreaM2*Math.hypot(e[0],e[1],e[2])*Math.hypot(e[4],e[5],e[6]);}
  let visibleLeafAreaM2=0;
  function foliageBatch(parent:THREE.Object3D,records:LeafRecord[],buds:THREE.Matrix4[]) {
    const visible=records.filter(record=>siteSample(record.nodeId??'',0)<leafPresence); if(visible.length) {
      const leaves=new THREE.InstancedMesh(leafGeometry,leafMaterial,visible.length),petioles=new THREE.InstancedMesh(unitPetiole,petioleMaterial,visible.length);
      leaves.userData.organ=petioles.userData.organ="leaf";leaves.userData.connectedBy="petiole";leaves.castShadow=leaves.receiveShadow=true;
      leaves.userData.nodeIds=visible.map(l=>l.nodeId??null);
      visible.forEach((l,i)=>{leaves.setMatrixAt(i,l.matrix);petioles.setMatrixAt(i,l.petiole);color.setHSL(.265-autumn*.145+l.tone*.018,.50+autumn*.25,.31+autumn*.23+l.tone*.06,THREE.SRGBColorSpace);leaves.setColorAt(i,color);visibleLeafAreaM2+=recordArea(l);});
      leaves.instanceMatrix.needsUpdate=true;petioles.instanceMatrix.needsUpdate=true;parent.add(petioles,leaves);leafCount+=visible.length;
    }
    if(buds.length){const bm=new THREE.InstancedMesh(unitBud,budMaterial,buds.length);bm.userData.organ="bud";buds.forEach((m,i)=>bm.setMatrixAt(i,m));parent.add(bm);}
  }
  function bladeRotation(direction: THREE.Vector3, roll: number, surfaceUp: THREE.Vector3) {
    // The blade's +Y axis extends out from its petiole. Its normal is biased toward
    // the sky, instead of rolling every fan into a vertical, needle-like plane.
    const normal = surfaceUp.clone().addScaledVector(direction, -surfaceUp.dot(direction)).normalize();
    if (normal.lengthSq() < .01) normal.set(0, 0, 1);
    const widthAxis = new THREE.Vector3().crossVectors(direction, normal).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(widthAxis, direction, normal))
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
  }
  function appendLeaf(records: LeafRecord[], attachment: THREE.Vector3, direction: THREE.Vector3, petioleLength: number, scale: number, roll: number, tone: number, surfaceUp: THREE.Vector3 = UP,nodeId?:string) {
    if(scale<1e-7||!nodeId||(!nodeId.startsWith("stem-")&&siteSample(nodeId,104729)>=densityPresence))return;
    const bladeBase = attachment.clone().addScaledVector(direction, petioleLength);
    dummy.position.copy(bladeBase); dummy.quaternion.copy(bladeRotation(direction, roll, surfaceUp)); dummy.scale.setScalar(scale); dummy.updateMatrix();
    const matrix = dummy.matrix.clone();
    dummy.position.copy(attachment).lerp(bladeBase, .5); dummy.quaternion.setFromUnitVectors(UP, direction);
    dummy.scale.set(.00048 * Math.max(.15, scale), petioleLength, .00048 * Math.max(.15, scale)); dummy.updateMatrix();
    records.push({ matrix, petiole: dummy.matrix.clone(), tone,nodeId });
  }
  // Exactly the same stable random draw is used in reservation and generation.
  // Capacity is independent of age/density; compressed leaf nodes cannot move
  // when another site becomes visible. Eight blades is an uncalibrated capacity
  // prior, not a measured leaf count on a campus spur.
  function spurLeafCount(key:number,s:number) {
    const rr=rng(key+s*12289);rr();rr();rr();rr();
    return Math.max(2,Math.round(5+rr()*3));
  }
  function spurCapacity(key:number,n:number) {let count=0;for(let s=0;s<n;s++)count+=spurLeafCount(key,s);return count;}
  function spreadSpurSlots(key:number,n:number) {
    // Reserve complete compressed spur modules across the FULL fixed catalogue,
    // not the currently formed/visible prefix. Start near opposite fifths, with
    // a stable reflection to avoid favouring either end when only one module
    // fits. Fill the remaining gaps in farthest-point order. The last reserved
    // module may be partial; neither density nor age can reassign its slots.
    const low=Math.floor((n-1)*.2),order=[low];
    if(n>1)order.push(n-1-low);
    if(rng(key+15485863)()<.5)order.reverse();
    while(order.length<n) {
      let next=-1,gap=-1;
      for(let s=0;s<n;s++)if(!order.includes(s)) {
        const distance=Math.min(...order.map(other=>Math.abs(s-other)));
        if(distance>gap){gap=distance;next=s;}
      }
      order.push(next);
    }
    const starts=new Array<number>(n);let slot=0;
    for(const s of order){starts[s]=slot;slot+=spurLeafCount(key,s);}
    return starts;
  }
  function shortShoots(curve:THREE.CatmullRomCurve3,frame:THREE.Matrix4,wood:THREE.BufferGeometry[],records:LeafRecord[],buds:THREE.Matrix4[],key:number,idPrefix:string,n:number,leafScale:number,surfaceUp: THREE.Vector3 = UP,axisFraction=1,leafSlotBudget=Infinity) {
    const shootCount=Math.max(1,Math.round(n)), axisLength=curve.getLength();
    const spreadSlots=Number.isFinite(leafSlotBudget)?spreadSpurSlots(key,shootCount):null;let slot=0;
    for(let s=0;s<shootCount;s++) {
      const rr=rng(key+s*12289),leafN=spurLeafCount(key,s),siteSlot=spreadSlots?.[s]??slot;slot+=leafN;
      const t=.09+(s+.3+rr()*.35)/shootCount*.88;
      const nodeGrowth=smooth((s+.15)*.030,(s+.85)*.045,axisLength)*smooth(t,t+.05,axisFraction);
      const shootScale=leafScale*nodeGrowth;if(shootScale<1e-7)continue;
      const anchor=curve.getPointAt(t).applyMatrix4(frame),tangent=curve.getTangentAt(t).transformDirection(frame);
      const az=rr()*6.28,outward=new THREE.Vector3(Math.cos(az)*.55,.12,Math.sin(az)*.55).addScaledVector(surfaceUp,.70+rr()*.25).normalize();
      // Ginkgo spur shoots have very short internodes. Leaves attach at successive
      // compressed nodes rather than all radiating from one floating rosette centre.
      const targetLength=.006+rr()*.013,targetEnd=anchor.clone().addScaledVector(outward,targetLength);
      const fullShoot=new THREE.CatmullRomCurve3([anchor,anchor.clone().lerp(targetEnd,.5).addScaledVector(tangent,.0015),targetEnd]);
      const end=fullShoot.getPoint(shootScale),shootCurve=new THREE.CatmullRomCurve3([anchor,end]);
      shootCurve.getPoint=(t:number,target=new THREE.Vector3())=>fullShoot.getPoint(t*shootScale,target);
      shootCurve.arcLengthDivisions=4;
      wood.push(tube(shootCurve,.0018*shootScale,.0007*shootScale,3,4));
      dummy.position.copy(end);dummy.quaternion.setFromUnitVectors(UP,outward);dummy.scale.set(.0013*shootScale,.0025*shootScale,.0013*shootScale);dummy.updateMatrix();if(shootScale>.015)buds.push(dummy.matrix.clone());
      rr(); // consume the same leaf-count draw used by spurLeafCount
      for(let l=0;l<leafN;l++) {
        if(siteSlot+l>=leafSlotBudget)break;
        const theta=az+l*2.39996+(rr()-.5)*.35;
        const direction=new THREE.Vector3(Math.cos(theta),.08+rr()*.42,Math.sin(theta)).normalize();
        const nodeT=.22+.72*(l+.5)/leafN,expansion=smooth(nodeT,nodeT+.06,shootScale),attachment=fullShoot.getPoint(nodeT);
        appendLeaf(records,attachment,direction,(.024+rr()*.018)*shootScale*expansion,shootScale*expansion*(.82+rr()*.22),(rr()-.5)*2.2,rr()-.5,surfaceUp,`${idPrefix}/spur:${s}/leaf:${l}`);
      }
    }
  }

  // Storage cotyledons remain inside this buried seed; no green aerial cotyledons.
  if(age < .65) {const seedGroup=new THREE.Group();seedGroup.position.set(0,-.018,0);seedGroup.userData.organ="seed";group.add(seedGroup);
    const geometry=ownGeometry(new THREE.SphereGeometry(1,16,10));const coat=new THREE.Mesh(geometry,seedMaterial);coat.scale.set(.015,.019,.011);coat.rotation.z=.14;seedGroup.add(coat);
    const seam=new THREE.Mesh(ownGeometry(new THREE.TorusGeometry(.0135,.00055,4,32)),budMaterial);seam.rotation.y=Math.PI/2;seam.scale.y=1.35;seedGroup.add(seam);
    if(age>.07)seedGroup.scale.setScalar(1-smooth(.25,.65,age)*.7);
  }
  if(h > 0) {
    const leader=branchJoint(group,new THREE.Vector3(),UP,h,radius,0,seed);
    const trunkCurve=curveFor(h,0,seed*.13);
    const trunk=new THREE.Mesh(ownGeometry(tube(trunkCurve,radius*1.35,Math.max(.001*emerged,radius*.055),Math.max(12,Math.round(h*4)),12)),age<1?twigMaterial:bark);trunk.castShadow=trunk.receiveShadow=true;leader.add(trunk);
    const majorCount=21, leafScale=Math.min(1,.24+smooth(.075,1.5,age)*.76);
    const trueLeaves=smooth(.075,.16,age), initialPhase=rng(seed*211)()*Math.PI*2;
    // Ginkgo seedlings carry primary-stem leaves, but an established tree does
    // not keep a ladder of blades intersecting the trunk. Lower stem cohorts
    // senesce as persistent crown axes establish; the wood and leaf-scar nodes
    // remain in the material catalogue. The cutoff retains only the apical
    // short-shoot cohort during the transition.
    const stemLeafRetention=1-smooth(1.8,3.5,age);
    group.userData.stemLeafPhenology={juvenileRetentionYears:[0,1.8],senescenceYears:[1.8,3.5],retention:stemLeafRetention,stemSpurCutoffIndex:74,state:stemLeafRetention>0.001?'juvenile_stem_leaves':'mature_stem_leaf_scar_only',calibration:'engineering prior; campus leaf-scar survey pending'};
    // Persistent stem nodes: lower nodes are born first, at their height at birth.
    // The active leader always carries alternate leaves; second-year axils form spurs.
    const records:LeafRecord[]=[], buds:THREE.Matrix4[]=[], fine:THREE.BufferGeometry[]=[];
    for(let i=0;i<80;i++) {
      const birth=.08+i*.075+i*i*.007, nodeAge=age-birth;
      if(nodeAge<=0)break;
      const materialY=heightAt(birth)*.96, angle=initialPhase+i*2.39996;
      const attachment=axisPoint(materialY,seed*.13), expansion=smooth(0,.12,nodeAge)*trueLeaves;
      // Retain established organs in the age-driven foliage proxy, as on the
      // lateral axes. No light-competition/abscission event is solved here:
      // scaling lower leaves by their fraction of today's height erased real
      // petioles/blades (and later spur leaves) at five years. Seasonal loss
      // remains controlled independently by day/leafPresence.
      const direction=new THREE.Vector3(Math.cos(angle),.18,Math.sin(angle)).normalize();
      appendLeaf(records,attachment,direction,.032*expansion,leafScale*expansion*stemLeafRetention,.12*Math.sin(i*2.1),rng(seed+i*113)()-.5,UP,`stem-leaf:${i}`);
      const spurGrowth=smooth(.85,1.8,nodeAge);
      if(spurGrowth>.001) {
        const end=attachment.clone().addScaledVector(direction,.014*spurGrowth);
        const spur=new THREE.CatmullRomCurve3([attachment,attachment.clone().lerp(end,.5),end]);
        spur.arcLengthDivisions=4;
        // Leaves start on the actual woody spur, not an offset rosette centre.
        fine.push(tube(spur,.0014*spurGrowth,.0005*spurGrowth,3,4));
        for(let l=0;l<5;l++) {
          const a=angle+l*2.39996, d=new THREE.Vector3(Math.cos(a),.18,Math.sin(a)).normalize();
          const nodeT=.2+l*.16,expansion=smooth(nodeT,nodeT+.08,spurGrowth),fixedNode=attachment.clone().addScaledVector(direction,.014*nodeT);
          appendLeaf(records,fixedNode,d,.032*spurGrowth*expansion,leafScale*spurGrowth*expansion*stemLeafRetention,.1*Math.sin(l),0,UP,`stem-spur:${i}:${l}`);
        }
      }
    }
    leader.userData.phyllotaxis="spiral alternate long shoots; second-year axillary clustered short shoots";
    pendingCanopies.push({parent:leader,wood:[],fine,records,buds,sites:[]});
    for(let i=0;i<majorCount;i++) {
      const rr=rng(seed*104729+i*8191), baseBirth=4+i*1.10+i*i*.080;
      // Seeded individuals keep the same upward order, but their bud-break
      // timing is not identical. The small bounded jitter is a procedural
      // prior for light, vigour and microsite differences; it is not field
      // calibration and never allows a later node to precede an earlier one.
      const birth=baseBirth+(rr()-.5)*.08, branchAge=age-birth;
      // A fixed birth-time vigour prior: later scaffold axes extend more slowly
      // as leader production slows. Existing axes are never clipped to a moving
      // crown envelope. All child births use this same developmental clock.
      // USDA constrains slender young / broader adult habit, not these durations.
      const primaryYears=7+birth/4,secondaryYears=primaryYears/2,twigYears=primaryYears/4;
      const growth=smooth(0,primaryYears,branchAge);if(growth<1e-7)continue;
      const anchor=axisPoint(heightAt(birth)*.96,seed*.13),attachT=anchor.y/h,az=initialPhase+i*2.39996+(rr()-.5)*.65;
      // Young pyramidal habit opens into an irregular broad ovoid; no radial tiers.
      const futureHeight=heightAt(birth+25),fixedFraction=heightAt(birth)/futureHeight;
      const inclination=clamp(.72+.65*(1-fixedFraction)+(rr()-.5)*.30,.55,1.48);
      const dir=new THREE.Vector3(Math.cos(az)*Math.sin(inclination),Math.cos(inclination),Math.sin(az)*Math.sin(inclination));
      const envelope=Math.pow(Math.sin(Math.PI*clamp((fixedFraction+.10)/1.15)),.7);
      const targetLength=Math.min(futureHeight*.46*envelope*(.80+rr()*.35),(futureHeight-anchor.y)/(dir.y+.85)),length=targetLength*growth;
      // There is no pruning, damage or competition solver: retain established
      // scaffold wood and its renewed seasonal foliage instead of retiring by age.
      const branchLeafScale=leafScale*smooth(0,.35,branchAge);
      const r=radius*(.21+rr()*.12)*Math.sqrt(growth)*Math.pow(1-attachT,.55);
      const pivot=branchJoint(leader,anchor,dir,length,r,1,seed*104729+i*911+7);
      pivot.userData.node={birth,attachment:anchor.toArray(),attachT};pivot.userData.axisId=`primary:${i}`;
      const canopyUp=UP.clone().applyQuaternion(pivot.quaternion.clone().invert());
      const primary=curveFor(length,0,az),fullPrimary=curveFor(targetLength,0,az);
      const wood:THREE.BufferGeometry[]=[tube(primary,r,Math.max(.00005,r*.045),16,8)],fine:THREE.BufferGeometry[]=[],records:LeafRecord[]=[],buds:THREE.Matrix4[]=[],sites:FillSite[]=[];
      // Alternate leaves on long shoots persist at the distal extension, including
      // first-year branches; short shoots wait until their second growing year.
      for(let n=0;n<12;n++) {
        const t=.12+n*.077, a=az+n*2.39996, d=new THREE.Vector3(Math.cos(a),.18,Math.sin(a)).normalize();
        const expansion=smooth(t,t+.05,growth);
        appendLeaf(records,fullPrimary.getPoint(t),d,.035*expansion,branchLeafScale*expansion,.1*Math.sin(n),0,canopyUp,`primary:${i}:long:${n}`);
      }
      const spurScale=branchLeafScale*smooth(.85,1.7,branchAge);
      if(spurScale>.001)shortShoots(fullPrimary,new THREE.Matrix4(),fine,records,buds,seed+i*4049,`primary:${i}`,16,spurScale,canopyUp,growth);
      const secondCount=9;
      for(let b=0;b<secondCount;b++) {
        const sr=rng(seed*617+i*1013+b*197), st=.15+(b+.2+sr()*.55)/secondCount*.80;
        const secondOnset=.9+st*primaryYears,secondAge=branchAge-secondOnset, sg=smooth(0,secondaryYears,secondAge);if(sg<1e-7)continue;
        const start=fullPrimary.getPoint(smooth(0,primaryYears,secondOnset)*.85),phi=b*2.39996+(sr()-.5)*1.1;
        const secondaryTarget=targetLength*(.22+sr()*.25)*(1-st*.40),slen=secondaryTarget*sg;
        const sdir=new THREE.Vector3(Math.cos(phi)*.85,.36+sr()*.60,Math.sin(phi)*.85).normalize(),sq=new THREE.Quaternion().setFromUnitVectors(UP,sdir),frame=new THREE.Matrix4().compose(start,sq,new THREE.Vector3(1,1,1));
        const secondary=curveFor(slen,0,phi),fullSecondary=curveFor(secondaryTarget,0,phi);
        wood.push(tube(secondary,r*.30*Math.sqrt(sg),Math.max(.00002,r*.018*sg),10,6).applyMatrix4(frame));
        const secondaryScale=branchLeafScale*smooth(0,.45,secondAge);
        for(let n=0;n<7;n++) {
          const a=phi+n*2.39996,d=new THREE.Vector3(Math.cos(a),.2,Math.sin(a)).normalize().applyQuaternion(sq);
          const t=.30+n*.10,expansion=smooth(t,t+.06,sg);
          appendLeaf(records,fullSecondary.getPoint(t).applyMatrix4(frame),d,.032*expansion,secondaryScale*expansion,.1*Math.sin(n),0,canopyUp,`primary:${i}/secondary:${b}:long:${n}`);
        }
        if(secondAge>.85)shortShoots(fullSecondary,frame,fine,records,buds,seed+i*7027+b*997,`primary:${i}/secondary:${b}`,12,secondaryScale*smooth(.85,1.7,secondAge),canopyUp,sg);
        for(let c=0;c<4;c++) {
          const tr=rng(seed*53+i*2131+b*313+c*79),tt=.22+(c+.3+tr()*.3)/4*.70;
          const twigOnset=.8+tt*secondaryYears,twigAge=secondAge-twigOnset,tg=smooth(0,twigYears,twigAge);if(tg<1e-7)continue;
          const origin=fullSecondary.getPoint(smooth(0,secondaryYears,twigOnset)*.85).applyMatrix4(frame),ta=phi+c*2.37+(tr()-.5)*1.2;
          const localDirection=new THREE.Vector3(Math.cos(ta)*.83,.35+tr()*.65,Math.sin(ta)*.83).normalize().applyQuaternion(sq);
          const tq=new THREE.Quaternion().setFromUnitVectors(UP,localDirection),tf=new THREE.Matrix4().compose(origin,tq,new THREE.Vector3(1,1,1));
          const twigTarget=secondaryTarget*(.30+tr()*.32),tl=twigTarget*tg,twig=curveFor(tl,0,ta),fullTwig=curveFor(twigTarget,0,ta),twigScale=secondaryScale*smooth(0,.4,twigAge);
          fine.push(tube(twig,r*.09*Math.sqrt(sg*tg),.0003*tg,6,5).applyMatrix4(tf));
          for(let n=0;n<5;n++) {
            const a=ta+n*2.39996,d=new THREE.Vector3(Math.cos(a),.2,Math.sin(a)).normalize().applyQuaternion(tq);
            const t=.30+n*.13,expansion=smooth(t,t+.08,tg);
            appendLeaf(records,fullTwig.getPoint(t).applyMatrix4(tf),d,.03*expansion,twigScale*expansion,.1*Math.sin(n),0,canopyUp,`primary:${i}/secondary:${b}/twig:${c}:long:${n}`);
          }
          if(twigAge>.85)shortShoots(fullTwig,tf,fine,records,buds,seed+i*10007+b*127+c*23,`primary:${i}/secondary:${b}/twig:${c}`,7,twigScale*smooth(.85,1.7,twigAge),canopyUp,tg);
          sites.push({curve:fullTwig,frame:tf,scale:twigScale,up:canopyUp,key:seed+i*13007+b*521+c*37,axis:i,index:b*4+c,fraction:tg});
        }
      }
      pendingCanopies.push({parent:pivot,wood,fine,records,buds,sites});
    }
    const terminal=new THREE.Mesh(unitBud,budMaterial);terminal.name="terminal-bud";terminal.position.copy(trunkCurve.getPointAt(1));
    const budMaturity=smooth(.2,20,age),budRadius=.00065+.0018*budMaturity,budLength=.0025+.0055*budMaturity;
    terminal.scale.set(budRadius,budLength*.5,budRadius).multiplyScalar(emerged);terminal.userData.organ="bud";leader.add(terminal);
  }
  // Fixed identity budgets, established before any axes grow. Reserve the
  // actual stable base-spur counts, then partition the remainder among 36 sites
  // x 12 fine-shoot cohorts. No age-dependent area target evicts older sites.
  // 80 stem nodes x (one long-shoot leaf + five spur leaves) plus 21 axis
  // capacities bounds all seasons, densities and ages by 159,996 leaf sites.
  const maxLeafBudget=160000,perAxisLeafBudget=Math.floor((maxLeafBudget-80*6)/21);
  const fillBudgets=Array.from({length:21},(_,i)=>{
    let base=12+spurCapacity(seed+i*4049,16);
    for(let b=0;b<9;b++) {
      base+=7+spurCapacity(seed+i*7027+b*997,12);
      for(let c=0;c<4;c++)base+=5+spurCapacity(seed+i*10007+b*127+c*23,7);
    }
    const remaining=perAxisLeafBudget-base;
    return Array.from({length:36*12},(_,slot)=>Math.floor(remaining/(36*12))+(slot<remaining%(36*12)?1:0));
  });
  let totalFineCohorts=0;
  group.updateMatrixWorld(true);
  const projectedBox=new THREE.Box3(),leafPoint=new THREE.Vector3();let potentialArea=0,potentialCount=0;
  for(const canopy of pendingCanopies)for(const record of canopy.records){potentialArea+=recordArea(record);potentialCount++;}
  for(let cohort=0;cohort<12;cohort++)for(const canopy of pendingCanopies) {
    for(const site of canopy.sites){const fillRandom=rng(site.key+cohort*65537),t=.20+(cohort+.5)/12*.70;
      // A lateral cohort starts only after its own fixed material node forms,
      // rather than waiting for the entire parent twig to finish extending.
      const siteScale=site.scale*smooth(t+.04,t+.12,site.fraction);if(siteScale<1e-7)continue;
      const start=site.curve.getPointAt(t).applyMatrix4(site.frame),tangent=site.curve.getTangentAt(t).transformDirection(site.frame),az=fillRandom()*Math.PI*2+cohort*2.39996;
      const side=new THREE.Vector3(Math.cos(az),.12,Math.sin(az));const direction=tangent.clone().multiplyScalar(.25).addScaledVector(side,.78).addScaledVector(site.up,.38).normalize();
      const orientation=new THREE.Quaternion().setFromUnitVectors(UP,direction),frame=new THREE.Matrix4().compose(start,orientation,new THREE.Vector3(1,1,1));
      const targetLength=.075+site.curve.getLength()*(.20+fillRandom()*.14),length=targetLength*siteScale,twig=curveFor(length,0,az),fullTwig=curveFor(targetLength,0,az);
      // Fixed material-axis catalogue for inspecting allocation against the full
      // candidate extent, including portions which have not formed yet. Local to
      // this scaffold pivot; these endpoints are diagnostics, never leaf anchors.
      const idPrefix=`primary:${site.axis}/secondary:${Math.floor(site.index/4)}/twig:${site.index%4}/cohort:${cohort}`,candidateSpurs=Math.max(3,Math.round(targetLength/.045));
      (canopy.parent.userData.foliationAxes??=[]).push({idPrefix,candidateSpurs,formedFraction:siteScale,
        start:fullTwig.getPoint(0).applyMatrix4(frame).toArray(),end:fullTwig.getPoint(1).applyMatrix4(frame).toArray()});
      canopy.fine.push(tube(twig,.00115*siteScale,.00040*siteScale,4,4).applyMatrix4(frame));const before=canopy.records.length;
      shortShoots(fullTwig,frame,canopy.fine,canopy.records,canopy.buds,site.key+cohort*4231,idPrefix,candidateSpurs,siteScale,site.up,siteScale,fillBudgets[site.axis][site.index*12+cohort]);
      for(let i=before;i<canopy.records.length;i++)potentialArea+=recordArea(canopy.records[i]);potentialCount+=canopy.records.length-before;totalFineCohorts++;
    }
  }
  for(const canopy of pendingCanopies){meshParts(canopy.parent,canopy.wood,bark);meshParts(canopy.parent,canopy.fine,twigMaterial);foliageBatch(canopy.parent,canopy.records,canopy.buds);}
  // Re-evaluate the slightly expanded leaf-centre footprint after cohort growth.
  projectedBox.makeEmpty();for(const canopy of pendingCanopies)for(const record of canopy.records){leafPoint.setFromMatrixPosition(record.matrix).applyMatrix4(canopy.parent.matrixWorld);projectedBox.expandByPoint(leafPoint);}
  const finalSize=projectedBox.isEmpty()?new THREE.Vector3():projectedBox.getSize(new THREE.Vector3()),projectedCrownAreaM2=Math.PI*.25*(finalSize.x+.08)*(finalSize.z+.08);
  group.userData.canopyMetrics={oneSidedLeafAreaM2:visibleLeafAreaM2,potentialLeafAreaM2:potentialArea,projectedCrownAreaM2,
    crownBaseM:projectedBox.isEmpty()?0:projectedBox.min.y,crownTopM:projectedBox.isEmpty()?0:projectedBox.max.y,leaderHeightM:h,
    crownWidthM:finalSize.x+.08,crownDepthM:finalSize.z+.08,leafAreaRatio:projectedCrownAreaM2>.01?visibleLeafAreaM2/projectedCrownAreaM2:0,targetAreaRatio:2.8*density,potentialLeafCount:potentialCount,
    connectedFineShootCohorts:totalFineCohorts,maxLeafBudget,lifetimeLeafSiteCapacity:80*6+21*perAxisLeafBudget,densityPresence,
    allocation:"fixed material-site identities; complete-catalogue spur spread; targetAreaRatio is diagnostic only",calibration:"uncalibrated engineering estimate; one-sided mesh area / ellipse of leaf-centre bounds; not measured stand LAI"};
  group.traverse(o=>{if(!o.userData.organ&&o.parent?.userData.organ)o.userData.organ=o.parent.userData.organ;});group.updateMatrixWorld(true);
  const gravityFrames=branches.map(j=>{const down=new THREE.Vector3(0,-1,0).applyQuaternion(j.pivot.getWorldQuaternion(new THREE.Quaternion()).invert()),axis=new THREE.Vector3().crossVectors(UP,down),perpendicular=axis.length();if(perpendicular>1e-8)axis.multiplyScalar(1/perpendicular);else axis.set(1,0,0);return{axis,perpendicular};});
  const gr=new THREE.Quaternion(),wr=new THREE.Quaternion(),euler=new THREE.Euler();
  function update(time:number,wind:number,gravity:number,stiffness:number){const speed=clamp(wind,0,25),rigid=Math.max(.1,stiffness),area=.24+.76*leafPresence*density;
    branches.forEach((j,i)=>{const load=speed*speed*.00023*j.flexibility/rigid*area,osc=Math.sin(time*(.9+j.order*.47)+j.phase)*.65+Math.sin(time*.43+j.phase*.7)*.35,bend=Math.min(.16,load)*(.65+osc*.35),sag=Math.min(.13,j.sag*clamp(gravity,0,30)/9.81/rigid*gravityFrames[i].perpendicular);gr.setFromAxisAngle(gravityFrames[i].axis,sag);euler.set(bend*.42,0,-bend);wr.setFromEuler(euler);j.pivot.quaternion.copy(j.rest).multiply(gr).multiply(wr);});
  }
  function dispose(){group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear();}
  const box=new THREE.Box3().setFromObject(group);return{group,branches,leafCount,height:geometryHeight(group),stageLabel,update,dispose};
}

export function naturalFanBlade(segments=24,radialRings=1):THREE.BufferGeometry {
  if(radialRings>1){
    const positions=[0,0,0],uvs=[.5,0],indices:number[]=[];
    for(let ring=1;ring<=radialRings;ring++)for(let i=0;i<=segments;i++){
      const a=.12*Math.PI+i/segments*.76*Math.PI,r=.041-.0065*Math.exp(-Math.pow((a-Math.PI/2)/.07,2))+Math.sin(a*31)*.00065,t=ring/radialRings,x=Math.cos(a)*r*t,y=Math.sin(a)*r*t;
      positions.push(x,y,.0022*Math.sin(y/.041*Math.PI)-.0017*Math.pow(x/.04,2));uvs.push(.5+x/.084,y/.044);
      if(ring===1&&i<segments)indices.push(0,1+i,2+i);
      if(ring<radialRings&&i<segments){const k=1+(ring-1)*(segments+1)+i,next=k+segments+1;indices.push(k,next,next+1,k,next+1,k+1);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;
  }
  const shape=new THREE.Shape();shape.moveTo(0,0);
  const radius=.041;for(let i=0;i<=segments;i++){const a=.12*Math.PI+i/segments*.76*Math.PI,notch=.0065*Math.exp(-Math.pow((a-Math.PI/2)/.07,2)),r=radius-notch+Math.sin(a*31)*.00065;shape.lineTo(Math.cos(a)*r,Math.sin(a)*r);}shape.lineTo(0,0);
  const g=new THREE.ShapeGeometry(shape,12),p=g.attributes.position,uv=g.attributes.uv;
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);p.setZ(i,.0022*Math.sin(y/radius*Math.PI)-.0017*Math.pow(x/.04,2));uv.setXY(i,.5+x/.084,y/.044);}
  g.computeVertexNormals();return g;
}
