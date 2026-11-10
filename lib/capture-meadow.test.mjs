import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createCaptureMeadow, createMeadowLayout, meadowSeed} from './capture-meadow.ts';
import {meadowBounds as bounds, isMeadowPoint} from './capture-meadow-layout.ts';

const reach = .108;
const key = (x,z) => Math.round((x-bounds.minX)*1000)*100000 + Math.round((z-bounds.minZ)*1000);
const hash = layout => {
  const h = createHash('sha256');
  for (const a of [layout.x, layout.z, layout.traits]) h.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));
  return h.digest('hex');
};
const glb = name => {
  const bytes = readFileSync(new URL('../public/capture17/'+name,import.meta.url));
  assert.equal(bytes.readUInt32LE(8),bytes.length);
  const size = bytes.readUInt32LE(12);
  return {json:JSON.parse(bytes.subarray(20,20+size)),bin:bytes.subarray(28+size),bytes};
};

test('deterministic world-space planting, density and clearance of every stored site', () => {
  const layout = createMeadowLayout(), fingerprint = hash(layout);
  assert.equal(layout.seed,meadowSeed);
  assert.equal(hash(createMeadowLayout(meadowSeed)), fingerprint);
  assert.notEqual(hash(createMeadowLayout(meadowSeed+1)), fingerprint);
  const distinct = new Set();
  for(let i=0;i<layout.count;i++) {
    assert.ok(isMeadowPoint(layout.x[i],layout.z[i],reach),'planting outside clearance at '+i);
    distinct.add(key(layout.x[i],layout.z[i]));
  }
  assert.equal(distinct.size,layout.count);
  const spacing=.10;
  let accepted=0;
  for(let i=0;i<Math.round((bounds.maxX-bounds.minX)/spacing);i++) {
    for(let j=0;j<Math.round((bounds.maxZ-bounds.minZ)/spacing);j++) {
      if(isMeadowPoint(bounds.minX+(i+.5)*spacing,bounds.minZ+(j+.5)*spacing,reach)) accepted++;
    }
  }
  const area=accepted*spacing**2, density=layout.count/area;
  assert.ok(density>180 && density<225);
  console.log(JSON.stringify({seed:layout.seed,fingerprint,fieldTufts:layout.count,
    proxyAreaM2:Number(area.toFixed(2)),gridStepM:spacing,renderTuftsPerM2:Number(density.toFixed(2))}));
});

function moveCamera(camera,x,z,height){
  camera.position.set(x,height,z);
  camera.up.set(0,0,-1);
  camera.lookAt(x,0,z);
}

