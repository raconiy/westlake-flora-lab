
# Portable package root; override only when using another runtime directory.
import os as _real2sim_os
from pathlib import Path as _Real2SimPath
_REAL2SIM_ROOT = _Real2SimPath(_real2sim_os.environ.get(
    'REAL2SIM_ROOT', str(_Real2SimPath(__file__).resolve().parents[1])
)).expanduser().resolve()

import bpy, os, time, json
from pathlib import Path
r=Path(str(_REAL2SIM_ROOT))
scene=bpy.context.scene
scene.view_settings.exposure=.65
bpy.ops.wm.save_as_mainfile(filepath=str(r/'scenes/scene-agent-a.blend'))
p=bpy.context.preferences.addons['cycles'].preferences;p.compute_device_type='OPTIX';p.refresh_devices()
active=[]
for d in p.devices:
    d.use=d.type=='OPTIX'
    if d.use:active.append(d.name)
if not active:raise RuntimeError('No OptiX GPU exposed; do not silently fall back')
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=int(os.environ.get('CG_SAMPLES','64'));scene.cycles.use_denoising=True
scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.cycles.transparent_max_bounces=12;scene.render.image_settings.file_format='PNG'
views=[('建筑与草坪','overview'),('柱廊近景','architecture'),('步道与植物','landscape'),('场景总览','aerial')]
if os.environ.get('CG_VIEW'):views=[v for v in views if v[1]==os.environ['CG_VIEW']]
for name,slug in views:
    scene.camera=bpy.data.objects[name];scene.render.filepath=str(r/'renders'/f'{slug}.png');start=time.time()
    bpy.ops.render.render(write_still=True)
    (r/'renders'/f'{slug}-receipt.json').write_text(json.dumps({'backend':'OptiX','gpu':active,'samples':scene.cycles.samples,'width':1440,'height':900,'camera':name,'seconds':time.time()-start},indent=2))
    print('RENDER_DONE',slug,flush=True)
