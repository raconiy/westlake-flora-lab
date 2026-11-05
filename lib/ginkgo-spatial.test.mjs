import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
import { woodSections } from './wood-loads.ts';

// Morphology, not a fit to an individually measured campus tree:
// https://plants.ces.ncsu.edu/plants/ginkgo-biloba/ (lead's institutional cache)
// https://plants.usda.gov/DocumentLibrary/plantguide/pdf/pg_ginkg.pdf
// The reference photos show clustered fans on connected axes and a variable,
// often open crown. Occupancy thresholds below are engineering failure guards,
// not measured biological targets. Leaf-area ratio alone cannot establish habit.
const ages = [18, 45, 80, 120, 200];
const round = x => +x.toFixed(4);

function eigenvalues(matrix) {
  const a = matrix.map(row => [...row]);
  for (let step = 0; step < 16; step++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const angle = .5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(angle), s = Math.sin(angle);
    const pp = a[p][p], qq = a[q][q], pq = a[p][q];
    for (let k = 0; k < 3; k++) if (k !== p && k !== q) {
      const kp = a[k][p], kq = a[k][q];
      a[k][p] = a[p][k] = c * kp - s * kq;
      a[k][q] = a[q][k] = s * kp + c * kq;
    }
    a[p][p] = c*c*pp - 2*s*c*pq + s*s*qq;
    a[q][q] = s*s*pp + 2*s*c*pq + c*c*qq;
    a[p][q] = a[q][p] = 0;
  }
  return [a[0][0], a[1][1], a[2][2]].sort((a,b) => a-b);
}

function inspect(model) {
  model.group.updateMatrixWorld(true);
  const bases = new Map(), points = [], fullAxes = new Map(), moduleSizes = new Map();
  const matrix = new THREE.Matrix4(), base = new THREE.Vector3(), world = new THREE.Vector3(), scale = new THREE.Vector3();
  let fractionSum = 0, allocated = 0, supported = 0;
  const along = [0, 0, 0];
  model.group.traverse(o => {
    if (!o.isInstancedMesh || o.userData.connectedBy !== 'petiole') return;
    const stalk = o.parent.children.find(s => s.isInstancedMesh && s.userData.organ === 'leaf' && !s.userData.connectedBy);
    assert.ok(stalk); assert.equal(stalk.count, o.count);
    const axes = new Map((o.parent.userData.foliationAxes ?? []).map(a => {
      const start = new THREE.Vector3().fromArray(a.start), delta = new THREE.Vector3().fromArray(a.end).sub(start);
      return [a.idPrefix, {...a, start, delta, lengthSq:delta.lengthSq()}];
    }));
    const supportSamples = new Map();
    for (let i = 0; i < o.count; i++) {
      const id = o.userData.nodeIds[i];
      assert.ok(!bases.has(id), `duplicate site ${id}`);
      stalk.getMatrixAt(i, matrix);
      base.set(0, -.5, 0).applyMatrix4(matrix);
      world.copy(base).applyMatrix4(stalk.matrixWorld);
      if (!id.startsWith('stem-')) bases.set(id, world.toArray());
      points.push(world.toArray());
      o.getMatrixAt(i, matrix);
      scale.setFromMatrixScale(matrix);
      assert.ok(scale.x <= 1.05 && scale.y <= 1.05, 'spatial coverage must not enlarge leaves');
      const match = /^(.*\/cohort:\d+)\/spur:(\d+)\/leaf:(\d+)$/.exec(id);
      if (!match) continue;
      const axis = axes.get(match[1]); assert.ok(axis, `missing full candidate axis ${id}`);
      const module = `${match[1]}/spur:${match[2]}`;
      moduleSizes.set(module, (moduleSizes.get(module) ?? 0) + 1);
      if (axis.formedFraction < .999) continue; // do not confuse growth with allocation
      // Actual petiole bases projected onto the full material axis, rather than
      // normalizing by the last occupied spur (which would hide a prefix bug).
      const fraction = ((base.x-axis.start.x)*axis.delta.x+(base.y-axis.start.y)*axis.delta.y+(base.z-axis.start.z)*axis.delta.z) / axis.lengthSq;
      fractionSum += fraction; allocated++;
      along[fraction < 1/3 ? 0 : fraction < 2/3 ? 1 : 2]++;
      if (!fullAxes.has(match[1])) fullAxes.set(match[1], new Set());
      fullAxes.get(match[1]).add(+match[2] / Math.max(1, axis.candidateSpurs - 1));
      // Sample both ends of the occupied catalogue on each scaffold, including
      // the distal leaves newly admitted by a spread reservation.
      for (const [key, better] of [['proximal', (x,y) => x < y], ['distal', (x,y) => x > y]]) {
        const old = supportSamples.get(key);
        if (!old || better(fraction, old.fraction)) supportSamples.set(key, {id, fraction, base: base.clone()});
      }
    }
    if (!supportSamples.size) return;
    const sections = o.parent.children.filter(s => s.isMesh && !s.isInstancedMesh)
      .flatMap(s => woodSections(s.geometry).map(section => ({
        line: new THREE.Line3(new THREE.Vector3().fromArray(section.a).applyMatrix4(s.matrix), new THREE.Vector3().fromArray(section.b).applyMatrix4(s.matrix)),
        radius: Math.sqrt(Math.max(section.areaA, section.areaB) / Math.PI)
      })));
    const closest = new THREE.Vector3();
    for (const sample of supportSamples.values()) {
      assert.ok(sections.some(s => s.line.closestPointToPoint(sample.base, true, closest).distanceTo(sample.base) <= s.radius + .001), `unsupported ${sample.id}`);
      supported++;
    }
  });
  assert.ok(allocated > 100 && supported >= 4);
  const box = new THREE.Box3().setFromPoints(points.map(p => new THREE.Vector3(...p))), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const voxels = new Set(), projections = [new Set(), new Set(), new Set()], sectors = Array(8).fill(0), heights = Array(4).fill(0);
  const sums = [0,0,0], products = Array.from({length:3}, () => [0,0,0]);
  for (const p of points) {
    const u = p.map((v,i) => Math.max(0, Math.min(.999999, (v-box.min.getComponent(i))/size.getComponent(i))));
    voxels.add(u.map(v => Math.floor(v*6)).join(','));
    for (const [i,[a,b]] of [[0,[0,1]], [1,[1,2]], [2,[0,2]]]) projections[i].add(`${Math.floor(u[a]*24)},${Math.floor(u[b]*24)}`);
    sectors[Math.min(7, Math.floor((Math.atan2(p[2]-centre.z, p[0]-centre.x)+Math.PI)/(2*Math.PI)*8))]++;
    heights[Math.floor(u[1]*4)]++;
    for (let i=0;i<3;i++) { sums[i]+=p[i]; for (let j=0;j<3;j++) products[i][j]+=p[i]*p[j]; }
  }
  const count=points.length, covariance=products.map((row,i) => row.map((v,j) => v/count-sums[i]*sums[j]/count**2));
  const eigen=eigenvalues(covariance), shares=along.map(v => v/allocated);
  let spanning=0, multiple=0;
  for (const modules of fullAxes.values()) if (modules.size>=2) { multiple++; if (Math.max(...modules)-Math.min(...modules) >= .35) spanning++; }
  return {bases, summary:{leaves:count, fullAxisLeaves:allocated, meanAxisFraction:round(fractionSum/allocated), axisThirds:shares.map(round),
    spanningModuleShare:round(spanning/Math.max(1,multiple)), multiLeafModuleShare:round([...moduleSizes.values()].filter(n=>n>=3).length/moduleSizes.size),
    covarianceMinMax:round(eigen[0]/eigen[2]), occupiedVoxels:voxels.size, projectedBaseOccupancy:projections.map(s=>round(s.size/576)),
    azimuthShares:sectors.map(v=>round(v/count)), heightShares:heights.map(v=>round(v/count)), supportedSamples:supported}};
}

