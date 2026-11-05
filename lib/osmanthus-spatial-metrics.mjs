import * as THREE from 'three';
import { woodSections, sectionVolume, sectionProjectedArea } from './wood-loads.ts';

// Actual rest mesh only. Length is measured on the wood-section centre polyline,
// never local y. Projected leaf-envelope gaps are not visible bare-wood lengths.
export function actualGeometry(model) {
  for (const b of model.branches) b.pivot.quaternion.copy(b.rest);
  model.group.updateMatrixWorld(true);
  const bounds = new THREE.Box3(), triangles = [], axes = new Map();
  const wind = new THREE.Vector3(1, 0, .2).normalize();
  let area = 0, leafProjectedAreaM2 = 0, woodProjectedAreaM2 = 0, triangleWoodProjectedAreaM2 = 0;
  let sectionWoodKg = 0, triangleWoodKg = 0, maxVolumeRelativeError = 0, draws = 0;
  model.group.traverse(o => { if (o.isMesh) draws++; });
  for (const branch of model.branches) {
    // Historical straight generator omits meshes shorter than 0.1 mm; retain
    // those real axes in the comparison without inventing wood mass.
    const wood = branch.pivot.children.find(o => o.isMesh && !o.isInstancedMesh && !o.userData.organ) ?? {
      geometry: new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([],3)),
      matrix:new THREE.Matrix4(),matrixWorld:branch.pivot.matrixWorld};
    const sections = woodSections(wood.geometry), centers = [];
    for (const section of sections) {
      if (!centers.length) centers.push(new THREE.Vector3(...section.a).applyMatrix4(wood.matrix));
      centers.push(new THREE.Vector3(...section.b).applyMatrix4(wood.matrix));
      sectionWoodKg += 550 * sectionVolume(section);
      woodProjectedAreaM2 += sectionProjectedArea(section, wood.matrixWorld, wind);
    }
    if (!centers.length) centers.push(new THREE.Vector3(),new THREE.Vector3(0,branch.length,0));
    const cumulative = [0];
    for (let i = 1; i < centers.length; i++) cumulative.push(cumulative[i-1] + centers[i].distanceTo(centers[i-1]));
    const length = cumulative.at(-1) ?? 0;
    const segments = centers.slice(1).map((end,i)=>{
      const a=centers[i],dx=end.x-a.x,dy=end.y-a.y,dz=end.z-a.z;
      return {x:a.x,y:a.y,z:a.z,dx,dy,dz,d2:dx*dx+dy*dy+dz*dz,start:cumulative[i],length:cumulative[i+1]-cumulative[i]};
    });
    const project = p => {
      let best=Infinity,station=0;
      for(const s of segments) {
        if(!s.d2)continue;
        const x=p.x-s.x,y=p.y-s.y,z=p.z-s.z,t=Math.max(0,Math.min(1,(x*s.dx+y*s.dy+z*s.dz)/s.d2));
        const ex=x-t*s.dx,ey=y-t*s.dy,ez=z-t*s.dz,distance=ex*ex+ey*ey+ez*ez;
        if(distance<best){best=distance;station=s.start+t*s.length;}
      }
      return station;
    };
    const wp = wood.geometry.attributes.position, wi = wood.geometry.index;
    for (let i = 0; i < wp.count; i++) bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(wp, i).applyMatrix4(wood.matrixWorld));
    let signedVolume = 0;
    const lateralCount = wood.geometry.userData.osmanthusAxis?.lateralIndexCount;
    for (let i = 0; i < (wi?.count ?? wp.count); i += 3) {
      const v = [0,1,2].map(k => new THREE.Vector3().fromBufferAttribute(wp, wi ? wi.getX(i+k) : i+k));
      signedVolume += v[0].dot(v[1].clone().cross(v[2]))/6;
      if (lateralCount !== undefined && i < lateralCount) {
        v.forEach(p => p.applyMatrix4(wood.matrixWorld));
        triangleWoodProjectedAreaM2 += Math.abs(v[1].sub(v[0]).cross(v[2].sub(v[0])).dot(wind))/4;
      }
    }
    const triangleKg = 550 * Math.abs(signedVolume), sectionKg = 550 * sections.reduce((sum, s) => sum + sectionVolume(s), 0);
    triangleWoodKg += triangleKg;
    if (triangleKg > 0) maxVolumeRelativeError = Math.max(maxVolumeRelativeError, Math.abs(sectionKg/triangleKg-1));
    let distal = 0, distalNode = 0;
    const leaves = branch.pivot.children.find(o => o.userData.connectedBy === 'petiole');
    if (leaves) {
      const lp = leaves.geometry.attributes.position, li = leaves.geometry.index, m = new THREE.Matrix4();
      for (const node of leaves.userData.nodes) if (node.scale >= 1-1e-8) distalNode = Math.max(distalNode, project(new THREE.Vector3(...node.attachment)));
      for (let i = 0; i < leaves.count; i++) {
        leaves.getMatrixAt(i, m);
        const vertices = Array.from({length: lp.count}, (_, j) => {
          const p = new THREE.Vector3().fromBufferAttribute(lp, j).applyMatrix4(m);
          distal = Math.max(distal, project(p));
          p.applyMatrix4(leaves.matrixWorld); bounds.expandByPoint(p); return p;
        });
        for (let j = 0; j < (li?.count ?? lp.count); j += 3) {
          const t = [0,1,2].map(k => vertices[li ? li.getX(j+k) : j+k]);
          const cross = t[1].clone().sub(t[0]).cross(t[2].clone().sub(t[0]));
          area += cross.length()/2; leafProjectedAreaM2 += Math.abs(cross.dot(wind))/2;
          triangles.push(t);
        }
      }
    }
    if (branch.length > .15 && model.group.userData.lifecycle.age > branch.pivot.userData.birth + .4) {
      axes.set(branch.pivot.userData.axisId, {lengthM: length, gapM: Math.max(0, length-distal), lastExpandedNodeGapM: Math.max(0, length-distalNode)});
    }
  }
  return {bounds, triangles, axes, leaves: model.leafCount, axisCount: model.branches.length, draws, area,
    sectionWoodKg, triangleWoodKg, maxVolumeRelativeError, leafProjectedAreaM2, woodProjectedAreaM2, triangleWoodProjectedAreaM2};
}

