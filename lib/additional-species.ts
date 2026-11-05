import * as THREE from "three";
import type { PlantParams, PlantModel, BranchJoint } from "./plant-engine";

// @ts-ignore Native Node tests require the suffix.
import { additionalDevelopment, developmentPriors, organGrowth, ophiopogonRamet } from "./development.ts";

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
function curvedTube(curve:THREE.CatmullRomCurve3,radius:number,tip:number,segments=10,sides=6){
 const f=curve.computeFrenetFrames(segments,false),p:number[]=[],uv:number[]=[],ix:number[]=[];
 for(let i=0;i<=segments;i++){const t=i/segments,c=curve.getPointAt(t),r=tip+(radius-tip)*Math.pow(1-t,.86);for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2,n=f.normals[i].clone().multiplyScalar(Math.cos(a)*r).addScaledVector(f.binormals[i],Math.sin(a)*r);p.push(c.x+n.x,c.y+n.y,c.z+n.z);uv.push(j/sides,t*curve.getLength());if(i<segments&&j<sides){const v=i*(sides+1)+j;ix.push(v,v+sides+1,v+1,v+1,v+sides+1,v+sides+2)}}}
 const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(p,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
}
function curvedAxis(length:number,bend:number,phase:number){return new THREE.CatmullRomCurve3([new THREE.Vector3(),new THREE.Vector3(bend*.1,length*.28,Math.sin(phase)*bend*.2),new THREE.Vector3(bend,length*.70,Math.sin(phase+.5)*bend*.4),new THREE.Vector3(bend*.7,length,Math.sin(phase+1)*bend*.55)])}
function merge(parts:THREE.BufferGeometry[]){const flat=parts.map(g=>g.index?g.toNonIndexed():g),n=flat.reduce((a,g)=>a+g.attributes.position.count,0),p=new Float32Array(n*3),normal=new Float32Array(n*3),uv=new Float32Array(n*2),color=new Float32Array(n*3).fill(1);let offset=0;
 for(const g of flat){p.set(g.attributes.position.array as ArrayLike<number>,offset*3);normal.set(g.attributes.normal.array as ArrayLike<number>,offset*3);if(g.attributes.uv)uv.set(g.attributes.uv.array as ArrayLike<number>,offset*2);if(g.attributes.color)color.set(g.attributes.color.array as ArrayLike<number>,offset*3);offset+=g.attributes.position.count}
 const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(p,3));out.setAttribute("normal",new THREE.BufferAttribute(normal,3));out.setAttribute("uv",new THREE.BufferAttribute(uv,2));out.setAttribute("color",new THREE.BufferAttribute(color,3));for(const g of new Set([...parts,...flat]))g.dispose();return out;
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
 function addWood(parent:THREE.Object3D,parts:THREE.BufferGeometry[],material:THREE.Material){if(!parts.length)return;const m=new THREE.Mesh(geom(merge(parts)),material);m.castShadow=m.receiveShadow=true;parent.add(m);}
 const stageLabel=life.stage;
 const leafPresence=species==="acer"?smooth(65,105,day)*(1-smooth(313,344,day)):1,autumn=species==="acer"?smooth(255,309,day):0;
 if(species!=="ophiopogon" && life.shoot>0) {
  const maple=species==="acer",grow=1-Math.exp(-age/(maple?15:24)),h=(.025+(maple?6.5:16)*grow)*life.shoot,radius=(.0015+(maple?.13:.32)*(1-Math.exp(-age/45)))*life.shoot;
  // Dense broad-crowned camphor versus lower multi-stemmed maple; neither is a renamed osmanthus model.
  const pixels=new Uint8Array(64*256*4),rr=randomFor(seed*67);for(let y=0;y<256;y++)for(let x=0;x<64;x++){const groove=Math.pow(Math.max(0,Math.sin(x*.75+Math.sin(y*.035)*.5)),14),shade=.75+rr()*.19-(maple?.06:.30)*groove,o=(y*64+x)*4;pixels[o]=(maple?146:129)*shade;pixels[o+1]=(maple?143:125)*shade;pixels[o+2]=(maple?129:112)*shade;pixels[o+3]=255}
  const barkTexture=new THREE.DataTexture(pixels,64,256,THREE.RGBAFormat);barkTexture.wrapS=barkTexture.wrapT=THREE.RepeatWrapping;barkTexture.colorSpace=THREE.SRGBColorSpace;barkTexture.needsUpdate=true;textures.add(barkTexture);
  const bark=mat(new THREE.MeshStandardMaterial({color:maple?"#c4b6a0":"#bfb39e",map:barkTexture,bumpMap:barkTexture,bumpScale:maple?.0015:.006,roughness:.9})),twigMat=mat(new THREE.MeshStandardMaterial({color:maple?"#8d6556":"#8d8a5f",roughness:.8}));
  const leafGeo=geom(maple?mapleBlade():camphorBlade()),leafPixels=new Uint8Array(128*128*4);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){const u=x/128,v=y/128;let vein=0;if(maple){const xx=(u-.5)*.0924,yy=v*.06-.01725;for(let l=0;l<7;l++){const a=-2+l*2/3,proj=xx*Math.sin(a)+yy*Math.cos(a),perp=Math.abs(xx*Math.cos(a)-yy*Math.sin(a));if(proj>0)vein=Math.max(vein,1-smooth(.0002,.0007,perp))}}else{const vBase=.06+(1-v)*.15;vein=Math.max(1-smooth(.005,.018,Math.abs(u-.5)),1-smooth(.005,.016,Math.abs(Math.abs(u-.5)-Math.sin(v*Math.PI)*vBase)));}const shade=1-.20*vein,o=(y*128+x)*4;leafPixels[o]=245*shade;leafPixels[o+1]=251*shade;leafPixels[o+2]=222*shade;leafPixels[o+3]=255}
  const leafTexture=new THREE.DataTexture(leafPixels,128,128,THREE.RGBAFormat);leafTexture.colorSpace=THREE.SRGBColorSpace;leafTexture.needsUpdate=true;textures.add(leafTexture);
  const leafMat=mat(new THREE.MeshStandardMaterial({color:"#ffffff",map:leafTexture,side:THREE.DoubleSide,roughness:maple?.79:.50})),petioleMat=mat(new THREE.MeshStandardMaterial({color:maple?"#985c4f":"#6c804b",roughness:.8})),petioleGeo=geom(new THREE.CylinderGeometry(1,1,1,4));
  const trunk=joint(group,new THREE.Vector3(),UP,h,radius,0,seed),trunkCurve=curvedAxis(h,h*.025,seed);
  const tm=new THREE.Mesh(geom(curvedTube(trunkCurve,radius*1.4,.001*life.shoot,24,10)),bark);tm.castShadow=tm.receiveShadow=true;trunk.add(tm);
  const primaryCount=maple?12:19;
  type Leaf={blade:THREE.Matrix4;petiole:THREE.Matrix4;variation:number;id:number};
  function recordLeaves(curve:THREE.CatmullRomCurve3,frame:THREE.Matrix4,records:Leaf[],key:number,nodes:number,birth:number){const r=randomFor(key),sq=new THREE.Quaternion().setFromRotationMatrix(frame);
   for(let n=0;n<nodes;n++){const scale=organGrowth(birth+n*.045,.38,age);if(scale<=0)continue;
    const t=.15+(n+.5)/nodes*.80,anchor=curve.getPointAt(t).applyMatrix4(frame),angle=maple?n*Math.PI/2:n*2.39996,vertical=.35+r()*.45,pairs=maple?2:1;
    for(let p=0;p<pairs;p++){const a=angle+p*Math.PI,dir=new THREE.Vector3(Math.cos(a)*.8,vertical,Math.sin(a)*.8).normalize().applyQuaternion(sq),len=(maple?.025:.026)*scale*(.9+r()*.2),base=anchor.clone().addScaledVector(dir,len);
      dummy.position.copy(base);dummy.quaternion.setFromUnitVectors(UP,dir);dummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP,(r()-.5)*1.3));dummy.scale.setScalar(scale*(.84+r()*.23));dummy.updateMatrix();const blade=dummy.matrix.clone();dummy.position.copy(anchor).lerp(base,.5);dummy.quaternion.setFromUnitVectors(UP,dir);dummy.scale.set(.00055*scale,len,.00055*scale);dummy.updateMatrix();records.push({blade,petiole:dummy.matrix.clone(),variation:r(),id:key+n*31+p});
    }
   }
  }
  function showLeaves(parent:THREE.Object3D,records:Leaf[],cohort:string){
   const visible=records.filter(l=>randomFor(l.id)()<leafPresence);if(!visible.length)return;
   const leaves=new THREE.InstancedMesh(leafGeo,leafMat,visible.length),petioles=new THREE.InstancedMesh(petioleGeo,petioleMat,visible.length);
   leaves.userData={organ:"leaf",connectedBy:"petiole",arrangement:maple?"opposite":"alternate",cohort,bladeSizeMetres:maple?[.03,.06,.04,.08]:[.06,.12,.025,.055],venation:maple?"palmate":"three basal main veins"};petioles.userData.organ="petiole";leaves.name=`leaves:${cohort}`;leaves.castShadow=leaves.receiveShadow=true;
   visible.forEach((l,n)=>{leaves.setMatrixAt(n,l.blade);petioles.setMatrixAt(n,l.petiole);if(maple)color.setHSL(.25-autumn*.235+(l.variation-.5)*.02,.43+autumn*.26,.29+autumn*.16+l.variation*.06);else color.setHSL(.265+(l.variation-.5)*.025,.38,.22+l.variation*.08);leaves.setColorAt(n,color);});parent.add(petioles,leaves);leafCount+=visible.length;
  }
  // Persistent first shoot leaves. Each node expands from zero; no age-2 removal.
  const first:Leaf[]=[];recordLeaves(trunkCurve,new THREE.Matrix4(),first,seed*8191,6,.07);showLeaves(trunk,first,"main-axis");
  for(let i=0;i<primaryCount;i++){const r=randomFor(seed*991+i*3011),birth=.6+i*(maple?.42:.55),growth=organGrowth(birth,3,age);if(growth<=0)continue;
    // Opposing layered maple branches share node heights; camphor stays alternate.
    const t=maple?Math.floor(i/2)/6:(i+.2+r()*.6)/primaryCount,attach=maple?.13+t*.50:.22+t*.59,az=maple?Math.floor(i/2)*1.6+(i%2)*Math.PI:i*2.39996+(r()-.5)*1.1,inc=maple?1.12+r()*.25:.65+r()*.50;
    const dir=new THREE.Vector3(Math.cos(az)*Math.sin(inc),Math.cos(inc),Math.sin(az)*Math.sin(inc)),length=h*(maple?.48:.37)*(1-.35*t)*(.80+r()*.45)*growth,pr=radius*(maple?.36:.30)*Math.sqrt(growth),pivot=joint(trunk,trunkCurve.getPointAt(attach),dir,length,pr,1,seed+i*79),axis=curvedAxis(length,length*.16,az),parts=[curvedTube(axis,pr,.001*growth,14,7)],records:Leaf[]=[];
    recordLeaves(axis,new THREE.Matrix4(),records,seed+i*6143,6,birth+.12);
    const secN=maple?7:9;
    for(let b=0;b<secN;b++){const sbirth=birth+.5+b*.13,sg=organGrowth(sbirth,1.4,age);if(sg<=0)continue;
      const br=randomFor(seed*197+i*881+b*997),tt=.20+(b+.3)/secN*.74,phi=maple?Math.floor(b/2)*1.6+(b%2)*Math.PI:b*2.39996+br()*.4,slen=length*(.31+br()*.22)*sg,q=new THREE.Quaternion().setFromUnitVectors(UP,new THREE.Vector3(Math.cos(phi)*.76,.64+br()*.2,Math.sin(phi)*.76).normalize()),frame=new THREE.Matrix4().compose(axis.getPointAt(tt),q,new THREE.Vector3(1,1,1)),second=curvedAxis(slen,slen*.18,phi);
      parts.push(curvedTube(second,pr*.28*Math.sqrt(sg),.0008*sg,8,5).applyMatrix4(frame));recordLeaves(second,frame,records,seed+i*8191+b*79,Math.max(3,Math.round((maple?6:10)*density)),sbirth+.15);
      for(let c=0;c<(maple?4:5);c++){const tbirth=sbirth+.6+c*.14,tg=organGrowth(tbirth,1.1,age);if(tg<=0)continue;
        const ct=.25+(c+.5)/(maple?4:5)*.70,point=second.getPointAt(ct).applyMatrix4(frame),a=phi+c*2.39996,tdir=new THREE.Vector3(Math.cos(a)*.7,.6+br()*.3,Math.sin(a)*.7).normalize().applyQuaternion(q),tq=new THREE.Quaternion().setFromUnitVectors(UP,tdir),tf=new THREE.Matrix4().compose(point,tq,new THREE.Vector3(1,1,1)),tl=slen*(.30+br()*.20)*tg,twig=curvedAxis(tl,tl*.11,a);
        parts.push(curvedTube(twig,.0019*tg,.00045*tg,5,4).applyMatrix4(tf));recordLeaves(twig,tf,records,seed+i*1213+b*139+c*29,Math.max(3,Math.round((maple?5:8)*density)),tbirth+.12);
      }
    }
    addWood(pivot,parts,bark);showLeaves(pivot,records,`branch-${i}`);
  }
  group.userData.reproduction="not simulated: no ornamental large flowers";
 } else if(species==="ophiopogon") {
  const clumpCount=1+Math.round(6*density),leafMaterial=mat(new THREE.MeshStandardMaterial({color:"#ffffff",side:THREE.DoubleSide,vertexColors:true,roughness:.67})),scapeMat=mat(new THREE.MeshStandardMaterial({color:"#7a925d",roughness:.8})),flowerMat=mat(new THREE.MeshStandardMaterial({color:"#ded8ee",side:THREE.DoubleSide,roughness:.72}));
  const bloom=smooth(145,172,day)*(1-smooth(226,246,day))*smooth(.5,1.5,age),petalShape=new THREE.Shape();petalShape.moveTo(0,0);petalShape.bezierCurveTo(.0016,.001,.0019,.004,0,.005);petalShape.bezierCurveTo(-.0019,.004,-.0016,.001,0,0);const flowerGeo=geom(new THREE.ShapeGeometry(petalShape,5));
  for(let c=0;c<clumpCount;c++){const ramet=ophiopogonRamet(c,age);if(ramet.growth<=0)continue;const r=randomFor(seed*199+c*761),base=joint(group,new THREE.Vector3(ramet.x,0,ramet.z),UP,.28*ramet.growth,.004*ramet.growth,2,seed+c*17),parts:THREE.BufferGeometry[]=[];base.userData.organ="basal-rosette";base.userData.woody=false;const leafN=Math.max(5,Math.round(84*density));
    for(let l=0;l<leafN;l++){const angle=l*2.39996+r()*.6,targetLength=.16+r()*.22,targetWidth=.002+r()*.002,lg=organGrowth(ramet.birth+l*.019,.6,age),length=targetLength*lg,width=targetWidth*lg,reach=.40+r()*.42,curve=new THREE.CubicBezierCurve3(new THREE.Vector3((r()-.5)*.008*lg,0,(r()-.5)*.008*lg),new THREE.Vector3(0,length*.43,0),new THREE.Vector3(Math.cos(angle)*length*reach*.48,length*.97,Math.sin(angle)*length*reach*.48),new THREE.Vector3(Math.cos(angle)*length*reach,length*(.34+r()*.24),Math.sin(angle)*length*reach));
      if(lg<=0)continue;
      const positions:number[]=[],ix:number[]=[],cols:number[]=[],normalside=new THREE.Vector3(Math.sin(angle),0,-Math.cos(angle)),n=18;const hue=.28+r()*.025,light=.19+r()*.10;
      for(let j=0;j<=n;j++){const t=j/n,p=curve.getPoint(t),w=width*(.27+.73*Math.sin(t*Math.PI))*(1-Math.pow(t,9))*.5;for(let k=0;k<3;k++){const v=p.clone().addScaledVector(normalside,(k-1)*w);v.y+=(k===1?.00035*lg:0)*Math.sin(t*Math.PI);positions.push(v.x,v.y,v.z);color.setHSL(hue,.43,light+(k===1?.035:0));cols.push(color.r,color.g,color.b);}if(j<n)for(let k=0;k<2;k++){const v=j*3+k;ix.push(v,v+3,v+1,v+1,v+3,v+4)}}
      const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.setAttribute("color",new THREE.Float32BufferAttribute(cols,3));g.setIndex(ix);g.computeVertexNormals();parts.push(g);leafCount++;
    }
    if(!parts.length)continue;const leaves=new THREE.Mesh(geom(merge(parts)),leafMaterial);leaves.userData.organ="leaf";leaves.userData.leafVertexCount=parts[0].attributes.position.count;leaves.userData.leafIndexCount=parts[0].index?.count||0;leaves.userData.bladeWidthMetres=[.002,.004];leaves.castShadow=leaves.receiveShadow=true;base.add(leaves);
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
 return{group,branches,leafCount,height:box.isEmpty()?0:Math.max(0,box.max.y),stageLabel,update,dispose};
}