// Sweep top-down test cameras until every actual matrix is visited at every
// density tier where its persistent point participates. The scan is independent
// of the tuft generator's hash, scaling and rotation transforms.
test('all active tiers stay within the .108 m clearance at ±12 m/s and wind returns to rest', () => {
  const field=createCaptureMeadow(), {layout}=field;
  const camera=new THREE.OrthographicCamera(-5,5,5,-5,.01,160);
  moveCamera(camera,0,-4,1.2);
  field.update(camera);
  const selected=field.group.children.find(c=>c.visible);
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>'};
  selected.material.onBeforeCompile(shader,{});
  assert.match(shader.vertexShader,/\.974555\*h\*slope/);
  assert.match(shader.vertexShader,/\.224148\*h\*slope/);
  assert.match(shader.vertexShader,/min\(\.50, 7\.\*h\)/);
  assert.match(shader.vertexShader,/\.82 \+ \.18\*sin/);
  const {meadowBend:bend,meadowTime:phase}=shader.uniforms;
  assert.equal(bend.value,0);
  for(let n=0;n<140;n++) field.update(camera,.1,12);
  assert.ok(Math.abs(bend.value-.8)<1e-8);
  const amplitude=bend.value;
  const ids=new Map();
  for(let i=0;i<layout.count;i++) ids.set(key(layout.x[i],layout.z[i]),i);
  const seen=[new Uint8Array(layout.count),new Uint8Array(layout.count),new Uint8Array(layout.count)];
  const counted=[0,0,0],nameToTier={near:0,middle:1,far:2};
  let forward2=0,reverse2=0,maxDrawCalls=0;
  const dimensions=new Map();
  let minHeight=Infinity,maxHeight=0,minWidth=Infinity,maxWidth=0;
  function nearBladeRange(mesh){
    if(dimensions.has(mesh.geometry))return dimensions.get(mesh.geometry);
    const v=mesh.geometry.getAttribute('position').array,blades=mesh.geometry.userData.bladesPerTuft;
    const rows=4, columns=3;
    assert.equal(v.length/3,blades*rows*columns);
    let lowH=Infinity,highH=0,lowW=Infinity,highW=0;
    for(let b=0;b<blades;b++){
      let y=0,width=0;
      for(let row=0;row<rows;row++){
        const left=(b*rows+row)*columns*3,right=left+(columns-1)*3;
        width=Math.max(width,Math.hypot(v[left]-v[right],v[left+2]-v[right+2]));
        for(let c=0;c<columns;c++)y=Math.max(y,v[left+c*3+1]);
      }
      lowH=Math.min(lowH,y);highH=Math.max(highH,y);
      lowW=Math.min(lowW,width);highW=Math.max(highW,width);
    }
    const range=[lowH,highH,lowW,highW];dimensions.set(mesh.geometry,range);return range;
  }
  function inspect(tier){
    const visible=field.group.children.filter(m=>m.visible && m.count);
    assert.equal(visible.length,field.stats.drawCalls);
    maxDrawCalls=Math.max(maxDrawCalls,visible.length);
    for(const m of visible){
      if(nameToTier[m.geometry.userData.detailTier]!==tier) continue;
      const matrices=m.instanceMatrix.array,v=m.geometry.getAttribute('position').array;
      for(let row=0;row<m.count;row++){
        const b=row*16,id=ids.get(key(matrices[b+12],matrices[b+14]));
        assert.ok(id!==undefined,'matrix without persistent site');
        if(seen[tier][id])continue;
        seen[tier][id]=1;counted[tier]++;
        const a=matrices[b],e=matrices[b+8],c=matrices[b+2],d=matrices[b+10],sy=matrices[b+5];
        if(tier===0){
          const [loH,hiH,loW,hiW]=nearBladeRange(m),sw=Math.hypot(a,c);
          minHeight=Math.min(minHeight,loH*sy);maxHeight=Math.max(maxHeight,hiH*sy);
          minWidth=Math.min(minWidth,loW*sw);maxWidth=Math.max(maxWidth,hiW*sw);
        }
        for(let j=0;j<v.length;j+=3){
          const rx=a*v[j]+e*v[j+2],rz=c*v[j]+d*v[j+2],h=Math.max(0,sy*v[j+1]);
          // At fixed speed the sinusoidal shader multiplier spans [.64, 1].
          // The squared displacement is convex, so its maximum occurs at a
          // sine extremum. Root scatter and rest lean are already in (rx,rz).
          const delta=h*amplitude*Math.min(.5,7*h);
          const rest=rx*rx+rz*rz,cross=2*(rx*.974555+rz*.224148)*delta;
          const shift=delta*delta*(.974555**2+.224148**2);
          forward2=Math.max(forward2,rest+cross+shift,rest+.64*cross+.64**2*shift);
          reverse2=Math.max(reverse2,rest-cross+shift,rest-.64*cross+.64**2*shift);
        }
      }
    }
  }
  for(const [tier,spacing,height] of [[0,4.3,1.2],[1,7,6.3]]) {
    const cols=Math.ceil((bounds.maxX-bounds.minX)/spacing),rows=Math.ceil((bounds.maxZ-bounds.minZ)/spacing);
    for(let i=0;i<cols;i++) for(let j=0;j<rows;j++) {
      moveCamera(camera,bounds.minX+(i+.5)*(bounds.maxX-bounds.minX)/cols,
        bounds.minZ+(j+.5)*(bounds.maxZ-bounds.minZ)/rows,height);
      field.update(camera);
      inspect(tier);
    }
  }
  camera.left=-40;camera.right=40;camera.top=40;camera.bottom=-40;camera.updateProjectionMatrix();
  moveCamera(camera,2,-16,80);
  field.update(camera);inspect(2);
  moveCamera(camera,2,-16,1.3);
  field.update(camera);inspect(0);
  assert.deepEqual(counted,[layout.count,layout.chunks.reduce((s,c)=>s+c.mid.length,0),layout.chunks.reduce((s,c)=>s+c.far.length,0)]);
  assert.equal(maxDrawCalls,12);
  // Mown upper blades and young lateral leaves coexist.
  assert.ok(minHeight>.018 && minHeight<.027 && maxHeight>.06 && maxHeight<.076);
  assert.ok(minWidth>.00125 && maxWidth<.0038);
  assert.ok(Math.sqrt(Math.max(forward2,reverse2))<reach);
  for(let k=0;k<100;k++)field.update(camera,.1,-12);
  assert.ok(Math.abs(bend.value+.8)<1e-8);
  for(let k=0;k<200;k++)field.update(camera,.1,0);
  assert.equal(bend.value,0); assert.equal(phase.value,0);
  assert.equal(field.update(camera,.1,0),false);
  console.log(JSON.stringify({uniqueSitesTestedAtEachLod:counted,maxDrawCalls,
    positive12msMaxRadiusM:Math.sqrt(forward2),negative12msMaxRadiusM:Math.sqrt(reverse2),nearBladeHeightM:[minHeight,maxHeight],nearBladeMaxWidthM:[minWidth,maxWidth]}));
  field.dispose();
});

