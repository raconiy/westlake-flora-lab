import {acerLeafBlade} from './acer-leaf-geometry.ts';
import {acerAdultHeightAt,acerShootHeightAt,acerShootArrival,acerJuvenileNodeHeight,acerJuvenileShootPrior} from './acer-juvenile-shoot.ts';
import {acerApicalCohorts,acerApicalCohortPrior} from './acer-apical-cohorts.ts';
import {geometryHeight} from './geometry-height.ts';
import {acerJuvenileLeafPrior,acerJuvenileLeafState} from './acer-juvenile-leaves.ts';
import * as THREE from "three";
import {tagWoodTube,mergeWoodSections,woodSections} from "./wood-loads.ts";
import {mapWoodyBarkUV,wireWoodyBarkSurface,wireWoodyLeafSurface} from "./woody-materials.ts";
import {tagLeafStrip,mergedLeafStripAttributes} from "./herb-leaf-dynamics.ts";
import type { PlantParams, PlantModel, BranchJoint } from "./plant-engine";

// @ts-ignore Native Node tests require the suffix.
import { additionalDevelopment, developmentPriors, organGrowth, ophiopogonRamet, clonalArchitecturePrior } from "./development.ts";
import {woodyEstablishmentGeometry, woodyEstablishmentState, woodyEstablishmentEvidence,
 acerHypocotylState,acerPrimaryGeometry,acerCotyledonState,acerCotyledonBlade,acerEstablishmentPriors} from './woody-establishment.ts';

export type AdditionalSpecies = "camphor" | "acer" | "ophiopogon";
/** Organ dimensions from primary botanical/extension descriptions, not campus measurements.
 * Camphor: alternate, basal 3-veined, blades 6–12 × 2.5–5.5 cm, petioles 2–3 cm (data record Flora source).
 * https://plantnet.rbgsyd.nsw.gov.au/cgi-bin/NSWfl.pl?lvl=sp&name=Cinnamomum~camphora&page=nswfl
 * Acer: opposite, deciduous, 5–7 lobes; summer-green form; autumn orange/scarlet.
 * https://landscapeplants.oregonstate.edu/plants/acer-palmatum
 * Ophiopogon japonicus is NOT Liriope: tufted 10–50 cm × 2–4 mm leaves; shorter scapes.
 * https://www.efloras.org/florataxon.aspx?flora_id=2&taxon_id=200027794
 * https://plants.ces.ncsu.edu/plants/ophiopogon-japonicus/ (summer, nodding, 6 tepals)
 * Calendar windows, growth curves, branch mechanics and root mappings are uncalibrated priors.
 */
export const ADDITIONAL_BOTANICAL_SOURCES = {
  camphor: "https://www.efloras.org/florataxon.aspx?flora_id=2&taxon_id=200008697",
  acer: "https://www.iplant.cn/foc/pdf/Acer.pdf",
  ophiopogon: "https://www.efloras.org/florataxon.aspx?flora_id=2&taxon_id=200027794",
};
const UP = new THREE.Vector3(0,1,0);
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
function randomFor(seed:number){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}};
function curvedTube(curve:THREE.Curve<THREE.Vector3>,radius:number,tip:number,segments=10,sides=6,woodySurface=false){
 const f=curve.computeFrenetFrames(segments,false),p:number[]=[],uv:number[]=[],ix:number[]=[];
 for(let i=0;i<=segments;i++){const t=i/segments,c=curve.getPointAt(t),r=tip+(radius-tip)*Math.pow(1-t,.86);for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2,n=f.normals[i].clone().multiplyScalar(Math.cos(a)*r).addScaledVector(f.binormals[i],Math.sin(a)*r);p.push(c.x+n.x,c.y+n.y,c.z+n.z);uv.push(j/sides,t*curve.getLength());if(i<segments&&j<sides){const v=i*(sides+1)+j;ix.push(v,v+sides+1,v+1,v+1,v+sides+1,v+sides+2)}}}
 const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(p,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();if(woodySurface)mapWoodyBarkUV(g,radius,curve.getLength());return tagWoodTube(g,segments,sides);
}
function curvedAxis(length:number,bend:number,phase:number){return new THREE.CatmullRomCurve3([new THREE.Vector3(),new THREE.Vector3(bend*.1,length*.28,Math.sin(phase)*bend*.2),new THREE.Vector3(bend,length*.70,Math.sin(phase+.5)*bend*.4),new THREE.Vector3(bend*.7,length,Math.sin(phase+1)*bend*.55)])}
// Engineering assumption: extension adds a prefix of one material centreline;
// secondary thickening may change radii, but old nodes never slide with total height.
// Keep the existing height / axis-length law while extending the fixed lateral bends.
function materialPoint(full:THREE.CatmullRomCurve3,t:number,target=new THREE.Vector3()){
 full.getPoint(t,target);target.y=t*full.points[full.points.length-1].y;return target;
}
class AxisPrefix extends THREE.Curve<THREE.Vector3> {
 readonly full:THREE.CatmullRomCurve3;readonly fraction:number;
 constructor(full:THREE.CatmullRomCurve3,fraction:number){super();this.full=full;this.fraction=fraction}
 getPoint(t:number,target=new THREE.Vector3()){return materialPoint(this.full,t*this.fraction,target)}
}
const inverseOrganGrowth=(fraction:number)=>.5-Math.sin(Math.asin(1-2*clamp(fraction))/3);
function extensionAxis(id:string,target:number,bend:number,phase:number,birth:number,duration:number,age:number){
 // Woody axes turn in two lateral dimensions, with a tangent continuous along
 // the material curve. Keep the herb/leader curve and their RNG streams intact.
 const lateral=(r:number,a:number,y:number)=>new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r),
  full=new THREE.CatmullRomCurve3([new THREE.Vector3(),lateral(bend*.12,phase,target*.28),
   lateral(bend,phase+.45,target*.70),lateral(bend*.78,phase+1.05,target)]),growth=organGrowth(birth,duration,age);
 return {id,target,birth,length:target*growth,curve:new AxisPrefix(full,growth),
  point:(t:number)=>materialPoint(full,t),birthAt:(t:number)=>birth+duration*inverseOrganGrowth(t)};
}
type ExtensionAxis=ReturnType<typeof extensionAxis>;
function materialTangent(axis:ExtensionAxis,t:number){return axis.point(Math.min(1,t+.0001)).sub(axis.point(Math.max(0,t-.0001))).normalize()}
type WoodAxis={id:string;parentId:string;birth:number;length:number;radius:number;attachment:number[]};
function merge(parts:THREE.BufferGeometry[]){const flat=parts.map(g=>g.index?g.toNonIndexed():g),n=flat.reduce((a,g)=>a+g.attributes.position.count,0),p=new Float32Array(n*3),normal=new Float32Array(n*3),uv=new Float32Array(n*2),color=new Float32Array(n*3).fill(1);let offset=0;
 for(const g of flat){p.set(g.attributes.position.array as ArrayLike<number>,offset*3);normal.set(g.attributes.normal.array as ArrayLike<number>,offset*3);if(g.attributes.uv)uv.set(g.attributes.uv.array as ArrayLike<number>,offset*2);if(g.attributes.color)color.set(g.attributes.color.array as ArrayLike<number>,offset*3);offset+=g.attributes.position.count}
 const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(p,3));out.setAttribute("normal",new THREE.BufferAttribute(normal,3));out.setAttribute("uv",new THREE.BufferAttribute(uv,2));out.setAttribute("color",new THREE.BufferAttribute(color,3));mergeWoodSections(parts,out);for(const g of new Set([...parts,...flat]))g.dispose();return out;
}
function camphorBlade(){const s=new THREE.Shape();s.moveTo(0,0);s.bezierCurveTo(.023,.021,.025,.058,0,.095);s.bezierCurveTo(-.025,.058,-.023,.021,0,0);const g=new THREE.ShapeGeometry(s,14),p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);p.setZ(i,.002*Math.sin(y/.095*Math.PI)-Math.abs(x)*.07);uv.setXY(i,.5+x/.05,y/.095)}g.computeVertexNormals();return g;}
function mapleBlade(){return acerLeafBlade();}

