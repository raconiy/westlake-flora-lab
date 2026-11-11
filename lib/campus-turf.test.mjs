import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {campusPaving,yunguCampusLayout,campusLamps} from './campus-layout.ts';
import {campusTurfReach,campusTurfRootEnvelopes,createCampusTurfLayout,isCampusTurfPoint,campusTuftGeometry,createCampusTurf} from './campus-turf.ts';
import {buildPlant} from './plant-engine.ts';
import {buildAdditionalPlant} from './additional-species.ts';

test('explicit root envelopes contain the actual frozen near-ground woody geometry',()=>{
  const point=new THREE.Vector3();
  for(const p of yunguCampusLayout.filter(p=>Object.hasOwn(campusTurfRootEnvelopes,p.id))){
    const params={age:p.age,day:180,seed:p.seed,density:p.density};
    const b=['camphor','acer'].includes(p.species)?buildAdditionalPlant(p.species,params):buildPlant(p.species,params);
    try{
      b.group.scale.setScalar(p.scale);b.group.rotation.y=(((p.seed*37)%360)-180)*Math.PI/180;b.group.updateMatrixWorld(true);
      let count=0;
      b.group.traverse(o=>{
        if(!o.isMesh||o.isInstancedMesh)return;
        const positions=o.geometry.getAttribute('position');
        for(let i=0;i<positions.count;i++){
          point.fromBufferAttribute(positions,i).applyMatrix4(o.matrixWorld);
          if(point.y<-.01||point.y>.12)continue;
          assert.ok(Math.hypot(point.x,point.z)<campusTurfRootEnvelopes[p.id],p.id+' root envelope no longer covers geometry');count++;
        }
      });
      assert.ok(count>25,p.id+' missing near-ground woody samples');
    }finally{b.dispose();}
  }
});

test('fixed turf roots are deterministic and leave paving, lamp feet and plant collars bare',()=>{
  const layout=createCampusTurfLayout();
  const digest=l=>createHash('sha256').update(JSON.stringify(l)).digest('hex');
  assert.equal(digest(layout),digest(createCampusTurfLayout()));
  assert.notEqual(digest(layout),digest(createCampusTurfLayout(layout.seed+1)));
  assert.ok(layout.roots.length>420000 && layout.roots.length<470000);
  assert.equal(new Set(layout.roots.map(p=>p.id)).size,layout.roots.length);
  for(const p of layout.roots){
    assert.ok(isCampusTurfPoint(p.x,p.z));
    for(const s of campusPaving){
      const dx=Math.max(0,Math.abs(p.x-s.x)-s.width/2),dz=Math.max(0,Math.abs(p.z-s.z)-s.depth/2);
      assert.ok(Math.hypot(dx,dz)>=campusTurfReach);
    }
  }
  for(const p of [...yunguCampusLayout,...campusLamps])assert.equal(isCampusTurfPoint(p.x,p.z),false);
  assert.equal(isCampusTurfPoint(NaN,0),false);assert.equal(isCampusTurfPoint(0,0,-1),false);
});

test('supplemental layers retain every archived root and use non-overlapping persistent IDs',()=>{
  const original=createCampusTurfLayout(undefined,1),dense=createCampusTurfLayout();
  assert.equal(original.roots.length,111433);
  assert.equal(dense.originalRoots,111433);
  assert.deepEqual(dense.roots.slice(0,original.roots.length),original.roots);
  assert.ok(dense.roots.length/original.roots.length>3.95);
  for(let layers=2;layers<=3;layers++){
    const partial=createCampusTurfLayout(undefined,layers);
    assert.deepEqual(dense.roots.slice(0,partial.roots.length),partial.roots);
  }
});

