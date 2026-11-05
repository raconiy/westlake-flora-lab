import * as THREE from 'three';
import {soilMaterial} from './soil-material.ts';
import {buildPlant} from './plant-engine.ts';
// @ts-ignore Explicit suffix is required by the native Node TypeScript test runner.
import { osmanthusLifecycle, osmanthusPriors } from './osmanthus-lifecycle.ts';

// @ts-ignore Native Node tests require the suffix.
import { additionalDevelopment, developmentPriors, organGrowth, ophiopogonRamet } from './development.ts';
import {woodyRootAxes, woodyRootGeometry} from './woody-root-development.ts';

/** A botanical illustration, not a measured root reconstruction or soil-water solver. */
export type RootSpecies = 'ginkgo' | 'osmanthus' | 'iris' | 'oxalis' | 'camphor' | 'acer' | 'ophiopogon';
export interface RhizosphereParams {
  age: number; seed: number;
  /** Relative soil moisture and compaction, each 0–1; uncalibrated. */
  moisture: number; compaction: number;
  /** Available soil profile depth, metres. */
  soilDepth: number; cutaway: boolean; density?:number;
  /** Actual above-ground model rest collar, not a separately guessed species origin. */
  shootCollar?: {position:[number,number,number];radius:number};
}
export interface RhizosphereModel {
  group: THREE.Group;
  /** Maximum root centreline depth and summed drawn-axis lengths, metres.
   * rootTips counts drawn axis ends, not all biological root tips in a living plant. */
  rootDepth: number; rootLength: number; rootTips: number;
  /** Visible soil window only, not the available rooting depth. */
  profileDepth: number;
  /** Relative availability / stress, 0–1, not measured water volume. */
  availableWater: number; waterStress: number;
  dispose(): void;
}
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const finite = (x: number, fallback: number) => Number.isFinite(x) ? x : fallback;
function randomSource(seed: number) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** Curved root with continuous rings and a tapered tip; no detached cylinder joints. */
function taperedTube(points: THREE.Vector3[], radius: number, sides: number, segments: number) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const frames = curve.computeFrenetFrames(segments, false);
  const vertices: number[] = [], indices: number[] = [], colors: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, p = curve.getPointAt(t), r = radius * (.035 + .965 * Math.pow(1 - t, .84));
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      const q = p.clone().addScaledVector(frames.normals[i], Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r);
      vertices.push(q.x, q.y, q.z);
      const light = .73 + .22 * t + .055 * Math.sin(j * 2.9 + i * 1.7);
      colors.push(light, light, light);
      if (i < segments && j < sides) {
        const n = i * (sides + 1) + j;
        indices.push(n, n + sides + 1, n + 1, n + 1, n + sides + 1, n + sides + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices); g.computeVertexNormals();
  return { geometry: g, curve };
}

