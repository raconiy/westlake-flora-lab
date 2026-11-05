import * as THREE from "three";
// @ts-ignore Explicit suffix is required by the native Node TypeScript test runner.
import { osmanthusLifecycle, osmanthusPriors } from "./osmanthus-lifecycle.ts";

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
  return new THREE.ShapeGeometry(s, 10);
}
function petalGeometry(length: number, width: number, bend: number) {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(width, length * .24, width, length * .96, 0, length); s.bezierCurveTo(-width, length * .96, -width, length * .24, 0, 0);
  const g = new THREE.ShapeGeometry(s, 14); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, bend * Math.pow(p.getY(i) / length, 2));
  g.computeVertexNormals(); return g;
}
function bladeGeometry(length: number, width: number, lean: number, yaw: number) {
  const points: number[] = [], indices: number[] = []; const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n, w = width * Math.pow(Math.sin(Math.PI * t), .65) * .5;
    const y = length * (t - .24 * t * t * Math.abs(lean)); const x = lean * length * t * t;
    for (let j = 0; j < 3; j++) { const z = (j - 1) * w; points.push(x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)); }
    if (i < n) for (let j = 0; j < 2; j++) { const a = i * 3 + j; indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3)); g.setIndex(indices); g.computeVertexNormals(); return g;
}

