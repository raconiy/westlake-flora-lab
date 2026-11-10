import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const raw=readFileSync(new URL('../public/capture17/yungu-lawn.glb',import.meta.url));
const length=raw.readUInt32LE(12);
const scene=JSON.parse(raw.subarray(20,20+length));
const turfNames=new Set(['Turf.PhotoAlbedo','Turf.RegisteredDiffuse']);
const turfMaterials=scene.materials.filter(m=>turfNames.has(m.name));
const turfPrimitives=scene.meshes.flatMap(m=>m.primitives).filter(p=>turfNames.has(scene.materials[p.material].name));

test('every turf fragment uses a single repeating colour field plus a standard incident-light multiplier',()=>{
  assert.equal(turfMaterials.length,2);
  const maps=turfMaterials.map(m=>m.pbrMetallicRoughness.baseColorTexture);
  assert.deepEqual(maps[0],maps[1]);
  assert.equal(maps[0].extensions,undefined);
  const tex=scene.textures[maps[0].index], sampler=scene.samplers[tex.sampler];
  assert.equal(sampler.wrapS??10497,10497);
  assert.equal(sampler.wrapT??10497,10497);
  assert.equal(scene.images[tex.source].name,'Yungu turf continuous orthophoto field');
  assert.equal(turfPrimitives.length,10);
  for(const primitive of turfPrimitives){
    const attributes=primitive.attributes;
    assert.ok(Number.isInteger(attributes.COLOR_0));
    assert.equal(attributes.COLOR_1,undefined);
    assert.equal(scene.accessors[attributes.COLOR_0].count,scene.accessors[attributes.POSITION].count);
    const uv=scene.accessors[attributes.TEXCOORD_0];
    assert.equal(uv.componentType,5126);
    assert.equal(uv.count,scene.accessors[attributes.POSITION].count);
  }
});