function assertSpatial(summary) {
  assert.ok(summary.meanAxisFraction > .38 && summary.meanAxisFraction < .65, 'no proximal-only fill allocation');
  assert.ok(summary.axisThirds[0] > .2 && summary.axisThirds[2] > .2, 'both ends of full candidate axes receive clustered foliage');
  assert.ok(summary.spanningModuleShare > .8, 'occupied spur modules span the complete catalogue');
  assert.ok(summary.multiLeafModuleShare > .35, 'retain compressed multi-leaf short shoots even at low density');
  assert.ok(summary.covarianceMinMax > .04, 'foliage occupies a 3D volume, not a plane with two visible sides');
  assert.ok(summary.occupiedVoxels >= 35);
  assert.ok(summary.projectedBaseOccupancy.every(v=>v>.12), 'three orthogonal projections have distributed petiole bases');
  // Open young crowns need not populate every octant equally. Require material
  // in all four quadrants as well as the rotation-independent covariance guard.
  assert.ok([0,2,4,6].every(i=>summary.azimuthShares[i]+summary.azimuthShares[i+1]>.04), 'no two-sided azimuth distribution');
  assert.ok(summary.heightShares[2]+summary.heightShares[3] > .15 && summary.heightShares[0] < .55, 'no basal-only foliage');
}

test('ginkgo spread allocation occupies supported 3D crowns and persists over ages, seeds and nested densities', t => {
  // Orthogonal coverage: all five ages for each seed, one density per seed.
  // The existing density/persistence suites own the expensive Cartesian sweep.
  for (const [seed, density] of [[1,.3], [42,1], [73,1.8]]) {
    let previous;
    for (const age of ages) {
      const model=buildPlant('ginkgo', {age, day:180, seed, density});
      let now;
      try {
        now=inspect(model);
        t.diagnostic(JSON.stringify({seed,age,density,...now.summary}));
        assertSpatial(now.summary);
        const m=model.group.userData.canopyMetrics;
        assert.ok(m.lifetimeLeafSiteCapacity<=160000 && model.leafCount<=m.potentialLeafCount);
        assert.ok(model.height<=m.leaderHeightM*1.12+.04, 'preserve leader envelope');
        if (seed===42 && age===45) {
          assert.ok(model.leafCount>80000 && m.oneSidedLeafAreaM2>150);
          assert.ok(m.projectedCrownAreaM2>50 && m.leafAreaRatio>=2 && m.leafAreaRatio<=3.5);
        }
        if (previous) for (const [id,point] of previous.bases) {
          const next=now.bases.get(id);assert.ok(next, `age evicted ${id}`);
          assert.ok(Math.hypot(...point.map((v,i)=>v-next[i]))<3e-6, `age moved ${id}`);
        }
      } finally {model.dispose();}
      previous=now;
      if (seed===42 && age===45) {
        for (const d of [.3,1.8]) {
          const variant=buildPlant('ginkgo', {age, day:180, seed, density:d});
          try {
            const other=inspect(variant); assertSpatial(other.summary);
            const [small,large]=d<density?[other,now]:[now,other];
            assert.ok(small.summary.leaves<large.summary.leaves);
            for (const [id,point] of small.bases) {
              const next=large.bases.get(id);assert.ok(next, `density evicted ${id}`);
              assert.ok(Math.hypot(...point.map((v,i)=>v-next[i]))<3e-6, `density moved ${id}`);
            }
            t.diagnostic(JSON.stringify({seed,age,density:d,...other.summary}));
          } finally {variant.dispose();}
        }
      }
    }
  }
});