export function buildPlant(species: PlantSpecies, params: PlantParams): PlantModel {
  const natural = species === "ginkgo" ? buildNaturalGinkgo(params) : null;
  if (natural) return natural;
  const age = Math.max(0, Number.isFinite(params.age) ? params.age : 12), day = clamp(params.day, 1, 365);
  const density = clamp(params.density, .15, 2); const random = rng(params.seed || 1);
  const group = new THREE.Group(); group.name = `plant:${species}:seed:${params.seed}`;
  const branches: BranchJoint[] = []; let leafCount = 0;
  const bark = new THREE.MeshStandardMaterial({ color: species === "ginkgo" ? "#786950" : "#6e6d53", roughness: .96 });
  const youngBark = new THREE.MeshStandardMaterial({ color: "#8e9270", roughness: .9 });
  const foliage = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: .76, side: THREE.DoubleSide });
  const stemMat = new THREE.MeshStandardMaterial({ color: "#637a3d", roughness: .9 });
  const materials: THREE.Material[] = [bark, youngBark, foliage, stemMat];
  const col = new THREE.Color();
  const extraGeometries: THREE.BufferGeometry[] = [];
  const leafGeometry = species === "ginkgo" ? fanGeometry() : species === "osmanthus" ? ovalGeometry() : heartGeometry();
  const leafPresence = species === "ginkgo" ? smooth(65, 105, day) * (1 - smooth(320, 350, day)) : 1;

  function cylinder(parent: THREE.Object3D, length: number, radius: number, endRadius: number, material = bark) {
    if (length < .0001) return;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(species === "osmanthus" ? 1e-9 : .00025, endRadius), Math.max(species === "osmanthus" ? 1e-9 : .0003, radius), length, radius > .04 ? 10 : 6, 1), material);
    mesh.position.y = length / 2; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function joint(parent: THREE.Object3D, pos: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number, order: number, phaseKey?: number) {
    const pivot = new THREE.Group(); pivot.position.copy(pos); pivot.quaternion.setFromUnitVectors(UP, direction.clone().normalize()); parent.add(pivot);
    const rest = pivot.quaternion.clone();
    const flexibility = clamp(.004 * Math.pow(length / Math.max(radius, .003), 1.12), .04, 1.7) * (.45 + order * .22);
    const j: BranchJoint = { pivot, rest, length, radius, order, phase: (phaseKey === undefined ? random() : rng(phaseKey)()) * Math.PI * 2, flexibility, sag: Math.min(.15, length * .035 * (order + 1)) };
    branches.push(j); cylinder(pivot, length, radius, radius * .49, order > 2 ? youngBark : bark); return pivot;
  }
  function direction(theta: number, inclination: number) { return new THREE.Vector3(Math.cos(theta) * Math.sin(inclination), Math.cos(inclination), Math.sin(theta) * Math.sin(inclination)); }

  let stageLabel: string | undefined;
  if (species === "osmanthus") {
    const life = osmanthusLifecycle(age), h = life.height, r = life.radius;
    stageLabel = life.stageLabel;
    group.userData = { stageLabel, lifecycle: life, priors: osmanthusPriors,
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
    function segmentMatrix(start: THREE.Vector3, end: THREE.Vector3, radius: number) {
      return new THREE.Matrix4().compose(start.clone().lerp(end, .5),
        new THREE.Quaternion().setFromUnitVectors(UP, end.clone().sub(start).normalize()),
        new THREE.Vector3(radius, start.distanceTo(end), radius));
    }
    function axisLeaves(parent: THREE.Group, length: number, birth: number, growth: number, nodeLimit: number, key: number) {
      const matrices: THREE.Matrix4[] = [], petioles: THREE.Matrix4[] = [];
      const nodes: { index: number; attachment: number[]; angle: number; scale: number }[] = [];
      const petals: THREE.Matrix4[] = [], peduncles: THREE.Matrix4[] = [], centers: THREE.Matrix4[] = [];
      const flowerSites: { node: number; side: number; center: number[]; attachment: number[]; orientation: number[] }[] = [];
      const nodeCount = Math.max(1, Math.round(nodeLimit * density));
      for (let n = 0; n < nodeCount; n++) {
        const onset = birth + .10 + n * .22, expansion = smooth(onset, onset + .20, age) * growth;
        if (expansion <= 0) continue;
        const attachment = new THREE.Vector3(0, length * (.16 + .76 * (n + .5) / nodeCount), 0);
        const theta = phase + n * Math.PI / 2;
        const scale = (.20 + .80 * smooth(.10, 2, age)) * expansion;
        nodes.push({ index: n, attachment: attachment.toArray(), angle: theta, scale });
        for (let side = 0; side < 2; side++) {
          // A single node, a single expansion factor, exactly opposite petioles;
          // the next node's pair rotates 90 degrees (decussate phyllotaxis).
          const angle = theta + side * Math.PI;
          const dir = new THREE.Vector3(Math.cos(angle), .23, Math.sin(angle)).normalize();
          const bladeBase = attachment.clone().addScaledVector(dir, .008 * scale);
          const normal = UP.clone().addScaledVector(dir, -UP.dot(dir)).normalize();
          const widthAxis = new THREE.Vector3().crossVectors(dir, normal).normalize();
          const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(widthAxis, dir, normal));
          matrices.push(new THREE.Matrix4().compose(bladeBase, q, new THREE.Vector3(scale, scale, scale)));
          petioles.push(segmentMatrix(attachment, bladeBase, .00055 * scale));
          if (bloom <= 0) continue;
          const fr = rng(key + n * 197 + side * 31);
          for (let f = 0; f < 2; f++) {
            // Each floret has ONE centre and frame. Its four lobes differ only in
            // rotation about that frame's normal, and a peduncle reaches the axil.
            const out = new THREE.Vector3(Math.cos(angle + (f - .5) * .6), .55 + fr() * .15, Math.sin(angle + (f - .5) * .6)).normalize();
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
      if (matrices.length) {
        const leaves = new THREE.InstancedMesh(leafGeometry, foliage, matrices.length);
        const stalks = new THREE.InstancedMesh(unitCylinder, stemMat, petioles.length);
        leaves.userData = { organ: "leaf", connectedBy: "petiole", phyllotaxis: "opposite-decussate", nodes };
        stalks.userData = { organ: "leaf", role: "petiole" };
        matrices.forEach((m, i) => { leaves.setMatrixAt(i, m); stalks.setMatrixAt(i, petioles[i]); col.setHSL(.27, .40, .22 + rng(key + Math.floor(i / 2) * 17)() * .06); leaves.setColorAt(i, col); });
        leaves.castShadow = leaves.receiveShadow = true; parent.add(stalks, leaves); leafCount += matrices.length;
      }
      if (petals.length) {
        const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, petals.length);
        const stalks = new THREE.InstancedMesh(unitCylinder, stemMat, peduncles.length);
        const cores = new THREE.InstancedMesh(flowerCenterGeo, flowerMat, centers.length);
        flowers.userData = { organ: "flower", role: "corolla-lobes", lobesPerFlower: 4, sites: flowerSites };
        stalks.userData = { organ: "flower", role: "axillary-peduncle" };
        cores.userData = { organ: "flower", role: "center" };
        petals.forEach((m, i) => flowers.setMatrixAt(i, m));
        centers.forEach((m, i) => { cores.setMatrixAt(i, m); stalks.setMatrixAt(i, peduncles[i]); });
        flowers.castShadow = true; parent.add(stalks, cores, flowers);
      }
    }
    if (h > 0) {
      const leader = joint(group, new THREE.Vector3(0, life.collarY, 0), UP, h, r, 0, params.seed || 1);
      leader.userData.axis = "leader";
      axisLeaves(leader, h, 0, 1, 12, params.seed || 1);
      function branchCohort(parent: THREE.Group, parentLength: number, birth: number, order: number, key: number, nodeCount: number, parentGrowth: number) {
        for (let n = 0; n < nodeCount; n++) for (let side = 0; side < 2; side++) {
          const onset = birth + n * (order === 1 ? .65 : .55);
          const growth = smooth(onset, onset + 1.6, age) * parentGrowth;
          if (growth <= 0) continue;
          const axisKey = Math.imul(key, 1664525) + (n * 2 + side + 1) * 1013904223;
          const rr = rng(axisKey);
          // Reconstruct the supporting leaf node rather than attach branches off-axis.
          const count = Math.max(1, Math.round((order === 1 ? 12 : order === 2 ? 6 : 4) * density));
          const node = Math.min(count - 1, order === 1 ? 1 + n * 2 : 1 + n);
          const position = new THREE.Vector3(0, parentLength * (.16 + .76 * (node + .5) / count), 0);
          const angle = phase + node * Math.PI / 2 + side * Math.PI;
          const len = parentLength * (order === 1 ? .50 : .42) * (.85 + rr() * .30) * growth;
          const radius = r * Math.pow(.32, order) * Math.sqrt(growth);
          const axis = joint(parent, position, direction(angle, .60 + rr() * .35), len, radius, order, axisKey);
          axis.userData = { axis: "lateral", birth: onset, node, growth };
          axisLeaves(axis, len, onset, growth, order === 1 ? 6 : order === 2 ? 4 : 3, key + n * 991 + side * 73);
          if (order < 3) branchCohort(axis, len, onset + 1.6, order + 1, axisKey, order === 1 ? 3 : 2, growth);
        }
      }
      branchCohort(leader, h, .8, 1, (params.seed || 1) * 811, 6, 1);
      const bud = new THREE.Mesh(seedGeo, stemMat); bud.name = "osmanthus-terminal-bud"; bud.userData.organ = "bud";
      bud.position.y = h; bud.scale.set(.0007, .0015, .0007).multiplyScalar(smooth(.035, .12, age)); leader.add(bud);
    }
  } else if (species === "iris" || species === "oxalis") {
    // Botanical constraints supplied by NCSU Plant Toolbox; geometry is in metres.
    // Durations, cohort budgets and flowering windows below are uncalibrated
    // presentation priors, NOT measured germination or first-flowering ages.
    const iris = species === "iris";
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
    materials.push(green, storage, petalMat, light);
    stageLabel = iris
      ? age < .025 ? "根茎分株 · 带芽繁殖体" : age < .14 ? "分株建立 · 首叶展开" : age < .5 ? "二列扇叶 · 新叶建立" : "根茎横走 · 分株扩展（繁殖结构为季节先验）"
      : age < .018 ? "带根匍匐茎节 · 营养繁殖体" : age < .10 ? "茎节建立 · 首片三出复叶" : age < .35 ? "匍匐伸长 · 新节生根" : "匍匐群落 · 连续展叶（繁殖结构为季节先验）";
    group.userData = { stageLabel, development: {
      origin: iris ? "rhizome-division" : "rooted-stolon-node", ageClock: "years-since-vegetative-propagule-establishment",
      seedGerminationModeled: false, source, evidence: "botanical constraints from user-supplied NCSU source; not locally measured",
      calibration: "uncalibrated-engineering-prior", timing: "cohort expansion is a presentation prior, not a biological flowering-age estimate",
      flowering: { dayWindow: iris ? [89, 106, 145, 158] : [45, 85, 310, 345], status: "engineering-season-prior", firstFloweringAge: null },
      reproduction: "flowers only; pollination, capsules and seed dispersal not modeled",
      seasonalSkeleton: "support axes retained as a structural proxy; seasonal senescence not simulated",
    } };
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
    if (iris) {
      const outerGeo = petalGeometry(.065, .024, -.045), innerGeo = petalGeometry(.055, .014, .008);
      const styleGeo = petalGeometry(.042, .007, .004);
      extraGeometries.push(outerGeo, innerGeo, styleGeo);
      const fanCount = Math.max(1, Math.round(4 * density));
      // One shallow, horizontal rhizome chain. Each new fan waits for its segment.
      let node = new THREE.Vector3(.015, -.003, 0);
      segment(group, new THREE.Vector3(-.015, -.003, 0), node, .004, storage, "rhizome-propagule");
      for (let c = 0; c < fanCount; c++) {
        const birth = c === 0 ? 0 : .5 + (c - 1) * .55;
        const extension = c === 0 ? 1 : smooth(birth, birth + .22, age);
        const start = node.clone();
        if (c > 0) {
          const angle = phase + .25 * (keyed(100 + c) - .5);
          node = start.clone().add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(.065 * extension));
          const rhizome = segment(group, start, node, .0035 * extension, storage, "rhizome");
          rhizome.userData = { ...rhizome.userData, cohort: c, birth, growth: extension };
        }
        const fanBirth = c === 0 ? 0 : birth + .22;
        const establishment = c === 0 ? 1 : smooth(fanBirth, fanBirth + .10, age);
        const base = new THREE.Group(); base.name = `iris-fan-${c}`; base.position.copy(node); base.rotation.y = phase;
        base.userData = { role: "rhizome-node", cohort: c, birth: fanBirth }; group.add(base);
        root(base, establishment); bud(base, establishment);
        const expanded = Array.from({ length: 8 }, (_, i) => smooth(fanBirth + .025 + i * .07, fanBirth + .14 + i * .07, age));
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
            vertices.setX(v, vertices.getX(v) + vertices.getZ(v)); vertices.setZ(v, 0);
          }
          geometry.computeVertexNormals();
          const leaf = new THREE.Mesh(geometry, green);
          // All sword blades share the same x/y plane, in two basal ranks.
          leaf.position.x = side * .0007 * (4 - Math.floor(i / 2)) * expansion;
          leaf.userData = { organ: "leaf", role: "sword-blade", arrangement: "distichous-fan", cohort: c, index: i, expansion };
          leaf.castShadow = true; fan.add(leaf); leafCount++;
        }
        const readiness = smooth(4, 7, expanded.reduce((a, b) => a + b, 0));
        const stemHeight = .32 * readiness;
        const stalk = segment(fan, new THREE.Vector3(), new THREE.Vector3(0, stemHeight, 0), .0022 * readiness, stemMat, "flower-scape");
        stalk.userData.organ = "stem";
        const bloom = smooth(89, 106, day) * (1 - smooth(145, 158, day));
        const flower = new THREE.Group(); flower.position.y = stemHeight; flower.scale.setScalar(readiness * bloom);
        flower.userData = { organ: "flower", role: "iris-flower", outerTepals: 3, innerTepals: 3, styleBranches: 3 }; fan.add(flower);
        for (let p = 0; p < 3; p++) {
          const frame = new THREE.Group(); frame.rotation.y = p * Math.PI * 2 / 3; flower.add(frame);
          const fall = new THREE.Mesh(outerGeo, petalMat); fall.rotation.x = -Math.PI / 2; fall.userData.role = "drooping-outer-tepal"; frame.add(fall);
          const style = new THREE.Mesh(styleGeo, light); style.rotation.x = -Math.PI / 2 + .22; style.userData.role = "style-branch"; frame.add(style);
          const standardFrame = new THREE.Group(); standardFrame.rotation.y = Math.PI / 3; frame.add(standardFrame);
          const standard = new THREE.Mesh(innerGeo, light); standard.rotation.x = .22; standard.userData.role = "upright-inner-tepal"; standardFrame.add(standard);
        }
      }
    } else {
      const petalGeo = petalGeometry(.006, .003, -.0006); extraGeometries.push(petalGeo);
      const origin = new THREE.Group(); origin.position.y = .003; origin.name = "oxalis-rooted-propagule"; group.add(origin);
      segment(origin, new THREE.Vector3(-.008, 0, 0), new THREE.Vector3(), .0009, stemMat, "stolon-propagule");
      root(origin, 1); bud(origin, 1);
      const runnerCount = Math.max(1, Math.round(3 * density)), nodeLimit = 6;
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
          mesh.userData.role = "heart-shaped-leaflet"; frame.add(mesh);
        }
        leafCount++; // Count compound leaves, not their three leaflets.
        const readiness = smooth(.85, 1, expansion) * smooth(.10, .28, age);
        const tip = new THREE.Vector3(.016 * readiness, height * readiness, .008 * readiness);
        const stalk = segment(pivot, new THREE.Vector3(), tip, .00045 * readiness, stemMat, "axillary-peduncle"); stalk.userData.organ = "stem";
        const flower = new THREE.Group(); flower.position.copy(tip);
        const bloom = smooth(45, 85, day) * (1 - smooth(310, 345, day)); flower.scale.setScalar(readiness * bloom);
        flower.userData = { organ: "flower", role: "oxalis-flower", petals: 5 }; pivot.add(flower);
        for (let p = 0; p < 5; p++) {
          const frame = new THREE.Group(); frame.rotation.y = p * Math.PI * 2 / 5;
          const mesh = new THREE.Mesh(petalGeo, petalMat); mesh.rotation.x = -Math.PI / 2 + .15; frame.add(mesh); flower.add(frame);
        }
      }
      nodeOrgans(origin, 0, 0);
      for (let r = 0; r < runnerCount; r++) {
        let parent: THREE.Object3D = origin;
        for (let n = 1; n <= nodeLimit; n++) {
          const birth = .12 + r * .045 + (n - 1) * .14;
          const extension = smooth(birth, birth + .10, age);
          const angle = phase + r * Math.PI * 2 / runnerCount + .2 * (keyed(1200 + r * 31 + n) - .5);
          const end = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar((.035 + .015 * keyed(1300 + r * 31 + n)) * extension);
          const internode = segment(parent, new THREE.Vector3(), end, .0008 * extension, stemMat, "stolon-internode");
          internode.userData = { ...internode.userData, runner: r, node: n, birth, growth: extension };
          const node = new THREE.Group(); node.name = `oxalis-node-${r}-${n}`; node.position.copy(end);
          node.userData = { role: "rooting-stolon-node", runner: r, node: n, birth: birth + .10 }; parent.add(node);
          nodeOrgans(node, birth + .10, r * nodeLimit + n); parent = node;
        }
      }
    }
  }
  // Copy organ labels to descendants as well as roots: skeleton renderers can toggle
  // every object independently without making an unlabelled petal/leaf visible again.
  group.traverse(obj => { if (!obj.userData.organ && obj.parent?.userData.organ) obj.userData.organ = obj.parent.userData.organ; });
  group.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(group); const height = Math.max(.001, box.max.y);
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
    geometries.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); group.clear();
  }
  return { group, branches, leafCount, height, stageLabel, update, dispose };
}

