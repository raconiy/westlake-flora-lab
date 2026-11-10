"""Identify existing connected terminal growth units without inventing new sockets."""
import bpy,json,sys
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

out=Path(sys.argv[sys.argv.index('--')+1]);out.mkdir(parents=True,exist_ok=True)
names=('tree.foreground.forked','tree.mid-fork','tree.left-spreading')
data={};report={}
def vertices(mesh):
    p=np.empty((len(mesh.vertices),3),np.float32);mesh.vertices.foreach_get('co',p.ravel());return p
for name in names:
    root=bpy.data.objects[name]
    for joint in root.children:
        if not joint.get('wind_joint'):continue
        wood=next(o for o in joint.children if '.volume-branchlets.' in o.name)
        leaf=next(o for o in joint.children if '.volume-leaves.' in o.name)
        v=vertices(wood.data).reshape(-1,2,4,3)
        ends=v.mean(axis=2)
        radii=np.linalg.norm(v-ends[:,:,None],axis=3).mean(axis=2)
        starts=np.flatnonzero((abs(radii[:,0]/.0031-1)<.18)&(abs(radii[:,1]/.0021-1)<.18))
        starts=starts[starts<len(v)-1]
        second=radii[starts+1]
        starts=starts[(abs(second[:,0]/.0021-1)<.18)&(abs(second[:,1]/.00085-1)<.18)]
        ends0=ends[starts];ends1=ends[starts+1]
        if np.max(np.linalg.norm(ends0[:,1]-ends1[:,0],axis=1))>1.e-4:raise ValueError('Disconnected original sprig')
        paths=np.stack([ends0[:,0],ends0[:,1],ends1[:,1]],axis=1)
        samples=[]
        for a,b in [(0,1),(1,2)]:
            t=np.linspace(0.,1.,5)
            samples.append(paths[:,a,None]*(1-t[None,:,None])+paths[:,b,None]*t[None,:,None])
        samples=np.concatenate(samples,axis=1)
        kd=KDTree(len(paths)*10)
        for i,p in enumerate(samples.reshape(-1,3)):kd.insert(Vector(p),i//10)
        kd.balance()
        l=vertices(leaf.data).reshape(-1,5,3)
        assigned=[];errors=[]
        for p in l[:,0]:
            candidates=np.unique([i for _,i,_ in kd.find_n(Vector(p),5)])
            line=paths[candidates];a=line[:,:2];delta=line[:,1:]-a
            t=np.clip(((p-a)*delta).sum(axis=2)/(delta*delta).sum(axis=2),0,1)
            dist=np.linalg.norm(p-(a+delta*t[:,:,None]),axis=2).min(axis=1)
            idx=dist.argmin();assigned.append(candidates[idx]);errors.append(dist[idx])
        m=np.array(leaf.matrix_world)
        world=paths@m[:3,:3].T+m[:3,3];world=world[:,:,[0,2,1]]*[1,1,-1]
        key=leaf.name
        data[key+'::path']=paths.astype('f');data[key+'::world']=world.astype('f')
        data[key+'::unit']=np.asarray(assigned,dtype='i4');data[key+'::segments']=starts.astype('i4')
        data[key+'::center']=l[:,0].astype('f')
        report[key]={'units':len(paths),'leaves':len(l),'maxAttachmentErrorM':float(max(errors)),
                     'p99AttachmentErrorM':float(np.quantile(errors,.99)),'unmatchedLeaves':int(np.sum(np.asarray(errors)>.003)),
                     'woodySegments':len(v),'parent':joint.name}
        print('UNITS',key,report[key],flush=True)
np.savez_compressed(out/'growth-units.npz',**data)
(out/'growth-units.json').write_text(json.dumps(report,indent=2))
