"""Check actual saved Blender products, independently from the transformation code."""
import bpy,numpy as np,json,sys,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.kdtree import KDTree
base,candidate,units_path,out=map(Path,sys.argv[sys.argv.index('--')+1:])
U=np.load(units_path)
def vertices(o):
 a=np.empty((len(o.data.vertices),3),'f');o.data.vertices.foreach_get('co',a.ravel());return a
def digest(a):return hashlib.sha256(a.tobytes()).hexdigest()
def basics():
 return {o.name:{'matrix':np.array(o.matrix_world).tolist(),'parent':o.parent.name if o.parent else None,
   'vertexCount':len(o.data.vertices) if o.type=='MESH' else None,
   'coordinates':digest(vertices(o)) if o.type=='MESH' else None}
   for o in bpy.data.objects if not ('.volume-leaves.' in o.name or '.volume-branchlets.' in o.name)}
bpy.ops.wm.open_mainfile(filepath=str(base));before=basics()
wood={o.name:vertices(o) for o in bpy.data.objects if '.volume-branchlets.' in o.name}
leafCounts={o.name:len(o.data.vertices)//5 for o in bpy.data.objects if '.volume-leaves.' in o.name}
bpy.ops.wm.open_mainfile(filepath=str(candidate));after=basics()
assert before==after,'Unowned geometry or named transform moved'
rows=[]
for key in U.files:
 if not key.endswith('::path'):continue
 name=key[:-6];leaf=bpy.data.objects[name];wname=name.replace('volume-leaves','volume-branchlets');w=vertices(bpy.data.objects[wname]).reshape(-1,2,4,3)
 old=wood[wname].reshape(-1,2,4,3);assert w.shape==old.shape
 ids=U[name+'::segments'];centres=w.mean(axis=2);oldcentres=old.mean(axis=2)
 p=np.stack([centres[ids,0],centres[ids,1],centres[ids+1,1]],axis=1)
 unchanged=np.ones(len(w),bool);unchanged[ids]=False;unchanged[ids+1]=False
 assert np.array_equal(w[unchanged],old[unchanged]),'Nonterminal original wood changed'
 drift=float(np.max(np.linalg.norm(centres[ids,0]-oldcentres[ids,0],axis=1)))
 assert drift<2e-6,('Terminal socket drift',drift)
 continuity=float(np.max(np.linalg.norm(centres[ids,1]-centres[ids+1,0],axis=1)))
 roots=vertices(leaf).reshape(-1,5,3)[:,0]
 kd=KDTree(len(p)*12)
 for i,path in enumerate(p):
  for j,t in enumerate(np.linspace(0,2,12)):
   seg=min(1,int(t));point=path[seg]+(path[seg+1]-path[seg])*(t-seg);kd.insert(point,i*12+j)
 kd.balance();errs=[]
 for root in roots:
  candidates=np.unique([a[1]//12 for a in kd.find_n(Vector(root),6)])
  paths=p[candidates];a=paths[:,:2];d=paths[:,1:]-a
  t=np.clip(((root-a)*d).sum(2)/np.maximum(1e-15,(d*d).sum(2)),0,1)
  e=np.linalg.norm(root-(a+d*t[:,:,None]),axis=2).min()
  if e>.003:
   a=p[:,:2];d=p[:,1:]-a;t=np.clip(((root-a)*d).sum(2)/np.maximum(1e-15,(d*d).sum(2)),0,1)
   e=np.linalg.norm(root-(a+d*t[:,:,None]),axis=2).min()
  errs.append(e)
 err=np.array(errs)
 row={'name':name,'sourceLeaves':leafCounts[name],'candidateLeaves':len(roots),'allLeafIDsRetained':leafCounts[name]==len(roots),
      'woodSegments':len(w),'fixedNonterminalSegments':int(unchanged.sum()),'maxTerminalBaseDriftM':drift,'maxSegmentJointGapM':continuity,
      'leafRootDistanceM':{'max':float(err.max()),'p99':float(np.quantile(err,.99))},'leafRootsOver3mm':int((err>.003).sum())}
 assert row['leafRootsOver3mm']==0,row
 assert continuity<2e-6,row
 rows.append(row);print('VERIFY',name,row['leafRootDistanceM'],flush=True)
result={'baseSha256':hashlib.sha256(base.read_bytes()).hexdigest(),'candidateSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),
 'otherObjectsExactIncludingRootsAndWindJoints':True,'nonterminalWoodExact':True,'rows':rows}
out.write_text(json.dumps(result,indent=2))