/** Silver-ginkgo architecture v3. Shape priors are not a fitted campus individual.
 * Botanical constraints: hypogeal germination, persistent long/short shoots,
 * petiolate fan blades with dichotomous veins, deciduous foliage, no assumed sex.
 * Flora of China: https://efloras.org/florataxon.aspx?flora_id=2&taxon_id=200005235
 * USDA: https://plants.sc.egov.usda.gov/DocumentLibrary/plantguide/pdf/pg_ginkg.pdf
 * Curves below are unmeasured engineering priors, not campus age/DBH observations.
 */
function buildNaturalGinkgo(params: PlantParams): PlantModel {
  const age = Math.max(0, Number.isFinite(params.age) ? params.age : 12), day = clamp(params.day, 1, 365), density = clamp(params.density, .15, 2);
  const seed = params.seed || 1, random = rng(seed), group = new THREE.Group();
  group.name = `plant:ginkgo:natural:${seed}`;
  group.userData.reproduction = "not-modeled: sex and reproductive maturity require independent observations";
  const stageLabel = age < .02 ? "种子 · 地下子叶" : age < .12 ? "萌发 · 胚根与芽" : age < 2 ? "幼苗 · 初生茎与真叶" : age < 20 ? "幼树 · 长短枝建立" : age < 100 ? "成树 · 冠层展开" : "老龄 · 持续增粗";
  group.userData.stageLabel = stageLabel;
  const leafPresence = smooth(65, 105, day) * (1 - smooth(320, 350, day));
  const autumn = smooth(266, 312, day), maturity = smooth(4, 50, age);
  const heightAt = (a:number) => a < 1 ? (.025 + .42 * a) * smooth(.035,.12,a) : .445 + 13.5 * (1 - Math.exp(-(a - 1) / 25));
  const h = heightAt(age);
  group.userData.priors = { calibration: "uncalibrated-engineering-prior", source: "Flora of China / USDA morphology; growth curves not empirical age/DBH data" };
  const radius = age < 1 ? .001 + .003 * age : .004 + .25 * (1 - Math.exp(-(age - 1) / 42));
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
    const g = new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
  }
  function mergeGeometries(parts: THREE.BufferGeometry[]) {
    let count=0; const flat=parts.map(g=>{const f=g.index?g.toNonIndexed():g;count+=f.attributes.position.count;return f;});
    const positions=new Float32Array(count*3),normals=new Float32Array(count*3),uv=new Float32Array(count*2);let n=0;
    for(const g of flat){positions.set(g.attributes.position.array as ArrayLike<number>,n*3);normals.set(g.attributes.normal.array as ArrayLike<number>,n*3);if(g.attributes.uv)uv.set(g.attributes.uv.array as ArrayLike<number>,n*2);n+=g.attributes.position.count;}
    const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(positions,3));out.setAttribute("normal",new THREE.BufferAttribute(normals,3));out.setAttribute("uv",new THREE.BufferAttribute(uv,2));
    for(const g of new Set([...parts,...flat]))g.dispose(); return ownGeometry(out);
  }
  function meshParts(parent:THREE.Object3D,parts:THREE.BufferGeometry[],mat:THREE.Material) {if(!parts.length)return;const mesh=new THREE.Mesh(mergeGeometries(parts),mat);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);}
  function curveFor(length:number, bend:number, phase:number) { return new THREE.CatmullRomCurve3([new THREE.Vector3(),new THREE.Vector3(bend*.20,length*.27,Math.sin(phase)*bend*.18),new THREE.Vector3(bend*.95,length*.64,Math.cos(phase)*bend*.34),new THREE.Vector3(bend*.65,length,Math.sin(phase+.7)*bend*.52)]); }
  function branchJoint(parent:THREE.Object3D,pos:THREE.Vector3,dir:THREE.Vector3,length:number,r:number,order:number,key:number) {
    const pivot=new THREE.Group();pivot.position.copy(pos);pivot.quaternion.setFromUnitVectors(UP,dir.clone().normalize());parent.add(pivot);
    const j:BranchJoint={pivot,rest:pivot.quaternion.clone(),length,radius:r,order,phase:rng(key)()*6.28,flexibility:clamp(.003*Math.pow(length/Math.max(.002,r),1.05),.02,1.25),sag:Math.min(.12,length*.027*(order+1))};branches.push(j);return pivot;
  }
  type LeafRecord={matrix:THREE.Matrix4;petiole:THREE.Matrix4;tone:number};
  type FillSite={curve:THREE.CatmullRomCurve3;frame:THREE.Matrix4;scale:number;up:THREE.Vector3;key:number};
  type PendingCanopy={parent:THREE.Group;wood:THREE.BufferGeometry[];fine:THREE.BufferGeometry[];records:LeafRecord[];buds:THREE.Matrix4[];sites:FillSite[]};
  const pendingCanopies:PendingCanopy[]=[];
  const leafPosition=leafGeometry.attributes.position,leafIndex=leafGeometry.index;
  const areaA=new THREE.Vector3(),areaB=new THREE.Vector3(),areaC=new THREE.Vector3();let bladeAreaM2=0;
  for(let i=0;i<(leafIndex?leafIndex.count:leafPosition.count);i+=3){areaA.fromBufferAttribute(leafPosition,leafIndex?leafIndex.getX(i):i);areaB.fromBufferAttribute(leafPosition,leafIndex?leafIndex.getX(i+1):i+1);areaC.fromBufferAttribute(leafPosition,leafIndex?leafIndex.getX(i+2):i+2);bladeAreaM2+=areaB.sub(areaA).cross(areaC.sub(areaA)).length()*.5;}
  function recordArea(record:LeafRecord){const e=record.matrix.elements;return bladeAreaM2*Math.hypot(e[0],e[1],e[2])*Math.hypot(e[4],e[5],e[6]);}
  let visibleLeafAreaM2=0;
  function foliageBatch(parent:THREE.Object3D,records:LeafRecord[],buds:THREE.Matrix4[]) {
    const visible=records.filter((_,i)=>rng(seed*113+i*47+records.length)()<leafPresence); if(visible.length) {
      const leaves=new THREE.InstancedMesh(leafGeometry,leafMaterial,visible.length),petioles=new THREE.InstancedMesh(unitPetiole,petioleMaterial,visible.length);
      leaves.userData.organ=petioles.userData.organ="leaf";leaves.userData.connectedBy="petiole";leaves.castShadow=leaves.receiveShadow=true;
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
  function appendLeaf(records: LeafRecord[], attachment: THREE.Vector3, direction: THREE.Vector3, petioleLength: number, scale: number, roll: number, tone: number, surfaceUp: THREE.Vector3 = UP) {
    if(scale<1e-7)return;
    const bladeBase = attachment.clone().addScaledVector(direction, petioleLength);
    dummy.position.copy(bladeBase); dummy.quaternion.copy(bladeRotation(direction, roll, surfaceUp)); dummy.scale.setScalar(scale); dummy.updateMatrix();
    const matrix = dummy.matrix.clone();
    dummy.position.copy(attachment).lerp(bladeBase, .5); dummy.quaternion.setFromUnitVectors(UP, direction);
    dummy.scale.set(.00048 * Math.max(.15, scale), petioleLength, .00048 * Math.max(.15, scale)); dummy.updateMatrix();
    records.push({ matrix, petiole: dummy.matrix.clone(), tone });
  }
  function shortShoots(curve:THREE.CatmullRomCurve3,frame:THREE.Matrix4,wood:THREE.BufferGeometry[],records:LeafRecord[],buds:THREE.Matrix4[],key:number,n:number,leafScale:number,surfaceUp: THREE.Vector3 = UP) {
    const shootCount=Math.max(1,Math.round(n)), axisLength=curve.getLength();
    for(let s=0;s<shootCount;s++) {
      const rr=rng(key+s*12289);
      const nodeGrowth=smooth((s+.15)*.030,(s+.85)*.045,axisLength);
      const shootScale=leafScale*nodeGrowth;if(shootScale<1e-7)continue;
      const t=.09+(s+.3+rr()*.35)/shootCount*.88,anchor=curve.getPointAt(t).applyMatrix4(frame),tangent=curve.getTangentAt(t).transformDirection(frame);
      const az=rr()*6.28,outward=new THREE.Vector3(Math.cos(az)*.55,.12,Math.sin(az)*.55).addScaledVector(surfaceUp,.70+rr()*.25).normalize();
      // Ginkgo spur shoots have very short internodes. Leaves attach at successive
      // compressed nodes rather than all radiating from one floating rosette centre.
      const shootLength=(.006+rr()*.013)*shootScale,end=anchor.clone().addScaledVector(outward,shootLength);
      const shootCurve=new THREE.CatmullRomCurve3([anchor,anchor.clone().lerp(end,.5).addScaledVector(tangent,.0015),end]);
      wood.push(tube(shootCurve,.0018*shootScale,.0007*shootScale,3,4));
      dummy.position.copy(end);dummy.quaternion.setFromUnitVectors(UP,outward);dummy.scale.set(.0013*shootScale,.0025*shootScale,.0013*shootScale);dummy.updateMatrix();if(shootScale>.015)buds.push(dummy.matrix.clone());
      const leafN=shootScale<.015?0:Math.max(2,Math.round((5+rr()*3)*density));
      for(let l=0;l<leafN;l++) {
        const theta=az+l*2.39996+(rr()-.5)*.35;
        const direction=new THREE.Vector3(Math.cos(theta),.08+rr()*.42,Math.sin(theta)).normalize();
        const attachment=shootCurve.getPointAt(.22+.72*(l+.5)/leafN);
        appendLeaf(records,attachment,direction,(.024+rr()*.018)*shootScale,shootScale*(.82+rr()*.22),(rr()-.5)*.65,rr()-.5,surfaceUp);
      }
    }
  }

  // Storage cotyledons remain inside this buried seed; no green aerial cotyledons.
  if(age < .65) {const seedGroup=new THREE.Group();seedGroup.position.set(0,-.018,0);seedGroup.userData.organ="seed";group.add(seedGroup);
    const geometry=ownGeometry(new THREE.SphereGeometry(1,16,10));const coat=new THREE.Mesh(geometry,seedMaterial);coat.scale.set(.015,.019,.011);coat.rotation.z=.14;seedGroup.add(coat);
    const seam=new THREE.Mesh(ownGeometry(new THREE.TorusGeometry(.0135,.00055,4,32)),budMaterial);seam.rotation.y=Math.PI/2;seam.scale.y=1.35;seedGroup.add(seam);
    if(age>.07)seedGroup.scale.setScalar(1-smooth(.25,.65,age)*.7);
  }
  if(h > .001) {
    const leader=branchJoint(group,new THREE.Vector3(),UP,h,radius,0,seed);
    const trunkCurve= new THREE.CatmullRomCurve3([new THREE.Vector3(),new THREE.Vector3(h*.007,h*.23,-h*.008),new THREE.Vector3(-h*.013,h*.50,h*.012),new THREE.Vector3(h*.019,h*.76,h*.018),new THREE.Vector3(h*.007,h,h*.012)]);
    const trunk=new THREE.Mesh(ownGeometry(tube(trunkCurve,radius*1.35,Math.max(.001,radius*.055),Math.max(12,Math.round(h*4)),12)),age<1?twigMaterial:bark);trunk.castShadow=trunk.receiveShadow=true;leader.add(trunk);
    const majorCount=21, leafScale=Math.min(1,.24+smooth(.075,1.5,age)*.76);
    const trueLeaves=smooth(.075,.16,age), initialPhase=rng(seed*211)()*Math.PI*2;
    // Persistent stem nodes: lower nodes are born first, at their height at birth.
    // The active leader always carries alternate leaves; second-year axils form spurs.
    const records:LeafRecord[]=[], buds:THREE.Matrix4[]=[], fine:THREE.BufferGeometry[]=[];
    for(let i=0;i<80;i++) {
      const birth=.08+i*.075+i*i*.007, nodeAge=age-birth;
      if(nodeAge<=0)break;
      const t=Math.min(.985,heightAt(birth)/Math.max(.001,h)), angle=initialPhase+i*2.39996;
      const attachment=trunkCurve.getPointAt(t), expansion=smooth(0,.12,nodeAge)*trueLeaves;
      const light=1-smooth(2,5,nodeAge)*(1-smooth(.24,.56,t));
      const direction=new THREE.Vector3(Math.cos(angle),.18,Math.sin(angle)).normalize();
      appendLeaf(records,attachment,direction,.032*expansion,leafScale*expansion*light,.12*Math.sin(i*2.1),rng(seed+i*113)()-.5);
      const spurGrowth=smooth(.85,1.8,nodeAge)*light;
      if(spurGrowth>.001) {
        const end=attachment.clone().addScaledVector(direction,.014*spurGrowth);
        const spur=new THREE.CatmullRomCurve3([attachment,attachment.clone().lerp(end,.5),end]);
        // Leaves start on the actual woody spur, not an offset rosette centre.
        fine.push(tube(spur,.0014*spurGrowth,.0005*spurGrowth,3,4));
        for(let l=0;l<5;l++) {
          const a=angle+l*2.39996, d=new THREE.Vector3(Math.cos(a),.18,Math.sin(a)).normalize();
          appendLeaf(records,spur.getPointAt(.2+l*.16),d,.032*spurGrowth,leafScale*spurGrowth,.1*Math.sin(l),0);
        }
      }
    }
    leader.userData.phyllotaxis="spiral alternate long shoots; second-year axillary clustered short shoots";
    pendingCanopies.push({parent:leader,wood:[],fine,records,buds,sites:[]});
    for(let i=0;i<majorCount;i++) {
      const rr=rng(seed*104729+i*8191), birth=.85+i*.78+i*i*.070, branchAge=age-birth;
      const growth=smooth(0,2.5,branchAge);if(growth<1e-7)continue;
      const attachT=Math.min(.999,heightAt(birth)/h),anchor=trunkCurve.getPointAt(attachT),az=initialPhase+i*2.39996+(rr()-.5)*.65;
      // Young pyramidal habit opens into an irregular broad ovoid; no radial tiers.
      const inclination=clamp(.48+(.65+maturity*.65)*(1-attachT)+maturity*.20+(rr()-.5)*.30,.30,1.48);
      const dir=new THREE.Vector3(Math.cos(az)*Math.sin(inclination),Math.cos(inclination),Math.sin(az)*Math.sin(inclination));
      const retirement=1-.86*smooth(20,40,branchAge);
      const envelope=Math.pow(Math.sin(Math.PI*clamp((attachT+.10)/1.15)),.7);
      const spread=h*(.27+maturity*.34)*envelope*(.65+rr()*.64)*growth*retirement;
      const headroom=Math.max(.001,h-anchor.y);
      const length=Math.min(spread,headroom/(dir.y+.36));
      const branchLeafScale=leafScale*smooth(0,.35,branchAge)*(1-smooth(24,40,branchAge));
      const r=radius*(.21+rr()*.12)*Math.sqrt(growth)*Math.pow(1-attachT,.55);
      const pivot=branchJoint(leader,anchor,dir,length,r,1,seed*104729+i*911+7);
      pivot.userData.node={birth,attachment:anchor.toArray(),attachT};
      const canopyUp=UP.clone().applyQuaternion(pivot.quaternion.clone().invert());
      const primary=curveFor(length,length*(.07+rr()*.15),az);
      const wood:THREE.BufferGeometry[]=[tube(primary,r,Math.max(.00005,r*.045),16,8)],fine:THREE.BufferGeometry[]=[],records:LeafRecord[]=[],buds:THREE.Matrix4[]=[],sites:FillSite[]=[];
      // Alternate leaves on long shoots persist at the distal extension, including
      // first-year branches; short shoots wait until their second growing year.
      for(let n=0;n<12;n++) {
        const t=.12+n*.077, a=az+n*2.39996, d=new THREE.Vector3(Math.cos(a),.18,Math.sin(a)).normalize();
        appendLeaf(records,primary.getPointAt(t),d,.035*growth,branchLeafScale*smooth(0,.18,branchAge),.1*Math.sin(n),0,canopyUp);
      }
      const spurScale=branchLeafScale*smooth(.85,1.7,branchAge);
      if(spurScale>.001)shortShoots(primary,new THREE.Matrix4(),fine,records,buds,seed+i*4049,8,spurScale,canopyUp);
      const secondCount=9;
      for(let b=0;b<secondCount;b++) {
        const sr=rng(seed*617+i*1013+b*197), st=.15+(b+.2+sr()*.55)/secondCount*.80;
        const secondAge=branchAge-(.65+st*1.5), sg=smooth(0,2,secondAge);if(sg<1e-7)continue;
        const start=primary.getPointAt(st),phi=b*2.39996+(sr()-.5)*1.1;
        const slen=length*(.22+sr()*.25)*(1-st*.40)*sg;
        const sdir=new THREE.Vector3(Math.cos(phi)*.85,.36+sr()*.60,Math.sin(phi)*.85).normalize(),sq=new THREE.Quaternion().setFromUnitVectors(UP,sdir),frame=new THREE.Matrix4().compose(start,sq,new THREE.Vector3(1,1,1));
        const secondary=curveFor(slen,slen*(.09+sr()*.17),phi);
        wood.push(tube(secondary,r*.30*Math.sqrt(sg),Math.max(.00002,r*.018*sg),10,6).applyMatrix4(frame));
        const secondaryScale=branchLeafScale*smooth(0,.45,secondAge);
        for(let n=0;n<7;n++) {
          const a=phi+n*2.39996,d=new THREE.Vector3(Math.cos(a),.2,Math.sin(a)).normalize().applyQuaternion(sq);
          appendLeaf(records,secondary.getPointAt(.32+n*.10).applyMatrix4(frame),d,.032*sg,secondaryScale,.1*Math.sin(n),0,canopyUp);
        }
        if(secondAge>.85)shortShoots(secondary,frame,fine,records,buds,seed+i*7027+b*997,7,secondaryScale*smooth(.85,1.7,secondAge),canopyUp);
        for(let c=0;c<4;c++) {
          const tr=rng(seed*53+i*2131+b*313+c*79),tt=.22+(c+.3+tr()*.3)/4*.70;
          const twigAge=secondAge-(.8+tt),tg=smooth(0,2,twigAge);if(tg<1e-7)continue;
          const origin=secondary.getPointAt(tt).applyMatrix4(frame),ta=phi+c*2.37+(tr()-.5)*1.2;
          const localDirection=new THREE.Vector3(Math.cos(ta)*.83,.35+tr()*.65,Math.sin(ta)*.83).normalize().applyQuaternion(sq);
          const tq=new THREE.Quaternion().setFromUnitVectors(UP,localDirection),tf=new THREE.Matrix4().compose(origin,tq,new THREE.Vector3(1,1,1));
          const tl=slen*(.30+tr()*.32)*tg,twig=curveFor(tl,tl*.18,ta),twigScale=secondaryScale*smooth(0,.4,twigAge);
          fine.push(tube(twig,r*.09*Math.sqrt(sg*tg),.0003*tg,6,5).applyMatrix4(tf));
          for(let n=0;n<5;n++) {
            const a=ta+n*2.39996,d=new THREE.Vector3(Math.cos(a),.2,Math.sin(a)).normalize().applyQuaternion(tq);
            appendLeaf(records,twig.getPointAt(.35+n*.13).applyMatrix4(tf),d,.03*tg,twigScale,.1*Math.sin(n),0,canopyUp);
          }
          if(twigAge>.85)shortShoots(twig,tf,fine,records,buds,seed+i*10007+b*127+c*23,5,twigScale*smooth(.85,1.7,twigAge),canopyUp);
          if(twigAge>1)sites.push({curve:twig,frame:tf,scale:twigScale*smooth(1,3,twigAge),up:canopyUp,key:seed+i*13007+b*521+c*37});
        }
      }
      pendingCanopies.push({parent:pivot,wood,fine,records,buds,sites});
    }
    const terminal=new THREE.Mesh(unitBud,budMaterial);terminal.name="terminal-bud";terminal.position.copy(trunkCurve.getPointAt(1));
    const budMaturity=smooth(.2,20,age),budRadius=.00065+.0018*budMaturity,budLength=.0025+.0055*budMaturity;
    terminal.scale.set(budRadius,budLength*.5,budRadius);terminal.userData.organ="bud";leader.add(terminal);
  }
  // A fixed number of leaves cannot fill an expanding crown: the previous model
  // gave a 45-year crown a one-sided area ratio below 1. Add connected fine-shoot
  // cohorts to an explicit, inspectable engineering target. This is NOT field LAI.
  group.updateMatrixWorld(true);
  const projectedBox=new THREE.Box3(),leafPoint=new THREE.Vector3();let potentialArea=0,potentialCount=0;
  for(const canopy of pendingCanopies)for(const record of canopy.records){potentialArea+=recordArea(record);potentialCount++;leafPoint.setFromMatrixPosition(record.matrix).applyMatrix4(canopy.parent.matrixWorld);projectedBox.expandByPoint(leafPoint);}
  const projectionSize=projectedBox.isEmpty()?new THREE.Vector3():projectedBox.getSize(new THREE.Vector3());
  const referenceCrownProjectionM2=Math.PI*.25*(projectionSize.x+.08)*(projectionSize.z+.08);
  const targetAreaRatio=2.8*density;
  const targetPotentialArea=referenceCrownProjectionM2*targetAreaRatio;
  // Keep young crowns' existing area; fill only a measurable area deficit.
  // Upper bound controls GPU cost. Leaves retain their unchanged centimetre blade.
  const maxLeafBudget=160000,perLeafArea=potentialCount?potentialArea/potentialCount:bladeAreaM2;
  const desiredCount=Math.min(maxLeafBudget,Math.ceil(targetPotentialArea/Math.max(.0001,perLeafArea)));
  let totalFineCohorts=0;
  for(let cohort=0;cohort<12&&potentialCount<desiredCount;cohort++)for(const canopy of pendingCanopies) {
    for(const site of canopy.sites){if(potentialCount>=desiredCount)break;const fillRandom=rng(site.key+cohort*65537),t=.20+(cohort+.5)/12*.70;
      const start=site.curve.getPointAt(t).applyMatrix4(site.frame),tangent=site.curve.getTangentAt(t).transformDirection(site.frame),az=fillRandom()*Math.PI*2+cohort*2.39996;
      const side=new THREE.Vector3(Math.cos(az),.12,Math.sin(az));const direction=tangent.clone().multiplyScalar(.25).addScaledVector(side,.78).addScaledVector(site.up,.38).normalize();
      const orientation=new THREE.Quaternion().setFromUnitVectors(UP,direction),frame=new THREE.Matrix4().compose(start,orientation,new THREE.Vector3(1,1,1));
      const length=(.075+site.curve.getLength()*(.20+fillRandom()*.14))*site.scale,twig=curveFor(length,length*.13,az);
      canopy.fine.push(tube(twig,.00115*site.scale,.00040,4,4).applyMatrix4(frame));const before=canopy.records.length;
      shortShoots(twig,frame,canopy.fine,canopy.records,canopy.buds,site.key+cohort*4231,Math.max(3,Math.round(length/.045)),site.scale,site.up);
      if(canopy.records.length-before>maxLeafBudget-potentialCount)canopy.records.length=before+Math.max(0,maxLeafBudget-potentialCount);
      for(let i=before;i<canopy.records.length;i++)potentialArea+=recordArea(canopy.records[i]);potentialCount+=canopy.records.length-before;totalFineCohorts++;
    }
  }
  for(const canopy of pendingCanopies){meshParts(canopy.parent,canopy.wood,bark);meshParts(canopy.parent,canopy.fine,twigMaterial);foliageBatch(canopy.parent,canopy.records,canopy.buds);}
  // Re-evaluate the slightly expanded leaf-centre footprint after cohort growth.
  projectedBox.makeEmpty();for(const canopy of pendingCanopies)for(const record of canopy.records){leafPoint.setFromMatrixPosition(record.matrix).applyMatrix4(canopy.parent.matrixWorld);projectedBox.expandByPoint(leafPoint);}
  const finalSize=projectedBox.isEmpty()?new THREE.Vector3():projectedBox.getSize(new THREE.Vector3()),projectedCrownAreaM2=Math.PI*.25*(finalSize.x+.08)*(finalSize.z+.08);
  group.userData.canopyMetrics={oneSidedLeafAreaM2:visibleLeafAreaM2,potentialLeafAreaM2:potentialArea,projectedCrownAreaM2,
    crownBaseM:projectedBox.isEmpty()?0:projectedBox.min.y,crownTopM:projectedBox.isEmpty()?0:projectedBox.max.y,leaderHeightM:h,
    crownWidthM:finalSize.x+.08,crownDepthM:finalSize.z+.08,leafAreaRatio:projectedCrownAreaM2>.01?visibleLeafAreaM2/projectedCrownAreaM2:0,targetAreaRatio,potentialLeafCount:potentialCount,
    connectedFineShootCohorts:totalFineCohorts,maxLeafBudget,calibration:"uncalibrated engineering estimate; one-sided mesh area / ellipse of leaf-centre bounds; not measured stand LAI"};
  group.traverse(o=>{if(!o.userData.organ&&o.parent?.userData.organ)o.userData.organ=o.parent.userData.organ;});group.updateMatrixWorld(true);
  const gravityFrames=branches.map(j=>{const down=new THREE.Vector3(0,-1,0).applyQuaternion(j.pivot.getWorldQuaternion(new THREE.Quaternion()).invert()),axis=new THREE.Vector3().crossVectors(UP,down),perpendicular=axis.length();if(perpendicular>1e-8)axis.multiplyScalar(1/perpendicular);else axis.set(1,0,0);return{axis,perpendicular};});
  const gr=new THREE.Quaternion(),wr=new THREE.Quaternion(),euler=new THREE.Euler();
  function update(time:number,wind:number,gravity:number,stiffness:number){const speed=clamp(wind,0,25),rigid=Math.max(.1,stiffness),area=.24+.76*leafPresence*density;
    branches.forEach((j,i)=>{const load=speed*speed*.00023*j.flexibility/rigid*area,osc=Math.sin(time*(.9+j.order*.47)+j.phase)*.65+Math.sin(time*.43+j.phase*.7)*.35,bend=Math.min(.16,load)*(.65+osc*.35),sag=Math.min(.13,j.sag*clamp(gravity,0,30)/9.81/rigid*gravityFrames[i].perpendicular);gr.setFromAxisAngle(gravityFrames[i].axis,sag);euler.set(bend*.42,0,-bend);wr.setFromEuler(euler);j.pivot.quaternion.copy(j.rest).multiply(gr).multiply(wr);});
  }
  function dispose(){group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear();}
  const box=new THREE.Box3().setFromObject(group);return{group,branches,leafCount,height:Math.max(.025,box.max.y),stageLabel,update,dispose};
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
