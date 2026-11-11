"""Blender 4.5 offline QA for the layout experiment, not a captured-scene render."""
import csv
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading
import time
import bpy
from mathutils import Vector

source, importer, destination = map(Path, sys.argv[sys.argv.index('--') + 1:])
destination.mkdir(parents=True, exist_ok=True)
raw = source.read_bytes()
n = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20+n])
for node in doc['nodes']:
    if node.get('name', '').startswith('Campus turf near'):
        node.pop('mesh', None)
        node.pop('extensions', None)
for key in ['extensionsUsed', 'extensionsRequired']:
    if key in doc:
        doc[key] = [v for v in doc[key] if v != 'EXT_mesh_gpu_instancing']
        if not doc[key]:
            del doc[key]
encoded = json.dumps(doc, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
tail = raw[20+n:]
fixtures = destination / 'fixtures-only.glb'
fixtures.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 20+len(encoded)+len(tail), len(encoded), 0x4E4F534A)+encoded+tail)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(fixtures))
spec = importlib.util.spec_from_file_location('meadow_import', importer)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
groups = module.attach(source)
scene = bpy.context.scene
for obj in list(scene.objects):
    if obj.type == 'LIGHT':
        bpy.data.objects.remove(obj, do_unlink=True)
sun = bpy.data.lights.new('QA clear daylight', 'SUN')
sun.energy = 3.2
sun.angle = math.radians(2.2)
obj = bpy.data.objects.new(sun.name, sun)
scene.collection.objects.link(obj)
obj.location = (-14, -12, 26)
obj.rotation_euler = (Vector((0, 0, 0))-obj.location).to_track_quat('-Z', 'Y').to_euler()
scene.world = bpy.data.worlds.new('QA ambient sky')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.48, .62, .8, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .45
scene.camera = bpy.data.objects['Campus grass close']
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.device = 'GPU'
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 5
scene.cycles.diffuse_bounces = 2
scene.cycles.transparent_max_bounces = 4
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.refresh_devices()
selected = [d for d in prefs.devices if d.type == 'OPTIX' and '5090' in d.name]
if len(selected) != 8:
    raise RuntimeError('Expected 8 RTX 5090 OptiX GPUs, found '+str(len(selected)))
chosen = {d.id for d in selected}
for d in prefs.devices:
    d.use = d.id in chosen
scene.render.resolution_x, scene.render.resolution_y = 1280, 960
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
scene.render.filepath = str(destination / 'campus-grass-close.png')
# An independent object-index mask measures exposed soil. Shadows and colour
# changes cannot count as extra grass coverage in this check.
for obj in bpy.data.objects:
    obj.pass_index = 1 if obj.name == 'Campus ground at root plane' else 2
bpy.context.view_layer.use_pass_object_index = True
scene.use_nodes = True
nodes, links = scene.node_tree.nodes, scene.node_tree.links
nodes.clear()
render_layers = nodes.new('CompositorNodeRLayers')
composite = nodes.new('CompositorNodeComposite')
links.new(render_layers.outputs['Image'], composite.inputs['Image'])
mask = nodes.new('CompositorNodeIDMask')
mask.index = 1
mask.use_antialiasing = True
links.new(render_layers.outputs['IndexOB'], mask.inputs['ID value'])
mask_file = nodes.new('CompositorNodeOutputFile')
mask_file.base_path = str(destination)
mask_file.file_slots[0].path = 'ground-visible-'
mask_file.format.file_format = 'PNG'
mask_file.format.color_mode = 'BW'
links.new(mask.outputs['Alpha'], mask_file.inputs[0])
observed = []
stop = threading.Event()
started = time.monotonic()
def sample():
    while not stop.is_set():
        try:
            output = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid,gpu_uuid,used_memory', '--format=csv,noheader,nounits'], text=True, timeout=4)
            rows = []
            for pid, uuid, mem in csv.reader(output.splitlines()):
                if pid.strip() == str(os.getpid()):
                    rows.append({'gpuUuid':uuid.strip(), 'processMiB':mem.strip()})
            observed.append({'seconds':round(time.monotonic()-started, 2), 'devices':rows})
        except Exception as exc:
            observed.append({'error':type(exc).__name__})
        stop.wait(1)
thread = threading.Thread(target=sample, daemon=True)
thread.start()
try:
    bpy.ops.render.render(write_still=True)
finally:
    stop.set()
    thread.join(5)
image = destination / 'campus-grass-close.png'
mask_path = destination / 'ground-visible-0001.png'
soil_mask = bpy.data.images.load(str(mask_path))
width, height = soil_mask.size
values = list(soil_mask.pixels)
# Bottom half of the fixed camera, excluding the sky; Blender pixel rows start
# at the bottom, so this ROI is [0, height/2) in the decoded mask.
soil_fraction = sum(values[4*i] for i in range(width*(height//2))) / (width*(height//2))
receipt = {'purpose':'Layout-experiment grass geometry offline QA; not a new capture reconstruction',
    'sourceGlbSha256':hashlib.sha256(raw).hexdigest(), 'imageSha256':hashlib.sha256(image.read_bytes()).hexdigest(),
    'image':image.name, 'blender':bpy.app.version_string, 'engine':'Cycles OptiX', 'samples':32,
    'resolution':[1280,960], 'camera':'Campus grass close', 'windSpeed':0,
    'tuftGroups':groups, 'persistentRoots':sum(groups.values()), 'configuredGPUCount':len(selected),
    'observedGpuUuids':sorted({d['gpuUuid'] for row in observed for d in row.get('devices', [])}),
    'processId':os.getpid(), 'elapsedSeconds':round(time.monotonic()-started, 2), 'gpuSamples':observed,
    'visibleSoilFractionBottomHalf':soil_fraction, 'coverageMethod':'Cycles object-index soil mask; fixed camera bottom-half ROI; not a colour or shadow threshold',
    'limits':'Full-detail blades at all roots; web view uses camera LOD. No tree occluders in this isolated grass render. Lighting and AgX differ from the browser renderer.'}
(destination / 'campus-grass-close-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
print('CAMPUS_GRASS_QA', json.dumps({k:v for k,v in receipt.items() if k!='gpuSamples'}), flush=True)
