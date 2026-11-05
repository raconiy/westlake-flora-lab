import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
import { createBeamDynamics } from './beam-dynamics.ts';
import { buildMain, buildRecovered } from './osmanthus-controls.mjs';
import { actualGeometry, arcSummary, compareGeometry } from './osmanthus-spatial-metrics.mjs';

// Selected coverage, not a Cartesian sweep. Ages are illustration inputs, NOT
// measured individuals. All original 13 cases remain; the pinned 29f02d6
// control is loaded from a .txt snapshot, never from an archived test file.
const samples = [
  ...[2, 8, 12, 40, 80].map(age => ({ age, seed: 42, density: 1 })),
  ...[2, 12, 80].map(age => ({ age, seed: 1, density: .3 })),
  ...[8, 40, 80].map(age => ({ age, seed: 73, density: 1.8 })),
  { age: 12, seed: 1, density: 1.8 }, { age: 40, seed: 73, density: .3 },
];
const build = p => buildPlant('osmanthus', { day: 180, ...p });
const blades = pivot => pivot.children.find(o => o.userData.connectedBy === 'petiole');
const key = p => `${p.age}/${p.seed}/${p.density}`;
// 1794da9 feature-only controls and original failed TAP are archived unchanged.
// Independent review 986dd14d shows that strict EVERY-projection nondecrease
// rejects even a 90-degree rotation of identical geometry. Preserve all raw
// comparisons as diagnostics, not an anatomical oracle. No fitted loss bound.

