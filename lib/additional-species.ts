import {geometryHeight} from './geometry-height.ts';
import * as THREE from "three";
import {tagWoodTube,mergeWoodSections} from "./wood-loads.ts";
import {tagLeafStrip,mergedLeafStripAttributes} from "./herb-leaf-dynamics.ts";
import type { PlantParams, PlantModel, BranchJoint } from "./plant-engine";

// @ts-ignore Native Node tests require the suffix.
import { additionalDevelopment, developmentPriors, organGrowth, ophiopogonRamet } from "./development.ts";
import {woodyEstablishmentGeometry, woodyEstablishmentState, woodyEstablishmentEvidence} from './woody-establishment.ts';

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
function curvedTube(curve:THREE.Curve<THREE.Vector3>,radius:number,tip:number,segments=10,sides=6){
 const f=curve.computeFrenetFrames(segments,false),p:number[]=[],uv:number[]=[],ix:number[]=[];
 for(let i=0;i<=segments;i++){const t=i/segments,c=curve.getPointAt(t),r=tip+(radius-tip)*Math.pow(1-t,.86);for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2,n=f.normals[i].clone().multiplyScalar(Math.cos(a)*r).addScaledVector(f.binormals[i],Math.sin(a)*r);p.push(c.x+n.x,c.y+n.y,c.z+n.z);uv.push(j/sides,t*curve.getLength());if(i<segments&&j<sides){const v=i*(sides+1)+j;ix.push(v,v+sides+1,v+1,v+1,v+sides+1,v+sides+2)}}}
 const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(p,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return tagWoodTube(g,segments,sides);
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
function mapleBlade(){const s=new THREE.Shape();s.moveTo(0,0);for(let l=0;l<7;l++){const a=-2.0+l*2/3,r=.052*(1-Math.abs(a)*.13),valley=.015,lo=a-.26,hi=a+.26;s.lineTo(Math.sin(lo)*valley,Math.cos(lo)*valley);
  // Small teeth on the pointed lobe margins; one palmate blade, not compound leaves.
  for(let e=1;e<=5;e++){const t=e/5,rr=valley+(r-valley)*t,aa=lo+(a-lo)*t+(e%2?.023:-.012);s.lineTo(Math.sin(aa)*rr,Math.cos(aa)*rr)}
  for(let e=1;e<=5;e++){const t=e/5,rr=r+(valley-r)*t,aa=a+(hi-a)*t+(e%2?.018:-.013);s.lineTo(Math.sin(aa)*rr,Math.cos(aa)*rr)}
 }s.lineTo(0,0);const g=new THREE.ShapeGeometry(s,8),p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++){const x=p.getX(i)*.88,y=p.getY(i)*.75;p.setX(i,x);p.setY(i,y);p.setZ(i,.0025*Math.sin(y*40)-.001*Math.abs(x)/.05);uv.setXY(i,.5+x/.0924,(y+.01725)/.06)}g.computeVertexNormals();return g;}

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
  const heightAt=(year:number)=>(.025+(maple?6.5:16)*(1-Math.exp(-year/heightTime)))*organGrowth(.025,.25,year);
  const h=heightAt(age),radius=(.0015+(maple?.13:.32)*(1-Math.exp(-age/45)))*life.shoot;
  // Dense broad-crowned camphor versus lower multi-stemmed maple; neither is a renamed osmanthus model.
  const pixels=new Uint8Array(64*256*4),rr=randomFor(seed*67);for(let y=0;y<256;y++)for(let x=0;x<64;x++){const groove=Math.pow(Math.max(0,Math.sin(x*.75+Math.sin(y*.035)*.5)),14),shade=.75+rr()*.19-(maple?.06:.30)*groove,o=(y*64+x)*4;pixels[o]=(maple?146:129)*shade;pixels[o+1]=(maple?143:125)*shade;pixels[o+2]=(maple?129:112)*shade;pixels[o+3]=255}
  const barkTexture=new THREE.DataTexture(pixels,64,256,THREE.RGBAFormat);barkTexture.wrapS=barkTexture.wrapT=THREE.RepeatWrapping;barkTexture.colorSpace=THREE.SRGBColorSpace;barkTexture.needsUpdate=true;textures.add(barkTexture);
  const bark=mat(new THREE.MeshStandardMaterial({color:maple?"#c4b6a0":"#bfb39e",map:barkTexture,bumpMap:barkTexture,bumpScale:maple?.0015:.006,roughness:.9})),twigMat=mat(new THREE.MeshStandardMaterial({color:maple?"#8d6556":"#8d8a5f",roughness:.8}));
  const leafGeo=geom(maple?mapleBlade():camphorBlade()),leafPixels=new Uint8Array(128*128*4);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){const u=x/128,v=y/128;let vein=0;if(maple){const xx=(u-.5)*.0924,yy=v*.06-.01725;for(let l=0;l<7;l++){const a=-2+l*2/3,proj=xx*Math.sin(a)+yy*Math.cos(a),perp=Math.abs(xx*Math.cos(a)-yy*Math.sin(a));if(proj>0)vein=Math.max(vein,1-smooth(.0002,.0007,perp))}}else{const vBase=.06+(1-v)*.15;vein=Math.max(1-smooth(.005,.018,Math.abs(u-.5)),1-smooth(.005,.016,Math.abs(Math.abs(u-.5)-Math.sin(v*Math.PI)*vBase)));}const shade=1-.20*vein,o=(y*128+x)*4;leafPixels[o]=245*shade;leafPixels[o+1]=251*shade;leafPixels[o+2]=222*shade;leafPixels[o+3]=255}
  const leafTexture=new THREE.DataTexture(leafPixels,128,128,THREE.RGBAFormat);leafTexture.colorSpace=THREE.SRGBColorSpace;leafTexture.needsUpdate=true;textures.add(leafTexture);
  const leafMat=mat(new THREE.MeshStandardMaterial({color:"#ffffff",map:leafTexture,side:THREE.DoubleSide,roughness:maple?.79:.50})),petioleMat=mat(new THREE.MeshStandardMaterial({color:maple?"#985c4f":"#6c804b",roughness:.8})),petioleGeo=geom(new THREE.CylinderGeometry(1,1,1,4));
  const trunk=joint(group,new THREE.Vector3(),UP,h,radius,0,seed),fullTrunk=curvedAxis(heightLimit,heightLimit*.025,seed),trunkCurve=new AxisPrefix(fullTrunk,h/heightLimit);
  const leader:ExtensionAxis={id:"leader",target:heightLimit,birth:.025,length:h,curve:trunkCurve,
   point:t=>materialPoint(fullTrunk,t),birthAt:t=>-heightTime*Math.log((heightLimit-heightLimit*t)/(heightLimit-.025))};
  trunk.userData.node={id:leader.id,birth:leader.birth};
  group.userData.continuity={calibration:"uncalibrated engineering assumptions; not measured growth rates",
   extension:"fixed material centrelines; lateral births wait for leader / parent to reach the attachment",
   timing:"original cohort onsets are lower bounds; axis extension durations remain illustrative",
   scaffold:"persistent without a modelled pruning or damage event",dateAndAge:"day controls phenology; age controls establishment"};
  const tm=new THREE.Mesh(geom(curvedTube(trunkCurve,radius*1.4,.001*life.shoot,24,10)),bark);tm.castShadow=tm.receiveShadow=true;trunk.add(tm);
  const primaryCount=maple?12:19;
  // Habit evidence: public/references/species-evidence.json (NC State pages):
  // https://plants.ces.ncsu.edu/plants/cinnamomum-camphora/ — spreading crown
  // https://plants.ces.ncsu.edu/plants/acer-palmatum/ — spreading/layered, cultivar dependent
  // Reviewed camphor-leaves.jpg and acer-autumn.jpg: organ close-ups only.
  // Requested camphor-form.jpg / acer-form.jpg are absent at b0be29f; no
  // whole-crown photographic or Yungu-individual calibration is claimed.
  // All turns, slopes and bend amplitudes below are uncalibrated engineering
  // priors. Axis-keyed streams never depend on age, day, density or visibility.
  type Leaf={blade:THREE.Matrix4;petiole:THREE.Matrix4;variation:number;id:number;nodeId:string;birth:number};
  function recordLeaves(axis:ExtensionAxis,frame:THREE.Matrix4,records:Leaf[],key:number,nodes:number,birth:number,firstShoot=false,apicalPhase?:number){const sq=new THREE.Quaternion().setFromRotationMatrix(frame);
   for(let n=0;n<nodes;n++){
    const nominalBirth=birth+n*.045,fraction=.15+(n+.5)/nodes*.80,
     t=firstShoot?(apicalPhase===undefined?fraction:.96)*heightAt(nominalBirth)/heightLimit:fraction,
     onset=firstShoot?nominalBirth:Math.max(nominalBirth,axis.birthAt(t)),scale=organGrowth(onset,.38,age);
    // Consume a separate stream per node so delayed births cannot reroll older organs.
    const r=randomFor(key+n*104729);if(scale<=0)continue;
    const anchor=axis.point(t).applyMatrix4(frame),angle=(apicalPhase??0)+(maple?n*Math.PI/2:n*2.39996),vertical=.35+r()*.45,pairs=maple?2:1;
    for(let p=0;p<pairs;p++){const a=angle+p*Math.PI,dir=new THREE.Vector3(Math.cos(a)*.8,vertical,Math.sin(a)*.8).normalize().applyQuaternion(sq),len=(maple?.025:.026)*scale*(.9+r()*.2),base=anchor.clone().addScaledVector(dir,len);
      dummy.position.copy(base);dummy.quaternion.setFromUnitVectors(UP,dir);dummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP,(r()-.5)*1.3));dummy.scale.setScalar(scale*(.84+r()*.23));dummy.updateMatrix();const blade=dummy.matrix.clone();dummy.position.copy(anchor).lerp(base,.5);dummy.quaternion.setFromUnitVectors(UP,dir);dummy.scale.set(.00055*scale,len,.00055*scale);dummy.updateMatrix();records.push({blade,petiole:dummy.matrix.clone(),variation:r(),id:key+n*31+p,nodeId:`${axis.id}:leaf:${key}:${n}:${p}`,birth:onset});
    }
   }
  }
  function showLeaves(parent:THREE.Object3D,records:Leaf[],cohort:string){
   const visible=records.filter(l=>randomFor(l.id)()<leafPresence);if(!visible.length)return;
   const leaves=new THREE.InstancedMesh(leafGeo,leafMat,visible.length),petioles=new THREE.InstancedMesh(petioleGeo,petioleMat,visible.length);
   leaves.userData={organ:"leaf",leafClass:"true-leaf",connectedBy:"petiole",arrangement:maple?"opposite":"alternate",cohort,bladeSizeMetres:maple?[.03,.06,.04,.08]:[.06,.12,.025,.055],nodes:visible.map(l=>({id:l.nodeId,birth:l.birth})),venation:maple?"palmate":"three basal main veins"};petioles.userData.organ="petiole";leaves.name=`leaves:${cohort}`;leaves.castShadow=leaves.receiveShadow=true;
   visible.forEach((l,n)=>{leaves.setMatrixAt(n,l.blade);petioles.setMatrixAt(n,l.petiole);if(maple)color.setHSL(.25-autumn*.235+(l.variation-.5)*.02,.43+autumn*.26,.29+autumn*.16+l.variation*.06);else color.setHSL(.265+(l.variation-.5)*.025,.38,.22+l.variation*.08);leaves.setColorAt(n,color);});
   // New zero-size leaves start on already rendered wood. Include that support
   // in local instance bounds so rotating their aggregate AABB cannot invent a
   // sudden crown-height jump when a previously empty material node leafs out.
   const support=parent.children.find(o=>o instanceof THREE.Mesh&&!(o instanceof THREE.InstancedMesh)) as THREE.Mesh|undefined;
   if(support){support.geometry.computeBoundingBox();for(const instances of [petioles,leaves]){instances.computeBoundingBox();instances.boundingBox!.union(support.geometry.boundingBox!)}}
   parent.add(petioles,leaves);leafCount+=visible.length;
  }
  // Persistent first shoot leaves. Each node expands from zero; no age-2 removal.
  const first:Leaf[]=[];recordLeaves(leader,new THREE.Matrix4(),first,seed*8191,6,.07,true);
  // Continuing apical leaf cohorts close the former multi-year bare-leader gap.
  // Cohort timing is an engineering prior; old leaf nodes never move upward.
  for(let c=0;c<72;c++)recordLeaves(leader,new THREE.Matrix4(),first,seed*8191+100003+c*311,1,.45+c*.28+c*c*.018,true,c*(maple?Math.PI/2:2.39996));
  showLeaves(trunk,first,"main-axis");
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
     attachment=leader.point(attach),pivot=joint(trunk,attachment,dir,length,pr,1,seed+i*79),
     axes:WoodAxis[]=[{id:axis.id,parentId:leader.id,birth,length,radius:pr,attachment:attachment.toArray()}],
     parts=[curvedTube(axis.curve,pr,.001*growth,14,7)],records:Leaf[]=[];
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
      parts.push(curvedTube(second.curve,sr,.0008*sg,8,5).applyMatrix4(frame));recordLeaves(second,frame,records,seed+i*8191+b*79,Math.max(3,Math.round((maple?6:10)*density)),sbirth+.15);
      for(let c=0;c<(maple?4:5);c++){
        const ct=.25+(c+.5)/(maple?4:5)*.70,tbirth=Math.max(sbirth+.6+c*.14,second.birthAt(ct)),tg=organGrowth(tbirth,1.1,age);if(tg<=0)continue;
        const cr=randomFor(seed*197+i*881+b*997+c*104729),hr=randomFor(seed*8191+i*524287+b*131071+c*15485863),point=second.point(ct).applyMatrix4(frame),a=phi+c*2.39996+(hr()-.5)*1.3,
         inclination=.65+cr()*.3+hr()*.45,
         tdir=daughter(materialTangent(second,ct).applyQuaternion(q),a,inclination,maple?-.15+hr()*.38:-.20+hr()*.70),tq=new THREE.Quaternion().setFromUnitVectors(UP,tdir),
         tf=new THREE.Matrix4().compose(point,tq,new THREE.Vector3(1,1,1)),ttarget=starget*(.30+cr()*.20),
         twig=extensionAxis(`${second.id}:twig:${c}`,ttarget,ttarget*(.08+hr()*.10),hr()*Math.PI*2,tbirth,1.1,age);
        axes.push({id:twig.id,parentId:second.id,birth:tbirth,length:twig.length,radius:.0019*tg,attachment:point.toArray()});
        parts.push(curvedTube(twig.curve,.0019*tg,.00045*tg,5,4).applyMatrix4(tf));recordLeaves(twig,tf,records,seed+i*1213+b*139+c*29,Math.max(3,Math.round((maple?5:8)*density)),tbirth+.12);
        if(!maple)for(let d=0;d<3;d++){
          const at=.36+d*.22,fbirth=Math.max(tbirth+.7+d*.17,twig.birthAt(at)),fg=organGrowth(fbirth,1,age);if(fg<=0)continue;
          const fr=randomFor(seed+i*479+b*2017+c*137+d*67),hr=randomFor(seed*32771+i*524287+b*8191+c*131071+d*15485863),angle=a+d*2.39996+(hr()-.5)*1.4,
           origin=twig.point(at).applyMatrix4(tf),inclination=.75+fr()*.3+hr()*.4,
           fd=daughter(materialTangent(twig,at).applyQuaternion(tq),angle,inclination,-.25+hr()*.65),
           fq=new THREE.Quaternion().setFromUnitVectors(UP,fd),ff=new THREE.Matrix4().compose(origin,fq,new THREE.Vector3(1,1,1)),
           terminal=extensionAxis(`${twig.id}:terminal:${d}`,ttarget*(.4+fr()*.22),ttarget*(.05+hr()*.07),hr()*Math.PI*2,fbirth,1,age);
          axes.push({id:terminal.id,parentId:twig.id,birth:fbirth,length:terminal.length,radius:.00085*fg,attachment:origin.toArray()});
          parts.push(curvedTube(terminal.curve,.00085*fg,.0002*fg,5,4).applyMatrix4(ff));recordLeaves(terminal,ff,records,seed+i*1621+b*631+c*101+d*43,Math.max(3,Math.round(8*density)),fbirth+.08);
        }
      }
    }
    addWood(pivot,parts,bark,axes);showLeaves(pivot,records,`branch-${i}`);
  }
  group.userData.reproduction="not simulated: no ornamental large flowers";
 } else if(species==="ophiopogon") {
  const clumpCount=1+Math.round(6*density),leafMaterial=mat(new THREE.MeshStandardMaterial({color:"#ffffff",side:THREE.DoubleSide,vertexColors:true,roughness:.67})),scapeMat=mat(new THREE.MeshStandardMaterial({color:"#7a925d",roughness:.8})),flowerMat=mat(new THREE.MeshStandardMaterial({color:"#ded8ee",side:THREE.DoubleSide,roughness:.72}));
  const bloom=smooth(145,172,day)*(1-smooth(226,246,day))*smooth(.5,1.5,age),petalShape=new THREE.Shape();petalShape.moveTo(0,0);petalShape.bezierCurveTo(.0016,.001,.0019,.004,0,.005);petalShape.bezierCurveTo(-.0019,.004,-.0016,.001,0,0);const flowerGeo=geom(new THREE.ShapeGeometry(petalShape,5));
  for(let c=0;c<clumpCount;c++){const ramet=ophiopogonRamet(c,age);if(ramet.growth<=0)continue;const r=randomFor(seed*199+c*761),base=joint(group,new THREE.Vector3(ramet.x,0,ramet.z),UP,.28*ramet.growth,.004*ramet.growth,2,seed+c*17),parts:THREE.BufferGeometry[]=[];base.userData.organ="basal-rosette";base.userData.cohort=c;base.userData.woody=false;const leafN=Math.max(5,Math.round(84*density));
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
 }
 group.traverse(o=>{if(!o.userData.organ&&o.parent?.userData.organ)o.userData.organ=o.parent.userData.organ});group.updateMatrixWorld(true);
 const gravityFrames=branches.map(j=>{const down=new THREE.Vector3(0,-1,0).applyQuaternion(j.pivot.getWorldQuaternion(new THREE.Quaternion()).invert()),axis=new THREE.Vector3().crossVectors(UP,down),perp=axis.length();if(perp>1e-8)axis.multiplyScalar(1/perp);else axis.set(1,0,0);return{axis,perp}}),gravityQ=new THREE.Quaternion(),windQ=new THREE.Quaternion(),euler=new THREE.Euler();
 function update(time:number,wind:number,gravity:number,stiffness:number){const rigid=Math.max(.1,stiffness),area=.24+.76*leafPresence*density;branches.forEach((j,i)=>{const load=clamp(wind,0,25)**2*.00025*j.flexibility/rigid*area,osc=.65*Math.sin(time*(1+j.order*.35)+j.phase)+.35*Math.sin(time*.49+j.phase*.4),bend=Math.min(.18,load)*(.65+.35*osc),sag=Math.min(.14,j.sag*clamp(gravity,0,30)/9.81/rigid*gravityFrames[i].perp);gravityQ.setFromAxisAngle(gravityFrames[i].axis,sag);euler.set(bend*.4,0,-bend);windQ.setFromEuler(euler);j.pivot.quaternion.copy(j.rest).multiply(gravityQ).multiply(windQ)})}
 const box=new THREE.Box3().setFromObject(group);
 function dispose(){group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose()});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear()}
 return{group,branches,leafCount,height:geometryHeight(group),stageLabel,update,dispose};
}
