"""Render the registered camera and a 31 cm lawn inspection on the eight local OptiX GPUs."""
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

import bpy
from mathutils import Vector


def digest(path):
    with open(path, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def sample_devices(pid, started, stop, observations):
    def rows(option):
        command = ['nvidia-smi', option, '--format=csv,noheader,nounits']
        return [list(map(str.strip, line)) for line in csv.reader(subprocess.check_output(command, text=True).splitlines())]
    while not stop.is_set():
        try:
            metrics = rows('--query-gpu=index,uuid,utilization.gpu')
            active = {uuid: int(mem) for proc, uuid, mem in rows('--query-compute-apps=pid,gpu_uuid,used_memory') if proc == str(pid) and mem.isdigit()}
            observations.append({'seconds': round(time.monotonic()-started, 2),
                                 'devices': [{'index': int(index), 'deviceBusyPct': int(busy), 'processMemoryMiB': active[uuid]}
                                             for index, uuid, busy in metrics if uuid in active and busy.isdigit()]})
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            observations.append({'seconds': round(time.monotonic()-started, 2), 'sampleError': str(error)})
        stop.wait(1)


def close_camera(scene):
    cam = bpy.data.cameras.new('Mown lawn inspection')
    obj = bpy.data.objects.new(cam.name, cam)
    scene.collection.objects.link(obj)
    # Three.js world [x,y,z] to the Blender frame [x,-z,y].
    eye, target = Vector((3.1, 1.8, .31)), Vector((1.0, 3.65, .07))
    obj.location = eye
    obj.rotation_euler = (target-eye).to_track_quat('-Z', 'Y').to_euler()
    cam.sensor_fit = 'HORIZONTAL'
    cam.lens = cam.sensor_width / (2 * math.tan(math.radians(52) / 2) * 1.5)
    cam.clip_start = .012
    return obj


def render(scene, camera, label, size, samples, destination):
    scene.camera = camera
    scene.cycles.samples = samples
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    image = destination / (label+'.png')
    scene.render.filepath = str(image)
    scene.render.image_settings.file_format = 'PNG'
    observations = []
    begin, stop = time.monotonic(), threading.Event()
    observer = threading.Thread(target=sample_devices, args=(os.getpid(), begin, stop, observations), daemon=True)
    observer.start()
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        stop.set()
        observer.join(8)
    by_index = {}
    for row in observations:
        for d in row.get('devices', []):
            peak = by_index.setdefault(d['index'], {'maxProcessMemoryMiB': 0, 'maxDeviceBusyPct': 0})
            peak['maxProcessMemoryMiB'] = max(peak['maxProcessMemoryMiB'], d['processMemoryMiB'])
            peak['maxDeviceBusyPct'] = max(peak['maxDeviceBusyPct'], d['deviceBusyPct'])
    details = {'sourceBlend': Path(bpy.data.filepath).name, 'sourceBlendSha256': digest(bpy.data.filepath),
               'image': image.name, 'sha256': digest(image), 'camera': camera.name, 'resolution': size,
               'samples': samples, 'elapsedSeconds': round(time.monotonic()-begin, 2), 'pid': os.getpid(),
               'blender': bpy.app.version_string, 'backend': 'OPTIX', 'pidObservedOnDeviceIndices': sorted(by_index),
               'peakByIndex': by_index, 'samplesByTime': observations, 'sparseV2BladesHidden': True}
    (destination/(label+'-receipt.json')).write_text(json.dumps(details, indent=2)+'\n')
    print('MEADOW_RENDER', label, image.stat().st_size, 'bytes', 'PID resident on', sorted(by_index), flush=True)


parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--view', choices=['both', 'registered', 'close'], default='both')
parser.add_argument('--samples', type=int, default=48)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
folder = args.directory.resolve()
folder.mkdir(exist_ok=True, parents=True)
scene = bpy.context.scene
devices = bpy.context.preferences.addons['cycles'].preferences
devices.compute_device_type = 'OPTIX'
devices.refresh_devices()
selected = [d for d in devices.devices if d.type == 'OPTIX' and '5090' in d.name]
if len(selected) != 8:
    raise RuntimeError('Expected eight RTX 5090 OptiX devices, found %d' % len(selected))
ids = {d.id for d in selected}
for device in devices.devices:
    device.use = device.id in ids
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.use_denoising = True
scene.cycles.transparent_max_bounces = 12
scene.render.threads_mode = 'FIXED'
scene.render.threads = min(20, os.cpu_count() or 1)
for obj in scene.objects:
    if obj.name.startswith('Turf.NearVergeBlades'):
        obj.hide_render = True
meadow = bpy.data.collections.get('Capture17 supplemental meadow')
points = [g for g in meadow.objects if g.get('persistent_tufts')] if meadow else []
actual = sum(len(g.data.vertices) for g in points)
if (len(points) != 4 or not all('near' in g.name and len(g.data.vertices)==g['persistent_tufts'] for g in points)
        or actual != meadow.get('full_field_tufts', actual) or actual != meadow.get('attachment_tufts',actual)):
    raise RuntimeError('The scene must contain four full-detail grass templates and all registered planting points.')
if args.view in ('both', 'registered'):
    render(scene, bpy.data.objects['Photo 01 registered'], 'photo01-optix', (1536, 1152), args.samples, folder)
if args.view in ('both', 'close'):
    render(scene, close_camera(scene), 'grass-close-optix', (1440, 960), args.samples, folder)