test('published meadow attachment stores the exact occupied transforms for registered camera 01', () => {
  const bed=glb('yungu-meadow.glb'),base=glb('yungu-lawn.glb');
  const group=bed.json.nodes.find(n=>n.extras?.stats);
  assert.equal(group.extras.sourceModelSha256,base.json.asset.extras?.treeSourceSha256??createHash('sha256').update(base.bytes).digest('hex'));
  const registered=base.json.nodes.find(n=>n.name==='Photo 01 registered');
  const parents=new Map();
  for(const [i,n] of base.json.nodes.entries())for(const child of n.children??[])parents.set(child,i);
  const chain=[];
  for(let i=base.json.nodes.indexOf(registered);i!==undefined;i=parents.get(i))chain.unshift(base.json.nodes[i]);
  const world=new THREE.Matrix4();
  for(const n of chain){
    const local=new THREE.Matrix4();
    if(n.matrix)local.fromArray(n.matrix);
    else local.compose(new THREE.Vector3().fromArray(n.translation??[0,0,0]),
      new THREE.Quaternion().fromArray(n.rotation??[0,0,0,1]),new THREE.Vector3().fromArray(n.scale??[1,1,1]));
    world.multiply(local);
  }
  const params=base.json.cameras[registered.camera].perspective;
  const camera=new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(params.yfov),params.aspectRatio,.05,300);
  world.decompose(camera.position,camera.quaternion,camera.scale);
  const field=createCaptureMeadow(), snapshot=field.exportSnapshot(camera);
  const attached=bed.json.nodes.filter(n=>n.extensions?.EXT_mesh_gpu_instancing);
  const summary=group.extras.stats;
  assert.deepEqual(summary,snapshot.userData.stats);
  assert.equal(attached.length,summary.drawCalls);
  const matrix=new THREE.Matrix4(),stored=new THREE.Matrix4(),pos=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3();
  const color=new THREE.Color(),receipt={};
  function floats(index,dims,rows){
    const acc=bed.json.accessors[index],view=bed.json.bufferViews[acc.bufferView];
    assert.equal(acc.count,rows);assert.equal(acc.type,'VEC'+dims);
    assert.equal(acc.componentType,5126);assert.equal(view.buffer,0);
    const start=(view.byteOffset??0)+(acc.byteOffset??0),stride=view.byteStride??dims*4;
    assert.ok((rows-1)*stride+dims*4+(acc.byteOffset??0)<=view.byteLength);
    assert.ok(start+(rows-1)*stride+dims*4<=bed.bin.byteLength);
    return (i,k)=>bed.bin.readFloatLE(start+i*stride+4*k);
  }
  const transforms=new Set();
  for(const n of attached){
    const mesh=snapshot.getObjectByName(n.name);assert.ok(mesh?.isInstancedMesh);
    const attrs=n.extensions.EXT_mesh_gpu_instancing.attributes;
    const primitive=bed.json.meshes[n.mesh].primitives[0];
    const livePositions=mesh.geometry.getAttribute('position');
    const vertex=floats(primitive.attributes.POSITION,3,livePositions.count);
    for(let i=0;i<livePositions.count;i++) for(let axis=0;axis<3;axis++){
      assert.equal(vertex(i,axis),livePositions.array[3*i+axis],n.name+' template differs from source');
    }
    const t=floats(attrs.TRANSLATION,3,mesh.count),rot=floats(attrs.ROTATION,4,mesh.count);
    const s=floats(attrs.SCALE,3,mesh.count),rgb=floats(attrs._COLOR_0,3,mesh.count);
    // Compare occupied transforms and tints, including the last entry in
    // every accessor. Extra preallocated zero matrices fail this check.
    for(let j=0;j<mesh.count;j++){
      pos.set(t(j,0),t(j,1),t(j,2));q.set(rot(j,0),rot(j,1),rot(j,2),rot(j,3));
      scale.set(s(j,0),s(j,1),s(j,2));stored.compose(pos,q,scale);
      mesh.getMatrixAt(j,matrix);mesh.getColorAt(j,color);
      for(let k=0;k<16;k++)assert.ok(Math.abs(matrix.elements[k]-stored.elements[k])<2e-6);
      assert.ok(Math.abs(rgb(j,0)-color.r)<1e-6 && Math.abs(rgb(j,1)-color.g)<1e-6 && Math.abs(rgb(j,2)-color.b)<1e-6);
      assert.ok(isMeadowPoint(pos.x,pos.z,reach));
      transforms.add(key(pos.x,pos.z));
    }
    receipt[n.name]=mesh.count;
  }
  assert.equal(transforms.size,summary.tufts);
  console.log(JSON.stringify({exportedAccessorsByGroup:receipt,stats:summary}));
  for(const m of snapshot.children)m.dispose();
  field.dispose();
});

