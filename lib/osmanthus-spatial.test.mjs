import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
import { createBeamDynamics } from './beam-dynamics.ts';

// Selected coverage, not a Cartesian sweep. Ages are illustration inputs, NOT
// measured individuals. The 1794da9 controls below were measured before editing
// the generator, with this same CPU rasterizer and actual instance triangles.
const samples = [
  ...[2, 8, 12, 40, 80].map(age => ({ age, seed: 42, density: 1 })),
  ...[2, 12, 80].map(age => ({ age, seed: 1, density: .3 })),
  ...[8, 40, 80].map(age => ({ age, seed: 73, density: 1.8 })),
  { age: 12, seed: 1, density: 1.8 }, { age: 40, seed: 73, density: .3 },
];
const build = p => buildPlant('osmanthus', { day: 180, ...p });
const blades = pivot => pivot.children.find(o => o.userData.connectedBy === 'petiole');
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key = p => `${p.age}/${p.seed}/${p.density}`;

// Axis IDs, local attachment translations AND rest rotations; diameters are
// deliberately excluded because extra supported area must be allowed to thicken
// real wood. The legacy node hash also fixes every pre-existing leaf site.
function identity(model) {
  return {
    axisHash: hash(model.branches.map(b => [b.pivot.userData.axisId, b.pivot.userData.birth,
      b.pivot.position.toArray(), b.rest.toArray(), b.length])),
    siteHash: hash(model.branches.map(b => [b.pivot.userData.axisId,
      (blades(b.pivot)?.userData.nodes ?? []).filter(n => n.index < 1000)
        .map(n => [n.index, n.birth, n.attachment, n.angle])])),
  };
}

/** Orthographic, unlit leaf-only pixel-centre coverage at 96² in XY/XZ/ZY.
 * Real transformed triangles, unioned once per pixel; no points, reported LAI,
 * shadow, alpha, perspective or invented clusters. Window includes actual wood
 * endpoints and blade vertices. This is a rest-pose geometry diagnostic, NOT a
 * WebGL screenshot or a photographic similarity score. Outer occupancy is in
 * the .55–1 normalized elliptical annulus of that same window.
 */
