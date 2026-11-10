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
  assert.match(shader.vertexShader,/modelMatrix \* vec4\(p/);assert.match(shader.vertexShader,/h\*slope/);
  assert.match(shader.vertexShader,/inverse\(lawnPositionBasis\)/);
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

test('captured and instanced grass advance the same field and all shadow passes follow it', async()=>{
  const {createCaptureMeadow}=await import('./capture-meadow.ts');
  const {model,grass}=scene(),captured=createCaptureGrass(model),meadow=createCaptureMeadow();
  const camera=new THREE.PerspectiveCamera(50,1,.01,200);camera.position.set(0,.7,0);camera.lookAt(0,0,-2);meadow.update(camera);
  const mesh=meadow.group.children.find(n=>n.isInstancedMesh && n.count);
  assert.ok(mesh.customDepthMaterial);assert.ok(mesh.customDistanceMaterial);
  const visible=state(mesh.material),old=state(grass.material);
  const snapshots=[...Array(20).fill([.1,12]),...Array(35).fill([.2,-4]),...Array(20).fill([.2,0])];
  for(const [dt,speed] of snapshots){
    captured.step(dt,speed);meadow.update(camera,dt,speed);
    assert.equal(visible.uniforms.lawnResponse.value,old.uniforms.lawnResponse.value);
    assert.equal(visible.uniforms.lawnPhase.value,old.uniforms.lawnPhase.value);
  }
  assert.equal(visible.uniforms.lawnResponse.value,0);assert.equal(visible.uniforms.lawnPhase.value,0);
  for(const object of [mesh,grass])for(const pass of [object.material,object.customDepthMaterial,object.customDistanceMaterial]){
    const p=state(pass);
    const owner=object===mesh?visible:old;
    assert.equal(p.uniforms.lawnResponse,owner.uniforms.lawnResponse);
    assert.equal(p.uniforms.lawnPhase,owner.uniforms.lawnPhase);
    assert.match(p.vertexShader,/modelMatrix \* instanceMatrix \* vec4\(p,1\.0\)/);
    assert.match(p.vertexShader,/lawnOffset\(lawnWorld\(transformed\),lawnBaseY\(\)\)/);
  }
  // The surface Jacobian includes horizontal phase gradients; vertical-only
  // derivatives caused representation-dependent wind normals before R7.
  for(const p of [visible,old]){
    assert.match(p.vertexShader,/lp\+vec3\(e,0\.,0\.\)/);
    assert.match(p.vertexShader,/lp\+vec3\(0\.,0\.,e\)/);
  }
  captured.dispose();meadow.dispose();
});
