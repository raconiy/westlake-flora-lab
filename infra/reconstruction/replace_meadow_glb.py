"""Update the eight distance-dependent grass prototypes of the release GLB.

Only the turf prototype accessors and its per-instance incident colors may change.
All other geometry, the archived camera, planted transforms and binary resources
are retained, including the compressed tree buffers.
"""
import argparse
import copy
import hashlib
import json
import struct
from pathlib import Path


def unpack(path):
    raw = path.read_bytes()
    magic, version, total, count, kind = struct.unpack_from('<4s4I', raw)
    if (magic, version, total, kind) != (b'glTF', 2, len(raw), 0x4e4f534a):
        raise ValueError('Invalid GLB')
    doc = json.loads(raw[20:20+count])
    length, kind = struct.unpack_from('<II', raw, 20+count)
    if kind != 0x004e4942 or 28+count+length != total:
        raise ValueError('Missing binary payload')
    return doc, bytearray(raw[28+count:])


def packed(doc, blob):
    blob += bytes(-len(blob) % 4)
    doc['buffers'][0]['byteLength'] = len(blob)
    header = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
    header += b' ' * (-len(header) % 4)
    return (struct.pack('<4s4I', b'glTF', 2, 28+len(header)+len(blob), len(header), 0x4e4f534a)
            + header + struct.pack('<II', len(blob), 0x004e4942) + blob)


def data(doc, blob, acc):
    view = doc['bufferViews'][doc['accessors'][acc]['bufferView']]
    if view['buffer'] != 0 or 'extensions' in view:
        raise ValueError('Expected plain, contiguous template accessors')
    start = view.get('byteOffset', 0)
    return blob[start:start+view['byteLength']]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


parser = argparse.ArgumentParser()
for name in ('base', 'grass', 'result', 'receipt'):
    parser.add_argument(name, type=Path)
args = parser.parse_args()
if args.base.resolve() == args.result.resolve():
    raise ValueError('Output must be distinct from the original GLB')
base, blob = unpack(args.base)
grass, binary = unpack(args.grass)
names = {n['name']: n for n in base['nodes'] if n.get('name', '').startswith('Turf blades ')}
results = []


def replace(dst, src):
    old = base['accessors'][dst]
    view_id = old['bufferView']
    if sum(a.get('bufferView') == view_id for a in base['accessors']) != 1:
        raise ValueError('Grass accessor aliases another view')
    view = base['bufferViews'][view_id]
    if view.get('extensions'):
        raise ValueError('A compressed grass template is unsupported')
    new = copy.deepcopy(grass['accessors'][src])
    new_view = copy.deepcopy(grass['bufferViews'][new['bufferView']])
    payload = data(grass, binary, src)
    if view['byteLength'] == len(payload):
        start = view.get('byteOffset', 0)
        blob[start:start+len(payload)] = payload
    else:
        blob.extend(bytes(-len(blob)%4))
        start = len(blob)
        blob.extend(payload)
    new_view['byteOffset'] = start
    new['bufferView'] = view_id
    base['bufferViews'][view_id] = new_view
    base['accessors'][dst] = new


for n in grass['nodes']:
    ext = n.get('extensions', {}).get('EXT_mesh_gpu_instancing')
    if not ext:
        continue
    target = names[n['name']]
    old_attributes = target['extensions']['EXT_mesh_gpu_instancing']['attributes']
    new_attributes = ext['attributes']
    for key in ('TRANSLATION', 'ROTATION', 'SCALE'):
        if data(base, blob, old_attributes[key]) != data(grass, binary, new_attributes[key]):
            raise ValueError('Changed planting transform: '+key)
    replace(old_attributes['_COLOR_0'], new_attributes['_COLOR_0'])
    old, = base['meshes'][target['mesh']]['primitives']
    new, = grass['meshes'][n['mesh']]['primitives']
    for key in new['attributes']:
        replace(old['attributes'][key], new['attributes'][key])
    replace(old['indices'], new['indices'])
    old['extras'] = new['extras']
    if base['materials'][old['material']] != grass['materials'][new['material']]:
        raise ValueError('Unexpected change to the shared grass surface material')
    results.append(n['name'])
if len(results) != len(names) or not results:
    raise ValueError('A template group was lost')
base['asset']['extras']['lawnBladeModel'] = {'basis': 'Managed fine turf prior; campus species and leaf dimensions unmeasured.',
    'meadowAttachmentSha256': sha(args.grass), 'geometry': 'Arch-length curved blades, partly clipped tips, fixed basal sockets.'}
args.result.write_bytes(packed(base, blob))
args.receipt.write_text(json.dumps({'sourceModelSha256': sha(args.base), 'attachmentSha256': sha(args.grass),
    'combinedSha256': sha(args.result), 'verifiedUnchangedAttributes': ['TRANSLATION', 'ROTATION', 'SCALE'],
    'templates': results}, indent=2)+'\n')
