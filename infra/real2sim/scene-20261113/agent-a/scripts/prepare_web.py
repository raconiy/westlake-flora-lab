
# Portable package root; override only when using another runtime directory.
import os as _real2sim_os
from pathlib import Path as _Real2SimPath
_REAL2SIM_ROOT = _Real2SimPath(_real2sim_os.environ.get(
    'REAL2SIM_ROOT', str(_Real2SimPath(__file__).resolve().parents[1])
)).expanduser().resolve()

from pathlib import Path
import shutil, json
r=Path(str(_REAL2SIM_ROOT));repo=r/'repo';out=repo/'public/real2sim/scene-20261113/agent-a';out.mkdir(parents=True,exist_ok=True)
viewer=r/'viewer'
for name in ['index.html','style.css','viewer.js']:shutil.copy2(viewer/name,out/name)
for p in (r/'exports').iterdir():
    if p.is_dir():shutil.copytree(p,out/p.name,dirs_exist_ok=True)
    else:shutil.copy2(p,out/p.name)
shutil.copy2(r/'source/fbaf2b7afa8ba98d6db3db06dfdd8e5f.mp4',out/'reference.mp4')
shutil.copy2(r/'frames/reference-03.jpg',out/'reference-poster.jpg')
shutil.copytree(r/'frames',out/'references',dirs_exist_ok=True)
vendor=out/'vendor';vendor.mkdir(exist_ok=True);three=repo/'node_modules/three'
for name in ['three.module.js','three.core.js']:shutil.copy2(three/'build'/name,vendor/name)
for folder,name in [('controls','OrbitControls.js'),('loaders','GLTFLoader.js'),('utils','BufferGeometryUtils.js')]:
    text=(three/'examples/jsm'/folder/name).read_text().replace('../utils/BufferGeometryUtils.js','./BufferGeometryUtils.js')
    (vendor/name).write_text(text)
shutil.copy2(three/'LICENSE',vendor/'THREE-LICENSE.txt')
rr=out/'renders';rr.mkdir(exist_ok=True)
print('WEB_PREPARED',out)

from PIL import Image
for p in (r/'renders').glob('*.png'):
    Image.open(p).convert('RGB').save(rr/(p.stem+'.jpg'),quality=91)
shutil.copy2(r/'assets/textures/environment.jpg',out/'environment.jpg')

from zipfile import ZipFile, ZIP_DEFLATED
with ZipFile(out/'scene-blend.zip','w',ZIP_DEFLATED,compresslevel=6) as z:
    z.write(r/'scenes/scene-agent-a.blend','scene-agent-a.blend')

shutil.copy2(three/'examples/jsm/loaders/DRACOLoader.js',vendor/'DRACOLoader.js')
shutil.copytree(three/'examples/jsm/libs/draco/gltf',vendor/'draco',dirs_exist_ok=True)

p=vendor/'three.core.js'
p.write_text(p.read_text().replace('\t\t\t \tmaterial = getMaterial( data.material );','\t\t\t\tmaterial = getMaterial( data.material );'))
