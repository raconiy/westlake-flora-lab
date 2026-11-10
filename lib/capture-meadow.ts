import * as THREE from 'three';
import turfLight from './capture-turf-light.json' with {type:'json'};
import {isMeadowPoint, meadowBounds, meadowCoreBounds, meadowFringeWeight} from './capture-meadow-layout.ts';

const cell = .065;                        // metres between candidate tiller groups
const cellsPerChunk = 30;
const variants = 4;
const rootY = -.003107703;                  // decoded plane height of the frozen v2 GLB
const clearance = .108;                    // includes bent tip, wind deflection and root scatter
export const meadowSeed = 0x73c103a7;
const unit = (bits:number) => (bits>>>0)/4294967296;
function hash(a:number,b:number,seed:number) {
  let v=Math.imul(a^seed,0x7feb352d)^Math.imul(b^0x635b,0x846ca68b);
  v=Math.imul(v^(v>>>16),0x85ebca6b);v=Math.imul(v^(v>>>13),0xc2b2ae35);
  return (v^(v>>>16))>>>0;
}
function random(seed:number) {
  let n=seed;
  return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return unit(n);};
}
const smooth = (a:number,b:number,x:number)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
/** Smooth fine-detail fraction over a camera-distance interval in world metres. */
export function meadowDetailMix(distance:number,near:number,far:number) {
  return far>near ? 1-smooth(near,far,distance) : 0;
}

// The independent scene-light field comes from the photo-01/02/13 lawn fit.
const [sunR,sunG,sunB] = turfLight.sunLinearRgb;
const [shadeR,shadeG,shadeB] = turfLight.oldShadeLinearRgb.map(v=>v*turfLight.shadeGain);

function captureLight(x:number,z:number) {
  const a=x-.36903619,b=-z-.00876927;
  const s=.77264685*a+.63483608*b, t=.63483608*a-.77264685*b;
  return (1-smooth(-.2,.2,s))*(1-smooth(7,11,Math.max(-8.1277918-t,t-4.2566911)))*(1-smooth(11,15,-s));
}

type Chunk={x:number;z:number;start:number;end:number;mid:number[];far:number[]};
/** Deterministic ground-frame layout. Each array is indexed by persistent tuft ID. */
export function createMeadowLayout(seed=meadowSeed) {
  const core=meadowCoreBounds;
  // All integer grid coordinates, including negative fringe indices, use the
  // original origin. Extending the planting must not move a single old root.
  const gridX=(x:number)=>(x-core.minX)/cell, gridZ=(z:number)=>(z-core.minZ)/cell;
  const left=Math.floor(gridX(meadowBounds.minX)),right=Math.ceil(gridX(meadowBounds.maxX));
  const top=Math.floor(gridZ(meadowBounds.minZ)),bottom=Math.ceil(gridZ(meadowBounds.maxZ));
  const size=(right-left)*(bottom-top);
  const xs=new Float32Array(size),zs=new Float32Array(size),traits=new Uint32Array(size);
  const chunks:Chunk[]=[];let count=0;
  function append(minI:number,maxI:number,minJ:number,maxJ:number,fringe:boolean) {
    for(let cz=minJ;cz<maxJ;cz+=cellsPerChunk)for(let cx=minI;cx<maxI;cx+=cellsPerChunk){
      const c:Chunk={x:core.minX+(cx+cellsPerChunk/2)*cell,z:core.minZ+(cz+cellsPerChunk/2)*cell,start:count,end:count,mid:[],far:[]};
      for(let j=cz;j<Math.min(maxJ,cz+cellsPerChunk);j++)for(let i=cx;i<Math.min(maxI,cx+cellsPerChunk);i++){
        const h=hash(i,j,seed),jitter=hash(j,i,seed^0x73ef9f);
        const x=core.minX+(i+.08+.84*(jitter&65535)/65535)*cell;
        const z=core.minZ+(j+.08+.84*(jitter>>>16)/65535)*cell;
        const oldFootprint=x>core.minX+clearance&&x<core.maxX-clearance&&z>core.minZ+clearance&&z<core.maxZ-clearance;
        if(oldFootprint===fringe)continue;
        if(fringe&&unit(hash(i,j,seed^0x69d54f))>=meadowFringeWeight(x,z))continue;
        const density=.86+.065*Math.sin(x*.73+z*.25)+.05*Math.cos(z*.81-x*.35);
        if(unit(hash(i,j,seed^0x319a51))>density || !isMeadowPoint(x,z,clearance))continue;
        xs[count]=x;zs[count]=z;traits[count]=h;
        const rank=(h&65535)/65535;
        if(rank<.285)c.mid.push(count);
        if(rank<.044)c.far.push(count);
        count++;
      }
      c.end=count;if(c.end>c.start)chunks.push(c);
    }
  }
  append(0,Math.ceil(gridX(core.maxX)),0,Math.ceil(gridZ(core.maxZ)),false);
  const coreCount=count;
  append(left,right,top,bottom,true);
  return {seed,count,coreCount,x:xs.subarray(0,count),z:zs.subarray(0,count),traits:traits.subarray(0,count),chunks};
}

