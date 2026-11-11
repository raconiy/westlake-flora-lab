import * as THREE from 'three';
import {campusLamps, campusPaving, lampRadii, yunguCampusLayout} from './campus-layout.ts';
import {advanceLawnWind, attachLawnWind} from './capture-grass.ts';

// Layout-experiment turf, not a measured reconstruction or species identification.
// The reference shows a short mown sward; dimensions below are engineering priors.
export const campusTurfBounds = {minX:-21, maxX:21, minZ:-18, maxZ:18} as const;
export const campusTurfReach = .14;
export const campusTurfSeed = 0x51a9e31;
const step = .105, variants = 4;
const unit = (n:number) => (n>>>0)/4294967296;
function hash(a:number,b:number,seed:number) {
  let n=Math.imul(a^seed,0x7feb352d)^Math.imul(b^0x64af,0x846ca68b);
  n=Math.imul(n^(n>>>16),0x85ebca6b);
  return (n^(n>>>13))>>>0;
}
function random(seed:number) {let n=seed;return ()=>unit(n=(Math.imul(n,1664525)+1013904223)>>>0);}

// Conservative envelopes of the *current scaled scene mesh* below 12 cm.
// These are explicit model-space checks, not measurements of campus root flares.
// A species-wide radius left conspicuous empty disks around the slender trees.
export const campusTurfRootEnvelopes:Record<string,number>={
  'camphor-01':.23,'camphor-02':.18,'camphor-03':.21,
  'ginkgo-01':.14,'ginkgo-02':.105,'ginkgo-03':.13,
  'osmanthus-01':.35,'osmanthus-02':.38,'acer-01':.065,
};
const obstacles = [
  ...yunguCampusLayout.map(p=>({x:p.x,z:p.z,r:campusTurfRootEnvelopes[p.id]??.18*p.scale})),
  ...campusLamps.map(p=>({x:p.x,z:p.z,r:lampRadii.postBase})),
];

/** Clearance includes each tuft's full rest and ±12 m/s swept geometry. */
export function isCampusTurfPoint(x:number,z:number,margin=campusTurfReach) {
  const b=campusTurfBounds;
  if(![x,z,margin].every(Number.isFinite)||margin<0||x<b.minX+margin||x>b.maxX-margin||z<b.minZ+margin||z>b.maxZ-margin)return false;
  if(campusPaving.some(p=>Math.abs(x-p.x)<=p.width/2+margin && Math.abs(z-p.z)<=p.depth/2+margin))return false;
  return !obstacles.some(p=>Math.hypot(x-p.x,z-p.z)<p.r+margin);
}

/** Immutable world-space roots; camera changes only choose mesh detail. */
export function createCampusTurfLayout(seed=campusTurfSeed,layers=4) {
  if(!Number.isInteger(layers)||layers<1||layers>4)throw new RangeError('Expected 1–4 persistent turf layers');
  const b=campusTurfBounds,cols=Math.ceil((b.maxX-b.minX)/step),rows=Math.ceil((b.maxZ-b.minZ)/step);
  const roots:{id:number;x:number;z:number;traits:number}[]=[];
  let originalRoots=0;
  // Layer zero is byte-for-byte unchanged. Additional layers populate the
  // inter-tuft gaps at half-cell offsets with independent deterministic jitter.
  const offsets=[[0,0],[.5,0],[0,.5],[.5,.5]];
  for(let layer=0;layer<layers;layer++){
   const layerSeed=layer===0?seed:hash(layer,0,seed^0x94c613);
   for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
    const traits=hash(i,j,layerSeed),jitter=hash(j,i,layerSeed^0x61fa2c);
    const x=b.minX+(i+offsets[layer][0]+.08+.84*(jitter&65535)/65535)*step;
    const z=b.minZ+(j+offsets[layer][1]+.08+.84*(jitter>>>16)/65535)*step;
    // Smooth low-amplitude density variation avoids rectangular patch borders.
    const density=.95+.025*Math.sin(.47*x+.31*z)+.02*Math.cos(.71*z-.2*x);
    if(unit(hash(i,j,layerSeed^0x315ec1))>density||!isCampusTurfPoint(x,z))continue;
    roots.push({id:layer*cols*rows+j*cols+i,x,z,traits});
   }
   if(layer===0)originalRoots=roots.length;
  }
  return {seed,roots,originalRoots,layers};
}