export function buildAdditionalPlant(species:AdditionalSpecies,params:PlantParams):PlantModel {
 const life=additionalDevelopment(species,params.age),age=life.age,day=clamp(Number.isFinite(params.day)?params.day:180,1,365),density=clamp(Number.isFinite(params.density)?params.density:1,.15,2),seed=Number.isFinite(params.seed)?params.seed:1;
 const group=new THREE.Group();group.name=`plant:${species}:${seed}`;group.userData.source=ADDITIONAL_BOTANICAL_SOURCES[species];group.userData.calibration="unmeasured engineering prototype";group.userData.rootModel=`${species}: engineering-prior, not measured`;group.userData.lifecycle=life;group.userData.priors=developmentPriors;group.userData.units="metres";
 const branches:BranchJoint[]=[],geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();let leafCount=0;
 const geom=<T extends THREE.BufferGeometry>(g:T)=>{geometries.add(g);return g},mat=<T extends THREE.Material>(m:T)=>{materials.add(m);return m};
 const dummy=new THREE.Object3D(),color=new THREE.Color();
 function joint(parent:THREE.Object3D,pos:THREE.Vector3,dir:THREE.Vector3,length:number,radius:number,order:number,key:number){const pivot=new THREE.Group();pivot.position.copy(pos);pivot.quaternion.setFromUnitVectors(UP,dir.clone().normalize());parent.add(pivot);branches.push({pivot,rest:pivot.quaternion.clone(),length,radius,order,phase:randomFor(key)()*6.28,flexibility:clamp(.003*Math.pow(length/Math.max(.001,radius),1.05),.03,1.3),sag:Math.min(.12,length*.045)});return pivot;}
 function addWood(parent:THREE.Object3D,parts:THREE.BufferGeometry[],material:THREE.Material,axes:WoodAxis[]){if(!parts.length)return;const m=new THREE.Mesh(geom(merge(parts)),material);m.castShadow=m.receiveShadow=true;m.userData.axes=axes;parent.add(m);}
 const stageLabel=life.stage;
 if(species==='camphor'||species==='acer'){
  const establishment=new THREE.Mesh(geom(woodyEstablishmentGeometry(species,age)),mat(new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.93})));
  establishment.name='woody-seed-establishment';establishment.userData={organ:'seed',organs:establishment.geometry.userData.organs,sourceType:'engineering-prior',calibrated:false,support:woodyEstablishmentState(species,age),evidence:woodyEstablishmentEvidence[species]};
  establishment.castShadow=establishment.receiveShadow=true;group.add(establishment);
  group.userData.establishment=woodyEstablishmentEvidence[species];
 }
 const leafPresence=species==="acer"?smooth(65,105,day)*(1-smooth(313,344,day)):1,autumn=species==="acer"?smooth(255,309,day):0;
 if(species!=="ophiopogon" && life.shoot>0) {
  const maple=species==="acer",heightLimit=.025+(maple?6.5:16),heightTime=maple?15:24;
  const heightAt=(year:number)=>maple?acerShootHeightAt(year):(.025+(maple?6.5:16)*(1-Math.exp(-year/heightTime)))*organGrowth(.025,.25,year);
  const h=heightAt(age),radius=(.0015+(maple?.13:.32)*(1-Math.exp(-age/45)))*life.shoot;
  // Dense broad-crowned camphor versus lower multi-stemmed maple; neither is a renamed osmanthus model.
  const ownTexture=(t:THREE.DataTexture)=>{textures.add(t)};
  const bark=mat(new THREE.MeshStandardMaterial()),twigMat=mat(new THREE.MeshStandardMaterial());
  wireWoodyBarkSurface(bark,species,age,false,seed,ownTexture);
  wireWoodyBarkSurface(twigMat,species,age,true,seed,ownTexture);
  const leafGeo=geom(maple?mapleBlade():camphorBlade());
  const leafMat=mat(new THREE.MeshStandardMaterial({color:"#ffffff",side:THREE.DoubleSide})),petioleMat=mat(new THREE.MeshStandardMaterial({color:maple?"#985c4f":"#6c804b",roughness:.8})),petioleGeo=geom(new THREE.CylinderGeometry(1,1,1,4));
  wireWoodyLeafSurface(leafMat,leafGeo,species,ownTexture);
  // Preserve the published qualitative juvenile Acer colour and radius-relative
  // relief guard when replacing its old shared colour/bump texture. These are
  // unmeasured appearance priors, not a tissue-age or spectral calibration.
  const skinMaturity=maple?smooth(.12,.5,age):1;
  if(maple) {
   bark.color.set('#a0b778').lerp(new THREE.Color('#ffffff'),skinMaturity);
   bark.bumpScale=Math.min(bark.bumpScale,radius*.08)*skinMaturity;
  }
  const hypo=maple?acerHypocotylState(age):undefined;
  const trunk=joint(group,new THREE.Vector3(),UP,h+(hypo?.length??0),radius,0,seed),fullTrunk=curvedAxis(heightLimit,heightLimit*.025,seed),trunkCurve=new AxisPrefix(fullTrunk,h/heightLimit);
  // A non-dynamic reference frame carries the ENTIRE original crown. The
  // combined primary tube below remains rooted at zero, never a lifted trunk.
  const crown:THREE.Object3D=maple?new THREE.Group():trunk;
  if(maple){crown.name='acer-epicotyl-reference';crown.position.copy(hypo!.node);crown.quaternion.copy(hypo!.frame);trunk.add(crown);}
  const leader:ExtensionAxis={id:"leader",target:heightLimit,birth:.025,length:h,curve:trunkCurve,
   point:t=>materialPoint(fullTrunk,t),birthAt:t=>maple?acerShootArrival(heightLimit*t):-heightTime*Math.log((heightLimit-heightLimit*t)/(heightLimit-.025))};
  trunk.userData.node={id:leader.id,birth:leader.birth};
  group.userData.continuity={calibration:"uncalibrated engineering assumptions; not measured growth rates",
   extension:maple?"immature hypocotyl primary strain carries its node until .07 y; thereafter persistent added segment and fixed crown material sites; lateral births wait for support":"fixed material centrelines; lateral births wait for leader / parent to reach the attachment",
   timing:"original cohort onsets are lower bounds; axis extension durations remain illustrative",
   scaffold:"persistent without a modelled pruning or damage event",dateAndAge:maple?"age and annual day are independent snapshots; single age-limited cotyledon cohort with qualitative warm-season exposure; no temperature or validated germination phenology":"day controls phenology; age controls establishment"};
  const originalTube=curvedTube(trunkCurve,radius*1.4,.001*life.shoot,24,10);
  const primaryGeometry=maple?acerPrimaryGeometry(originalTube,age,radius*1.4):originalTube;
  // Map once on the final spliced primary, so both tissues share UV units.
  mapWoodyBarkUV(primaryGeometry,radius*1.4,trunkCurve.getLength()+(hypo?.length??0));
  const tm=new THREE.Mesh(geom(primaryGeometry),bark);tm.name=maple?'acer-primary-axis':'';tm.castShadow=tm.receiveShadow=true;trunk.add(tm);
  if(maple){
   const primary=branches[0];
   primary.length=woodSections(tm.geometry).reduce((sum,s)=>sum+new THREE.Vector3(...s.a).distanceTo(new THREE.Vector3(...s.b)),0);
   primary.flexibility=clamp(.003*Math.pow(primary.length/Math.max(.001,radius),1.05),.03,1.3);primary.sag=Math.min(.12,primary.length*.045);
   trunk.userData.geometryAssumptions={length:'actual tube centreline chords',nominalRadius:radius,basalRadiusScale:1.4,
    mechanics:'lumped beam uses nominal radius, not reconstructed tapered section inertia; not a primary-growth strain solver'};
   const state=acerCotyledonState(age,day),prior=acerEstablishmentPriors;
   group.userData.acerEstablishment={status:'literature-constrained procedural establishment; not field calibrated',
    hypocotyl:hypo!.node.toArray(),hypocotylLength:hypo!.length,epicotylLength:h,
    permanentHeightOffset:prior.hypocotylLength,rootCollar:[0,0,0],cotyledonCount:state.scale>0?2:0,
    cotyledonState:state,cotyledonLifespan:'one cohort .04-.36 y; senescence from .14 y after illustrative first true-leaf establishment; never annual renewal',
    seasonalLimit:'qualitative day 65-95 warm-up / 255-300 cooling proxy; sufficiently warm, frost-free emergence assumed; no temperature, chilling or germination history input',
    heightAccounting:'immature crown transported by hook endpoint frame; after .07 y original crown + permanent 18 mm; actual vertex height reported',
    primaryGrowth:hypo!.strain,appearance:'pale/green juvenile axis; bump capped at 8% nominal radius; hardening clock is an engineering prior',
    remainingVisualLimits:'first-pair size and apex sites refined; internode proportions, heteroblasty, temperatures and growth clocks remain uncalibrated',
    unsupported:'coat carry/release/decay, internal anatomy, calibrated senescence, pollination, collision, fracture, root-soil compliance and large-strain mechanics are not solved'};
   if(state.scale>0){
    const cotColour=new THREE.Color('#8db659').lerp(new THREE.Color('#52914a'),state.unfold).lerp(new THREE.Color('#bc963e'),state.senescence),
     material=mat(new THREE.MeshStandardMaterial({color:cotColour,side:THREE.DoubleSide,roughness:.8})),
     blades=new THREE.InstancedMesh(geom(acerCotyledonBlade(age,day)),material,2),
     stalks=new THREE.InstancedMesh(petioleGeo,material,2),organs=new THREE.Group();
    organs.name='acer-cotyledon-node';organs.position.copy(hypo!.node);organs.quaternion.copy(hypo!.frame);trunk.add(organs);
    blades.name='acer-cotyledons';stalks.name='acer-cotyledon-petioles';
    blades.userData={organ:'leaf',leafClass:'cotyledon',arrangement:'opposite',outline:'unlobed-ovate',connectedBy:'cotyledon-petiole',
     state,nodes:[-1,1].map(side=>({id:`acer:cotyledon:${side}`,birth:prior.cotyledonBirth})),
     calibration:'one age-limited cohort with qualitative seasonal exposure; shrink-to-zero abscission proxy; no temperature or germination calibration'};
    stalks.userData={organ:'petiole',organPart:'petiole'};
    for(let i=0;i<2;i++){
     const side=i===0?-1:1,angle=.12+state.unfold*1.18,
      direction=new THREE.Vector3(side*Math.sin(angle),Math.cos(angle),0),length=prior.petioleLength*state.scale;
     dummy.position.copy(direction).multiplyScalar(length);dummy.quaternion.setFromUnitVectors(UP,direction);dummy.scale.setScalar(state.scale);dummy.updateMatrix();blades.setMatrixAt(i,dummy.matrix);
     dummy.position.copy(direction).multiplyScalar(length/2);dummy.scale.set(.00016*state.scale,length,.00016*state.scale);dummy.updateMatrix();stalks.setMatrixAt(i,dummy.matrix);
    }
    blades.castShadow=blades.receiveShadow=true;organs.add(stalks,blades);leafCount+=2;
   }
   // NC State describes small green/red twig buds, terminal buds often doubled:
   // https://plants.ces.ncsu.edu/plants/acer-palmatum/ . One terminal meristem
   // represents the active leader; duplication, sizes and phenology are NOT
   // measured here. Never remove the meristem while this wood keeps extending.
   const budGrowth=organGrowth(.025,.015,age);
   if(budGrowth>0){
    const {segments,sides}=primaryGeometry.userData.woodTube,p=primaryGeometry.attributes.position,
     rim=Array.from({length:sides},(_,j)=>new THREE.Vector3().fromBufferAttribute(p,segments*(sides+1)+j)),
     endpoint=rim.reduce((sum,v)=>sum.add(v),new THREE.Vector3()).divideScalar(sides),
     radial=rim.map(v=>v.clone().sub(endpoint)),tangent=new THREE.Vector3();
    // Use the rendered Float32 rim, already transported through the hook.
    // Its oriented plane supplies the local terminal tangent, not world UP.
    for(let j=0;j<sides;j++)tangent.add(radial[j].clone().cross(radial[(j+1)%sides]));
    tangent.normalize();
    const u=radial[0].clone().normalize(),v=new THREE.Vector3().crossVectors(tangent,u).normalize(),
     rimRadius=Math.max(...radial.map(r=>r.length())),maturity=smooth(.04,.2,age),
     length=(.0015-.00045*maturity+rimRadius*1.2)*budGrowth,
     bulge=(.0003-.000105*maturity)*budGrowth+rimRadius*.35,
     positions=radial.flatMap(r=>r.toArray()),indices:number[]=[],rings:number[][]=[];
    rings.push(Array.from({length:sides},(_,j)=>j));
    // Eleven 16-sided body rings plus a closed tip retain the old 16 x 12
    // visual resolution. A 10-to-16 triangular collar welds every real rim
    // corner; a centre-touching ellipsoid would leave the cut edge exposed.
    for(let k=1;k<12;k++){
     const t=k/12,r= rimRadius*Math.pow(1-t,.7)+bulge*Math.pow(Math.sin(Math.PI*t),.8),ring:number[]=[];
     for(let j=0;j<16;j++){
      const a=j/16*Math.PI*2;ring.push(positions.length/3);
      positions.push(...u.clone().multiplyScalar(r*Math.cos(a)).addScaledVector(v,r*Math.sin(a)).addScaledVector(tangent,length*t).toArray());
     }
     rings.push(ring);
    }
    for(let k=1;k<rings.length;k++){
     const a=rings[k-1],b=rings[k];let i=0,j=0;
     while(i<a.length||j<b.length){
      if(i<a.length&&(j===b.length||(i+1)/a.length<=(j+1)/b.length)){
       indices.push(a[i%a.length],a[(i+1)%a.length],b[j%b.length]);i++;
      }else{indices.push(a[i%a.length],b[(j+1)%b.length],b[j%b.length]);j++;}
     }
    }
    const tip=positions.length/3;positions.push(...tangent.clone().multiplyScalar(length).toArray());
    const bottom=positions.length/3;positions.push(0,0,0);
    const last=rings[rings.length-1];
    for(let j=0;j<last.length;j++)indices.push(last[j],last[(j+1)%last.length],tip);
    for(let j=0;j<sides;j++)indices.push(bottom,(j+1)%sides,j);
    const budGeometry=new THREE.BufferGeometry();budGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    budGeometry.setIndex(indices);budGeometry.computeVertexNormals();
    const bud=new THREE.Mesh(geom(budGeometry),mat(new THREE.MeshStandardMaterial({color:'#a8bf73',roughness:.8})));
    bud.name='acer-apical-bud';bud.position.copy(endpoint);bud.castShadow=bud.receiveShadow=true;
    bud.userData={organ:'bud',sourceType:'engineering-prior',supportedBy:'actual-primary-tip-ring',
     source:'https://plants.ces.ncsu.edu/plants/acer-palmatum/',rimVertexCount:sides,
     calibration:'qualitative small green/red buds; single meristem proxy; dimensions and age transition unmeasured; no seasonal dormancy inference',
     mechanics:'follows primary beam; bud mass, drag and physiology unresolved; excluded from wood/leaf load ownership',
     budget:'one organ mesh, 188 vertices <= previous 221; after .2 y at most one additional draw for persistent meristem'};
    // The primary mesh and bud share the same dynamic owner. Coordinates above
    // already include the hook frame, so do not apply the crown frame twice.
    trunk.add(bud);
   }
  }
  const primaryCount=maple?12:19;
  // Habit evidence: public/references/species-evidence.json (NC State pages):
  // https://plants.ces.ncsu.edu/plants/cinnamomum-camphora/ — spreading crown
  // https://plants.ces.ncsu.edu/plants/acer-palmatum/ — spreading/layered, cultivar dependent
  // Reviewed camphor-leaves.jpg and acer-autumn.jpg: organ close-ups only.
  // Requested camphor-form.jpg / acer-form.jpg are absent at b0be29f; no
  // whole-crown photographic or Yungu-individual calibration is claimed.
  // All turns, slopes and bend amplitudes below are uncalibrated engineering
  // priors. Axis-keyed streams never depend on age, day, density or visibility.
  type Leaf={blade:THREE.Matrix4;petiole:THREE.Matrix4;variation:number;id:number;nodeId:string;birth:number;juvenile?:boolean;senescence?:number};
  leafGeo.computeBoundingBox();
  const actualBladeLength=leafGeo.boundingBox!.max.y-leafGeo.boundingBox!.min.y;
  const actualBladeWidth=leafGeo.boundingBox!.max.x-leafGeo.boundingBox!.min.x;
  function recordLeaves(axis:ExtensionAxis,frame:THREE.Matrix4,records:Leaf[],key:number,nodes:number,birth:number,firstShoot=false,apicalPhase?:number,shootNode?:{heightM:number;birth:number;expansionYears:number}){const sq=new THREE.Quaternion().setFromRotationMatrix(frame);
   for(let n=0;n<nodes;n++){
    const juvenile=maple&&firstShoot&&apicalPhase===undefined,
     nominalBirth=shootNode?.birth??(juvenile?acerJuvenileShootPrior.leafBirthsYears[n]:birth+n*.045),fraction=.15+(n+.5)/nodes*.80,
     t=shootNode?shootNode.heightM/heightLimit:juvenile?acerJuvenileNodeHeight(n)/heightLimit:firstShoot?(apicalPhase===undefined?fraction:.96)*(maple?acerAdultHeightAt(nominalBirth):heightAt(nominalBirth))/heightLimit:fraction,
     onset=firstShoot&&!maple?nominalBirth:Math.max(nominalBirth,axis.birthAt(t)),
     juvenileState=juvenile?acerJuvenileLeafState(age,onset,n):undefined,
     // Age advances established leaf expansion; seasonal turnover belongs to day/leafPresence.
     // Do not retract a lower leaf merely because the age slider crosses the illustrative
     // juvenile senescence window; its parent axis and petiole remain real supports.
     scale=juvenileState?juvenileState.expansion*juvenileState.targetLengthM/actualBladeLength:organGrowth(onset,shootNode?.expansionYears??.38,age);
    // Consume a separate stream per node so delayed births cannot reroll older organs.
    const r=randomFor(key+n*104729);if(scale<=0)continue;
    const anchor=axis.point(t).applyMatrix4(frame),angle=(apicalPhase??0)+(maple?n*Math.PI/2:n*2.39996),vertical=.35+r()*.45,pairs=maple?2:1;
    for(let p=0;p<pairs;p++){const a=angle+p*Math.PI,dir=new THREE.Vector3(Math.cos(a)*.8,vertical,Math.sin(a)*.8).normalize().applyQuaternion(sq),len=(juvenileState?juvenileState.expansion*juvenileState.targetLengthM/6:(maple?.025:.026)*scale)*(.9+r()*.2),base=anchor.clone().addScaledVector(dir,len);
      dummy.position.copy(base);dummy.quaternion.setFromUnitVectors(UP,dir);dummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP,(r()-.5)*1.3));const bladeVariation=.84+r()*.23;
      if(juvenileState)dummy.scale.set(juvenileState.expansion*juvenileState.targetWidthM/actualBladeWidth*(.9+(bladeVariation-.84)/.23*.2),scale*bladeVariation,scale*bladeVariation);
      else dummy.scale.setScalar(scale*bladeVariation);
      dummy.updateMatrix();const blade=dummy.matrix.clone();dummy.position.copy(anchor).lerp(base,.5);dummy.quaternion.setFromUnitVectors(UP,dir);dummy.scale.set(.00055*scale,len,.00055*scale);dummy.updateMatrix();records.push({blade,petiole:dummy.matrix.clone(),variation:r(),id:key+n*31+p,nodeId:`${axis.id}:leaf:${key}:${n}:${p}`,birth:onset,juvenile,senescence:juvenileState?.senescence});
    }
   }
  }
  function showLeaves(parent:THREE.Object3D,records:Leaf[],cohort:string){
   const visible=records.filter(l=>randomFor(l.id)()<leafPresence);if(!visible.length)return;
   const juvenile=maple&&cohort==='establishment-first-shoot';
   const leaves=new THREE.InstancedMesh(leafGeo,leafMat,visible.length),petioles=new THREE.InstancedMesh(petioleGeo,petioleMat,visible.length);
   leaves.userData={organ:"leaf",leafClass:juvenile?"juvenile-true-leaf":"true-leaf",connectedBy:"petiole",arrangement:maple?"opposite":"alternate",cohort,bladeSizeMetres:maple?[.03,.06,.04,.08]:[.06,.12,.025,.055],nodes:visible.map(l=>({id:l.nodeId,birth:l.birth,leafClass:juvenile?"juvenile-true-leaf":"true-leaf",senescence:l.senescence})),venation:maple?"palmate":"three basal main veins"};petioles.userData.organ="petiole";leaves.name=`leaves:${cohort}`;leaves.castShadow=leaves.receiveShadow=true;
   visible.forEach((l,n)=>{leaves.setMatrixAt(n,l.blade);petioles.setMatrixAt(n,l.petiole);if(maple)color.setHSL(.25-autumn*.235+(l.variation-.5)*.02,.43+autumn*.26,.29+autumn*.16+l.variation*.06);else color.setHSL(.265+(l.variation-.5)*.025,.38,.22+l.variation*.08);if(l.juvenile)color.lerp(new THREE.Color("#b9a85d"),l.senescence??0);leaves.setColorAt(n,color);});
   // New zero-size leaves start on already rendered wood. Include that support
   // in local instance bounds so rotating their aggregate AABB cannot invent a
   // sudden crown-height jump when a previously empty material node leafs out.
   const support=parent.children.find(o=>o instanceof THREE.Mesh&&!(o instanceof THREE.InstancedMesh)) as THREE.Mesh|undefined;
   if(support){support.geometry.computeBoundingBox();for(const instances of [petioles,leaves]){instances.computeBoundingBox();instances.boundingBox!.union(support.geometry.boundingBox!)}}
   if(maple&&(cohort==='establishment-first-shoot'||cohort==='main-axis')){
    const leafGroup=new THREE.Group();leafGroup.name=`leaf-cohort:${cohort}`;parent.add(leafGroup);leafGroup.add(petioles,leaves);
   }else parent.add(petioles,leaves);
   leafCount+=visible.length;
  }
  // Persistent first shoot leaves. Each node expands from zero; no age-2 removal.
  const first:Leaf[]=[];recordLeaves(leader,new THREE.Matrix4(),first,seed*8191,6,.07,true);
  if(maple)showLeaves(crown,first,"establishment-first-shoot");
  const apical:Leaf[]=[];
  // Later cohorts are separate organs; they do not inflate the original
  // millimetre seedling pair into an immortal adult-sized blade.
  const apicalCatalogue=maple?acerApicalCohorts():[];
  for(let c=0;c<72;c++)recordLeaves(leader,new THREE.Matrix4(),apical,seed*8191+100003+c*311,1,maple?apicalCatalogue[c].birth:.45+c*.28+c*c*.018,true,c*(maple?Math.PI/2:2.39996),maple?apicalCatalogue[c]:undefined);
  if(maple)showLeaves(crown,apical,"main-axis");else showLeaves(crown,[...first,...apical],"main-axis");
  if(maple){
   group.userData.apicalCohorts={prior:acerApicalCohortPrior,sites:apicalCatalogue};
   group.userData.juvenileTrueLeaves={prior:acerJuvenileLeafPrior,shootPrior:acerJuvenileShootPrior,
    sites:Array.from({length:6},(_,n)=>({id:`leader:leaf:${seed*8191}:${n}`,birth:acerJuvenileShootPrior.leafBirthsYears[n],
     attachment:leader.point(acerJuvenileNodeHeight(n)/heightLimit).toArray()})),
    event:{organ:'juvenile-true-leaf',type:'senescence',startAge:.55,endAge:.8,
     active:age>.55&&age<.8,completed:age>=.8,woodRetired:false}};
  }
  for(let i=0;i<primaryCount;i++){const r=randomFor(seed*991+i*3011);
    // Opposing layered maple branches share fixed material nodes; camphor stays alternate.
    const t=maple?Math.floor(i/2)/6:(i+.2+r()*.6)/primaryCount,attach=maple?.13+t*.50:.10+t*.71,
     birth=Math.max(.6+i*(maple?.42:.55),leader.birthAt(attach)),growth=organGrowth(birth,3,age),
     baseAz=maple?Math.floor(i/2)*1.6+(i%2)*Math.PI:i*2.39996+(r()-.5)*1.1,baseInc=maple?1.12+r()*.25:.65+r()*.50,
     target=heightAt(birth+3)*(maple?.48:.37)*(1-.35*t)*(.80+r()*.45);
    if(growth<=0)continue;
    const habit=randomFor(seed*65537+i*15485863),pair=randomFor(seed*32771+Math.floor(i/2)*49999),
     az=baseAz+randomFor(seed*31337)()*Math.PI*2+(maple?(pair()-.5)*.75:(habit()-.5)*.9),
     inc=maple?baseInc+(habit()-.5)*.30:baseInc*.35+.73+habit()*.25-.10*t,
     axis=extensionAxis(`primary:${i}`,target,target*(.10+habit()*.13),habit()*Math.PI*2,birth,3,age),length=axis.length,
     dir=new THREE.Vector3(Math.cos(az)*Math.sin(inc),Math.cos(inc),Math.sin(az)*Math.sin(inc)),pr=radius*(maple?.36:.30)*Math.sqrt(growth),
     attachment=leader.point(attach),pivot=joint(crown,attachment,dir,length,pr,1,seed+i*79),
     axes:WoodAxis[]=[{id:axis.id,parentId:leader.id,birth,length,radius:pr,attachment:attachment.toArray()}],
     parts=[curvedTube(axis.curve,pr,.001*growth,14,7,true)],records:Leaf[]=[];
    pivot.userData.node={id:axis.id,birth,attachment:attachment.toArray()};
    // Azimuth is around the actual parent tangent, not the same nominal UP
    // on every scaffold. A gravity-frame slope keeps maple sprays layered,
    // while camphor orders occupy a deeper volume without stacking upward.
    const primaryQ=pivot.quaternion.clone(),inversePrimaryQ=primaryQ.clone().invert();
    function daughter(tangent:THREE.Vector3,azimuth:number,inclination:number,slope:number){
     const direction=new THREE.Vector3(Math.cos(azimuth)*Math.sin(inclination),Math.cos(inclination),Math.sin(azimuth)*Math.sin(inclination))
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP,tangent)).applyQuaternion(primaryQ);
     direction.y=Math.hypot(direction.x,direction.z)*slope;
     return direction.normalize().applyQuaternion(inversePrimaryQ);
    }
    recordLeaves(axis,new THREE.Matrix4(),records,seed+i*6143,6,birth+.12);
    const secN=maple?7:9;
    for(let b=0;b<secN;b++){
      const tt=.20+(b+.3)/secN*.74,sbirth=Math.max(birth+.5+b*.13,axis.birthAt(tt)),sg=organGrowth(sbirth,1.4,age);if(sg<=0)continue;
      const br=randomFor(seed*197+i*881+b*997),hr=randomFor(seed*524287+i*8191+b*131071),
       phi=(maple?Math.floor(b/2)*1.6+(b%2)*Math.PI:b*2.39996+br()*.4)+(hr()-.5)*1.1+randomFor(seed*65537+i*15485863+17)()*Math.PI*2,
       starget=target*(.31+br()*.22),inclination=.55+br()*.2+hr()*.60,
       q=new THREE.Quaternion().setFromUnitVectors(UP,daughter(materialTangent(axis,tt),phi,inclination,maple?-.10+hr()*.40:.12+hr()*.62)),
       point=axis.point(tt),frame=new THREE.Matrix4().compose(point,q,new THREE.Vector3(1,1,1)),
       second=extensionAxis(`${axis.id}:secondary:${b}`,starget,starget*(.10+hr()*.14),hr()*Math.PI*2,sbirth,1.4,age),sr=pr*.28*Math.sqrt(sg);
      axes.push({id:second.id,parentId:axis.id,birth:sbirth,length:second.length,radius:sr,attachment:point.toArray()});
      parts.push(curvedTube(second.curve,sr,.0008*sg,8,5,true).applyMatrix4(frame));recordLeaves(second,frame,records,seed+i*8191+b*79,Math.max(3,Math.round((maple?6:10)*density)),sbirth+.15);
      for(let c=0;c<(maple?4:5);c++){
        const ct=.25+(c+.5)/(maple?4:5)*.70,tbirth=Math.max(sbirth+.6+c*.14,second.birthAt(ct)),tg=organGrowth(tbirth,1.1,age);if(tg<=0)continue;
        const cr=randomFor(seed*197+i*881+b*997+c*104729),hr=randomFor(seed*8191+i*524287+b*131071+c*15485863),point=second.point(ct).applyMatrix4(frame),a=phi+c*2.39996+(hr()-.5)*1.3,
         inclination=.65+cr()*.3+hr()*.45,
         tdir=daughter(materialTangent(second,ct).applyQuaternion(q),a,inclination,maple?-.15+hr()*.38:-.20+hr()*.70),tq=new THREE.Quaternion().setFromUnitVectors(UP,tdir),
         tf=new THREE.Matrix4().compose(point,tq,new THREE.Vector3(1,1,1)),ttarget=starget*(.30+cr()*.20),
         twig=extensionAxis(`${second.id}:twig:${c}`,ttarget,ttarget*(.08+hr()*.10),hr()*Math.PI*2,tbirth,1.1,age);
        axes.push({id:twig.id,parentId:second.id,birth:tbirth,length:twig.length,radius:.0019*tg,attachment:point.toArray()});
        parts.push(curvedTube(twig.curve,.0019*tg,.00045*tg,5,4,true).applyMatrix4(tf));recordLeaves(twig,tf,records,seed+i*1213+b*139+c*29,Math.max(3,Math.round((maple?5:8)*density)),tbirth+.12);
        if(!maple)for(let d=0;d<3;d++){
          const at=.36+d*.22,fbirth=Math.max(tbirth+.7+d*.17,twig.birthAt(at)),fg=organGrowth(fbirth,1,age);if(fg<=0)continue;
          const fr=randomFor(seed+i*479+b*2017+c*137+d*67),hr=randomFor(seed*32771+i*524287+b*8191+c*131071+d*15485863),angle=a+d*2.39996+(hr()-.5)*1.4,
           origin=twig.point(at).applyMatrix4(tf),inclination=.75+fr()*.3+hr()*.4,
           fd=daughter(materialTangent(twig,at).applyQuaternion(tq),angle,inclination,-.25+hr()*.65),
           fq=new THREE.Quaternion().setFromUnitVectors(UP,fd),ff=new THREE.Matrix4().compose(origin,fq,new THREE.Vector3(1,1,1)),
           terminal=extensionAxis(`${twig.id}:terminal:${d}`,ttarget*(.4+fr()*.22),ttarget*(.05+hr()*.07),hr()*Math.PI*2,fbirth,1,age);
          axes.push({id:terminal.id,parentId:twig.id,birth:fbirth,length:terminal.length,radius:.00085*fg,attachment:origin.toArray()});
          parts.push(curvedTube(terminal.curve,.00085*fg,.0002*fg,5,4,true).applyMatrix4(ff));recordLeaves(terminal,ff,records,seed+i*1621+b*631+c*101+d*43,Math.max(3,Math.round(8*density)),fbirth+.08);
        }
      }
    }
    addWood(pivot,parts,twigMat,axes);showLeaves(pivot,records,`branch-${i}`);
  }
  group.userData.reproduction="not simulated: no ornamental large flowers";
 } else if(species==="ophiopogon") {
  const clumpCount=1+Math.round(6*density),leafMaterial=mat(new THREE.MeshStandardMaterial({color:"#ffffff",side:THREE.DoubleSide,vertexColors:true,roughness:.67})),scapeMat=mat(new THREE.MeshStandardMaterial({color:"#7a925d",roughness:.8})),flowerMat=mat(new THREE.MeshStandardMaterial({color:"#ded8ee",side:THREE.DoubleSide,roughness:.72}));
  const bloom=smooth(145,172,day)*(1-smooth(226,246,day))*smooth(.5,1.5,age),petalShape=new THREE.Shape();petalShape.moveTo(0,0);petalShape.bezierCurveTo(.0016,.001,.0019,.004,0,.005);petalShape.bezierCurveTo(-.0019,.004,-.0016,.001,0,0);const flowerGeo=geom(new THREE.ShapeGeometry(petalShape,5));
  for(let c=0;c<clumpCount;c++){const ramet=ophiopogonRamet(c,age,seed,density);if(ramet.growth<=0)continue;const r=randomFor(seed*199+c*761),rosetteLength=(.20+r()*.14)*ramet.growth,base=joint(group,new THREE.Vector3(ramet.x,0,ramet.z),UP,rosetteLength,.004*ramet.growth,2,seed+c*17),parts:THREE.BufferGeometry[]=[];base.userData.organ="basal-rosette";base.userData.cohort=c;base.userData.woody=false;base.userData.rametId=`ramet:${c}`;const leafN=Math.max(5,Math.round(84*density));
    // Leaf bases are material nodes inside the expanding 8 mm basal square.
    // Freeze each offset at its own birth, when the collar already encloses it.
    // In particular the first blade begins at the zero-radius collar centre.
    for(let l=0;l<leafN;l++){const r=randomFor(seed*199+c*761+l*104729+17),angle=l*2.39996+r()*.6,targetLength=.16+r()*.22,targetWidth=.002+r()*.002,leafBirth=ramet.birth+l*.019,lg=organGrowth(leafBirth,.6,age),baseGrowth=organGrowth(ramet.birth,.6,leafBirth),length=targetLength,width=targetWidth*lg,reach=.40+r()*.42,curve=new THREE.CubicBezierCurve3(new THREE.Vector3((r()-.5)*.008*baseGrowth,0,(r()-.5)*.008*baseGrowth),new THREE.Vector3(0,length*.43,0),new THREE.Vector3(Math.cos(angle)*length*reach*.48,length*.97,Math.sin(angle)*length*reach*.48),new THREE.Vector3(Math.cos(angle)*length*reach,length*(.34+r()*.24),Math.sin(angle)*length*reach));
      if(lg<=0)continue;
      const positions:number[]=[],ix:number[]=[],cols:number[]=[],normalside=new THREE.Vector3(Math.sin(angle),0,-Math.cos(angle)),n=18;const hue=.28+r()*.025,light=.19+r()*.10;
      for(let j=0;j<=n;j++){const t=j/n*lg,p=curve.getPoint(t),w=width*(.27+.73*Math.sin(t*Math.PI))*(1-Math.pow(t,9))*.5;for(let k=0;k<3;k++){const v=p.clone().addScaledVector(normalside,(k-1)*w);v.y+=(k===1?.00035*lg:0)*Math.sin(t*Math.PI);positions.push(v.x,v.y,v.z);color.setHSL(hue,.43,light+(k===1?.035:0));cols.push(color.r,color.g,color.b);}if(j<n)for(let k=0;k<2;k++){const v=j*3+k;ix.push(v,v+3,v+1,v+1,v+3,v+4)}}
      const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.setAttribute("color",new THREE.Float32BufferAttribute(cols,3));g.setIndex(ix);g.computeVertexNormals();tagLeafStrip(g);parts.push(g);leafCount++;
    }
    if(!parts.length)continue;const stripAttributes=mergedLeafStripAttributes(parts),leaves=new THREE.Mesh(geom(merge(parts)),leafMaterial);for(const [name,attribute] of Object.entries(stripAttributes))leaves.geometry.setAttribute(name,attribute);leaves.userData.organ="leaf";leaves.userData.leafDynamics="material-strip";leaves.userData.leafVertexCount=parts[0].index?.count||parts[0].attributes.position.count;leaves.userData.bladeWidthMetres=[.002,.004];leaves.castShadow=leaves.receiveShadow=true;base.add(leaves);
    const flowering=bloom*organGrowth(ramet.birth+1,.7,age);if(flowering>0&&c%2===0){const flowers=new THREE.Group();flowers.userData.organ="flower";base.add(flowers);flowers.scale.setScalar(flowering);const height=.085+r()*.055,scape=curvedAxis(height,.009,c);const stem=new THREE.Mesh(geom(curvedTube(scape,.0015,.0008,7,4)),scapeMat);flowers.add(stem);const petals=new THREE.InstancedMesh(flowerGeo,flowerMat,36);
      for(let f=0;f<6;f++){const t=.56+f*.073,point=scape.getPointAt(t),direction=new THREE.Vector3(Math.cos(f*2.4),-.7,Math.sin(f*2.4)).normalize();for(let p=0;p<6;p++){const a=p*Math.PI/3;dummy.position.copy(point).addScaledVector(direction,.003);dummy.quaternion.setFromUnitVectors(UP,direction);dummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP,a));dummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.30));dummy.scale.setScalar(bloom);dummy.updateMatrix();petals.setMatrixAt(f*6+p,dummy.matrix);}}flowers.add(petals);
    }
  }
 group.userData.identification="Ophiopogon japonicus; narrow evergreen tuft; short, partly hidden summer raceme";
 group.userData.clonalArchitecture={...clonalArchitecturePrior,density,clumpCount,pioneerReachM:.115*(.85+.15*density),seed};
 }
 group.traverse(o=>{if(!o.userData.organ&&o.parent?.userData.organ)o.userData.organ=o.parent.userData.organ});group.updateMatrixWorld(true);
 const gravityFrames=branches.map(j=>{const down=new THREE.Vector3(0,-1,0).applyQuaternion(j.pivot.getWorldQuaternion(new THREE.Quaternion()).invert()),axis=new THREE.Vector3().crossVectors(UP,down),perp=axis.length();if(perp>1e-8)axis.multiplyScalar(1/perp);else axis.set(1,0,0);return{axis,perp}}),gravityQ=new THREE.Quaternion(),windQ=new THREE.Quaternion(),euler=new THREE.Euler();
 function update(time:number,wind:number,gravity:number,stiffness:number){const rigid=Math.max(.1,stiffness),area=.24+.76*leafPresence*density;branches.forEach((j,i)=>{const load=clamp(wind,0,25)**2*.00025*j.flexibility/rigid*area,osc=.65*Math.sin(time*(1+j.order*.35)+j.phase)+.35*Math.sin(time*.49+j.phase*.4),bend=Math.min(.18,load)*(.65+.35*osc),sag=Math.min(.14,j.sag*clamp(gravity,0,30)/9.81/rigid*gravityFrames[i].perp);gravityQ.setFromAxisAngle(gravityFrames[i].axis,sag);euler.set(bend*.4,0,-bend);windQ.setFromEuler(euler);j.pivot.quaternion.copy(j.rest).multiply(gravityQ).multiply(windQ)})}
 const box=new THREE.Box3().setFromObject(group);
 let disposed=false;
 function dispose(){if(disposed)return;disposed=true;group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose()});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear()}
 return{group,branches,leafCount,height:geometryHeight(group),stageLabel,update,dispose};
}