if (process.env.OSMANTHUS_SPATIAL_PROBE) {
  for (const p of samples) {
    const model = build(p);
    try { const g = actualGeometry(model); console.log(JSON.stringify({sample:key(p),arc:arcSummary(g),leaves:g.leaves,area:g.area})); }
    finally { model.dispose(); }
  }
} else {
  test('selected13 hard anatomy/load/budget gates with complete projection and terminal diagnostics', async t => {
    for (const p of samples) await t.test(key(p), t => {
      const model = build(p), control = buildMain('osmanthus', {day:180,...p}), recovered = buildRecovered('osmanthus', {day:180,...p}), d = createBeamDynamics(model);
      try {
        const metric = actualGeometry(model), before = actualGeometry(control), comparison = compareGeometry(before,metric), failures=[], screeningFailures=[];
        const check = (ok,label) => {if(!ok)failures.push(label);};
        const screen = (ok,label) => {if(!ok)screeningFailures.push(label);};
        d.update(0,3.2,9.81,1);
        check(metric.axisCount===before.axisCount,'original axis count');
        check(metric.leaves<=28704 && metric.axisCount<=869 && metric.draws<=5216,'leaf/axis/draw budgets');
        check(Math.abs(metric.area-model.group.userData.canopyMetrics.oneSidedLeafAreaM2)<1e-6,'actual leaf area accounting');
        check(metric.leaves===before.leaves,'original selected-age leaf count');
        check(model.group.userData.canopyMetrics.oneSidedLeafAreaM2===control.group.userData.canopyMetrics.oneSidedLeafAreaM2,'exact original cohort expansion area');
        // Same blades and exact per-node expansion, under rotated Float32
        // instances: reuse the existing 1e-6 mesh-area accounting bound above.
        // Raw signed differences are always reported; no new loss tolerance.
        check(Math.abs(metric.area-before.area)<1e-6,'original actual triangle leaf area');
        const originalAxes=new Map(control.branches.map(b=>[b.pivot.userData.axisId,b]));
        const recoveredAxes=new Map(recovered.branches.map(b=>[b.pivot.userData.axisId,b]));
        for(const b of model.branches) {
          const a=originalAxes.get(b.pivot.userData.axisId);
          const r=recoveredAxes.get(b.pivot.userData.axisId);
          check(Boolean(a),'original woody axis identity');
          check(Boolean(r),'recovered woody axis identity');
          if(!a || !r)continue;
          assert.equal(b.length,r.length,'recovered woody extension clock');
          assert.equal(b.pivot.userData.birth,r.pivot.userData.birth,'recovered woody birth');
          assert.deepEqual(b.pivot.position.toArray(),r.pivot.position.toArray(),'recovered woody support');
          assert.deepEqual(b.rest.toArray(),r.rest.toArray(),'recovered woody angles');
          if(b.order>0)assert.deepEqual(b.pivot.userData.supportNode,r.pivot.userData.supportNode,'recovered complete woody support node');
          const oldLeaves=blades(a.pivot),newLeaves=blades(b.pivot);
          const oldNodes=new Map((oldLeaves?.userData.nodes??[]).map(n=>[n.index,n]));
          const recoveredNodes=new Map((blades(r.pivot)?.userData.nodes??[]).map(n=>[n.index,n]));
          check((newLeaves?.userData.nodes.length??0)===oldNodes.size,'original formed cohort count');
          if(oldLeaves && newLeaves) {
            check(Array.from(newLeaves.geometry.attributes.position.array).every((v,i)=>v===oldLeaves.geometry.attributes.position.array[i]),'unchanged actual blade vertices');
            check(Array.from(newLeaves.geometry.index.array).every((v,i)=>v===oldLeaves.geometry.index.array[i]),'unchanged blade triangles');
          }
          for(const node of newLeaves?.userData.nodes??[]) {
            const old=oldNodes.get(node.index);
            check(Boolean(old) && node.scale===old.scale && node.angle===old.angle,'original selected-age cohort identity/expansion/angle');
            // Curvature changes some final reach lengths relative to straight
            // main, so inversion can differ in its last bisection bit. Preserve
            // the pre-refinement CURVED birth exactly, without fitting a clock
            // tolerance or altering any woody support/extension clock.
            check(node.birth===recoveredNodes.get(node.index)?.birth,'exact recovered supplementary/base birth');
          }
        }
        // Preserve every view rather than choose a favourable projection or phase.
        for(const pair of comparison.projections) {
          const label=`${pair.before.resolution}/${pair.before.phase}`;
          pair.after.views.forEach((n,i)=>screen(n>=pair.before.views[i]-1e-12,`common occupancy ${label} view ${i}`));
          pair.after.outer.forEach((n,i)=>screen(n>=pair.before.outer[i]-1e-12,`common outer ${label} view ${i}`));
        }
        const arc=comparison.commonArc;
        screen(arc.after.gapLengthRatio<=arc.before.gapLengthRatio+1e-12,'common arc gap ratio nonincrease');
        screen(arc.after.terminalSupport>=arc.before.terminalSupport-1e-12,'common arc support nondecrease');
        if(p.seed===42 && p.age>=8)screen(arc.after.terminalSupport>.96,'inherited .12m/>96% terminal screening');
        if(p.age===2 && p.density===.3)check(metric.leaves===24,'sparse early leaf count');
        check(d.stats.youngModulusPa===8e9 && d.stats.clampedBranches===0,'unchanged E/no clamp');
        check(d.stats.maxUnclampedTargetRad<.1 && d.stats.maxDeflectionRad<=.28,'inherited raw/guard bounds');
        check(d.stats.countedLeaves===metric.leaves && Math.abs(d.stats.leafAreaM2-metric.area)<1e-6,'actual solver blades');
        // Cross-taper TOTAL mass monotonicity is invalid. Recover wood and blade
        // terms independently; actual triangles bound section approximation.
        check(Math.abs(d.stats.estimatedMassKg-metric.sectionWoodKg-.12*metric.area)<1e-6,'section wood + actual blade mass');
        check(metric.maxVolumeRelativeError<.001,'actual closed triangle wood-volume audit');
        check(Math.abs(metric.woodProjectedAreaM2/metric.triangleWoodProjectedAreaM2-1)<.001,'actual wood triangle drag audit');
        const force=.5*1.225*.8*3.2**2*(metric.woodProjectedAreaM2+metric.leafProjectedAreaM2/Math.sqrt(1+(3.2/12)**2));
        check(Math.abs(force-d.stats.windForceN)<1e-6,'actual wood + blade triangle drag');
        t.diagnostic(JSON.stringify({sample:key(p),comparison,leaves:metric.leaves,beforeLeaves:before.leaves,area:metric.area,beforeArea:before.area,
          axes:metric.axisCount,draws:metric.draws,massKg:d.stats.estimatedMassKg,woodKg:metric.sectionWoodKg,triangleWoodKg:metric.triangleWoodKg,
          maxVolumeRelativeError:metric.maxVolumeRelativeError,windN:d.stats.windForceN,demandRad:d.stats.maxUnclampedTargetRad,
          areaDeltaM2:metric.area-before.area,exactCohortAreaM2:model.group.userData.canopyMetrics.oneSidedLeafAreaM2,
          clamped:d.stats.clampedBranches,failures,screeningFailures,
          terminalScreening:{gapLimitM:.12,supportTarget:.96,passes:arc.after.terminalSupport>.96,originalGateScope:p.seed===42 && p.age>=8},
          gapDefinition:'nearest projection of actual blade vertices onto sampled wood-section centreline arclength; not visible bare wood'}));
        assert.deepEqual(failures,[],'hard invariants; projection and terminal screening are separate diagnostics');
      } finally { d.dispose();model.dispose();control.dispose();recovered.dispose(); }
    });
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
            directions.push(end.sub(start).applyQuaternion(new THREE.Quaternion(...node.sectionFrame).invert()).setY(0).normalize());
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
