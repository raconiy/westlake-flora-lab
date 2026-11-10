import bpy,json,numpy as np, sys
from mathutils import Vector
from pathlib import Path
out=Path(sys.argv[-1])
D={}
for tree in ['tree.foreground.forked','tree.mid-fork','tree.left-spreading']:
 root=bpy.data.objects[tree]
 items={}
 for ob in root.children_recursive:
  if ob.type!='MESH' or ('.wood.' not in ob.name and '.trunk' not in ob.name and '.stem' not in ob.name and '.prun' not in ob.name):continue
  v=np.empty((len(ob.data.vertices),3),np.float32);ob.data.vertices.foreach_get('co',v.ravel())
  rr=np.where(np.linalg.norm(v[1:]-v[0],axis=1)<1e-5)[0]
  n=rr[0]+2 if len(rr) else 0
  if not n or len(v)%n:continue
  rings=v.reshape(-1,n,3);q=rings[:,:-1].mean(axis=1)
  world=np.array(ob.matrix_world);q=q@world[:3,:3].T+world[:3,3];points=q[:,[0,2,1]];points[:,2]*=-1
  items[ob.name]={'radii':np.median(np.linalg.norm(rings[:,:-1]-rings[:,:-1].mean(axis=1)[:,None],axis=2),axis=1).tolist(),'points':points.tolist()}
 D[tree]=items
out.write_text(json.dumps(D))
