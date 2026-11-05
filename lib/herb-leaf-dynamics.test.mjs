import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildPlant} from './plant-engine.ts';
import {buildAdditionalPlant} from './additional-species.ts';
import {createLeafObservation} from './leaf-observation.ts';
import {createLeafDynamics,leafStripVertex} from './leaf-dynamics.ts';
import {STRIP_ATTRIBUTES,tagLeafStrip} from './herb-leaf-dynamics.ts';

const make=species=>species==='ophiopogon'?buildAdditionalPlant(species,{age:2,day:120,seed:42,density:.4}):buildPlant(species,{age:2,day:120,seed:42,density:.4});
const meshes=root=>{const found=[];root.traverse(o=>{if(o.isMesh)found.push(o);});return found;};
const inject=material=>{const shader={uniforms:{},vertexShader:'#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>'};material.onBeforeCompile(shader,{});return shader;};

for(const species of ['iris','oxalis','ophiopogon'])test(`${species}: actual plant and observation strips, anchored insertions, finite separate apex response, shadow parity and cleanup`,()=>{
 const plant=make(species),detail=createLeafObservation(plant.group,species);
 try{for(const root of [plant.group,detail]){
  root.updateMatrixWorld(true);
  const all=meshes(root),blades=all.filter(o=>o.userData.leafDynamics==='material-strip');assert.ok(blades.length>0);
  if(species==='oxalis'&&root===detail){assert.equal(blades.length,3);assert.ok(blades.every(o=>o.userData.insertion==='leaflet-base-at-petiole-tip'));}
  const original=all.map(m=>({m,material:m.material,depth:m.customDepthMaterial,distance:m.customDistanceMaterial,culled:m.frustumCulled}));
  const dynamics=createLeafDynamics(root);assert.equal(dynamics.bladeMeshes,blades.length);assert.deepEqual(dynamics.unsupportedBlades,[]);
  dynamics.update(4,9.81,1);
  let moved=0;const lengths=new Set(),bases=new Set();
  for(const blade of blades){
   const g=blade.geometry,coord=g.getAttribute('leafMaterial'),pos=g.getAttribute('position');
   for(const [name,size]of Object.entries(STRIP_ATTRIBUTES)){assert.equal(g.getAttribute(name).itemSize,size);assert.equal(g.getAttribute(name).count,pos.count);}
   const a=inject(blade.material),b=inject(blade.customDepthMaterial),c=inject(blade.customDistanceMaterial);
   assert.equal(a.vertexShader,b.vertexShader);assert.equal(a.vertexShader,c.vertexShader);
   assert.equal(a.uniforms.leafPressure,b.uniforms.leafPressure);assert.equal(a.uniforms.leafGravity,c.uniforms.leafGravity);
   assert.match(a.vertexShader,/transformed \+= leafLoadNormal \* leafBend/);
   for(let i=0;i<pos.count;i++){
    const rest=new THREE.Vector3().fromBufferAttribute(pos,i),result=leafStripVertex(g,i,blade.matrixWorld,4,9.81);
    assert.ok(result.position.toArray().concat(result.normal.toArray()).every(Number.isFinite));
    if(coord.getX(i)===0){assert.ok(result.position.distanceTo(rest)<1e-12);const base=new THREE.Vector3().fromBufferAttribute(g.getAttribute('leafBase'),i);bases.add(base.toArray().join(','));}
    if(coord.getX(i)>.999){if(result.position.distanceTo(rest)>1e-10)moved++;lengths.add(coord.getY(i)*new THREE.Vector3().setFromMatrixColumn(blade.matrixWorld,1).length());}
   }
   if(species==='iris')assert.ok(g.getAttribute('position').getZ(25)>0,'rest midrib retained');
  }
  assert.ok(moved>0,'apex moves relative to its own fixed insertion');
  if(root===plant.group)assert.ok(lengths.size>1,'different known lengths survive');
  if(species==='ophiopogon'&&root===plant.group)assert.ok(bases.size>5,'merged ribbons have distinct declared bases');
  for(const {m,material}of original)if(!blades.includes(m)){assert.equal(m.material,material);assert.equal(m.customDepthMaterial,undefined);}
  let disposed=0;const owned=new Set(blades.flatMap(m=>[m.material,m.customDepthMaterial,m.customDistanceMaterial]));owned.forEach(m=>m.addEventListener('dispose',()=>disposed++));
  // No frame traversal or instance uploads: update only modifies shared uniforms.
  const traverse=root.traverse;root.traverse=()=>{throw Error('frame traversal');};dynamics.update(-2,3,.8);root.traverse=traverse;
  dynamics.dispose();dynamics.dispose();assert.equal(disposed,owned.size);
  for(const {m,material,depth,distance,culled}of original){assert.equal(m.material,material);assert.equal(m.customDepthMaterial,depth);assert.equal(m.customDistanceMaterial,distance);assert.equal(m.frustumCulled,culled);}
 }}finally{for(const m of meshes(detail)){m.geometry.dispose();m.material.dispose();}plant.dispose();}
});

