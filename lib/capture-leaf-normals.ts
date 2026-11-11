/** Leaf-local normal reconstruction. No vertex, index or organ attachment moves.
 * Connect triangles only through a complete geometric edge: leaves that merely
 * share a petiole point must not acquire each other's normal.
 */
export function smoothLeafNormals(positions: ArrayLike<number>, indices: ArrayLike<number>,
  original: ArrayLike<number>, maxFaces = 16) {
  if (positions.length % 3 || indices.length % 3 || original.length !== positions.length) {
    throw new Error('Incomplete leaf geometry');
  }
  const n = positions.length / 3, faces = indices.length / 3;
  const pointId = new Uint32Array(n), ids = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const p = [positions[i*3], positions[i*3+1], positions[i*3+2]];
    if (!p.every(Number.isFinite)) throw new Error('Non-finite leaf position');
    const key = p.join(','), id = ids.get(key) ?? ids.size;
    ids.set(key,id); pointId[i] = id;
  }
  const parent = Uint32Array.from({length: faces}, (_,i) => i);
  const find = (i:number):number => {
    while(parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const edges = new Map<string, number>();
  const faceNormals = new Float64Array(faces*3);
  const owners = Array.from({length:n}, () => new Set<number>());
  for(let f=0; f<faces; f++) {
    const a=indices[f*3], b=indices[f*3+1], c=indices[f*3+2];
    if (![a,b,c].every(i=>Number.isInteger(i)&&i>=0&&i<n)) throw new Error('Invalid leaf index');
    for(const [u,v] of [[a,b],[b,c],[c,a]]) {
      const x=pointId[u], y=pointId[v];
      if(x===y) continue;
      const key=x<y?`${x}:${y}`:`${y}:${x}`, prior=edges.get(key);
      if(prior!==undefined) parent[find(f)]=find(prior);
      else edges.set(key,f);
    }
    const ab=[positions[b*3]-positions[a*3],positions[b*3+1]-positions[a*3+1],positions[b*3+2]-positions[a*3+2]];
    const ac=[positions[c*3]-positions[a*3],positions[c*3+1]-positions[a*3+1],positions[c*3+2]-positions[a*3+2]];
    faceNormals.set([ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],f*3);
  }
  const groups=new Map<number,number[]>();
  for(let f=0;f<faces;f++) {
    const root=find(f); if(!groups.has(root)) groups.set(root,[]); groups.get(root)!.push(f);
    for(let j=0;j<3;j++) owners[indices[f*3+j]].add(root);
  }
  const normals=Float32Array.from(original);
  let smoothedComponents=0, skippedComponents=0, changedVertices=0;
  for(const list of groups.values()) {
    // Fail closed on joined sheets/whole branch surfaces and malformed triangles.
    if(list.length<2 || list.length>maxFaces) {skippedComponents++; continue;}
    const sums=new Map<number,number[]>(), members=new Set<number>();
    for(const f of list) for(let j=0;j<3;j++) {
      const vertex=indices[f*3+j], id=pointId[vertex]; members.add(vertex);
      if(!sums.has(id)) sums.set(id,[0,0,0]);
      const sum=sums.get(id)!;
      for(let k=0;k<3;k++) sum[k]+=faceNormals[f*3+k];
    }
    let changed=false;
    for(const vertex of members) {
      if(owners[vertex].size!==1) continue;
      const sum=sums.get(pointId[vertex])!, length=Math.hypot(...sum);
      if(length<1e-20) continue;
      const unit=sum.map(v=>v/length);
      if(unit.reduce((s,v,k)=>s+v*original[vertex*3+k],0)<-.05) continue;
      const difference=unit.some((v,k)=>Math.abs(v-original[vertex*3+k])>1e-5);
      if(difference) { changedVertices++; changed=true; }
      normals.set(unit,vertex*3);
    }
    if(changed) smoothedComponents++;
  }
  return {normals,smoothedComponents,skippedComponents,changedVertices};
}
