"""Refresh native full-resolution mesh counts without changing authored coordinates or material data."""
import bpy
import hashlib
import json
from pathlib import Path
import sys

manifest_path, outfile, receipt = map(Path, sys.argv[sys.argv.index('--') + 1:])
manifest = json.loads(manifest_path.read_text())
counts = manifest['visualHull']['counts']
updated = {}
for name, row in counts.items():
    ob = bpy.data.objects[name]
    vertices = len(ob.data.vertices)
    expected = row['retainedFull']
    if vertices != expected * 5:
        raise ValueError(f'{name}: unexpected blade topology')
    updated[name] = {'previousMetadata': ob.get('physical_blades'), 'fullResolutionBlades': expected}
    ob['physical_blades'] = expected
    ob['capture_support'] = 'Stereo-supported and multi-view free-sky constrained; unobserved interior inferred.'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(outfile), compress=True, copy=True)
def sha(path):
    with open(path,'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()
receipt.write_text(json.dumps({'input': sha(bpy.data.filepath), 'output': sha(outfile), 'metadataOnly': True, 'updates': updated}, indent=2))
