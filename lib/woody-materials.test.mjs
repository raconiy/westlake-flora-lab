import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildPlant} from './plant-engine.ts';
import {buildAdditionalPlant} from './additional-species.ts';
import {createLeafDynamics} from './leaf-dynamics.ts';
import {BARK_TILE_METRES, WOODY_SURFACE_EVIDENCE, mapWoodyLeafUV, mapWoodyBarkUV, wireWoodyLeafSurface, wireWoodyBarkSurface} from './woody-materials.ts';

const base = {age: 18, day: 180, seed: 42, density: .3};
const build = (species, params = base) => (species === 'osmanthus' ? buildPlant : buildAdditionalPlant)(species, params);
function surfaces(model) {
  const materials = new Set(), geometries = new Set(), textures = new Set();
  model.group.traverse(o => {
    if (!o.isMesh) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
  });
  return {materials, geometries, textures};
}
const leaves = m => { let leaf; m.group.traverse(o => {if (!leaf && o.userData.connectedBy === 'petiole') leaf = o}); return leaf };
const snapshot = g => ({index: g.index?.array.slice(), attributes: Object.fromEntries(Object.entries(g.attributes).filter(([name]) => name !== 'uv').map(([name, a]) => [name, a.array.slice()])), userData: structuredClone(g.userData), bounds: [g.boundingBox?.clone(), g.boundingSphere?.clone()]});

for (const species of ['osmanthus', 'camphor', 'acer']) {
  test(`${species}: actual blade UVs align base/midrib and retain geometry, attributes and bounds`, () => {
    const m = build(species), blade = leaves(m), g = blade.geometry;
    try {
      g.computeBoundingBox(); g.computeBoundingSphere(); const before = snapshot(g);
      const uvBefore = g.attributes.uv.array.slice(); mapWoodyLeafUV(g, species);
      assert.deepEqual(snapshot(g), before); assert.deepEqual(g.attributes.uv.array, uvBefore, 'UV mapping is idempotent');
      const p = g.attributes.position, uv = g.attributes.uv; let baseFound = false;
      assert.equal(p.count, uv.count);
      for (let i = 0; i < p.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        assert.ok(u >= -1e-7 && u <= 1 + 1e-7 && v >= -1e-7 && v <= 1 + 1e-7, 'actual silhouette fits texture');
        if (Math.abs(p.getX(i)) + Math.abs(p.getY(i)) < 1e-8) {
          baseFound = true; assert.ok(Math.abs(u - .5) < 1e-7);
          assert.ok(Math.abs(v - (species === 'acer' ? .2875 : 0)) < 1e-7, 'base is correctly located inside palmate texture');
        }
      }
      assert.ok(baseFound);
      m.group.traverse(o => {if (o.isMesh && (o.userData.organ === 'petiole' || o.userData.role === 'petiole')) assert.equal(o.material.map, null, 'veins never wired to petioles')});
    } finally {m.dispose()}
  });
}

test('actual curved and cylinder wood use metre-scaled UVs and preserve all non-UV data', () => {
  for (const species of ['osmanthus', 'camphor', 'acer']) {
    const m = build(species);
    try {
      const j = m.branches[0], wood = j.pivot.children.find(o => o.isMesh && o.material.userData.woodySurface?.organ === 'main-stem');
      assert.ok(wood);
      const g = wood.geometry, p = g.attributes.position, uv = g.attributes.uv;
      assert.equal(uv.count, p.count); assert.ok(Array.from(uv.array).every(Number.isFinite));
      if (g.isBufferGeometry && g.type === 'CylinderGeometry') {
        const {radialSegments: sides, radiusBottom: r, height} = g.parameters;
        assert.ok(Math.abs(uv.getX(sides) * BARK_TILE_METRES[0] - 2 * Math.PI * r) < 1e-7);
        assert.ok(Math.abs(uv.getY(0) * BARK_TILE_METRES[1] - height) < 5e-7);
        const clone = new THREE.CylinderGeometry(r * .49, r, height, sides), before = snapshot(clone);
        mapWoodyBarkUV(clone, r, height); assert.deepEqual(snapshot(clone), before); clone.dispose();
      } else {
        const {sides, segments} = g.userData.woodTube;
        const firstRing = Array.from({length: sides}, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i));
        const center = firstRing.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(sides), radius = firstRing[0].distanceTo(center);
        assert.ok(Math.abs(uv.getX(sides) * BARK_TILE_METRES[0] - 2 * Math.PI * radius) < 2e-6);
        assert.ok(uv.getY(segments * (sides + 1)) * BARK_TILE_METRES[1] >= m.height * .9, 'axial scale follows metres rather than unit UV');
      }
      for (const geo of surfaces(m).geometries) {
        for (const a of Object.values(geo.attributes)) { assert.equal(a.count, geo.attributes.position.count); assert.ok(Array.from(a.array).every(Number.isFinite)) }
        if (geo.index) for (const i of geo.index.array) assert.ok(i < geo.attributes.position.count);
      }
    } finally {m.dispose()}
  }
});

