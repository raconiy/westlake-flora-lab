"""Read actual R7 native fusion and compare every non-grass-prototype vertex."""
import bpy,numpy as np,sys,hashlib,json
from pathlib import Path
base,final,out=map(Path,sys.argv[sys.argv.index('--')+1:])
def digest(a):return hashlib.sha256(a.tobytes()).hexdigest()
def verts(o):
 a=np.empty((len(o.data.vertices),3),'f');o.data.vertices.foreach_get('co',a.ravel());return a
def snapshot():
 prototypes=[];groups={}
 for o in bpy.data.objects:
  if o.name in {f'Turf blades near {i}' for i in range(1,5)}:
   info,=[n for n in o.modifiers[0].node_group.nodes if n.bl_idname=='GeometryNodeObjectInfo'];prototypes.append(info.inputs['Object'].default_value.name)
   colors=np.empty((len(o.data.vertices),4),'f');o.data.color_attributes['meadow_irradiance'].data.foreach_get('color',colors.ravel());groups[o.name]=digest(colors)
 objects={}
 for o in bpy.data.objects:
  d={'matrix':np.array(o.matrix_world).tolist(),'parent':o.parent.name if o.parent else None,'hide_render':o.hide_render,'wind':{k:o.get(k) for k in ['wind_joint','beam_length_m','beam_base_radius_m','beam_tip_radius_m','leaf_area_m2','root_anchored']}}
  if o.type=='MESH':
   v=verts(o);idx=np.empty(len(o.data.loops),'i');o.data.loops.foreach_get('vertex_index',idx);d.update(vertexCount=len(v),vertices=digest(v),faceLoops=digest(idx))
  objects[o.name]=d
 return objects,set(prototypes),groups
bpy.ops.wm.open_mainfile(filepath=str(base));a,allowed,groups=snapshot();assert len(allowed)==4
bpy.ops.wm.open_mainfile(filepath=str(final));b,allow2,groups2=snapshot();assert allowed==allow2;assert groups==groups2,'Instance illumination changed';assert set(a)==set(b),'Object population changed'
changed=[]
for name in a:
 if name in allowed:
  for key in ['matrix','parent','hide_render','wind']:assert a[name][key]==b[name][key],name+key
  assert a[name]['vertices']!=b[name]['vertices'],'Expected new prototype'
  changed.append({'object':name,'oldVertices':a[name]['vertexCount'],'newVertices':b[name]['vertexCount']})
 else:assert a[name]==b[name],name+' unowned geometry/transform changed'
trunk=bpy.data.objects['tree.foreground.trunk'];nodes=trunk.data.materials[0].node_tree.nodes
assert nodes['Principled BSDF'].inputs['Normal'].is_linked is False
images=[n.image for n in nodes if n.type=='TEX_IMAGE'];assert len(images)==1
assert tuple(images[0].size)==(512,1024)
res={'baselineSha256':hashlib.sha256(base.read_bytes()).hexdigest(),'finalSha256':hashlib.sha256(final.read_bytes()).hexdigest(),'allObjectNamesAndTransformsPreserved':True,'allNonGrassPrototypeVerticesAndTopologyExact':True,'instanceIlluminationExact':True,'fourPrototypeChanges':changed,'barkTextureSize':list(images[0].size),'barkNormalDisconnected':True,'objectsVerified':len(a)}
out.write_text(json.dumps(res,indent=2));print(json.dumps(res))