type Tier = 0|1|2;
const tierNames=['near','middle','far'];
/** Each coarser geometry is a strict subset of the same leaves and centreline. */
export function campusTuftGeometry(tier:Tier,variant:number,seed=campusTurfSeed) {
  const next=random(hash(variant,0,seed));
  const allIds=Array.from({length:24},(_,i)=>i);
  const ids=tier===0?allIds:tier===1?[0,3,6,9,12,15,18,21]:[3,12,21];
  const rows=tier===0?[0,.25,.5,.75,1]:[0,.5,1];
  const retained=new Set(ids),position:number[]=[],color:number[]=[],indices:number[]=[];
  const shoots=Array.from({length:8},()=>{
    const angle=next()*Math.PI*2,r=Math.sqrt(next())*.025;
    return {x:r*Math.cos(angle),z:r*Math.sin(angle),a:next()*Math.PI*2};
  });
  for(const id of allIds){
    const shoot=shoots[id%shoots.length],young=id%3===0;
    const yaw=shoot.a+id*.91+(next()-.5)*.8;
    const length=(young?.03:.045)+next()*(young?.018:.032);
    const emergence=(young?.12:.3)+.24*next(),curve=(young?.35:.65)+next()*.7;
    const width=.0012+.0009*next(),tint=next(),cut=next()<.68;
    const twist=(next()-.5)*.8;
    if(!retained.has(id))continue;
    const offset=position.length/3;
    for(const [row,t] of rows.entries()){
      const a=emergence+curve*t;
      const reach=length*(Math.cos(emergence)-Math.cos(a))/curve;
      const lift=length*(Math.sin(a)-Math.sin(emergence))/curve;
      const w=width*(1-(cut?.4:.98)*t*t),cross=yaw+Math.PI/2+twist*t;
      for(const side of [-1,1]){
        position.push(shoot.x+Math.cos(yaw)*reach+side*Math.cos(cross)*w,
          lift,shoot.z+Math.sin(yaw)*reach+side*Math.sin(cross)*w);
        const brightness=.65+.35*t,dry=(id%13===0?.3:0)*t*t;
        color.push((.075+.045*tint+dry*.16)*brightness,
          (.17+.085*tint+dry*.035)*brightness,(.025+.025*tint)*brightness);
      }
      if(row){const k=offset+(row-1)*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(color,3));
  g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();
  g.name=`Campus turf ${tierNames[tier]} ${variant}`;
  g.userData={bladeIds:ids,rows,bladeCount:ids.length,tier,variant};
  return g;
}

/** Near, middle and far grass all retain the same root placements. */
export function createCampusTurf(seed=campusTurfSeed) {
  const layout=createCampusTurfLayout(seed),group=new THREE.Group();
  group.name='Campus short grass geometry';
  group.userData={basis:'engineering prior; fixed turf roots, mown grass geometry; no campus species or density measurement',rootPlaneY:0,seed};
  const response={value:0},phase={value:0};
  const uniforms={lawnResponse:response,lawnPhase:phase,lawnRootY:{value:0}};
  const material=new THREE.MeshStandardMaterial({name:'Campus short-grass blades',vertexColors:true,roughness:.94,side:THREE.DoubleSide});
  attachLawnWind(material,uniforms,true);
  const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
  const distance=new THREE.MeshDistanceMaterial({side:THREE.DoubleSide});
  attachLawnWind(depth,uniforms,false);attachLawnWind(distance,uniforms,false);
  const beds=Array.from({length:variants*3},(_,i)=>({
    geometry:campusTuftGeometry(Math.floor(i/variants) as Tier,i%variants,seed),
    mesh:null as THREE.InstancedMesh|null,ids:[] as number[],
  }));
  const previous=new THREE.Vector3(Infinity,0,0),eye=new THREE.Vector3(),matrix=new THREE.Matrix4(),tint=new THREE.Color();
  let disposed=false;
  const stats={roots:layout.roots.length,blades:0,drawCalls:0};
  function update(camera:THREE.Camera,seconds=0,speed=0){
    if(disposed)return false;
    camera.getWorldPosition(eye);
    let changed=false;
    if(previous.distanceToSquared(eye)>.35**2){
      previous.copy(eye);for(const bed of beds)bed.ids.length=0;
      for(const [i,p] of layout.roots.entries()){
        const d=Math.hypot(eye.x-p.x,eye.y,eye.z-p.z);
        // Stagger transitions per persistent tuft, not per square chunk.
        const stagger=((p.traits>>>8)&255)/255;
        const tier:Tier=d<2.5+1.5*stagger?0:d<7+3*stagger?1:2;
        beds[tier*variants+(p.traits&3)].ids.push(i);
      }
      stats.blades=0;stats.drawCalls=0;
      for(const bed of beds){
        const n=bed.ids.length;
        if(!n){if(bed.mesh){bed.mesh.count=0;bed.mesh.visible=false;}continue;}
        if(!bed.mesh||bed.mesh.instanceMatrix.count<n){
          if(bed.mesh){bed.mesh.removeFromParent();bed.mesh.dispose();}
          bed.mesh=new THREE.InstancedMesh(bed.geometry,material,Math.ceil(n*1.2)+8);
          bed.mesh.name=bed.geometry.name;bed.mesh.frustumCulled=false;bed.mesh.receiveShadow=true;
          bed.mesh.customDepthMaterial=depth;bed.mesh.customDistanceMaterial=distance;
          bed.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(bed.mesh);
        }
        const mesh=bed.mesh;mesh.visible=true;mesh.count=n;
        for(const [row,id] of bed.ids.entries()){
          const p=layout.roots[id],yaw=unit(hash(p.traits,1,seed))*Math.PI*2;
          const sw=.9+.2*((p.traits>>>16)&255)/255,sy=.84+.23*(p.traits>>>24)/255;
          const c=sw*Math.cos(yaw),s=sw*Math.sin(yaw);
          matrix.set(c,0,s,p.x, 0,sy,0,0, -s,0,c,p.z, 0,0,0,1);mesh.setMatrixAt(row,matrix);
          const light=.87+.2*unit(hash(p.traits,2,seed));
          tint.setRGB(light,light,.92*light);mesh.setColorAt(row,tint);
        }
        mesh.instanceMatrix.needsUpdate=true;
        if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
        stats.blades+=n*bed.geometry.userData.bladeCount;stats.drawCalls++;
      }
      changed=true;
    }
    return advanceLawnWind(response,phase,seconds,speed)||changed;
  }
  return {group,stats,layout,update,
    dispose(){if(disposed)return;disposed=true;for(const bed of beds){bed.mesh?.dispose();bed.geometry.dispose();}material.dispose();depth.dispose();distance.dispose();group.removeFromParent();group.clear();},
  };
}
