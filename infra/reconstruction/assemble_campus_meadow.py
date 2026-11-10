"""Blender: combine the final tree project, full meadow and photographed low objects."""
from pathlib import Path
import argparse
import json
import sys

import bpy

sys.path.insert(0,str(Path(__file__).resolve().parent))
from import_meadow import attach

parser=argparse.ArgumentParser()
parser.add_argument('meadow',type=Path)
parser.add_argument('fixtures',type=Path)
parser.add_argument('destination',type=Path)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
source=Path(bpy.data.filepath).name
groups=attach(args.meadow)
existing=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(args.fixtures.resolve()))
fixture_objects=[o.name for o in bpy.data.objects if o not in existing and o.type=='MESH']
old=[]
for o in bpy.data.objects:
    if o.name.startswith('Turf.NearVergeBlades'):
        o.hide_render=True
        o.hide_viewport=True
        old.append(o.name)
if len(fixture_objects)!=2 or len(groups)!=4 or not old:
    raise ValueError('Unexpected measured fixture / full-detail turf structure')
bpy.ops.file.pack_all()
missing=[im.name for im in bpy.data.images if im.source=='FILE' and not im.packed_file]
if missing:
    raise ValueError('Unpacked bitmap images: '+', '.join(missing))
bpy.context.scene['capture17_source']='13 registered photographs and 4 videos. 3.41 m lamp scale is nominal.'
bpy.context.scene['capture17_meadow']='384606 persistent modelled grass groups; full detail, mowing and growth density are priors.'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(args.destination.resolve()),compress=True)
print('ASSEMBLY',json.dumps({'treeSource':source,'fullMeadowPointObjects':groups,'fixtures':fixture_objects,'oldTurfHidden':old,'packed':True},ensure_ascii=False))