test('curved blade geometry is grounded, dimensionally bounded and retains exact sockets across LOD',()=>{
  let largestRadius=0,smallestHeight=Infinity,largestHeight=0;
  for(let variant=0;variant<4;variant++){
    const meshes=[0,1,2].map(t=>campusTuftGeometry(t,variant));
    const full=meshes[0];
    for(const g of meshes){
      const p=g.attributes.position,c=g.attributes.color,rows=g.userData.rows;
      for(const [blade,id] of g.userData.bladeIds.entries()){
        let height=0;
        for(const [j,t] of rows.entries())for(let side=0;side<2;side++){
          const i=(blade*rows.length+j)*2+side,fullIndex=(id*full.userData.rows.length+full.userData.rows.indexOf(t))*2+side;
          assert.equal(p.getY(i)>=0,true);
          assert.ok(Number.isFinite(g.attributes.normal.getX(i)));
          if(t===0)assert.equal(p.getY(i),0);
          height=Math.max(height,p.getY(i));
          // Maximum sway is <= .4 h at 12 m/s; include the largest instance scale.
          largestRadius=Math.max(largestRadius,1.1*Math.hypot(p.getX(i),p.getZ(i))+.4*1.07*p.getY(i));
          for(const axis of ['getX','getY','getZ']){
            assert.equal(p[axis](i),full.attributes.position[axis](fullIndex));
            assert.equal(c[axis](i),full.attributes.color[axis](fullIndex));
          }
        }
        smallestHeight=Math.min(smallestHeight,height);largestHeight=Math.max(largestHeight,height);
      }
    }
    for(const id of meshes[2].userData.bladeIds)assert.ok(meshes[1].userData.bladeIds.includes(id));
    meshes.forEach(g=>g.dispose());
  }
  assert.ok(smallestHeight>.02 && largestHeight<.08);
  assert.ok(largestRadius<campusTurfReach,`swept geometry ${largestRadius} exceeds excluded margin`);
});

function occupied(field){
  const seen=new Map();
  for(const m of field.group.children){
    if(!m.visible)continue;
    const a=m.instanceMatrix.array;
    for(let i=0;i<m.count;i++){
      const x=a[16*i+12],y=a[16*i+13],z=a[16*i+14],key=x+','+z;
      assert.equal(y,0);assert.equal(seen.has(key),false);
      seen.set(key,Array.from(a.slice(i*16,i*16+16)));
    }
  }
  return seen;
}

test('camera detail changes never move or delete planted turf roots; wind unloads and resources release',()=>{
  const field=createCampusTurf(),camera=new THREE.PerspectiveCamera(50,1,.01,300);
  camera.position.set(0,.25,5);camera.updateMatrixWorld();field.update(camera);
  const initial=occupied(field),nearBlades=field.stats.blades;
  assert.equal(initial.size,field.layout.roots.length);assert.ok(field.stats.drawCalls<=12);
  camera.position.set(50,80,80);camera.updateMatrixWorld();field.update(camera);
  assert.deepEqual(occupied(field),initial);
  assert.ok(field.stats.blades<nearBlades);
  const m=field.group.children.find(c=>c.visible);
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>\n#include <beginnormal_vertex>'};
  m.material.onBeforeCompile(shader,{});
  assert.match(shader.vertexShader,/lawnBaseY/);
  for(let i=0;i<100;i++)field.update(camera,.1,12);
  assert.ok(Math.abs(shader.uniforms.lawnResponse.value-.8)<1e-8);
  assert.deepEqual(occupied(field),initial);
  for(let i=0;i<100;i++)field.update(camera,.1,0);
  assert.equal(shader.uniforms.lawnResponse.value,0);
  assert.equal(shader.uniforms.lawnPhase.value,0);
  let materialDisposals=0,geometryDisposals=0;
  m.material.addEventListener('dispose',()=>materialDisposals++);
  const geometries=new Set(field.group.children.map(c=>c.geometry));
  geometries.forEach(g=>g.addEventListener('dispose',()=>geometryDisposals++));
  field.dispose();field.dispose();
  assert.equal(materialDisposals,1);assert.equal(geometryDisposals,geometries.size);
  assert.equal(field.group.children.length,0);assert.equal(field.update(camera,.1,6),false);
});
