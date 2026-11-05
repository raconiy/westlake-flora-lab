import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import {buildRhizosphere} from './rhizosphere.ts';
import {buildPlant} from './plant-engine.ts';
import {buildAdditionalPlant} from './additional-species.ts';
import {rootCollarBridge} from './root-collar-bridge.ts';
import {createBeamDynamics} from './beam-dynamics.ts';
import {modelGeometryFrame, unionGeometryFrames, perspectiveGeometryFrame} from './scene-framing.ts';

// SHA-pinned control travels with the source; tests also work in CI's shallow
// checkout and source archives without requiring an older Git object.
const baseline = JSON.parse(readFileSync(new URL('../artifacts/root-zone-window/source-baseline.json', import.meta.url)));
const originalSource = readFileSync(new URL('../artifacts/root-zone-window/rhizosphere-before.txt', import.meta.url), 'utf8');
const sha = data => createHash('sha256').update(data).digest('hex');
assert.equal(sha(originalSource), baseline.sha256['rhizosphere.ts']);
const original = originalSource.replace(/from (['"])([^'"]+)\1/g, (_match, quote, name) => `from ${quote}${import.meta.resolve(name)}${quote}`);
const controlJS = ts.transpileModule(original, {compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
}}).outputText;
const {buildRhizosphere: buildControl} = await import(`data:text/javascript;base64,${Buffer.from(controlJS).toString('base64')}`);

const speciesList = ['ginkgo', 'osmanthus', 'camphor', 'acer', 'iris', 'oxalis', 'ophiopogon'];
const ages = [0, .04, .12, .5, 1, 18];
const defaults = {day: 180, density: 1, moisture: .62, compaction: .25, cutaway: true};

test('geometry, material-node birth, mass/load, contact and camera source modules remain byte-identical to the control', () => {
  for (const name of ['plant-engine.ts', 'additional-species.ts', 'woody-root-development.ts', 'development.ts',
    'beam-dynamics.ts', 'physical-priors.ts', 'wood-loads.ts', 'root-collar-bridge.ts', 'scene-framing.ts']) {
    assert.equal(sha(readFileSync(new URL(name, import.meta.url))), baseline.sha256[name], name);
  }
});
function shoot(species, params) {
  return ['camphor', 'acer', 'ophiopogon'].includes(species)
    ? buildAdditionalPlant(species, params) : buildPlant(species, params);
}
function collarParams(plant, species) {
  const joint = plant.branches.find(b => b.order === 0);
  return joint ? {position: joint.pivot.position.toArray(), radius: joint.radius * (species === 'ginkgo' ? 1.35 : species === 'osmanthus' ? 1 : 1.4)} : undefined;
}
function rootSignature(model) {
  return model.group.children.filter(o => o.isMesh && o.userData.organ !== 'soil').map(mesh => {
    const hash = createHash('sha256');
    const attributes = Object.entries(mesh.geometry.attributes).map(([name, attribute]) => {
      hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
      return [name, attribute.itemSize, attribute.normalized, attribute.array.constructor.name];
    });
    const index = mesh.geometry.index;
    if (index) hash.update(Buffer.from(index.array.buffer, index.array.byteOffset, index.array.byteLength));
    const material = mesh.material.toJSON(); delete material.uuid;
    return {name: mesh.name, userData: mesh.userData, geometryData: mesh.geometry.userData,
      attributes, indexType: index?.array.constructor.name, data: hash.digest('hex'), material,
      position: mesh.position.toArray(), rotation: mesh.rotation.toArray(), scale: mesh.scale.toArray(),
      castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, visible: mesh.visible};
  });
}
function assertSameRoots(model, control, label) {
  assert.deepEqual(rootSignature(model), rootSignature(control), `${label}: exact root/collar buffers, material, birth/node metadata and transforms`);
  for (const key of ['rootDepth', 'rootLength', 'rootTips', 'availableWater', 'waterStress']) {
    assert.equal(model[key], control[key], `${label}: ${key}`);
  }
  const metadata = {...model.group.userData}, baseline = {...control.group.userData};
  for (const key of ['profileDepth', 'profileWidth', 'profileScope']) { delete metadata[key]; delete baseline[key]; }
  assert.deepEqual(metadata, baseline, `${label}: non-display source properties`);
}
function assertContained(model, label) {
  const width = model.group.userData.profileWidth;
  const soil = model.group.children.filter(o => o.userData.organ === 'soil');
  const soilBox = new THREE.Box3(); soil.forEach(o => soilBox.union(new THREE.Box3().setFromObject(o, true)));
  model.group.updateMatrixWorld(true);
  model.group.traverse(mesh => {
    if (!mesh.isMesh || mesh.userData.organ === 'soil') return;
    const positions = mesh.geometry.attributes.position, point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      assert.ok(point.toArray().every(Number.isFinite), `${label}: finite vertex`);
      assert.ok(Math.abs(point.x) <= width / 2 - .009 && Math.abs(point.z) <= width / 2 - .009,
        `${label}: every root/collar vertex has horizontal margin`);
      assert.ok(point.y >= soilBox.min.y + .0029, `${label}: bottom margin, even at available-depth cap`);
      // The upper collar and exposed herb attachments legitimately cross y=0;
      // the window is a footprint/depth, not the opaque half-soil volume.
    }
  });
  assert.equal(model.profileScope, 'local-root-zone-window-not-bedrock');
  assert.equal(model.group.userData.profileScope, model.profileScope);
  assert.equal(model.availableSoilDepth, model.group.userData.soilDepth);
  assert.ok(model.profileDepth <= model.availableSoilDepth);
  assert.equal(soil.length, 3);
  assert.ok(soil.every(o => o.name.includes('示意')));
  assert.ok(soilBox.min.z >= 0, 'cutaway front half stays open');
}

test('actual mesh windows contain all seven species, collars and shallow roots; all non-display properties match HEAD control', t => {
  let cases = 0;
  for (const species of speciesList) for (const age of ages) for (const seed of [42, 73]) {
    const params = {...defaults, age, seed}, plant = shoot(species, params);
    try {
      const shootCollar = collarParams(plant, species);
      for (const soilDepth of [.05, 2.5]) {
        const input = {...params, soilDepth, shootCollar};
        const model = buildRhizosphere(species, input), control = buildControl(species, input);
        const label = `${species}/${age}/${seed}/${soilDepth}`;
        try {
          assertSameRoots(model, control, label);
          assertContained(model, label);
          const expected = Math.max(0, Math.min(1, (input.moisture - .08) / .58))
            * (1 - .62 * input.compaction) * Math.max(.2, Math.min(1, soilDepth / .8));
          assert.equal(model.availableWater, expected, `${label}: water still uses available soil depth`);
          cases++;
        } finally { model.dispose(); control.dispose(); }
      }
    } finally { plant.dispose(); }
  }
  t.diagnostic(`${cases} scenarios; exact source/control buffer comparisons, CPU only`);
});

test('translated wide collars and late root catalogues expand the window rather than clipping or hiding geometry', () => {
  for (const species of speciesList) for (const seed of [42, 73]) for (const cutaway of [true, false]) {
    const model = buildRhizosphere(species, {...defaults, age: 1500, seed, soilDepth: 8, cutaway,
      shootCollar: {position: [.8, .015, -.6], radius: .24}});
    try {
      // Full soil and cutaway use the same virtual footprint, while only the
      // cutaway has an open front. Check the full mesh bounds in either mode.
      const box = new THREE.Box3();
      model.group.children.filter(o => o.userData.organ !== 'soil').forEach(o => box.union(new THREE.Box3().setFromObject(o, true)));
      assert.ok(model.group.userData.profileWidth / 2 > Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) + .009);
      assert.ok(model.profileDepth >= -box.min.y);
      if (cutaway) assertContained(model, species);
    } finally { model.dispose(); }
  }
});