type Tier = 0|1|2;
const tierName=['near','middle','far'];
function tuftGeometry(tier:Tier,variant:number,seed:number) {
  // Generate one physical tuft. Coarser meshes retain a nested subset of the
  // same blades, their shoot sockets, centerlines, widths and pigmentation.
  const next=random(hash(0,variant,seed^0x4c351));
  const original=Array.from({length:39+variant},(_,i)=>i);
  const understorey=Array.from({length:23+variant},(_,i)=>original.length+i);
  const allBlades=[...original,...understorey];
  const sample=(ids:number[],count:number)=>Array.from({length:count},(_,i)=>ids[Math.floor((i+.5)*ids.length/count)]);
  const previousMiddle=sample(original,10+variant),lowerMiddle=sample(understorey,5);
  const mid=[...previousMiddle,...lowerMiddle];
  const far=[...sample(previousMiddle,5+variant),...sample(lowerMiddle,2)];
  const sourceBladeIds=tier===0?allBlades:tier===1?mid:far;
  const retained=new Set(sourceBladeIds);
  const position:number[]=[],color:number[]=[],index:number[]=[];
  const rows=tier===0?[0,.22,.48,.76,1]:tier===1?[0,.48,1]:[0,1];
  const columns=tier===0?3:2;
  const originalSockets:{x:number;z:number}[]=[];
  const shoots=Array.from({length:Math.ceil(original.length/1.5)},()=>{
    const angle=next()*Math.PI*2,r=Math.sqrt(next())*.036;
    // A runner's position and the azimuth of its grass shoot are independent.
    return {x:Math.cos(angle)*r,z:Math.sin(angle)*r,a:next()*Math.PI*2};
  });
  for(const k of allBlades){
    const isLower=k>=original.length;
    const shoot=shoots[k%shoots.length], originalAngle=shoot.a+(k%3)*2.17+(next()-.5)*1.05;
    // Keep the same random draws through the root socket across revisions.
    // The photos resolve a low, continuous sward. Blade dimensions come
    // from a fine-textured turf prior, not a species ID or campus caliper.
    const young=!isLower && k%5<2;
    const length=young?.025+.019*next():.042+.021*next();
    const initialAngle=young?.16+.38*next():.32+.41*next();
    const twist=(next()-.5)*1.12;
    const halfWidth=.00084+.00055*next();
    const tint=next(),clipped=next()<.74;
    const sampledX=shoot.x+(next()-.5)*.004,sampledZ=shoot.z+(next()-.5)*.004;
    if(!isLower)originalSockets.push({x:sampledX,z:sampledZ});
    // A second leaf fans from the same shoot. Preserve every underlying
    // planting point and previously established leaf socket.
    const socket=originalSockets[isLower?(k*7+variant)%original.length:k];
    const rootX=socket.x,rootZ=socket.z;
    if(!retained.has(k))continue;
    const shape=random(hash(k,variant,seed^0x4cf69));
    const angle=isLower?Math.atan2(rootZ,rootX)+(shape()-.5)*1.65:originalAngle;
    const cx=Math.cos(angle),cz=Math.sin(angle),sx=-cz,sz=cx;
    const emergence=isLower?.55+.22*shape():initialAngle;
    const sweep=young?.38+.50*shape():isLower?.70+.64*shape():.61+.69*shape();
    const cutWidth=clipped?.46+.37*shape():.035;
    const cutSlant=clipped?(shape()-.5)*1.15:0;
    const dry=shape()<.09?.5+.38*shape():.05*shape();
    const offset=position.length/3;
    for(let j=0;j<rows.length;j++){
      const t=rows[j],angleAt=emergence+sweep*t;
      // Integrate the centreline tangent by arc length. Mature outer blades
      // can return towards the ground beyond their crown; young blades arch less.
      const reach=length*(Math.cos(emergence)-Math.cos(angleAt))/sweep;
      const lift=length*(Math.sin(angleAt)-Math.sin(emergence))/sweep;
      const crossTurn=twist*t*t;
      const sideX=sx*Math.cos(crossTurn)-cx*Math.sin(crossTurn)*Math.cos(angleAt);
      const sideZ=sz*Math.cos(crossTurn)-cz*Math.sin(crossTurn)*Math.cos(angleAt);
      const sideY=Math.sin(crossTurn)*Math.sin(angleAt);
      // Narrow sheath opens by the lower third. The lamina then narrows
      // continuously toward its intact point or a wider, obliquely cut tip.
      const sheath=.82+.18*Math.sin(.5*Math.PI*Math.min(1,t/.32));
      const width=halfWidth*sheath*(1-(1-cutWidth)*t*t);
      const light=.75+.22*t+.12*tint;
      const tipDry=dry*(.12+.88*t*t*t);
      for(let l=0;l<columns;l++){
        const u=2*l/(columns-1)-1;
        const midrib=(1-Math.abs(u))*width*.20*Math.sin(Math.PI*t);
        const along=t===1?width*u*cutSlant:0;
        position.push(rootX+cx*(reach+along*Math.sin(angleAt))+sideX*u*width,
          lift+along*Math.cos(angleAt)+sideY*u*width+midrib,
          rootZ+cz*(reach+along*Math.sin(angleAt))+sideZ*u*width);
        const lamina=light*(1-.065*Math.sin(Math.PI*t)*(1-Math.abs(u)));
        color.push((.115+.077*tint+.105*tipDry)*lamina,
          (.204+.096*tint+.021*tipDry)*lamina,(.028+.025*tint+.013*tipDry)*lamina);
      }
      if(j>0)for(let l=0;l<columns-1;l++){
        const a=offset+(j-1)*columns+l,b=a+1,c=a+columns,d=c+1;
        index.push(a,c,b,b,c,d);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(color,3));
  geometry.setIndex(index);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  geometry.name=`Turf blades ${tierName[tier]} ${variant+1}`;
  geometry.userData={bladesPerTuft:sourceBladeIds.length,detailTier:tierName[tier],sourceBladeIds,sampleRows:rows};
  return geometry;
}

function patchMeadowWind(mat:THREE.MeshStandardMaterial,amplitude:{value:number},phase:{value:number}) {
  mat.onBeforeCompile=shader=>{
    shader.uniforms.meadowBend=amplitude;shader.uniforms.meadowTime=phase;
    shader.vertexShader='uniform float meadowBend; uniform float meadowTime;\n'+shader.vertexShader.replace('#include <begin_vertex>',`
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 rest = instanceMatrix * vec4(transformed, 1.0);
        float h = max(0.0, rest.y - instanceMatrix[3].y);
        float direction = meadowBend * (.82 + .18*sin(meadowTime-dot(instanceMatrix[3].xz,vec2(1.7,.91))));
        float slope = direction * min(.50, 7.*h);
        transformed += inverse(mat3(instanceMatrix)) * vec3(.974555*h*slope, -h*(1.-sqrt(max(0.,1.-slope*slope))), .224148*h*slope);
      #endif
    `);
  };
  mat.customProgramCacheKey=()=> 'capture-meadow-wind-v1';
}

/** Renderable camera-dependent density and wind over persistent world-space planting sites. */
export function createCaptureMeadow(seed=meadowSeed) {
  const layout=createMeadowLayout(seed);
  const group=new THREE.Group();group.name='Yungu captured lawn meadow';
  group.userData={seed,basis:'Original 44 by 52 m core plus a deterministic, gradual 6–11 m outer grass transition; metre scale from assumed 3.41 m lamp. Tiller density, mowing height and hidden plants are engineering priors.',rootPlaneY:rootY,originalCoreTufts:layout.coreCount};
  const amplitude={value:0},phase={value:0};
  const material=new THREE.MeshStandardMaterial({name:'Mown lawn tillers',vertexColors:true,roughness:.92,metalness:0,side:THREE.DoubleSide});
  patchMeadowWind(material,amplitude,phase);
  const beds=Array.from({length:3*variants},(_,k)=>({
    geometry:tuftGeometry(Math.floor(k/variants) as Tier,k%variants,seed),mesh:null as THREE.InstancedMesh|null,ids:[] as number[],
  }));
  const eye=new THREE.Vector3(),prior=new THREE.Vector3(Infinity,0,0),rotation=new THREE.Quaternion(),lastRotation=new THREE.Quaternion();
  const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),oldProjection=new THREE.Matrix4();
  const chunkSphere=new THREE.Sphere(new THREE.Vector3(),cellsPerChunk*cell*.72+.5);
  const matrix=new THREE.Matrix4(),instanceColor=new THREE.Color();
  const stats={seed,fieldTufts:layout.count,tufts:0,blades:0,drawCalls:0,nearBlades:0,middleBlades:0,farBlades:0};
  let disposed=false;
  function rebuild(camera:THREE.Camera,allChunks=false,fullDetail=false) {
    camera.updateWorldMatrix(true,false);camera.getWorldPosition(eye);camera.getWorldQuaternion(rotation);
    if(!allChunks && prior.distanceToSquared(eye)<.28**2 && Math.abs(rotation.dot(lastRotation))>.9997 && camera.projectionMatrix.equals(oldProjection)) return false;
    prior.copy(eye);lastRotation.copy(rotation);oldProjection.copy(camera.projectionMatrix);
    projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);
    for(const bed of beds)bed.ids.length=0;
    const dy=(eye.y-rootY)**2;
    for(const chunk of layout.chunks){
      chunkSphere.center.set(chunk.x,rootY+.04,chunk.z);
      if(!allChunks && !frustum.intersectsSphere(chunkSphere))continue;
      const lower=Math.max(0,Math.hypot(chunk.x-eye.x,chunk.z-eye.z)-chunkSphere.radius);
      const nearestSq=lower*lower+dy;
      const candidates=fullDetail?null:nearestSq>14.5**2?chunk.far:nearestSq>5.3**2?chunk.mid:null;
      const n=candidates?.length??chunk.end-chunk.start;
      for(let j=0;j<n;j++){
        const id=candidates?candidates[j]:chunk.start+j;
        const h=layout.traits[id],rank=(h&65535)/65535;
        const stagger=((h>>>24)+.5)/256;
        const distance=Math.sqrt((layout.x[id]-eye.x)**2+(layout.z[id]-eye.z)**2+dy);
        const tier=fullDetail||stagger<meadowDetailMix(distance,3.7,5.3)?0:stagger<meadowDetailMix(distance,10.5,14.5)?1:2;
        if(tier===1&&rank>=.285 || tier===2&&rank>=.044)continue;
        beds[tier*variants+((h>>>16)&3)].ids.push(id);
      }
    }
    const totals=[0,0,0];stats.tufts=0;stats.drawCalls=0;
    for(let k=0;k<beds.length;k++){
      const bed=beds[k],n=bed.ids.length;
      if(!n){if(bed.mesh){bed.mesh.count=0;bed.mesh.visible=false;}continue;}
      if(!bed.mesh || bed.mesh.instanceMatrix.count<n){
        if(bed.mesh){group.remove(bed.mesh);bed.mesh.dispose();}
        const mesh=new THREE.InstancedMesh(bed.geometry,material,Math.ceil(n*1.25)+16);
        mesh.name=bed.geometry.name;mesh.receiveShadow=true;mesh.frustumCulled=false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);bed.mesh=mesh;group.add(mesh);
      }
      const mesh=bed.mesh;mesh.count=n;mesh.visible=true;
      for(let q=0;q<n;q++){
        const id=bed.ids[q],x=layout.x[id],z=layout.z[id],traits=layout.traits[id];
        const yaw=unit(hash(traits,seed,3))*Math.PI*2;
        const sy=.82+.28*((traits>>>18)&255)/255,sw=.86+.25*((traits>>>24)&255)/255;
        const co=sw*Math.cos(yaw),si=sw*Math.sin(yaw);
        matrix.set(co,0,si,x, 0,sy,0,rootY, -si,0,co,z, 0,0,0,1);mesh.setMatrixAt(q,matrix);
        const shade=captureLight(x,z),v=.88+.20*unit(hash(traits,2,seed));
        instanceColor.setRGB(v*THREE.MathUtils.lerp(sunR,shadeR,shade),v*THREE.MathUtils.lerp(sunG,shadeG,shade),v*THREE.MathUtils.lerp(sunB,shadeB,shade));mesh.setColorAt(q,instanceColor);
      }
      mesh.instanceMatrix.addUpdateRange(0,n*16);mesh.instanceMatrix.needsUpdate=true;
      if(mesh.instanceColor){mesh.instanceColor.addUpdateRange(0,n*3);mesh.instanceColor.needsUpdate=true;}
      stats.tufts+=n;stats.drawCalls++;totals[Math.floor(k/variants)]+=n*bed.geometry.userData.bladesPerTuft;
    }
    [stats.nearBlades,stats.middleBlades,stats.farBlades]=totals;
    stats.blades=totals[0]+totals[1]+totals[2];return true;
  }
  return {group,stats,layout,
    update(camera:THREE.Camera,seconds=0,speed=0){
      if(disposed)return false;
      const changed=rebuild(camera),wind=Number.isFinite(speed)?THREE.MathUtils.clamp(speed,-12,12):0;
      if((wind===0&&amplitude.value===0)||!(seconds>0))return changed;
      const target=wind*Math.abs(wind)/(36+wind*wind),dt=Math.min(seconds,.2);
      amplitude.value+=(target-amplitude.value)*-Math.expm1(-dt/.22);
      if(!wind&&Math.abs(amplitude.value)<.0001)amplitude.value=0;
      phase.value=amplitude.value?(phase.value+dt*(1.5+.32*Math.abs(wind)))%(2*Math.PI):0;
      return true;
    },
    /** Static, complete campus attachment; nearby density is referenced to the given camera.
     * The returned group borrows source geometries/materials. Export before disposing this field. */
    exportSnapshot(camera:THREE.Camera,detail:'distance'|'full'='distance'){
      if(disposed)throw Error('The meadow has been disposed');
      rebuild(camera,true,detail==='full');
      const snapshot=new THREE.Group();snapshot.name=group.name;snapshot.userData={...group.userData,stats:{...stats},densityReference:detail==='full'?'Full near-detail blades at every persistent planting site.':'Camera distance sets three geometric representations across the whole planting extent.'};
      for(const bed of beds){
        const mesh=bed.mesh;if(!mesh?.visible||!mesh.count)continue;
        const copy=new THREE.InstancedMesh(bed.geometry,material,mesh.count);copy.name=mesh.name;
        copy.instanceMatrix.array.set(mesh.instanceMatrix.array.subarray(0,mesh.count*16));
        if(mesh.instanceColor)copy.instanceColor=new THREE.InstancedBufferAttribute(mesh.instanceColor.array.slice(0,mesh.count*3),3);
        snapshot.add(copy);
      }
      prior.x=Infinity;
      return snapshot;
    },
    dispose(){if(disposed)return;disposed=true;for(const bed of beds){bed.mesh?.dispose();bed.geometry.dispose();}material.dispose();group.removeFromParent();group.clear();}
  };
}
