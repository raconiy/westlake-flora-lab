import * as T from 'three';
export const vertex=(p,i)=>new T.Vector3().fromBufferAttribute(p,i);
export function trianglesIntersect(a,b){
 const eps=1e-12;
 for(const [edge,face] of [[a,b],[b,a]])for(let k=0;k<3;k++){
  const d=edge[(k+1)%3].clone().sub(edge[k]),len=d.length();if(len<=eps)continue;
  const q=new T.Ray(edge[k],d.divideScalar(len)).intersectTriangle(...face,false,new T.Vector3());
  if(q&&q.distanceTo(edge[k])>eps&&q.distanceTo(edge[k])<len-eps)return true;
 }
 // Coplanar interiors also count; legitimate common vertices are filtered by caller.
 const n=b[1].clone().sub(b[0]).cross(b[2].clone().sub(b[0]));if(n.lengthSq()<1e-40)return false;n.normalize();
 if(!a.every(p=>Math.abs(p.clone().sub(b[0]).dot(n))<=eps))return false;
 const drop=['x','y','z'].sort((x,y)=>Math.abs(n[y])-Math.abs(n[x]))[0],axes=['x','y','z'].filter(k=>k!==drop),
  project=v=>axes.map(k=>v[k]),aa=a.map(project),bb=b.map(project),
  side=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(side(aa[i],aa[(i+1)%3],bb[j])*side(aa[i],aa[(i+1)%3],bb[(j+1)%3])<0&&side(bb[j],bb[(j+1)%3],aa[i])*side(bb[j],bb[(j+1)%3],aa[(i+1)%3])<0)return true;
 const inside=(p,t)=>{const s=t.map((q,i)=>side(q,t[(i+1)%3],p));return s.every(v=>v>0)||s.every(v=>v<0);};
 return inside(aa[0],bb)||inside(bb[0],aa);
}
export function inspectPrimary(mesh){
 const g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,ix=g.index,
  {segments,sides}=g.userData.woodTube,hypo=g.userData.primarySegments.hypocotyl,
  rings=Array.from({length:segments+1},(_,i)=>Array.from({length:sides},(_,j)=>vertex(p,i*(sides+1)+j))),
  centres=rings.map(r=>r.reduce((c,v)=>c.add(v),new T.Vector3()).divideScalar(sides)),
  triangles=Array.from({length:ix.count/3},(_,i)=>{const ids=[0,1,2].map(k=>ix.getX(i*3+k));return {ids,pts:ids.map(i=>vertex(p,i))};});
 let crossings=0,crossTissue=0,minFaceRadialDot=1,minNormalLength=Infinity,maxNormalLength=0,maxSeamNormalAngle=0,maxAdjacentNormalAngle=0,minTriangleArea=Infinity;
 for(let i=0;i<triangles.length;i++){
  const a=triangles[i],area=a.pts[1].clone().sub(a.pts[0]).cross(a.pts[2].clone().sub(a.pts[0]));minTriangleArea=Math.min(minTriangleArea,area.length()/2);
  const c=a.pts.reduce((v,q)=>v.add(q),new T.Vector3()).divideScalar(3),ring=Math.floor(i/(2*sides)),mid=centres[ring].clone().lerp(centres[ring+1],.5),radial=c.sub(mid).normalize();
  minFaceRadialDot=Math.min(minFaceRadialDot,area.normalize().dot(radial));
  for(let j=i+1;j<triangles.length;j++){
   const b=triangles[j];
   if(a.ids.some(id=>b.ids.includes(id))||a.pts.some(v=>b.pts.some(w=>v.distanceToSquared(w)<1e-24)))continue;
   // Broad phase only prunes; actual triangle intersection determines each hit.
   if(!new T.Box3().setFromPoints(a.pts).intersectsBox(new T.Box3().setFromPoints(b.pts)))continue;
   if(trianglesIntersect(a.pts,b.pts)){crossings++;if(i<hypo*2*sides&&j>=hypo*2*sides)crossTissue++;}
  }
 }
 for(let i=0;i<n.count;i++){const len=vertex(n,i).length();minNormalLength=Math.min(minNormalLength,len);maxNormalLength=Math.max(maxNormalLength,len);}
 for(let i=0;i<=segments;i++){
  const a=i*(sides+1);maxSeamNormalAngle=Math.max(maxSeamNormalAngle,vertex(n,a).angleTo(vertex(n,a+sides))*180/Math.PI);
  if(i>0&&i<=hypo+1)for(let j=0;j<sides;j++)maxAdjacentNormalAngle=Math.max(maxAdjacentNormalAngle,vertex(n,a+j).angleTo(vertex(n,a+j-sides-1))*180/Math.PI);
 }
 const lastHypo=triangles.slice((hypo-1)*2*sides,hypo*2*sides),firstEpic=triangles.slice(hypo*2*sides,(hypo+1)*2*sides),
  leftIDs=new Set(lastHypo.flatMap(t=>t.ids)),rightIDs=new Set(firstEpic.flatMap(t=>t.ids)),shared=[...leftIDs].filter(i=>rightIDs.has(i));
 const plane=ring=>{const sum=new T.Vector3();for(let j=0;j<sides;j++)sum.add(rings[ring][j].clone().sub(centres[ring]).cross(rings[ring][(j+1)%sides].clone().sub(centres[ring])));return sum.normalize();},
  incoming=centres[hypo].clone().sub(centres[hypo-1]),outgoing=centres[hypo+1].clone().sub(centres[hypo]);
 return {segments,sides,vertices:p.count,triangles:triangles.length,nonsharedIntersectionPairs:crossings,crossTissueIntersectionPairs:crossTissue,
  junctionSharedVertexCount:shared.length,
  junctionChordAngleDeg:incoming.angleTo(outgoing)*180/Math.PI,junctionRingToEpicotylChordDeg:plane(hypo).angleTo(outgoing)*180/Math.PI,
  maxAdjacentNormalAngleDeg:maxAdjacentNormalAngle,maxAngularSeamNormalAngleDeg:maxSeamNormalAngle,minNormalLength,maxNormalLength,minFaceRadialDot,minTriangleArea,
  finite:[p,n,uv].every(a=>Array.from(a.array).every(Number.isFinite)),node:centres[hypo].toArray(),tip:centres[segments].toArray(),
  rootCollarMaxAbsY:Math.max(...rings[0].map(p=>Math.abs(p.y))),
  seamURanges:[hypo-1,hypo,hypo+1].map(i=>uv.getX(i*(sides+1)+sides)-uv.getX(i*(sides+1)))};
}