test('the actual collar bridge stays inside the footprint under existing maximum loads, with identical contact geometry', () => {
  for (const species of speciesList.slice(0, 4)) for (const age of [.04, .12, .5, 1, 18]) {
    const params = {...defaults, age, seed: 73}, plant = shoot(species, params);
    const dynamics = createBeamDynamics(plant);
    try {
      for (const soilDepth of [.05, 2.5]) {
        const input = {...params, soilDepth, shootCollar: collarParams(plant, species)};
        const model = buildRhizosphere(species, input), control = buildControl(species, input);
        try {
          const bridge = rootCollarBridge(plant, model), oldBridge = rootCollarBridge(plant, control);
          for (const [wind, gravity] of [[0, 0], [12, 19.62]]) {
            for (let i = 0; i <= 24; i++) dynamics.update(i / 60, wind, gravity, .2);
            bridge?.update(); oldBridge?.update();
            assertSameRoots(model, control, `${species}/${age}: loaded`);
            assertContained(model, `${species}/${age}: loaded`);
          }
        } finally { model.dispose(); control.dispose(); }
      }
    } finally { dynamics.dispose(); plant.dispose(); }
  }
});

test('Acer at 0.5 years gets a local window and a materially closer unchanged section fit', t => {
  const params = {...defaults, age: .5, seed: 42, soilDepth: 2.5}, plant = shoot('acer', params);
  const input = {...params, shootCollar: collarParams(plant, 'acer')};
  const model = buildRhizosphere('acer', input), control = buildControl('acer', input);
  try {
    assert.ok(model.profileDepth < .2);
    assert.ok(model.group.userData.profileWidth < .4);
    const plantFrame = modelGeometryFrame(plant.group);
    const frame = soil => perspectiveGeometryFrame(unionGeometryFrames(plantFrame, modelGeometryFrame(soil.group)), new THREE.Vector3(.8, .44, -2.1), 35, 1.5);
    const local = frame(model), old = frame(control);
    assert.ok(local.distance < old.distance * .4, 'existing camera fit spends less space on empty soil');
    assertSameRoots(model, control, 'Acer reproduction');
    t.diagnostic(`window ${model.group.userData.profileWidth.toFixed(4)} m wide × ${model.profileDepth.toFixed(4)} m deep; previous ${control.group.userData.profileWidth.toFixed(4)} × ${control.profileDepth.toFixed(4)} m; CPU fit distance ${local.distance.toFixed(4)} vs ${old.distance.toFixed(4)} m`);
  } finally { model.dispose(); control.dispose(); plant.dispose(); }
});

test('actual UI caption distinguishes local depth, clamped available depth and illustrative strata in both root modes', () => {
  const source = ts.createSourceFile('page.tsx', readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'small') {
      const child = node.children.find(n => ts.isJsxExpression(n) && n.expression?.getText(source).includes('rootStats.profileDepth'));
      if (child) expression = child.expression.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(expression, 'use the actual scene caption expression');
  const caption = new Function('organView', 'rootStats', `return (${expression});`);
  for (const species of speciesList) {
    const model = buildRhizosphere(species, {...defaults, age: .5, seed: 42, soilDepth: .001});
    try {
      for (const view of ['section', 'root']) {
        assert.equal(caption(view, model), '局部根区窗口 0.05 m（非基岩）· 可用土层 0.05 m · 土层示意');
      }
      assert.equal(caption('plant', model), '场景范围 · 个体位置待采集');
      assert.equal(caption('leaf', model), '器官近景 · 中性观察补光');
      assert.equal(caption('stem', model), '树皮细节 · 外观参数待实测');
    } finally { model.dispose(); }
  }
});
