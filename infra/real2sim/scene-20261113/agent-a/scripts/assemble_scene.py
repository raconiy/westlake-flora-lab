"""Assemble independent CG modules. All dimensions are visual estimates, not survey measurements."""

# Portable package root; override only when using another runtime directory.
import os as _real2sim_os
from pathlib import Path as _Real2SimPath
_REAL2SIM_ROOT = _Real2SimPath(_real2sim_os.environ.get(
    'REAL2SIM_ROOT', str(_Real2SimPath(__file__).resolve().parents[1])
)).expanduser().resolve()

import bpy, math, json, importlib.util, os, time
from pathlib import Path
from mathutils import Vector
ROOT=Path(str(_REAL2SIM_ROOT))
OUT=ROOT/'exports'; OUT.mkdir(exist_ok=True)
ASSETS=OUT/'assets'; ASSETS.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
modules=[('architecture','build_architecture.py'),('terrain','build_ground.py'),('vegetation','build_vegetation.py')]
roots=[]
for name,file in modules:
    folder=ROOT/'cg'/name; path=folder/file
    spec=importlib.util.spec_from_file_location(name,path); mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    old=os.getcwd();os.chdir(folder)
    result=mod.build();os.chdir(old)
    for ob in result or []:
        if not ob.users_collection: bpy.context.scene.collection.objects.link(ob)
        ob['source_module']=name
        ob['category']='buildings' if name=='architecture' else 'plants' if name=='vegetation' else ('facilities' if any(k in ob.name.lower() for k in ['lamp','bin','sign','facilit']) else 'ground')
    roots.extend(result or [])
    print('MODULE_BUILT',name,len(result or []),flush=True)
# Some builders deliberately return unlinked asset data. Link every generated object.
for generated in list(bpy.data.objects):
    if not generated.users_collection: bpy.context.scene.collection.objects.link(generated)
bpy.context.view_layer.update()
import sys
sys.path.insert(0,str(ROOT/'scripts'))
from refine_architecture import refine as refine_facade
refine_facade()
from refine_materials import refine
print('MATERIAL_PASS',refine(),flush=True)
scene=bpy.context.scene
# Use named camera views and preserve editable hierarchy in the source scene.
def camera(name,pos,target,lens=42):
    data=bpy.data.cameras.new(name); ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=pos
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler();data.sensor_fit='VERTICAL';data.sensor_height=24;data.lens=30.5;data.clip_end=1000
    return ob
views=[('建筑与草坪',(28,-35,2.0),(0,17,4.2)),('柱廊近景',(31,13,4.8),(5,35,4)),('步道与植物',(-26,-27,4),(3,6,3)),('场景总览',(62,-65,50),(0,13,0))]
cameras=[camera(n,p,t) for n,p,t in views];scene.camera=cameras[0]
world=bpy.data.worlds.new('Soft daylight') if not bpy.data.worlds else bpy.data.worlds[0];scene.world=world;world.use_nodes=True
nodes=world.node_tree.nodes;nodes.clear();sky=nodes.new('ShaderNodeTexSky');sky.sky_type='NISHITA';sky.sun_elevation=.45;sky.sun_rotation=2.2;sky.sun_disc=False;sky.air_density=1.1;sky.dust_density=2
bg=nodes.new('ShaderNodeBackground');bg.inputs['Strength'].default_value=.4;wo=nodes.new('ShaderNodeOutputWorld');world.node_tree.links.new(sky.outputs['Color'],bg.inputs['Color']);world.node_tree.links.new(bg.outputs[0],wo.inputs[0])
ld=bpy.data.lights.new('Filtered afternoon sun','SUN');ld.energy=2.0;ld.angle=.12;lo=bpy.data.objects.new('Filtered afternoon sun',ld);scene.collection.objects.link(lo);lo.rotation_euler=(.48,-.36,-.8)
scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True;scene.cycles.max_bounces=6
scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-.3
from refine_environment import refine as refine_environment
refine_environment()
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scenes/scene-agent-a.blend'))
records=[]
labels={'architecture.main_colonnade.v1':'椭圆柱廊建筑','architecture.west_academic.v1':'条带学术楼','central_lawn':'中央草坪','stone_plaza':'花岗岩广场铺装','asphalt_road':'环形车道与路沿','paths':'草坪步道','lamps':'庭院路灯','bins_signs':'垃圾桶与导视'}
def descendants(o):
    yield o
    for c in o.children:yield from descendants(c)
