"""Offline A/B of actual decoded web GLBs. Run against the frozen R7 blend.
blender -b frozen.blend -P render_leaf_normal_ab.py -- output_dir baseline.glb candidate.glb
No geometry edits; inherited scene lights/world/camera are identical across runs.
"""
import bpy,json,sys,time,hashlib,os,struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import import_meadow

def without_instanced_grass(source, destination):
 """Skip only instancer meshes in glTF import; attach their exact data as GN.

 Expanding 265,564 instances into separate Blender objects would overwhelm the
 importer. The source GLB remains unchanged; its instance transforms, blade
 geometry and vertex colors feed the existing native meadow importer instead.
 """
 raw=source.read_bytes();length,kind=struct.unpack_from('<II',raw,12)
 if kind!=0x4e4f534a:raise ValueError('Missing GLB JSON chunk')
 doc=json.loads(raw[20:20+length]);count=0
 for node in doc['nodes']:
  ext=node.get('extensions',{}).get('EXT_mesh_gpu_instancing')
  if not ext:continue
  if any(k in node for k in ('matrix','translation','rotation','scale')):
   raise ValueError('Meadow importer expects identity instancer node transforms')
  count+=doc['accessors'][ext['attributes']['TRANSLATION']]['count']
  node.pop('mesh');node['extensions'].pop('EXT_mesh_gpu_instancing')
  if not node['extensions']:node.pop('extensions')
 for key in ('extensionsUsed','extensionsRequired'):
  if key in doc:doc[key]=[e for e in doc[key] if e!='EXT_mesh_gpu_instancing']
 js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
 rest=raw[20+length:]
 destination.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(js)+len(rest))+struct.pack('<II',len(js),0x4e4f534a)+js+rest)
 return count
out,baseline,candidate=map(Path,sys.argv[sys.argv.index('--')+1:])
out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
camera=bpy.data.objects.get('Photo 01 registered')
if camera is None: raise RuntimeError('Missing registered camera')
keep=[o for o in scene.objects if o.type in ('CAMERA','LIGHT')]
for o in keep:
 matrix=o.matrix_world.copy();o.parent=None;o.matrix_world=matrix
for o in list(bpy.data.objects):
 if o not in keep:bpy.data.objects.remove(o,do_unlink=True)
if 'Capture17 supplemental meadow' in bpy.data.collections:
 bpy.data.collections.remove(bpy.data.collections['Capture17 supplemental meadow'])
scene.camera=camera
prefs=bpy.context.preferences.addons['cycles'].preferences
devices=[]
for kind in ('OPTIX','CUDA'):
 try:
  prefs.compute_device_type=kind;prefs.refresh_devices()
  devices=[d for d in prefs.devices if d.type==kind and '5090' in d.name]
  if devices:break
 except (TypeError,RuntimeError):pass
if len(devices)!=8:raise RuntimeError('Expected all eight RTX 5090 devices')
ids={d.id for d in devices}
for d in prefs.devices:d.use=d.id in ids
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.cycles.transparent_max_bounces=10;scene.render.resolution_x=1024;scene.render.resolution_y=768;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
receipt={'scope':'Offline Cycles rendering of actual decoded delivered GLBs; not a browser screenshot','grassImport':'Exact blade geometry and instance transforms through existing import_meadow.py Geometry Nodes; same native material in both passes, not browser shader','renderer':'Cycles','backend':kind,'blender':bpy.app.version_string,'devicesEnabled':len(devices),'devices':[d.name for d in devices],'samples':32,'camera':camera.name,'resolution':[1024,768],'startedAtEpoch':time.time(),'passes':[]}
for label,path in [('before',baseline),('after',candidate)]:
 before=set(bpy.data.objects)
 prepared=out/(label+'-without-instancers.glb')
 expected_grass=without_instanced_grass(path,prepared)
 bpy.ops.import_scene.gltf(filepath=str(prepared),import_shading='NORMALS')
 grass_groups=import_meadow.attach(path)
 if sum(grass_groups.values())!=expected_grass:raise RuntimeError('Grass instance count changed')
 imported=set(bpy.data.objects)-before
 for o in imported:
  if o.type=='LIGHT':o.hide_render=True
 scene.camera=camera
 scene.render.filepath=str(out/(label+'.png'));start=time.time()
 print('AB_RENDER_START',label,len(imported),flush=True)
 bpy.ops.render.render(write_still=True)
 receipt['passes'].append({'label':label,'source':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'objects':len(imported),'grassGroups':grass_groups,'grassInstances':expected_grass,'seconds':time.time()-start,'image':label+'.png'})
 (out/'gpu-render-receipt.json').write_text(json.dumps(receipt,indent=2))
 for o in imported:bpy.data.objects.remove(o,do_unlink=True)
 bpy.data.collections.remove(bpy.data.collections['Capture17 supplemental meadow'])
receipt['endedAtEpoch']=time.time();(out/'gpu-render-receipt.json').write_text(json.dumps(receipt,indent=2))
print('AB_RENDER_DONE',flush=True)