function spatial(model) {
  model.group.updateMatrixWorld(true);
  const bounds = new THREE.Box3(), triangles = [], bases = [];
  const m = new THREE.Matrix4(), world = new THREE.Matrix4();
  let area = 0, gapSum = 0, totalLength = 0, supportedTerminals = 0, terminals = 0;
  const gaps = [];
  for (const b of model.branches) {
    for (const y of [0, b.length]) bounds.expandByPoint(new THREE.Vector3(0, y, 0).applyMatrix4(b.pivot.matrixWorld));
    const leaf = blades(b.pivot); let distal = 0;
    if (leaf) {
      const p = leaf.geometry.attributes.position, idx = leaf.geometry.index;
      for (let i = 0; i < leaf.count; i++) {
        leaf.getMatrixAt(i, m); world.multiplyMatrices(leaf.matrixWorld, m);
        bases.push(new THREE.Vector3().setFromMatrixPosition(world));
        const vertices = Array.from({ length: p.count }, (_, j) => {
          const local = new THREE.Vector3().fromBufferAttribute(p, j).applyMatrix4(m);
          distal = Math.max(distal, local.y);
          const vertex = local.applyMatrix4(leaf.matrixWorld); bounds.expandByPoint(vertex);
          return vertex;
        });
        for (let j = 0; j < (idx ? idx.count : p.count); j += 3) {
          const t = [0, 1, 2].map(k => vertices[idx ? idx.getX(j + k) : j + k]);
          area += t[1].clone().sub(t[0]).cross(t[2].clone().sub(t[0])).length() * .5;
          triangles.push(t);
        }
      }
    }
    // Exclude tiny/new shoots whose leaf expansion is legitimately incomplete.
    if (b.length > .15 && model.group.userData.lifecycle.age > b.pivot.userData.birth + .4) {
      const gap = Math.max(0, b.length - distal);
      gaps.push(gap); gapSum += gap; totalLength += b.length; terminals++;
      if (gap <= .12) supportedTerminals++;
    }
  }
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const resolution = 96, views = [], outer = [];
  for (const [u, v] of [['x', 'y'], ['x', 'z'], ['z', 'y']]) {
    const occupied = new Uint8Array(resolution ** 2);
    for (const triangle of triangles) {
      const t = triangle.map(p => [(p[u] - bounds.min[u]) / size[u] * resolution,
        (p[v] - bounds.min[v]) / size[v] * resolution]);
      const [a, b, c] = t;
      const edge = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      const sign = Math.sign(edge(a, b, c[0], c[1])); if (!sign) continue;
      const loX = Math.max(0, Math.ceil(Math.min(...t.map(p => p[0])) - .5));
      const hiX = Math.min(resolution - 1, Math.floor(Math.max(...t.map(p => p[0])) - .5));
      const loY = Math.max(0, Math.ceil(Math.min(...t.map(p => p[1])) - .5));
      const hiY = Math.min(resolution - 1, Math.floor(Math.max(...t.map(p => p[1])) - .5));
      for (let y = loY; y <= hiY; y++) for (let x = loX; x <= hiX; x++) {
        if (occupied[y * resolution + x]) continue;
        if (edge(a, b, x + .5, y + .5) * sign >= 0 && edge(b, c, x + .5, y + .5) * sign >= 0 &&
          edge(c, a, x + .5, y + .5) * sign >= 0) occupied[y * resolution + x] = 1;
      }
    }
    let outerPixels = 0, outerFilled = 0;
    for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
      const r2 = ((x + .5) * 2 / resolution - 1) ** 2 + ((y + .5) * 2 / resolution - 1) ** 2;
      if (r2 < .55 ** 2 || r2 > 1) continue;
      outerPixels++; outerFilled += occupied[y * resolution + x];
    }
    views.push(occupied.reduce((s, n) => s + n, 0) / resolution ** 2);
    outer.push(outerFilled / outerPixels);
  }
  const outerBases = bases.filter(p => p.clone().sub(center).divide(size).multiplyScalar(2).length() > .72).length;
  return { leaves: model.leafCount, axes: model.branches.length, area, views, outer,
    outerLeafFraction: outerBases / bases.length, terminalSupport: supportedTerminals / terminals,
    gapLengthRatio: gapSum / totalLength, gap95M: gaps.sort((a, b) => a - b)[Math.floor(gaps.length * .95)] ?? 0,
    span: size.toArray(), ...identity(model) };
}

