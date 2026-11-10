"""Render 01/13 and a fixed metric plan, recording actual OptiX device allocation per view."""
import bpy
import json,os,hashlib,sys,time,threading,subprocess,math
from pathlib import Path
from mathutils import Vector
import numpy as np
folder=Path(sys.argv[sys.argv.index('--')+1]);tag=sys.argv[-1]
wide=tag.endswith('-wide')
assert tag.split('-')[0] in ('A','B','bare','R4')
s=bpy.context.scene
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
cards={d.id for d in prefs.devices if d.type=='OPTIX' and '5090' in d.name};assert len(cards)==8
for d in prefs.devices:d.use=d.id in cards
s.render.engine='CYCLES';s.cycles.device='GPU';s.cycles.samples=64;s.cycles.seed=871
s.cycles.use_animated_seed=False;s.cycles.use_denoising=False;s.cycles.use_adaptive_sampling=False
s.render.resolution_x=1280;s.render.resolution_y=960;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGB'
s.render.threads_mode='FIXED';s.render.threads=16;s.frame_set(1)
plan=bpy.data.objects.new('R4 fixed orthographic ground measurement',bpy.data.cameras.new('R4 fixed plan'))
s.collection.objects.link(plan);plan.location=(.75,10.,70.);plan.rotation_euler=(0.,0.,0.);plan.data.type='ORTHO';plan.data.ortho_scale=84.0
if wide:plan.location=(2.,16.,80.);plan.data.ortho_scale=120.
bpy.context.view_layer.update()
uu={k.strip():int(v.strip()) for k,v in [l.split(',') for l in subprocess.check_output(['nvidia-smi','--query-gpu=uuid,index','--format=csv,noheader'],text=True).splitlines()]}
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
rep={'variant':tag,'sourceBlendSha256':sha(Path(bpy.data.filepath)),'engine':'Cycles OptiX','samples':64,'seed':871,'size':[1280,960],
 'cameras':[],'preservedLights':[(o.name,list(o.matrix_world.translation),o.data.energy) for o in s.objects if o.type=='LIGHT']}
if tag.split('-')[0]=='bare': bpy.data.collections['Capture17 supplemental meadow'].hide_render=True
for key in (('plan',) if wide or tag=='bare' else ('01','13','plan')):
    s.camera=plan if key=='plan' else s.objects['Photo '+key+' registered']
    dest=folder/(tag+'-'+key+'.png');s.render.filepath=str(dest)
    peak={};stop=threading.Event()
    def collect():
        while not stop.is_set():
            for line in subprocess.check_output(['nvidia-smi','--query-compute-apps=pid,gpu_uuid,used_memory','--format=csv,noheader,nounits'],text=True).splitlines():
                pid,u,n=map(str.strip,line.split(','))
                if pid==str(os.getpid()) and n.isdigit():peak[uu[u]]=max(peak.get(uu[u],0),int(n))
            stop.wait(.6)
    t=threading.Thread(target=collect,daemon=True);started=time.monotonic();t.start()
    try:bpy.ops.render.render(write_still=True)
    finally:stop.set();t.join(6)
    assert len(peak)==8
    rep['cameras'].append({'view':key,'name':s.camera.name,'file':dest.name,'sha256':sha(dest),'seconds':round(time.monotonic()-started,2),
       'cameraMatrixWorld':np.array(s.camera.matrix_world).tolist(),'gpuProcessPeakMiBPerIndex':peak})
    (folder/(tag+'-8gpu.json')).write_text(json.dumps(rep,indent=2)+'\n')
    print('R4_RENDER',tag,key,rep['cameras'][-1]['seconds'],flush=True)