test('material-strip reference preserves base tangent, wind sign/quadratic low loads, length scaling, and downward gravity',()=>{
 const g=tagLeafStrip(new THREE.PlaneGeometry(.01,.01,1,100).translate(0,.005,0),true),p=g.getAttribute('position'),coord=g.getAttribute('leafMaterial');
 let base=0,tip=0,near=0;for(let i=0;i<p.count;i++){if(coord.getX(i)<coord.getX(base))base=i;if(coord.getX(i)>coord.getX(tip))tip=i;if(coord.getX(i)>0&&coord.getX(i)<.011)near=i;}
 const frame=new THREE.Matrix4().makeRotationY(Math.PI/2),rest=i=>new THREE.Vector3().fromBufferAttribute(p,i);
 const delta=(i,u,mat=frame,gravity=0)=>leafStripVertex(g,i,mat,u,gravity).position.sub(rest(i));
 assert.ok(delta(base,1).length()<1e-18);
 const d=delta(tip,.01).z;assert.ok(d>0);assert.ok(Math.abs(delta(tip,-.01).z+d)<1e-16);assert.ok(Math.abs(delta(tip,.02).z/d-4)<1e-6);
 assert.ok(Math.abs(delta(tip,.01,new THREE.Matrix4().makeRotationY(Math.PI/2).scale(new THREE.Vector3(2,2,2))).z/d-8)<1e-5,'local displacement scales as L^4/scale');
 assert.ok(delta(near,.01).length()/delta(tip,.01).length()<.0003,'quadratic approach to zero slope');
 const downFrame=new THREE.Matrix4().makeRotationX(Math.PI/2),worldDelta=delta(tip,0,downFrame,9.81).transformDirection(downFrame);assert.ok(worldDelta.y<0);
 const zero=leafStripVertex(g,base,frame,4,9.81);assert.ok(zero.normal.distanceTo(new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal'),base))<1e-12);
 g.dispose();
});

test('missing material coordinates are excluded rather than bending a merged clump about its bounds',()=>{
 const g=new THREE.PlaneGeometry(.1,.2),m=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(g,m);mesh.userData={organ:'leaf',leafDynamics:'material-strip'};
 const d=createLeafDynamics(mesh);assert.equal(d.bladeMeshes,0);assert.match(d.unsupportedBlades[0].reason,/Missing or incomplete/);assert.equal(mesh.material,m);d.dispose();g.dispose();m.dispose();
});

test('nonuniform herb frames report unsupported; seeds, roots, flowers and petioles never acquire blade shaders',()=>{
 const g=tagLeafStrip(new THREE.PlaneGeometry(.01,.02).translate(0,.01,0),true),m=new THREE.MeshStandardMaterial(),root=new THREE.Group();
 for(const organ of ['seed','root','flower','petiole']){const mesh=new THREE.Mesh(g,m);mesh.userData={organ,leafDynamics:'material-strip'};root.add(mesh);}
 const blade=new THREE.Mesh(g,m);blade.userData={organ:'leaf',leafDynamics:'material-strip'};blade.scale.set(1,2,1);root.add(blade);
 const d=createLeafDynamics(root);assert.equal(d.bladeMeshes,0);assert.equal(d.unsupportedBlades.length,1);assert.match(d.unsupportedBlades[0].reason,/nonuniform scale or shear/);assert.ok(root.children.every(o=>o.material===m&&!o.customDepthMaterial&&!o.customDistanceMaterial));d.dispose();g.dispose();m.dispose();
});

test('strip normals follow the deformed surface and disposal restores preexisting shadow materials',()=>{
 const g=tagLeafStrip(new THREE.PlaneGeometry(.01,.1,2,100).translate(0,.05,0),true),m=new THREE.MeshStandardMaterial({side:THREE.DoubleSide,alphaTest:.4}),mesh=new THREE.Mesh(g,m);
 const depth=new THREE.MeshDepthMaterial(),distance=new THREE.MeshDistanceMaterial();mesh.customDepthMaterial=depth;mesh.customDistanceMaterial=distance;mesh.userData={organ:'leaf',leafDynamics:'material-strip'};
 const frame=new THREE.Matrix4().makeRotationY(Math.PI/2),row=50,centre=row*3+1;
 const a=leafStripVertex(g,centre-3,frame,2,0).position,b=leafStripVertex(g,centre+3,frame,2,0).position,result=leafStripVertex(g,centre,frame,2,0);
 assert.ok(Math.abs(result.normal.dot(b.sub(a).normalize()))<1e-4,'normal perpendicular to finite-difference centreline');
 const d=createLeafDynamics(mesh);assert.equal(mesh.customDepthMaterial.alphaTest,.4);assert.equal(mesh.customDistanceMaterial.side,THREE.DoubleSide);d.dispose();assert.equal(mesh.customDepthMaterial,depth);assert.equal(mesh.customDistanceMaterial,distance);g.dispose();m.dispose();depth.dispose();distance.dispose();
});