test('species source rules and appearance priors remain explicit; channels have separate colour spaces', () => {
  for (const species of ['osmanthus', 'camphor', 'acer']) {
    const m = build(species);
    try {
      const s = surfaces(m); assert.equal(s.textures.size, 9, 'three channels each for lamina, main stem, smooth lateral wood');
      let bytes = 0;
      for (const t of s.textures) {
        bytes += t.image.data.byteLength;
        assert.ok(t.isDataTexture); assert.equal(t.image.data.length, t.image.width * t.image.height * 4);
        assert.equal(t.colorSpace, t.name.endsWith(':pigment') ? THREE.SRGBColorSpace : THREE.NoColorSpace);
        for (let i = 3; i < t.image.data.length; i += 4) assert.equal(t.image.data[i], 255, 'geometry clips silhouette in every shadow pass');
      }
      assert.ok(bytes <= 1_300_000, `bounded CPU texture storage: ${bytes}`);
      for (const mat of s.materials) if (mat.userData.woodySurface) {
        assert.equal(mat.userData.woodySurface.status, WOODY_SURFACE_EVIDENCE.status);
        assert.match(mat.userData.woodySurface.evidence.source, /^https:\/\/plants.ces.ncsu.edu/);
        assert.equal(mat.emissive.getHex(), 0); assert.equal(mat.displacementMap, null);
        assert.ok(mat.bumpScale <= .0002); assert.equal(new Set([mat.map, mat.bumpMap, mat.roughnessMap]).size, 3);
      }
    } finally {m.dispose()}
  }
});

test('young tissues keep smooth priors, separate from old camphor main-stem ridges; shader hooks survive wiring', () => {
  for (const species of ['osmanthus', 'camphor', 'acer']) {
    const textures = [], own = t => textures.push(t), hook = () => {}, cacheKey = () => 'existing-hook';
    const material = new THREE.MeshStandardMaterial(); material.onBeforeCompile = hook; material.customProgramCacheKey = cacheKey;
    wireWoodyBarkSurface(material, species, 80, true, 42, own);
    assert.equal(material.userData.woodySurface.ageClass, 'conservative smooth lateral wood'); assert.equal(material.bumpScale, .00004);
    assert.equal(material.onBeforeCompile, hook); assert.equal(material.customProgramCacheKey, cacheKey);
    const m = build(species), geo = leaves(m).geometry;
    wireWoodyLeafSurface(material, geo, species, own);
    assert.equal(material.onBeforeCompile, hook); assert.equal(material.customProgramCacheKey, cacheKey);
    material.dispose(); textures.forEach(t => t.dispose()); m.dispose();
  }
});

test('leaf dynamics clones share immutable textures and retain depth/distance shader parity; no frame uploads', () => {
  for (const species of ['osmanthus', 'camphor', 'acer']) {
    const m = build(species), blade = leaves(m), original = blade.material, data = surfaces(m), versions = [...data.textures].map(t => t.version);
    const dynamics = createLeafDynamics(m.group);
    try {
      assert.notEqual(blade.material, original);
      for (const key of ['map', 'bumpMap', 'roughnessMap']) assert.equal(blade.material[key], original[key]);
      const shaders = [blade.material, blade.customDepthMaterial, blade.customDistanceMaterial].map(mat => {
        assert.equal(mat.map, original.map); assert.equal(mat.alphaTest, original.alphaTest);
        const shader = {uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>'};
        mat.onBeforeCompile(shader, {}); return shader;
      });
      assert.equal(shaders[0].vertexShader, shaders[1].vertexShader); assert.equal(shaders[1].vertexShader, shaders[2].vertexShader);
      for (let i = 0; i < 5; i++) {m.update(i, 3, 9.81, 1); dynamics.update(3, 9.81, 1)}
      assert.deepEqual([...data.textures].map(t => t.version), versions);
    } finally {dynamics.dispose(); assert.equal(blade.material, original); m.dispose()}
  }
});

test('each build uniquely owns a bounded texture set and releases geometry, materials and textures exactly once', () => {
  for (const species of ['osmanthus', 'camphor', 'acer']) {
    const a = build(species), b = build(species, {...base, seed: 43}), sa = surfaces(a), sb = surfaces(b);
    for (const t of sa.textures) assert.ok(!sb.textures.has(t));
    const calls = new Map();
    for (const item of [...sa.materials, ...sa.geometries, ...sa.textures]) {
      calls.set(item, 0); item.addEventListener('dispose', () => calls.set(item, calls.get(item) + 1));
    }
    const original = leaves(a).material, dynamics = createLeafDynamics(a.group);
    const clone = leaves(a).material; let clonesDisposed = 0; clone.addEventListener('dispose', () => clonesDisposed++);
    dynamics.dispose(); dynamics.dispose(); assert.equal(clonesDisposed, 1); assert.equal(calls.get(original), 0);
    a.dispose(); a.dispose(); for (const [item, count] of calls) assert.equal(count, 1, `${item.type ?? item.name} released once`);
    assert.equal(a.group.children.length, 0); assert.ok(b.group.children.length > 0); b.dispose();
  }
});
