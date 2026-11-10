import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCaptureGrass} from './capture-grass.ts';

function scene() {
  const model = new THREE.Group(), patch = new THREE.Group();
  patch.name='TurfNearVergeBlades';
  const geo = new THREE.BufferGeometry();
  // Representative gltfpack integer positions with their quantization transform.
  geo.setAttribute('position',new THREE.Uint16BufferAttribute([32071,20,39142,32072,20,39142,32072,23,39142],3));
  const color=new THREE.Uint8BufferAttribute([50,60,35,50,60,35,50,60,35],3,true);
  geo.setAttribute('color',color);
  const original=new THREE.MeshStandardMaterial({color:0x597531,vertexColors:true});original.name='Turf.Blade.01';
  const grass=new THREE.Mesh(geo,original);grass.scale.setScalar(.0213626307);grass.position.set(-700,-.430360317,-850);
  patch.add(grass);const lamp=new THREE.Mesh(geo,original);model.add(patch,lamp);
  const turfMat=new THREE.MeshStandardMaterial();turfMat.name='Turf.RegisteredDiffuse';
  const turf=new THREE.Mesh(geo,turfMat);patch.add(turf);
  return {model,grass,lamp,turf,turfMat,original,color};
}
function state(mat){
  const shader={uniforms:{},vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>'};
  mat.onBeforeCompile(shader,{});return shader;
}

test('only blade primitives bind; world root accounts for integer positions, rest color and lighting survive',()=>{
  const {model,grass,lamp,turf,turfMat,original,color}=scene();const rig=createCaptureGrass(model);
  assert.equal(rig.bladeMeshes,1);assert.equal(lamp.material,original);assert.equal(turf.material,turfMat);
  assert.ok(grass.geometry.getAttribute('position').array instanceof Uint16Array);
  assert.equal(grass.geometry.getAttribute('color'),color);assert.equal(grass.material.color.getHex(),original.color.getHex());
  const shader=state(grass.material);const base=grass.localToWorld(new THREE.Vector3().fromBufferAttribute(grass.geometry.attributes.position,0));
  assert.ok(Math.abs(shader.uniforms.lawnRootY.value-base.y)<1e-10);
  assert.match(shader.vertexShader,/modelMatrix \* vec4\(transformed/);assert.match(shader.vertexShader,/height \* slope/);
  assert.match(shader.vertexShader,/inverse\(mat3\(modelMatrix\)\)/);
  assert.equal(shader.uniforms.lawnResponse.value,0);assert.equal(rig.step(1/60,0),false);
  rig.dispose();assert.equal(grass.material,original);assert.equal(grass.customDepthMaterial,undefined);assert.equal(lamp.material,original);
});

test('damped response drives visible and shadow passes and returns to exact rest for either wind direction',()=>{
  const {model,grass}=scene(), rig=createCaptureGrass(model);
  const uniforms=state(grass.material).uniforms;
  for(const shadow of [grass.customDepthMaterial,grass.customDistanceMaterial]){
    const u=state(shadow).uniforms;
    assert.equal(u.lawnResponse,uniforms.lawnResponse);assert.equal(u.lawnPhase,uniforms.lawnPhase);
  }
  for(let k=0;k<90;k++)rig.step(1/60,6);
  assert.ok(uniforms.lawnResponse.value>.49&&uniforms.lawnResponse.value<.5);
  for(let k=0;k<120;k++)rig.step(1/60,-6);
  assert.ok(uniforms.lawnResponse.value<-.49);
  rig.step(1/60,0);assert.ok(uniforms.lawnResponse.value<-.4);
  for(let k=0;k<180;k++)rig.step(1/60,0);
  assert.equal(uniforms.lawnResponse.value,0);assert.equal(uniforms.lawnPhase.value,0);
  assert.equal(rig.step(1/60,0),false);assert.equal(rig.step(NaN,5),false);rig.dispose();assert.equal(rig.step(1/60,5),false);
});
