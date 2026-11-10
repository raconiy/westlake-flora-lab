"""Append the extrapolated feather zone to the four existing full-resolution Blender meadow point clouds."""
import hashlib,json,sys
from pathlib import Path
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from import_meadow import parse_glb

def digest(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def coords(mesh):
    a=np.empty((len(mesh.vertices),3),np.float32);mesh.vertices.foreach_get('co',a.ravel())
    return a
def vectors(obj,field):
    x=np.empty((len(obj.data.vertices),3),np.float32);obj.data.attributes[field].data.foreach_get('vector',x.ravel());return x
def colors(obj):
    x=np.empty((len(obj.data.vertices),4),np.float32);obj.data.color_attributes['meadow_irradiance'].data.foreach_get('color',x.ravel());return x
source,destination,receipt=map(Path,sys.argv[sys.argv.index('--')+1:])
current=Path(bpy.data.filepath);assert current.resolve()!=destination.resolve()
doc,read=parse_glb(source)
stats=next(n['extras']['stats'] for n in doc['nodes'] if 'stats' in n.get('extras',{}))
records=[]
for node in doc['nodes']:
    ext=node.get('extensions',{}).get('EXT_mesh_gpu_instancing')
    if not ext:continue
    ob=bpy.data.objects.get(node['name'])
    if ob is None or 'persistent_tufts' not in ob:raise ValueError('Could not find original full meadow group')
    mesh=ob.data
    original=coords(mesh);n0=len(original)
    attrs={k:np.array(read(index),np.float32) for k,index in ext['attributes'].items()}
    pos=attrs['TRANSLATION'][:,[0,2,1]].copy();pos[:,1]*=-1
    scale=attrs['SCALE'][:,[0,2,1]].copy()
    rot=attrs['ROTATION'];euler=np.zeros_like(scale)
    euler[:,2]=2*np.arctan2(rot[:,1].astype(float),rot[:,3].astype(float))
    tint=np.ones((len(rot),4),np.float32);tint[:,:3]=attrs['_COLOR_0'][:,:3]
    within={'rootM':float(np.max(np.abs(original-pos[:n0]))),'orientationRadians':float(np.max(np.abs(vectors(ob,'meadow_euler')-euler[:n0]))),
            'scale':float(np.max(np.abs(vectors(ob,'meadow_scale')-scale[:n0]))),'color':float(np.max(np.abs(colors(ob)-tint[:n0])))}
    if max(within.values())>1.e-6 or len(pos)<=n0:raise ValueError('Original tuft data changed: '+str(within))
    mesh.vertices.add(len(pos)-n0);mesh.vertices.foreach_set('co',pos.ravel())
    mesh.attributes['meadow_euler'].data.foreach_set('vector',euler.ravel())
    mesh.attributes['meadow_scale'].data.foreach_set('vector',scale.ravel())
    mesh.color_attributes['meadow_irradiance'].data.foreach_set('color',tint.ravel());mesh.update()
    if not np.array_equal(coords(mesh)[:n0],original):raise ValueError('Original roots moved in Blender')
    ob['persistent_tufts']=len(pos)
    records.append({'object':ob.name,'original':n0,'new':len(pos),'oldTupleMaxAbsError':within})
assert len(records)==4 and sum(x['new'] for x in records)==stats['fieldTufts'] and sum(x['original'] for x in records)==384606
s=bpy.context.scene;s['capture17_meadow']=str(stats['fieldTufts'])+' persistent tufts including a modelled soft perimeter. The original 384606 root coordinates are unchanged.'
bpy.context.view_layer.update()
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(destination.resolve()),compress=True,copy=True)
receipt.write_text(json.dumps({'sourceBlendSha256':digest(current),'candidateBlendSha256':digest(destination),'sourceFullMeadowGlbSha256':digest(source),'originalCount':384606,
                             'total':stats['fieldTufts'],'meshGroups':records,'basis':'Additional tufts are outside the original 44x52m field. Density there is an engineering extrapolation, not measured.'},indent=2)+'\n')
