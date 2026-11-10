"""Transplant the source lamp's seven float-position meshes into the web scene.

Preserve the campus hierarchy, the shared world transform and the collision keys.
The campus decoder still handles compressed objects; new object-local buffers are
ordinary glTF and are independent of the campus-wide quantization grid.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import struct

PARTS = ['ClearFlaredBowl', 'DomedRainCap', 'FrostedOptic', 'HeadCollar', 'InternalRibs', 'Rim', 'TaperedPost']
IDENTITY_TRS = {'translation': [0, 0, 0], 'scale': [1, 1, 1], 'rotation': [0, 0, 0, 1]}

def read_glb(path):
    data = path.read_bytes()
    magic, version, size, js, typ = struct.unpack_from('<4s4I', data)
    if (magic, version, size, typ) != (b'glTF', 2, len(data), 0x4e4f534a):
        raise ValueError(f'Unsupported GLB {path}')
    doc = json.loads(data[20:20+js])
    size, typ = struct.unpack_from('<II', data, 20+js)
    if typ != 0x004e4942 or 28+js+size != len(data):
        raise ValueError('Invalid binary chunk')
    return doc, bytearray(data[28+js:28+js+doc['buffers'][0]['byteLength']])

def write_glb(path, doc, binary):
    doc['buffers'][0]['byteLength'] = len(binary)
    js = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    binary.extend(b'\0' * (-len(binary) % 4))
    path.write_bytes(struct.pack('<4s4I', b'glTF', 2, 28+len(js)+len(binary),len(js),0x4e4f534a)
        + js + struct.pack('<II',len(binary),0x004e4942) + binary)

def transplant(scene, lamp, basebin, lampbin):
    dst = {n.get('name'): n for n in scene['nodes']}
    src = {n.get('name'): n for n in lamp['nodes']}
    basebin.extend(b'\0' * (-len(basebin)%4))
    offset = len(basebin)
    views, attrs = len(scene['bufferViews']), len(scene['accessors'])
    basebin.extend(lampbin)
    for view in lamp['bufferViews']:
        if view['buffer'] != 0 or view.get('extensions'):
            raise ValueError('Expected ordinary object-local buffer')
        scene['bufferViews'].append({**view, 'byteOffset': offset+view.get('byteOffset',0)})
    for a in lamp['accessors']:
        scene['accessors'].append({**a, 'bufferView': views+a['bufferView']})
    oldmats = {m['name']:i for i,m in enumerate(scene['materials']) if 'name' in m}
    material_indices = []
    for mat in lamp['materials']:
        if not mat['name'].startswith('Lamp.'):
            raise ValueError('Non-lamp material in transport')
        if mat['name'] in oldmats:
            i = oldmats[mat['name']]
            scene['materials'][i] = mat
        else:
            i = len(scene['materials'])
            scene['materials'].append(mat)
        material_indices.append(i)
    for ext in lamp.get('extensionsUsed', []):
        if ext not in scene.setdefault('extensionsUsed', []):
            scene['extensionsUsed'].append(ext)
    for part in PARTS:
        name = 'Lamp.' + part
        node = src[name]
        if 'matrix' in node or any(node.get(k,identity)!=identity for k,identity in IDENTITY_TRS.items()):
            raise ValueError(f'Non-identity part transform at {name}')
        mesh = copy.deepcopy(lamp['meshes'][node['mesh']])
        if len(dst[name].get('children', [])) != 1:
            raise ValueError(f'Unexpected original lamp hierarchy at {name}')
        child = scene['nodes'][dst[name]['children'][0]]
        for p in mesh['primitives']:
            if lamp['accessors'][p['attributes']['POSITION']]['componentType'] != 5126:
                raise ValueError('Transport still quantized')
            p['material'] = material_indices[p['material']]
            p['attributes'] = {k:v+attrs for k,v in p['attributes'].items()}
            p['indices'] += attrs
        scene['meshes'][child['mesh']] = mesh
        for key in ('matrix', *IDENTITY_TRS):
            child.pop(key, None)
    scene.setdefault('asset', {}).setdefault('extras', {})['luminaireGeometry'] = 'R6 source object-local float meshes'

def main():
    parser = argparse.ArgumentParser()
    for name in ['scene','lamp','output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.output.resolve() in [args.scene.resolve(), args.lamp.resolve()]:
        raise ValueError('Output must be separate')
    scene, basebin = read_glb(args.scene)
    lamp, lampbin = read_glb(args.lamp)
    if scene.get('asset',{}).get('extras',{}).get('luminaireGeometry'):
        raise ValueError('Lamp is already restored')
    transplant(scene,lamp,basebin,lampbin)
    write_glb(args.output,scene,basebin)
    print(args.output.name, hashlib.sha256(args.output.read_bytes()).hexdigest())

if __name__ == '__main__':
    main()