export function arcSummary(geometry, commonIds = [...geometry.axes.keys()]) {
  const rows = commonIds.map(id => geometry.axes.get(id)).filter(Boolean);
  const gaps = rows.map(r => r.gapM).sort((a,b) => a-b), nodes = rows.map(r => r.lastExpandedNodeGapM).sort((a,b) => a-b);
  return {axes: rows.length, gap95M: gaps[Math.floor(gaps.length*.95)] ?? 0,
    lastExpandedNodeGap95M: nodes[Math.floor(nodes.length*.95)] ?? 0,
    terminalSupport: rows.filter(r => r.gapM <= .12).length/rows.length,
    gapLengthRatio: rows.reduce((s,r) => s+r.gapM,0)/rows.reduce((s,r) => s+r.lengthM,0)};
}

export function coverage(geometry, bounds, resolution = 192, phase = .5) {
  const size = bounds.getSize(new THREE.Vector3()), views = [], outer = [];
  for (const [u,v] of [['x','y'],['x','z'],['z','y']]) {
    const occupied = new Uint8Array(resolution**2);
    const edge = (a,b,x,y) => (b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
    for (const triangle of geometry.triangles) {
      const t = triangle.map(p => [(p[u]-bounds.min[u])/size[u]*resolution,(p[v]-bounds.min[v])/size[v]*resolution]);
      const [a,b,c] = t, sign = Math.sign(edge(a,b,c[0],c[1])); if (!sign) continue;
      const loX = Math.max(0,Math.ceil(Math.min(...t.map(p=>p[0]))-phase)), hiX = Math.min(resolution-1,Math.floor(Math.max(...t.map(p=>p[0]))-phase));
      const loY = Math.max(0,Math.ceil(Math.min(...t.map(p=>p[1]))-phase)), hiY = Math.min(resolution-1,Math.floor(Math.max(...t.map(p=>p[1]))-phase));
      for (let y=loY;y<=hiY;y++) for(let x=loX;x<=hiX;x++) {
        if (occupied[y*resolution+x]) continue;
        if (edge(a,b,x+phase,y+phase)*sign>=0 && edge(b,c,x+phase,y+phase)*sign>=0 && edge(c,a,x+phase,y+phase)*sign>=0) occupied[y*resolution+x]=1;
      }
    }
    let pixels=0,filled=0;
    for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++) {
      const r2=((x+phase)*2/resolution-1)**2+((y+phase)*2/resolution-1)**2;
      if(r2<.55**2||r2>1)continue; pixels++;filled+=occupied[y*resolution+x];
    }
    views.push(occupied.reduce((s,n)=>s+n,0)/resolution**2);outer.push(filled/pixels);
  }
  return {resolution,phase,views,outer};
}

// A single root-coordinate physical window per comparison, including actual
// wood and leaf vertices from BOTH models; no independently fitted windows.
export function compareGeometry(before, after) {
  const bounds = before.bounds.clone().union(after.bounds);
  const commonIds = [...before.axes.keys()].filter(id => after.axes.has(id));
  return {windowM: {min: bounds.min.toArray(),max: bounds.max.toArray()},
    commonArc: {before: arcSummary(before,commonIds),after: arcSummary(after,commonIds)},
    ownArc: {before: arcSummary(before),after: arcSummary(after)},
    projections: [96,192].flatMap(resolution => [.25,.5,.75].map(phase => ({
      before: coverage(before,bounds,resolution,phase),after: coverage(after,bounds,resolution,phase)})))};
}