const baseline = {
  "2/42/1": {
    leaves: 48, axes: 7, area: 0.12118323396100758,
    views: [0.20670572916666666, 0.17176649305555555, 0.09092881944444445], outer: [0.16494845360824742, 0.1098334655035686, 0.08148295003965107],
    terminalSupport: 1, gapLengthRatio: 0.08366991034739554, gap95M: 0.07515392841947494,
    massKg: 0.03716060800758422, windN: 0.18409353800954736, demandRad: 0.016393454049421254,
    axisHash: "46a757976e2b1bfbc5c44448d27d5cf285f7a0705547839a797a1b4e2a6cd786",
    siteHash: "4c5ec68942ea383e650e42cc3eed194f4c68f6afbfd83e29154ac496411ddcea",
  },
  "8/42/1": {
    leaves: 3422, axes: 177, area: 10.141923026636942,
    views: [0.2699652777777778, 0.2629123263888889, 0.3221571180555556], outer: [0.1992466296590008, 0.16395717684377478, 0.2521808088818398],
    terminalSupport: 0.8782051282051282, gapLengthRatio: 0.06628138292345707, gap95M: 0.20445127411207997,
    massKg: 7.90256692651523, windN: 24.764247413727368, demandRad: 0.042095065005661236,
    axisHash: "78a5732b9f1336d38ba438d09edc9443e7d7ff5a750aba8f7c8949c186488570",
    siteHash: "b7399a1ca8f1337a85369e56c2bddbd38f3f854b4768cc2daf77034b8ed07e43",
  },
  "12/42/1": {
    leaves: 7008, axes: 275, area: 21.314091609625788,
    views: [0.2950303819444444, 0.2987196180555556, 0.3705512152777778], outer: [0.2127279936558287, 0.17922283901665345, 0.3126486915146709],
    terminalSupport: 0.9135338345864662, gapLengthRatio: 0.05955697334445928, gap95M: 0.14910297801872452,
    massKg: 20.553675687715288, windN: 52.21008229673721, demandRad: 0.03853904023044816,
    axisHash: "d1102dbd3abc6d0d0fd3fb0bd003a8edf8a6246fb3263ada9fe28294bb4b8c41",
    siteHash: "9d3d9c7417a26a13254470f3465722c38297beeb44f91c49dea19f2fbd9a3296",
  },
  "40/42/1": {
    leaves: 19668, axes: 697, area: 60.333181657457565,
    views: [0.3812934027777778, 0.4086371527777778, 0.3905164930555556], outer: [0.408406026962728, 0.3723235527359239, 0.41494845360824745],
    terminalSupport: 0.8945827232796486, gapLengthRatio: 0.06835503744998257, gap95M: 0.15560883140017678,
    massKg: 81.2901392403527, windN: 148.85073225870894, demandRad: 0.03846471276703645,
    axisHash: "44eebac41cbba9ecafaaa63e1ac331865cdbfd27cce0195c7249e06c518ccde3",
    siteHash: "95da1472b67d8d6a866da87ca59357c4eb86a173637a22feddb1a3a1f5d0a76d",
  },
  "80/42/1": {
    leaves: 24714, axes: 869, area: 75.8482566921856,
    views: [0.3973524305555556, 0.4153645833333333, 0.4044053819444444], outer: [0.4367565424266455, 0.38005551149881045, 0.4429024583663759],
    terminalSupport: 0.9078455790784558, gapLengthRatio: 0.06570886555336723, gap95M: 0.14667818469078775,
    massKg: 115.53907393423131, windN: 185.785652785382, demandRad: 0.03846471276703627,
    axisHash: "20da8d034d8904524c5e1aeff362c2fc933e9a15a9cf1d3b004ae2f94262e668",
    siteHash: "ddfe2e1177532962df97af8aca4314417ca23c7210088aed48a0adc2c4172f5e",
  },
  "2/1/0.3": {
    leaves: 24, axes: 7, area: 0.06766168970641942,
    views: [0.05295138888888889, 0.1535373263888889, 0.1484375], outer: [0.030927835051546393, 0.06958762886597938, 0.15186360031720855],
    terminalSupport: 0.2, gapLengthRatio: 0.5693375671891584, gap95M: 0.33508696728765863,
    massKg: 0.02983099972456461, windN: 0.1698674412882367, demandRad: 0.008724570787037474,
    axisHash: "3513f5f97f3bfb6a87d9206b8c50a4ad1ff2a1f61c928c4ceb04705b0dfe2a9c",
    siteHash: "a4e99c767e4258e203c1d60d367c153f916320068a2879303dbb60fcbb927201",
  },
  "12/1/0.3": {
    leaves: 2012, axes: 269, area: 6.014802406007434,
    views: [0.13368055555555555, 0.1323784722222222, 0.1265190972222222], outer: [0.09476605868358445, 0.05551149881046788, 0.0929817605075337],
    terminalSupport: 0.7807692307692308, gapLengthRatio: 0.13378510652194978, gap95M: 0.5750359069017816,
    massKg: 17.617198135121413, windN: 22.35548315492789, demandRad: 0.051262685860129456,
    axisHash: "cb559b8914a89f99f9cd90db437b263d8c97248d4b52cd0ca51b33a42846f9bc",
    siteHash: "d03afc3af2568d5b24bacd1702153737a30cf122d57e0c0442921a354ab06e9c",
  },
  "80/1/0.3": {
    leaves: 7468, axes: 849, area: 22.941740897572927,
    views: [0.2183159722222222, 0.2445746527777778, 0.2123480902777778], outer: [0.2268041237113402, 0.1950832672482157, 0.2204599524187153],
    terminalSupport: 0.9036755386565273, gapLengthRatio: 0.06961783169263253, gap95M: 0.16947845010824558,
    massKg: 103.49948176550686, windN: 77.07292477618971, demandRad: 0.025147919475184733,
    axisHash: "54832c55d78bdfaf9ae200fce6c86914471bd1b354a1c0bb495a96f59fca1767",
    siteHash: "98399d135abfab6fdc6601df2073a203b0dc0376e3294986345e9650ad472f5e",
  },
  "8/73/1.8": {
    leaves: 4440, axes: 184, area: 13.177267583931128,
    views: [0.2957899305555556, 0.2633463541666667, 0.2830946180555556], outer: [0.22105471847739888, 0.1669310071371927, 0.19845360824742267],
    terminalSupport: 0.9705882352941176, gapLengthRatio: 0.0404739993484962, gap95M: 0.09783233477335251,
    massKg: 10.779427113364285, windN: 32.400041712027665, demandRad: 0.04076753192115506,
    axisHash: "731aeb186902ee110370330643ba43a301c6b5e503f9ac691b38c6bf23d51596",
    siteHash: "27df14a441fef50e4ef8ef72644d3e9288fb1ddbe539240c0652be835d681518",
  },
  "40/73/1.8": {
    leaves: 22862, axes: 708, area: 70.10851124524845,
    views: [0.4708116319444444, 0.4640842013888889, 0.4382595486111111], outer: [0.5031720856463124, 0.4351704996034893, 0.4498413957176844],
    terminalSupport: 0.8809869375907112, gapLengthRatio: 0.06784298254156428, gap95M: 0.16060579724326796,
    massKg: 92.7756103958643, windN: 171.32706142542327, demandRad: 0.0349460078186905,
    axisHash: "8811d73af1e984c96e14df1cf61405f7833445374abe2df72ccfe05c1e880bff",
    siteHash: "65c0171e3033b7aab5baa46436f14bfea23c8b9cc531bcd9f54b1df70488f2cf",
  },
  "80/73/1.8": {
    leaves: 28646, axes: 869, area: 87.97508243465725,
    views: [0.4782986111111111, 0.4677734375, 0.4440104166666667], outer: [0.5245836637589215, 0.43636003172085647, 0.4655035685963521],
    terminalSupport: 0.8955974842767296, gapLengthRatio: 0.06634235525014483, gap95M: 0.1572572396828903,
    massKg: 127.03825734723647, windN: 211.84717530851177, demandRad: 0.03494600781868692,
    axisHash: "7cf50538a679ed94aeb6a2ef6fb52ef00109ef2a40ce9b358fe803a160e7fc54",
    siteHash: "db522e35eab4b40289b0306bb6f81f553db489044b1844667510185ea7652aea",
  },
  "12/1/1.8": {
    leaves: 8282, axes: 279, area: 25.21095560381309,
    views: [0.3297526041666667, 0.3556857638888889, 0.3262803819444444], outer: [0.25931800158604285, 0.27498017446471057, 0.25237906423473433],
    terminalSupport: 0.8943396226415095, gapLengthRatio: 0.05657223312193686, gap95M: 0.15126510770997093,
    massKg: 29.322716986287197, windN: 64.3375499016803, demandRad: 0.033950379356158925,
    axisHash: "6abf75908669a14dc4bb0dcd38f280dc78ea41c9b870bc11a206fb8b40eebb8c",
    siteHash: "88f2de9998fb8c35a418cd0f94158775e93984921a48c78f9c4e8299bf537afe",
  },
  "40/73/0.3": {
    leaves: 5730, axes: 661, area: 17.555291258097977,
    views: [0.19466145833333334, 0.24088541666666666, 0.20735677083333334], outer: [0.19409199048374307, 0.19547977795400476, 0.21629659000793022],
    terminalSupport: 0.8689024390243902, gapLengthRatio: 0.079012513800094, gap95M: 0.17848460365583096,
    massKg: 62.92777725745978, windN: 58.31700574440536, demandRad: 0.039441485210146725,
    axisHash: "62707eda6a911ae09fcbdb7f7f1f71ea06064491a220c6228fa7dddeab4fd66a",
    siteHash: "b639033c6e928d9ddf5a0674b49ace1ed4b8f6bdd829bd5ec5b4c448e525feb4",
  },
};