def select_objects(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.hide_set(False);o.select_set(True)
    if objects:bpy.context.view_layer.objects.active=objects[0]
for i,root in enumerate(roots):
    asset_id=str(root.get('asset_id') or root.name).replace(' ','_').replace('/','_')
    root['asset_id']=asset_id
    if asset_id.startswith('tree_'):label='常绿乔木 '+asset_id.split('_')[-1]
    elif asset_id.startswith('autumntree_'):label='秋色乔木 '+asset_id.split('_')[-1]
    elif asset_id.startswith('shrub_'):label='灌木 '+asset_id.split('_')[-1]
    else:label=labels.get(asset_id,root.name)
    root['display_name']=label
    group=list(descendants(root)); select_objects(group)
    corners=[o.matrix_world @ Vector(c) for o in group if o.type=='MESH' for c in o.bound_box]
    dimensions=[max(c[k] for c in corners)-min(c[k] for c in corners) for k in range(3)] if corners else [0,0,0]
    filename='assets/'+asset_id+'.glb'
    # Asset export in its local frame; scene export keeps the placement transforms.
    matrix=root.matrix_world.copy();root.matrix_world.identity();bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(filepath=str(OUT/filename),export_format='GLB',export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,use_selection=True,export_extras=True,export_apply=True,export_animations=False,export_cameras=False,export_lights=False)
    root.matrix_world=matrix;bpy.context.view_layer.update()
    records.append({'id':asset_id,'name':str(root.get('display_name') or root.name),'category':str(root.get('category') or 'facilities'),'file':filename,'objectName':root.name,'dimensions_estimated':[round(d,4) for d in dimensions],'physical_properties':{'status':'uncalibrated','mass_kg':None,'density_kg_m3':None,'collision':None},'placement_matrix_blender_row_major':[list(row) for row in matrix]})
    print('ASSET_EXPORTED',i+1,len(roots),asset_id,flush=True)
select_objects([o for r in roots for o in descendants(r)])
bpy.ops.export_scene.gltf(filepath=str(OUT/'scene.glb'),export_format='GLB',export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,use_selection=True,export_extras=True,export_apply=True,export_animations=False,export_cameras=False,export_lights=False)
# glTF maps Blender (x,y,z) to (x,z,-y).
def web(v):return [v[0],v[2],-v[1]]
manifest={'schema_version':1,'scene_id':'scene-20261113','agent_id':'agent-a','title':'环绕实拍 · 独立CG资产场景','status':'appearance-prototype','source':{'duration':286.325,'width':544,'height':960,'video':'reference.mp4','sha256':'6e5f00262487a188cd7673340a61fbcd581644d800090dc1050cd7e962275248'},'coordinates':{'source':'Blender Z-up','web':'glTF Y-up','scale':'estimated meters; not surveyed'},'scene':'scene.glb','assets':records,'views':[{'name':n,'position':web(p),'target':web(t)} for n,p,t in views],'notes':['由实拍视频参考生成的可编辑CG资产；当前布局与尺度为目视估计。','建筑、每株植物、地面与设施独立管理，可下载和重新装配。','原视频544×960；未观察区域和微观材质包含工程补全。','外观优先；碰撞与物理仿真尚未接入。']}
(OUT/'assets-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(ROOT/'scenes/assembly.json').write_text(json.dumps({'coordinate_system':'Blender Z-up','assets':records},ensure_ascii=False,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scenes/scene-agent-a.blend'))
print('ASSEMBLY_COMPLETE',len(roots),len(bpy.data.objects),flush=True)
