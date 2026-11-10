import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3, Quaternion, Matrix4} from 'three';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {isMeadowPoint, meadowBounds} from './capture-meadow-layout.ts';

test('the frozen GLB has no plantable stone, trunk-collar vertex or lamp-foot centre', async () => {
  const bytes = readFileSync(new URL('../public/capture17/yungu-lawn.glb', import.meta.url));
  const length = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + length)), bin = bytes.subarray(28 + length);
  await MeshoptDecoder.ready;
  const cache = new Map();
  function decodedView(viewIndex) {
    if (cache.has(viewIndex)) return cache.get(viewIndex);
    const view = gltf.bufferViews[viewIndex], compressed = view.extensions?.EXT_meshopt_compression;
    let payload;
    if (compressed) {
      payload = new Uint8Array(compressed.count * compressed.byteStride);
      const start = compressed.byteOffset ?? 0;
      MeshoptDecoder.decodeGltfBuffer(payload, compressed.count, compressed.byteStride,
        bin.subarray(start, start + compressed.byteLength), compressed.mode, compressed.filter ?? 'NONE');
    } else {
      const start = view.byteOffset ?? 0;
      payload = bin.subarray(start, start + view.byteLength);
    }
    const d = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    cache.set(viewIndex, d);
    return d;
  }
  function eachPosition(index, world, visit) {
    const ac = gltf.accessors[index], bv = gltf.bufferViews[ac.bufferView], dv = decodedView(ac.bufferView);
    const format = {5122:['getInt16',2,32767],5123:['getUint16',2,65535],5126:['getFloat32',4,1]}[ac.componentType];
    assert.ok(format, 'unsupported vertex encoding');
    const [read, size, norm] = format, step = bv.byteStride ?? size * 3;
    for (let i = 0; i < ac.count; i++) {
      const offset = (ac.byteOffset ?? 0) + step * i;
      const coord = (axis) => {
        const value = dv[read](offset + axis * size, true);
        return ac.normalized ? Math.max(-1, value / norm) : value;
      };
      visit(new Vector3(coord(0), coord(1), coord(2)).applyMatrix4(world));
    }
  }
  let pavers = 0, trunkPoints = 0, roots = 0, lights = 0, walks = 0;
  function walk(index, parent, inherited) {
    const n = gltf.nodes[index], world = new Matrix4();
    if (n.matrix) world.fromArray(n.matrix);
    else world.compose(new Vector3().fromArray(n.translation ?? [0,0,0]),
      new Quaternion().fromArray(n.rotation ?? [0,0,0,1]), new Vector3().fromArray(n.scale ?? [1,1,1]));
    world.premultiply(parent);
    let kind = inherited;
    if (['CrossWalk.GraniteCourses', 'NearWalk.GraniteCourses'].includes(n.name)) {kind = 'walk'; walks++;}
    if (n.name?.endsWith('.trunk')) kind = 'trunk';
    if (n.extras?.root_anchored || n.extras?.asset_class?.includes('light') || n.extras?.asset_class?.includes('luminaire')) {
      const p = new Vector3().setFromMatrixPosition(world);
      assert.equal(isMeadowPoint(p.x, p.z), false, n.name);
      if (n.extras.root_anchored) roots++; else lights++;
    }
    if (kind && n.mesh !== undefined) {
      for (const primitive of gltf.meshes[n.mesh].primitives) eachPosition(primitive.attributes.POSITION, world, p => {
        if (kind === 'trunk' && p.y > .16) return;
        assert.equal(isMeadowPoint(p.x, p.z), false, kind + ' at ' + p.toArray());
        if (kind === 'walk') pavers++; else trunkPoints++;
      });
    }
    for (const child of n.children ?? []) walk(child, world, kind);
  }
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) walk(root, new Matrix4(), null);
  assert.deepEqual({roots, lights, walks}, {roots:12, lights:7, walks:2});
  assert.ok(pavers > 1000 && trunkPoints > 50);
});

test('photo-marked utility cover, foreground object and camera side of paving remain clear', () => {
  for (const [x,z] of [[-1.158,3.728],[-.459,2.648],[.143,3.181],[-.574,4.267],
                        [-1.373,3.576],[-.67,2.517],[-.64,3.48],[3.48,3.73],[-5,7.8]]) {
    assert.equal(isMeadowPoint(x,z), false, 'photographic exclusion at ' + [x,z]);
  }
  for (const [x,z] of [[-3,0],[1,1],[5,-3],[9,-15],[0,-22],[-4,-40]]) {
    assert.equal(isMeadowPoint(x,z,.06), true, 'free turf at ' + [x,z]);
  }
});

test('the optional clump radius preserves clearance and the cut-off bounds', () => {
  const b = meadowBounds;
  assert.equal(isMeadowPoint(NaN,0),false);
  assert.equal(isMeadowPoint(0,-10,-.1),false);
  assert.equal(isMeadowPoint(b.maxX, -23),false);
  assert.equal(isMeadowPoint(b.maxX-.02, -23,.03),false);
  assert.equal(isMeadowPoint(b.minX, b.minZ),false);
  const margin = .11;
  let accepted = 0;
  for (let x = b.minX+.08; x < b.maxX; x+=.26) {
    for (let z = b.minZ+.08; z < b.maxZ; z+=.26) {
      if (!isMeadowPoint(x,z,margin)) continue;
      accepted++;
      for (let k=0;k<8;k++) {
        const a = k * Math.PI / 4;
        assert.equal(isMeadowPoint(x+margin*Math.cos(a),z+margin*Math.sin(a)), true);
      }
    }
  }
  assert.ok(accepted > 27000 && accepted < 30000);
});
