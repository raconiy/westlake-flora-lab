import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {smoothLeafNormals} from './capture-leaf-normals.ts';

function blade() {
  const corners=[[0,0,0],[-.03,.05,0],[0,.05,.012],[.03,.05,0],[0,.1,-.008]];
  const position=[0,1,2,0,2,3,1,4,2,2,4,3].flatMap(i=>corners[i]);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));g.computeVertexNormals();
  return {p:g.attributes.position.array,n:g.attributes.normal.array,i:Uint16Array.from({length:12},(_,i)=>i)};
}
test('leaf internal duplicates share normals while position/index bytes stay unchanged',()=>{
  const {p,n,i}=blade(), beforeP=p.slice(), beforeI=i.slice();
  const out=smoothLeafNormals(p,i,n);
  assert.equal(out.smoothedComponents,1);assert.ok(out.changedVertices>0);
  for(const group of [[0,3],[1,6],[2,4,8,9],[5,11],[7,10]]) for(const v of group)
    assert.deepEqual(out.normals.slice(v*3,v*3+3),out.normals.slice(group[0]*3,group[0]*3+3));
  for(let v=0;v<p.length/3;v++) assert.ok(Math.abs(Math.hypot(...out.normals.slice(v*3,v*3+3))-1)<1e-6);
  assert.deepEqual(p,beforeP);assert.deepEqual(i,beforeI);
});
test('two leaves sharing only a petiole point keep separate shading normals',()=>{
  const {p,n,i}=blade();const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.rotateY(1.2);g.computeVertexNormals();
  const p2=g.attributes.position.array,n2=g.attributes.normal.array;
  const separate=smoothLeafNormals(p,i,n), other=smoothLeafNormals(p2,i,n2);
  const together=smoothLeafNormals([...p,...p2],[...i,...i.map(v=>v+12)],[...n,...n2]);
  assert.deepEqual(together.normals.slice(0,36),separate.normals);
  assert.deepEqual(together.normals.slice(36),other.normals);
  assert.equal(together.smoothedComponents,2);
});
test('joined surfaces beyond the per-leaf contract remain untouched',()=>{
  const {p,n,i}=blade();const out=smoothLeafNormals(p,i,n,3);
  assert.equal(out.smoothedComponents,0);assert.deepEqual(out.normals,n);
  assert.throws(()=>smoothLeafNormals(p,[999,0,1],n),/index/);
});
