"""Transplant recalibrated meshes into the frozen R6 model, preserving all named sockets."""
from pathlib import Path
from copy import deepcopy
import json,struct,hashlib,sys
import numpy as np

base,addition,binding,target,report=map(Path,sys.argv[1:])
def unpack(p):
 b=p.read_bytes();magic,ver,total,l,typ=struct.unpack_from('<4s4I',b);assert magic==b'glTF' and ver==2 and total==len(b) and typ==0x4e4f534a
 return json.loads(b[20:20+l]),bytearray(b[28+l:])
def matrix(node):
 if 'matrix' in node:return np.array(node['matrix']).reshape(4,4).T
 x,y,z,w=node.get('rotation',[0,0,0,1]);R=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
 M=np.eye(4);M[:3,:3]=R@np.diag(node.get('scale',[1,1,1]));M[:3,3]=node.get('translation',[0,0,0]);return M
def graph(data):
 nodes=data['nodes'];parents={c:i for i,n in enumerate(nodes) for c in n.get('children',[])}
 def world(i):
  m=matrix(nodes[i]);return world(parents[i])@m if i in parents else m
 names={n['name']:i for i,n in enumerate(nodes) if 'name' in n}
 return names,world
def actual(d,i):
 n=d['nodes'][i]
 if 'mesh' in n:return i
 stack=n.get('children',[]);out=[j for j in stack if 'mesh' in d['nodes'][j]]
 if len(out)!=1:raise ValueError(('Expected exactly one mesh below',n,out))
 return out[0]
d,b=unpack(base);g,a=unpack(addition);bind=json.loads(binding.read_text())
ids,world=graph(d);src,source_world=graph(g);new_access={};new_views={};old_acc=set();changes=[]
# Some gltfpack resources are shared among all selected tree meshes. Copy each compressed range once.
def append_to_blob(offset,length):
 b.extend(bytes(-len(b)%4));start=len(b);b.extend(a[offset:offset+length]);return start
def copy_view(j):
 if j in new_views:return new_views[j]
 v=deepcopy(g['bufferViews'][j]);ex=v.get('extensions',{}).get('EXT_meshopt_compression')
 if ex is not None:
  ex['byteOffset']=append_to_blob(ex.get('byteOffset',0),ex['byteLength']);ex['buffer']=0
  if v['buffer']!=1 or len(d['buffers'])!=2:raise ValueError('Unexpected fallback buffers')
  d['buffers'][1]['byteLength']+=(-d['buffers'][1]['byteLength'])%4
  v['byteOffset']=d['buffers'][1]['byteLength'];d['buffers'][1]['byteLength']+=v['byteLength']
 else:
  assert v['buffer']==0
  v['byteOffset']=append_to_blob(v.get('byteOffset',0),v['byteLength'])
 new_views[j]=len(d['bufferViews']);d['bufferViews'].append(v);return new_views[j]
def copy_acc(j):
 if j not in new_access:
  x=deepcopy(g['accessors'][j]);x['bufferView']=copy_view(x['bufferView']);new_access[j]=len(d['accessors']);d['accessors'].append(x)
 return new_access[j]
mats={m.get('name'):i for i,m in enumerate(d['materials'])}
for name in bind['changedObjects']:
 i=ids[name];old=actual(d,i);j=src[name];new=actual(g,j);n=d['nodes'][old]
 if i==old:raise ValueError('Named socket was welded by the original exporter')
 mesh=deepcopy(g['meshes'][g['nodes'][new]['mesh']])
 old_mesh=d['meshes'][n['mesh']]
 for p in old_mesh['primitives']:old_acc.update(p['attributes'].values());old_acc.add(p['indices'])
 for p in mesh['primitives']:
  p['attributes']={k:copy_acc(v) for k,v in p['attributes'].items()};p['indices']=copy_acc(p['indices'])
  p['material']=mats[g['materials'][p['material']]['name']]
 if sum(1 for o in d['nodes'] if o.get('mesh',-1)==n['mesh'])!=1:raise ValueError('Replacement geometry unexpectedly shared')
 d['meshes'][n['mesh']]=mesh
 if name in bind['changes']:
  counts=bind['changes'][name]
  d['nodes'][i].setdefault('extras',{}).update(full_blades=counts['resultBlades'],physical_blades=counts['webBlades'])
 local=np.linalg.inv(world(i))@source_world(new);check=world(i)@local
 if not np.allclose(check,source_world(new),rtol=1.e-7,atol=1.e-7):raise ValueError('Attachment transform changed')
 for k in ['scale','rotation','translation']:n.pop(k,None)
 n['matrix']=local.T.ravel().tolist();changes.append(name)
for name,extra in bind['updatedJoints'].items():d['nodes'][ids[name]]['extras'].update(extra)
d['asset']['extras']['captureRevision']=7
d['asset']['extras']['terminalShootFit']={'mode':bind['mode'],'basis':bind['basis'],'woodySegmentsRemoved':0,'sourceNativeSha256':bind['blendSha256'],'leafLOD':'Retains prior deterministic original leaf IDs, per-tree stride 2/4/3; native full leaves differ and require separate image evaluation.','limits':'Engineering terminal orientation and resource priors. Occluded geometry is inferred. Not a measured biological growth sequence.'}
# The existing shared view still contains unreachable vertices from the R5 near crowns.
# Record their accessor IDs so a later exact meshopt compaction may reclaim that space.
b.extend(bytes(-len(b)%4));d['buffers'][0]['byteLength']=len(b);js=json.dumps(d,ensure_ascii=False,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
target.write_bytes(struct.pack('<4sIIII',b'glTF',2,28+len(js)+len(b),len(js),0x4e4f534a)+js+struct.pack('<II',len(b),0x004e4942)+b)
report.write_text(json.dumps({'baseSha256':hashlib.sha256(base.read_bytes()).hexdigest(),'meshPatchSha256':hashlib.sha256(addition.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'changes':changes,'oldAccessors':sorted(old_acc),'newBufferViews':len(new_views),'newAccessors':len(new_access)},indent=2))