if (process.env.OSMANTHUS_SPATIAL_PROBE) {
  for (const p of samples) {
    const model = build(p);
    try {
      const d = createBeamDynamics(model); d.update(0, 3.2, 9.81, 1);
      console.log(JSON.stringify({ sample: key(p), ...spatial(model),
        massKg: d.stats.estimatedMassKg, windN: d.stats.windForceN,
        demandRad: d.stats.maxUnclampedTargetRad, clamped: d.stats.clampedBranches }));
      d.dispose();
    } finally { model.dispose(); }
  }
} else {
  test('selected actual-geometry crown occupancy and terminal support versus 1794da9', t => {
    for (const p of samples) {
      const model = build(p);
      try {
        const metric = spatial(model), before = baseline[key(p)];
        assert.equal(metric.axes, before.axes); assert.equal(metric.siteHash, before.siteHash);
        assert.equal(identity(model).axisHash, before.axisHash, 'all original woody transforms/lengths persist');
        assert.ok(Math.abs(metric.area - model.group.userData.canopyMetrics.oneSidedLeafAreaM2) < 1e-6);
        assert.ok(metric.leaves <= 28704 && model.branches.length <= 869);
        metric.views.forEach((n, i) => assert.ok(n >= before.views[i] - 1e-12, 'three actual triangle views retain occupancy'));
        metric.outer.forEach((n, i) => assert.ok(n >= before.outer[i] - 1e-12, 'outer crown coverage is retained in every view'));
        assert.ok(metric.gapLengthRatio <= before.gapLengthRatio + 1e-12);
        assert.ok(metric.terminalSupport >= before.terminalSupport - 1e-12);
        if (p.seed === 42) {
          metric.views.forEach((n, i) => assert.ok(n > before.views[i] + .01, 'supplementary connected sites fill actual spatial gaps'));
          metric.outer.forEach((n, i) => assert.ok(n > before.outer[i] + .01, 'added foliage reaches outer crown, not just basal supports'));
          assert.ok(metric.gap95M < before.gap95M * .8);
          if (p.age >= 8) assert.ok(metric.terminalSupport > .96);
        }
        if (p.density === 1.8) {
          assert.equal(metric.leaves, before.leaves, 'saturated lifetime budget is respected, even if spatial gaps remain');
          assert.deepEqual(metric.views, before.views);
        }
        if (p.age === 2 && p.density === .3) assert.equal(metric.leaves, 24, 'sparse early stage remains sparse');
        const d = createBeamDynamics(model);
        try {
          d.update(0, 3.2, 9.81, 1);
          assert.equal(d.stats.youngModulusPa, 8e9); assert.equal(d.stats.clampedBranches, 0);
          assert.ok(d.stats.maxUnclampedTargetRad < .1 && d.stats.maxDeflectionRad <= .28);
          assert.equal(d.stats.countedLeaves, metric.leaves);
          assert.ok(Math.abs(d.stats.leafAreaM2 - metric.area) < 1e-6);
          if (metric.leaves > before.leaves) {
            assert.ok(d.stats.estimatedMassKg > before.massKg, 'actual extra wood and leaf mass enter the unchanged solver');
            assert.ok(d.stats.windForceN > before.windN, 'new blades/wood contribute actual projected drag');
          }
          t.diagnostic(JSON.stringify({ sample: key(p),
            before: { views: before.views, outer: before.outer, gap95M: before.gap95M, terminalSupport: before.terminalSupport },
            after: { ...metric, axisHash: undefined, siteHash: undefined },
            massKg: d.stats.estimatedMassKg, windN: d.stats.windForceN, demandRad: d.stats.maxUnclampedTargetRad }));
        } finally { d.dispose(); }
      } finally { model.dispose(); }
    }
  });

  test('supplementary nodes retain opposite/decussate petioles and real four-lobed flower axils', () => {
    const model = build({ age: 12, seed: 42, density: 1, day: 280 });
    let extraLeaves = 0, extraFlowers = 0;
    try {
      model.update(3, 7, 9.81, 1); model.group.updateMatrixWorld(true);
      for (const b of model.branches) {
        const leaves = blades(b.pivot); if (!leaves) continue;
        const nodes = leaves.userData.nodes, stalks = b.pivot.children.find(o => o.userData.role === 'petiole');
        const m = new THREE.Matrix4(), lm = new THREE.Matrix4(); let previous;
        nodes.forEach((node, i) => {
          const directions = [];
          for (const side of [0, 1]) {
            stalks.getMatrixAt(i * 2 + side, m); leaves.getMatrixAt(i * 2 + side, lm);
            const start = new THREE.Vector3(0, -.5, 0).applyMatrix4(m);
            const end = new THREE.Vector3(0, .5, 0).applyMatrix4(m);
            const bladeBase = new THREE.Vector3().setFromMatrixPosition(lm);
            assert.ok(start.distanceTo(new THREE.Vector3(...node.attachment)) < 2e-6);
            assert.ok(start.y >= 0 && start.y <= b.length);
            assert.ok(end.distanceTo(bladeBase) < 2e-6);
            assert.ok(end.clone().applyMatrix4(stalks.matrixWorld).distanceTo(bladeBase.applyMatrix4(leaves.matrixWorld)) < 2e-6);
            assert.ok(new THREE.Vector3().setFromMatrixScale(lm).length() <= Math.sqrt(3) + 1e-7);
            directions.push(end.sub(start).setY(0).normalize());
          }
          assert.ok(directions[0].dot(directions[1]) < -.9999);
          if (previous) assert.ok(Math.abs(previous.dot(directions[0])) < .0001, 'inserted pairs preserve consecutive 90-degree planes');
          previous = directions[0];
          if (node.index >= 1000) extraLeaves += 2;
        });
        const flowers = b.pivot.children.find(o => o.userData.role === 'corolla-lobes');
        const peduncles = b.pivot.children.find(o => o.userData.role === 'axillary-peduncle');
        assert.equal(flowers.count, flowers.userData.sites.length * 4);
        flowers.userData.sites.forEach((site, i) => {
          const node = nodes.find(n => n.index === site.node); assert.ok(node);
          peduncles.getMatrixAt(i, m);
          assert.ok(new THREE.Vector3(0, -.5, 0).applyMatrix4(m).distanceTo(new THREE.Vector3(...node.attachment)) < 2e-6);
          const center = new THREE.Vector3(...site.center);
          assert.ok(new THREE.Vector3(0, .5, 0).applyMatrix4(m).distanceTo(center) < 2e-6);
          for (let lobe = 0; lobe < 4; lobe++) {
            flowers.getMatrixAt(i * 4 + lobe, m);
            assert.ok(new THREE.Vector3().setFromMatrixPosition(m).distanceTo(center) < 2e-6);
          }
          if (node.index >= 1000) extraFlowers++;
        });
      }
      assert.ok(extraLeaves > 1000 && extraFlowers > 1000, 'test actual added supports, not just old nodes');
    } finally { model.dispose(); }
  });

  test('fixed supplementary material sites are reached at birth, expand continuously and persist across ages', () => {
    const adult = build({ age: 80, seed: 42, density: 1 });
    const selected = [];
    try {
      for (const order of [0, 1, 2]) {
        const b = adult.branches.find(b => b.order === order && blades(b.pivot)?.userData.nodes.some(n => n.index >= 1000));
        const nodes = blades(b.pivot).userData.nodes.filter(n => n.index >= 1000);
        for (const node of [nodes[0], nodes.at(-1)]) selected.push({ id: b.pivot.userData.axisId, node });
      }
      for (const { id, node } of selected) {
        const at = build({ age: node.birth, seed: 42, density: 1 });
        const before = build({ age: node.birth - 1e-5, seed: 42, density: 1 });
        const after = build({ age: node.birth + 1e-5, seed: 42, density: 1 });
        try {
          const axisAt = at.branches.find(b => b.pivot.userData.axisId === id);
          assert.ok(Math.abs(axisAt.length - node.lengthAtBirth) < 1e-12);
          assert.ok(node.attachment[1] <= axisAt.length && node.attachment[1] >= .95 * axisAt.length);
          const old = before.branches.find(b => b.pivot.userData.axisId === id);
          assert.ok(!blades(old.pivot)?.userData.nodes.some(n => n.index === node.index));
          const fresh = after.branches.find(b => b.pivot.userData.axisId === id);
          const born = blades(fresh.pivot).userData.nodes.find(n => n.index === node.index);
          assert.ok(born.scale > 0 && born.scale < 1e-7);
          assert.deepEqual(born.attachment, node.attachment);
          const a = new THREE.Box3().setFromObject(before.group), b = new THREE.Box3().setFromObject(after.group);
          assert.ok(a.min.distanceTo(b.min) < .0003 && a.max.distanceTo(b.max) < .0003);
        } finally { at.dispose(); before.dispose(); after.dispose(); }
      }
    } finally { adult.dispose(); }
    let previous;
    for (const age of [2, 8, 12, 40, 80]) {
      const model = build({ age, seed: 42, density: 1 });
      const before = build({ age: age - 1e-5, seed: 42, density: 1 });
      const after = build({ age: age + 1e-5, seed: 42, density: 1 });
      try {
        const a = new THREE.Box3().setFromObject(before.group), b = new THREE.Box3().setFromObject(after.group);
        assert.ok(a.min.distanceTo(b.min) < .0003 && a.max.distanceTo(b.max) < .0003,
          `actual generated bounds remain continuous around age ${age}`);
        const now = new Map(model.branches.map(b => [b.pivot.userData.axisId,
          new Map((blades(b.pivot)?.userData.nodes ?? []).map(n => [n.index, [n.birth, n.attachment, n.angle]]))]));
        if (previous) for (const [id, nodes] of previous) for (const [index, site] of nodes) {
          assert.deepEqual(now.get(id)?.get(index), site, `retained material site ${id}/${index}`);
        }
        previous = now;
      } finally { model.dispose(); before.dispose(); after.dispose(); }
    }
  });

  test('whole-life catalogue and actual flower-season draws fit the original leaf/axis budgets', () => {
    // Include the intermediate reserve-allocation regime as well as the
    // saturated catalogue. Test real generated meshes, not a copied allocator.
    for (const [seed, density] of [[1, .15], [1, .3], [42, 1], [42, 1.3], [73, 1.8], [73, 2]]) {
      const model = build({ age: 1000, seed, density, day: 280 });
      try {
        let draws = 0;
        model.group.traverse(o => { if (o.isMesh) draws++; });
        const budget = model.group.userData.architecture;
        assert.ok(model.leafCount <= budget.leafCatalogue.lifetimePairsBound * 2);
        assert.ok(budget.leafCatalogue.lifetimePairsBound * 2 <= 28704);
        assert.ok(model.branches.length <= 869 && draws <= budget.maxDrawBudget);
        assert.equal(budget.maxDrawBudget, 5216);
      } finally { model.dispose(); }
    }
  });
}