test('offline attachment stores near-detail geometry and a transform for every field site', () => {
  const {json,bin}=glb('yungu-meadow-full.glb');
  const root=json.nodes.find(node=>node.extras?.stats);
  const summary=root.extras.stats;
  const field=createMeadowLayout();
  const allSites=new Set(Array.from(field.x,(x,i)=>key(x,field.z[i])));
  const available=allSites.size;
  let blades=0;
  assert.equal(root.children.length,4);
  for(const index of root.children){
    const node=json.nodes[index];
    const primitive=json.meshes[node.mesh].primitives[0];
    assert.equal(primitive.extras.detailTier,'near');
    const attrs=node.extensions.EXT_mesh_gpu_instancing.attributes;
    const pos=json.accessors[attrs.TRANSLATION],view=json.bufferViews[pos.bufferView];
    for(const socket of ['ROTATION','SCALE','_COLOR_0']){
      assert.equal(json.accessors[attrs[socket]].count,pos.count);
    }
    assert.equal(pos.componentType,5126);assert.equal(pos.type,'VEC3');
    const offset=(view.byteOffset??0)+(pos.byteOffset??0),stride=view.byteStride??12;
    for(let i=0;i<pos.count;i++){
      const x=bin.readFloatLE(offset+i*stride),z=bin.readFloatLE(offset+i*stride+8);
      assert.ok(allSites.delete(key(x,z)),'unexpected or duplicate full-detail position');
    }
    blades+=primitive.extras.bladesPerTuft*pos.count;
  }
  assert.equal(allSites.size,0);
  assert.equal(summary.fieldTufts,available);
  assert.equal(summary.blades,blades);
  assert.equal(summary.nearBlades,blades);
  assert.equal(summary.middleBlades+summary.farBlades,0);
});