/** Three illustrative strata with fine world-scale aggregate textures; no DOM/canvas dependency. */
function soilLayer(width: number, depth: number, thickness: number, bottom: number, color: string, half: boolean, seed: number) {
  const zDepth = half ? width * .5 : width;
  const geometry = new THREE.BoxGeometry(width, thickness, zDepth, 32, 9, 20);
  const pos = geometry.attributes.position, normals=geometry.attributes.normal, uv=geometry.attributes.uv, base = new THREE.Color(color), colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const noise = Math.sin(x * 91.7 + y * 173.3 + z * 67.9 + seed) * 43758.5453;
    const fine = noise - Math.floor(noise), bands = Math.sin((y + bottom) / depth * 145 + Math.sin(x * 11) * .2);
    const c = base.clone().multiplyScalar(.94 + fine * .04 + bands * .018);
    const nx=Math.abs(normals.getX(i)),ny=Math.abs(normals.getY(i));uv.setXY(i,(nx>.5?z:x),(ny>.5?z:y+bottom));
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // Millimetre-scale aggregate texture in world-space UVs; avoid metre-sized
  // triangular colour noise being mistaken for the structure of a soil profile.
  const surface=soilMaterial('#bcb6a6',seed+71),material=surface.material;material.vertexColors=true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, bottom + thickness / 2, half ? width / 4 + .002 : 0);
  mesh.userData = { organ: 'soil', sourceType: 'engineering-prior' };
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRhizosphere(species: RootSpecies | string, params: RhizosphereParams): RhizosphereModel {
  const known = ['ginkgo', 'osmanthus', 'iris', 'oxalis', 'camphor', 'acer', 'ophiopogon'].includes(species);
  const additional = species === 'camphor' || species === 'acer' || species === 'ophiopogon' ? additionalDevelopment(species, params.age) : null;
  const age = clamp(finite(params.age, 0), 0, 1500), seed = finite(params.seed, 42);
  const moisture = clamp(finite(params.moisture, .55)), compaction = clamp(finite(params.compaction, .2));
  const soilDepth = clamp(finite(params.soilDepth, 1.6), .05, 8), random = randomSource(seed);
  const group = new THREE.Group(); group.name = `rhizosphere:${species}`;
  const availableWater = clamp((moisture - .08) / .58) * (1 - .62 * compaction) * clamp(soilDepth / .8, .2, 1);
  // Saturation may reduce aeration; this is an illustrative stress proxy, not hydraulic simulation.
  const waterStress = clamp(1 - availableWater + Math.max(0, moisture - .91) * 2.5);
  const expansion = (.56 + .44 * availableWater) * (1 - .46 * compaction);
  const woody = species === 'ginkgo' || species === 'osmanthus' || species === 'camphor' || species === 'acer' || !known;
  const osmanthus = species === 'osmanthus' ? osmanthusLifecycle(age) : null;
  const development = woody ? 1 - Math.exp(-age / 9) : 1 - Math.exp(-age / .65);
  const germination = clamp((age - .012) / .08);
  const reach = woody ? (.035 + development * (species === 'ginkgo' ? 3.9 : 2.5)) * expansion : (.025 + development * (species === 'iris' ? .36 : .48)) * expansion;
  const maxDepth = Math.min(soilDepth * .96, woody ? (.018 + development * (species === 'ginkgo' ? 2.15 : 1.12)) * expansion : (.025 + development * (species === 'iris' ? .28 : .14)) * expansion);
  const rootColor = woody ? '#967349' : '#d9c6a0';
  const coarseMat = new THREE.MeshStandardMaterial({ color: rootColor, roughness: .95, vertexColors: true });
  const fineMat = new THREE.MeshStandardMaterial({ color: '#e2ca96', roughness: 1, vertexColors: true });
  const rhizomeMat = new THREE.MeshStandardMaterial({ color: species === 'iris' ? '#bba267' : '#a5aa64', roughness: .92, vertexColors: true });
  const allMaterials: THREE.Material[] = [coarseMat, fineMat, rhizomeMat];
  const geometries: THREE.BufferGeometry[] = [];
  let rootDepth = 0, rootLength = 0, rootTips = 0;
  group.userData = {
    sourceType: 'engineering-prior', calibrated: false, units: 'metres', requestedSpecies: species, knownSpecies: known,
    note: '根系空间、相对水分和压实响应均未校准；土壤纹理不代表校园土层；根尖计数仅为绘制根轴末端数。',
    metricsMeaning: { rootLength: 'sum-of-drawn-root-axis-lengths', rootTips: 'drawn-root-axis-end-count', availableWater: 'relative-illustration-index-not-hydraulic-solver' },
    soilDepth, moisture, compaction, cutaway: params.cutaway,
    architecture: species === 'ginkgo' ? 'primary-root-with-laterals' : species === 'osmanthus' ? 'generalized-lateral-root-system' : species === 'iris' ? 'horizontal-rhizome-and-fibrous-roots' : 'stolon-node-adventitious-roots'
  };
  if (!known) Object.assign(group.userData, { architecture: 'generic-unknown-root-engineering-prior', note: '未知物种：泛化工程先验，非物种实测根系。' });
  if (additional) Object.assign(group.userData, { lifecycle: additional, priors: developmentPriors,
    architecture: species === 'ophiopogon' ? 'slender-rhizomes-adventitious-fibrous-and-storage-roots' : species === 'camphor' ? 'camphor-primary-and-spreading-lateral-prior' : 'acer-primary-and-layered-lateral-prior',
    note: '形态约束下的独立物种工程先验；木本根网、砧木、根深与材料参数未知，非现场实测。' });
  if (osmanthus) Object.assign(group.userData, { lifecycle: osmanthus, priors: osmanthusPriors, architecture: 'emerging-primary-radicle-then-staggered-laterals' });
  if (species === 'ginkgo') group.userData.collarTransition = {
    source: 'project engineering continuity construction, not empirical growth data', unit: 'years and metres',
    scope: 'buried-seed lower pole to established ginkgo root collar', confidence: 'low',
    calibration: 'uncalibrated-engineering-prior', intervalYears: [.55, .95],
  };
  function addRoot(points: THREE.Vector3[], radius: number, order: number, organ = 'root') {
    // Ophiopogon's horizontal basal polygon must enclose the actual 8 mm
    // square of blade offsets AND blade half-widths, even in 5 cm soil.
    radius = Math.min(radius, soilDepth * (species === 'ophiopogon' && organ === 'root-collar' ? .14 : .12));
    const surfaceAxis=organ==='rhizome'||organ==='stolon';
    // Herb attachments are actual support nodes (Oxalis is at +3 mm), not
    // independently buried origins. Keep their proximal axes and rings intact.
    // A shared lower centreline limit also prevents a thicker daughter root
    // being lifted off its parent in shallow soil; clip the mesh at that boundary.
    const herbAttachment = !woody && !surfaceAxis;
    const axisTop = surfaceAxis ? .003 : herbAttachment ? Math.min(.003, points[0].y) : osmanthus ? -.00005 : -.002 - radius;
    points = points.map(p => new THREE.Vector3(p.x, clamp(p.y, -soilDepth + (herbAttachment ? .0001 : radius + .0001), axisTop), p.z));
    const built = taperedTube(points, radius, order < 2 ? 8 : 5, order < 2 ? 24 : 12);
    // Only the few millimetres around an exposed herb origin may cross y=0.
    // Bulk roots and spline overshoot remain inside the supplied soil profile.
    const positions = built.geometry.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      const proximal = herbAttachment && vertex.fromBufferAttribute(positions, i).distanceToSquared(points[0]) <= (.006 + radius) ** 2;
      const top = surfaceAxis ? .008 : proximal ? Math.max(-.00005, points[0].y + radius) : -.00005;
      positions.setY(i, clamp(positions.getY(i), -soilDepth + .00005, top));
    }
    built.geometry.computeVertexNormals();
    const material = organ === 'rhizome' ? rhizomeMat : order > 1 ? fineMat : coarseMat;
    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.name = `${organ}:order:${order}`;
    mesh.userData = { organ, order, sourceType: 'engineering-prior', start: points[0].toArray(), end: points.at(-1)!.toArray(), radius };
    mesh.castShadow = order < 2; group.add(mesh); geometries.push(built.geometry);
    if (organ === 'root' || organ === 'storage-root') {
      rootLength += built.curve.getLength(); rootTips++;
      for (const p of built.curve.getPoints(24)) rootDepth = Math.max(rootDepth, Math.min(soilDepth - .00005, -p.y));
    }
    return built.curve;
  }
  function laterals(parent: THREE.CatmullRomCurve3, count: number, length: number, radius: number, order: number, phase: number) {
    for (let j = 0; j < count; j++) {
      const t = .12 + j / Math.max(1, count - 1) * .77;
      const start = parent.getPointAt(t), angle = phase + j * 2.39996 + (random() - .5) * .6;
      const len = length * (.45 + random() * .55) * (1 - t * .38);
      const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * len, -len * (.35 + random() * .5), Math.sin(angle) * len));
      end.y = Math.max(-soilDepth * .96, end.y);
      const mid = start.clone().lerp(end, .48).add(new THREE.Vector3((random() - .5) * len * .24, len * .045, (random() - .5) * len * .24));
      const curve = addRoot([start, mid, end], radius * (.8 + random() * .4), order);
      if (order === 1 && (species !== 'ginkgo' || age > .2)) laterals(curve, 3 + Math.floor(random() * 3), len * .45, radius * .28, 2, angle + .8);
    }
  }
  function addWoodyRoots() {
    const axes = woodyRootAxes(species, seed, expansion, soilDepth);
    Object.assign(group.userData, {rootPersistence: {
      sourceType: 'engineering-prior', calibrated: false,
      coordinates: 'fixed material nodes in metres; persistent centreline prefixes',
      births: 'scheduled lower bounds gated by parent arrival; zero initial length and radius',
      seedTransition: 'proximal extension; original buried radicle material retained',
      scope: 'illustrative geometry; no root-soil mechanics or measured growth calibration',
    }});
    for (const axis of axes) {
      if (age <= axis.birth || axis.lengthAt(age) <= 0) continue;
      const built = woodyRootGeometry(axis, age, soilDepth);
      const mesh = new THREE.Mesh(built.geometry, axis.order > 1 ? fineMat : coarseMat);
      mesh.name = `root:order:${axis.order}`;
      mesh.userData = {organ: 'root', order: axis.order, sourceType: 'engineering-prior',
        axisId: axis.id, parentId: axis.parentId, materialNode: axis.node, birth: axis.birth,
        start: axis.point(axis.startAt(age)).toArray(), end: axis.point(axis.lengthAt(age)).toArray(),
        radius: built.radius, materialCoordinates: built.coordinates, ringSides: built.sides};
      mesh.castShadow = axis.order < 2; group.add(mesh); geometries.push(built.geometry);
      rootLength += built.length; rootDepth = Math.max(rootDepth, built.depth); rootTips++;
    }
  }
  if (species === 'iris' || species === 'oxalis') {
    // Reuse actual clonal support-axis endpoints, not an unrelated radial root proxy.
    // The small herb generator runs only on rebuild. Its geometry is disposed after extraction.
    const source = buildPlant(species,{age,day:180,seed,density:clamp(finite(params.density??1,1),.15,2)});
    const rootAnchors:{origin:THREE.Vector3;growth:number;key:number}[]=[];
    let supportCount=0;
    source.group.updateMatrixWorld(true);
    source.group.traverse(object=>{
      if(!(object instanceof THREE.Mesh)||!object.parent)return;
      const role=object.userData.role;
      if(!['rhizome-propagule','rhizome','stolon-propagule','stolon-internode','adventitious-root'].includes(role))return;
      const a=object.userData.start,b=object.userData.end;
      if(!Array.isArray(a)||!Array.isArray(b))return;
      const start=new THREE.Vector3().fromArray(a).applyMatrix4(object.parent.matrixWorld);
      const end=new THREE.Vector3().fromArray(b).applyMatrix4(object.parent.matrixWorld);
      if(start.distanceTo(end)<1e-8||object.scale.x<=1e-8)return;
      const organ=role==='adventitious-root'?'root':species==='iris'?'rhizome':'stolon';
      const mid=start.clone().lerp(end,.5);
      addRoot([start,mid,end],object.scale.x,organ==='root'?1:0,organ);
      supportCount++;
      // Extend the actual adventitious root, rather than drawing another bundle
      // from the surface node and exposing unnecessary parallel proximal axes.
      if(organ==='root')rootAnchors.push({origin:end.clone(),growth:clamp(object.scale.x/.00065),key:rootAnchors.length});
    });
    source.dispose();
    for(const anchor of rootAnchors){
      const depth=(species==='iris'?.24:.095)*anchor.growth*expansion*(1-Math.exp(-age/.55));
      if(depth<1e-7)continue;
      for(let f=0;f<(species==='iris'?7:4);f++){
        const rr=randomSource(seed+anchor.key*811+f*127),angle=f*2.39996+rr()*.4;
        const tip=anchor.origin.clone().add(new THREE.Vector3(Math.cos(angle)*depth*.38,-depth*(.55+rr()*.45),Math.sin(angle)*depth*.38));
        const curve=addRoot([anchor.origin.clone(),anchor.origin.clone().lerp(tip,.5),tip],(species==='iris'?.0011:.00045)*anchor.growth,1);
        laterals(curve,2,depth*.18,(species==='iris'?.0003:.00014)*anchor.growth,2,angle);
      }
    }
    Object.assign(group.userData,{sharedTopology:'actual-herb-support-axis-endpoints',supportCount,establishment:species==='iris'?'rhizome-division':'rooted-stolon-node',fiberExtension:'uncalibrated-engineering-prior'});
  } else if (additional) {
    const herb = species === 'ophiopogon', maturity = additional.maturity;
    const depth = Math.min(soilDepth * .85, (herb ? .24 : species === 'camphor' ? 1.8 : .95) * maturity * expansion + .025 * additional.radicle);
    const reach = (herb ? .17 : species === 'camphor' ? 3.4 : 2.2) * maturity * expansion;
    if (herb) {
      // Ophiopogon uses fixed material paths, not fractions of a growing axis.
      // These distances / clocks are uncalibrated; the cached NC State page
      // supports underground lateral axes terminating in daughter plants only.
      const targetDepth=Math.min(soilDepth*.85,.24*expansion+.025);
      const point=(p:{x:number;y:number;z:number})=>new THREE.Vector3(p.x,p.y,p.z);
      function materialAxis(id:string,start:THREE.Vector3,target:THREE.Vector3,g:number,radius:number,order:number,organ='root') {
        // Constrain the FULL path before taking its prefix, so shallow soil
        // never rotates or shortens a previously established material segment.
        target=target.clone();target.y=Math.max(-soilDepth+.0001,target.y);
        const end=start.clone().lerp(target,g);
        addRoot([start,start.clone().lerp(end,.5),end],radius*g,order,organ);
        Object.assign(group.children[group.children.length-1].userData,{axisId:id});
      }
      // Match the above-ground finite fallback, density clamp and cohort budget.
      const density=clamp(finite(params.density??1,1),.15,2),clumpCount=1+Math.round(6*density);
      for(let c=0;c<clumpCount;c++){const ramet=ophiopogonRamet(c,age);if(ramet.extension<=0)continue;
        const origin=point(ramet.nodeAt(0)),distal=point(ramet.nodeAt(1));
        materialAxis(`rhizome-${c}`,origin,distal,ramet.extension,.0015,0,'rhizome');
        // Root-only views may show a precursor with no collar or leaf tuft.
        if(ramet.growth>0){
          const end=new THREE.Vector3(ramet.x,-.008,ramet.z),leafBase=new THREE.Vector3(ramet.x,0,ramet.z);
          // 6.8 mm octagon inradius exceeds sqrt(2)*4 mm + .54 mm
          // (the largest ribbon half-width at its base); geometry, not a
          // measured collar diameter. Preserve the original offset square.
          addRoot([leafBase,leafBase.clone().lerp(end,.5),end],.0068*organGrowth(ramet.birth,.6,age),0,'root-collar');
          Object.assign(group.children[group.children.length-1].userData,{axisId:`collar-${c}`});
        }
        for(let f=0;f<12;f++){
          // The original division can root directly from its existing collar;
          // later fibers wait for underground extension to reach their nodes.
          const t=c===0&&f===0?0:.15+.7*(f+.5)/12,birth=Math.max(ramet.extensionBirth+.04+f*.055,ramet.arrivalAt(t)),g=organGrowth(birth,.65,age);
          if(g<=0)continue;
          const r=randomSource(seed*617+c*997+f*197),a=f*2.39996+r()*.5,start=point(ramet.nodeAt(t)),len=targetDepth*(.45+r()*.4);
          const target=start.clone().add(new THREE.Vector3(Math.cos(a)*len*.35,-len,Math.sin(a)*len*.35));
          materialAxis(`fiber-${c}-${f}`,start,target,g,.0007,2);
        }
        for(let f=0;f<2;f++){const birth=ramet.birth+.8+f*.2,g=organGrowth(birth,1,age);if(g<=0)continue;
          const a=c*2.39996+f*1.8,start=new THREE.Vector3(ramet.x,-.008,ramet.z),target=start.clone().add(new THREE.Vector3(Math.cos(a)*.025,-.08,Math.sin(a)*.025));
          target.y=Math.max(-soilDepth+.0001,target.y);
          materialAxis(`storage-parent-${c}-${f}`,start,target,g,.0007,1);
          // The swelling starts at a fixed material node on an arrived root,
          // never at .65 of its CURRENT length or as a daughter-plant bud.
          // Use the remaining parent extension clock after the .65 node;
          // no independent mature swelling can pop into existence at arrival.
          const sg=clamp((g-.65)/.35);
          if(sg<=0)continue;
          const node=start.clone().lerp(target,.65),tip=node.clone().add(new THREE.Vector3(Math.cos(a)*.008,-.018,Math.sin(a)*.008));
          materialAxis(`storage-${c}-${f}`,node,tip,sg,.0025,2,'storage-root');
        }
      }
    } else if (additional.radicle > 0) {
      addWoodyRoots();
    }
  } else if (age > .012) {
    if (woody) {
      addWoodyRoots();
    } else {
      const arms = species === 'iris' ? 3 : 5;
      for (let i = 0; i < arms; i++) {
        const angle = i * 2.39996 + random() * .2, r = reach * (.65 + random() * .35) * germination;
        const end = new THREE.Vector3(Math.cos(angle) * r, species === 'iris' ? -.025 : -.007, Math.sin(angle) * r);
        // Oxalis stolons are at the surface; node roots are represented below it, not as a buried rhizome.
        const curve = addRoot([new THREE.Vector3(0, end.y, 0), new THREE.Vector3(end.x * .5, end.y - .003, end.z * .55), end], species === 'iris' ? .006 + development * .005 : .0012, 0, species === 'iris' ? 'rhizome' : 'stolon');
        const nodes = 2 + Math.floor(development * 4);
        for (let n = 0; n < nodes; n++) {
          const origin = curve.getPointAt(.1 + n / nodes * .85), fibers = species === 'iris' ? 6 : 4;
          for (let f = 0; f < fibers; f++) {
            const a = random() * Math.PI * 2, d = maxDepth * (.4 + random() * .6) * germination;
            const tip = origin.clone().add(new THREE.Vector3(Math.cos(a) * d * .45, -d, Math.sin(a) * d * .45));
            const root = addRoot([origin, origin.clone().lerp(tip, .4).add(new THREE.Vector3(d * .08, 0, 0)), tip], species === 'iris' ? .0014 : .0007, 1);
            laterals(root, 2, d * .26, species === 'iris' ? .0004 : .00022, 2, a);
          }
        }
      }
    }
  }
  // Connect the ACTUAL shoot collar to the coarse root crown. Independently
  // clamping a root centreline below ground can otherwise leave a visible gap.
  // This fixed geometric junction is not a root-soil anchorage/FEM solver.
  if(woody&&params.shootCollar&&params.shootCollar.radius>1e-7){
    const top=new THREE.Vector3().fromArray(params.shootCollar.position);
    // Root generators use their own origin; translate their actual vertices and
    // endpoint metadata into the same horizontal collar coordinate system.
    if(top.x!==0||top.z!==0)for(const child of group.children){
      if(!(child instanceof THREE.Mesh))continue;child.geometry.translate(top.x,0,top.z);
      for(const key of ['start','end'])if(Array.isArray(child.userData[key])){child.userData[key][0]+=top.x;child.userData[key][2]+=top.z;}
    }
    const radius=params.shootCollar.radius,depth=Math.min(soilDepth*.70,Math.max(.004,radius*.9));
    const primary=group.children.find(o=>o.userData.organ==='root'&&o.userData.order===0);
    const primaryY=primary?.userData.start?.[1]??top.y;
    const bottomY=Math.max(-soilDepth+.0001,Math.min(top.y-.004,-depth,primaryY-radius*.5));
    const geometry=new THREE.CylinderGeometry(radius,radius*1.45,top.y-bottomY,16,3);
    geometry.translate(top.x,(top.y+bottomY)/2,top.z);
    const material=coarseMat.clone();material.vertexColors=false;allMaterials.push(material);geometries.push(geometry);
    const collar=new THREE.Mesh(geometry,material);collar.name='root-shoot-junction';collar.castShadow=collar.receiveShadow=true;
    collar.userData={organ:'root-collar',sourceType:'engineering-prior',top:top.toArray(),bottomY,anchored:true};group.add(collar);
    group.userData.shootCollar={...params.shootCollar,geometry:'connected-root-flare-proxy',anchorage:'fixed-rest-collar-not-soil-mechanics'};
  }
  // The available depth still constrains all roots and water availability above.
  // A shallow-rooted herb shows a LOCAL soil window with all drawn roots, rather
  // than a 2.5 m column that makes a 7 cm plant almost invisible. This window is
  // not a bedrock boundary, a geological measurement or a change to the roots.
  const profileDepth = woody ? soilDepth : Math.min(soilDepth, Math.max(.12, rootDepth * 1.25 + .025));
  const width = Math.max(woody ? 1.3 : .42, reach * 2.45);
  const strata = [{ ratio: .12, color: '#564532', label: '有机表层 · 示意' }, { ratio: .35, color: '#8b6846', label: '根系活跃层 · 示意' }, { ratio: .53, color: '#a28b68', label: '下部土层 · 示意' }];
  let top = -.003;
  for (let i = 0; i < strata.length; i++) {
    const layer = strata[i], thickness = layer.ratio * profileDepth;
    const mesh = soilLayer(width, profileDepth, thickness, top - thickness, layer.color, params.cutaway, seed + i * 13);
    mesh.name = layer.label; mesh.userData.layer = i; group.add(mesh);
    geometries.push(mesh.geometry); allMaterials.push(mesh.material as THREE.Material); top -= thickness;
  }
  group.userData.profileWidth = width;
  group.userData.profileDepth = profileDepth;
  group.userData.availableSoilDepth = soilDepth;
  group.userData.profileScope = woody ? 'full-available-depth-illustration' : 'local-root-zone-window-not-bedrock';
  let disposed = false;
  return { group, rootDepth, rootLength, rootTips, profileDepth, availableWater, waterStress,
    dispose() { if (disposed) return; disposed = true; for (const g of geometries) g.dispose(); const textures=new Set<THREE.Texture>();for(const m of allMaterials){for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);m.dispose();}for(const t of textures)t.dispose(); group.clear(); }
  };
}
