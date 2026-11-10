"""Blender 4+: import the Three.js lawn attachment as native geometry-node instances.

blender -b campus.blend -P import_meadow.py -- meadow.glb campus-with-meadow.blend
The GLB and input BLEND must share the published capture17 coordinate frame.
"""
import argparse
import json
from math import atan2
from pathlib import Path
import struct
import sys

import bpy


def parse_glb(path):
    data = path.read_bytes()
    magic, version, total, json_length, json_type = struct.unpack_from('<4s4I', data)
    if magic != b'glTF' or version != 2 or total != len(data) or json_type != 0x4E4F534A:
        raise ValueError('Expected a binary glTF 2.0 meadow file')
    content = json.loads(data[20:20 + json_length])
    offset = 20 + json_length
    binary_length, binary_type = struct.unpack_from('<II', data, offset)
    if binary_type != 0x004E4942:
        raise ValueError('Missing binary chunk')
    binary = memoryview(data)[offset + 8:offset + 8 + binary_length]

    def read(index):
        a = content['accessors'][index]
        v = content['bufferViews'][a['bufferView']]
        n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
        fmt = struct.Struct('<' + str(n) + {5123: 'H', 5125: 'I', 5126: 'f'}[a['componentType']])
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        step = v.get('byteStride', fmt.size)
        return [fmt.unpack_from(binary, start + j * step) for j in range(a['count'])]

    return content, read


def axis(v):
    return v[0], -v[2], v[1]


def set_color(mesh, name, values):
    attribute = mesh.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    attribute.data.foreach_set('color', [k for v in values for k in (*v[:3], 1.)])


def material():
    mat = bpy.data.materials.new('Capture17 turf blades')
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    blade = nodes.new('ShaderNodeVertexColor')
    blade.layer_name = 'blade_albedo'
    incident = nodes.new('ShaderNodeAttribute')
    incident.attribute_type = 'INSTANCER'
    incident.attribute_name = 'meadow_irradiance'
    combine = nodes.new('ShaderNodeMixRGB')
    combine.blend_type = 'MULTIPLY'
    combine.inputs[0].default_value = 1.
    links.new(blade.outputs['Color'], combine.inputs[1])
    links.new(incident.outputs['Color'], combine.inputs[2])
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = .92
    links.new(combine.outputs[0], bsdf.inputs['Base Color'])
    return mat


def plant(obj, prototype):
    group = bpy.data.node_groups.new(obj.name, 'GeometryNodeTree')
    group.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    group.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    nodes, links = group.nodes, group.links
    start, end = nodes.new('NodeGroupInput'), nodes.new('NodeGroupOutput')
    source = nodes.new('GeometryNodeObjectInfo')
    source.inputs['Object'].default_value = prototype
    copies = nodes.new('GeometryNodeInstanceOnPoints')
    links.new(start.outputs['Geometry'], copies.inputs['Points'])
    links.new(source.outputs['Geometry'], copies.inputs['Instance'])
    for name, socket in [('meadow_euler', 'Rotation'), ('meadow_scale', 'Scale')]:
        val = nodes.new('GeometryNodeInputNamedAttribute')
        val.data_type = 'FLOAT_VECTOR'
        val.inputs['Name'].default_value = name
        links.new(val.outputs['Attribute'], copies.inputs[socket])
    links.new(copies.outputs['Instances'], end.inputs['Geometry'])
    obj.modifiers.new('Instanced tillers', 'NODES').node_group = group


def attach(source):
    doc, read = parse_glb(source)
    collection_name = 'Capture17 supplemental meadow'
    if collection_name in bpy.data.collections:
        raise ValueError('This scene already contains the meadow attachment')
    collection = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(collection)
    turf = material()
    groups = {}
    for node in doc['nodes']:
        ext = node.get('extensions', {}).get('EXT_mesh_gpu_instancing')
        if not ext:
            continue
        p, = doc['meshes'][node['mesh']]['primitives']
        verts = [axis(v) for v in read(p['attributes']['POSITION'])]
        indices = [u[0] for u in read(p['indices'])]
        shape = bpy.data.meshes.new(node['name'] + ' template')
        shape.from_pydata(verts, [], list(zip(indices[::3], indices[1::3], indices[2::3])))
        shape.update()
        set_color(shape, 'blade_albedo', read(p['attributes']['COLOR_0']))
        shape.materials.append(turf)
        prototype = bpy.data.objects.new(shape.name, shape)
        # Deliberately do not link the template into the scene. Its owning node
        # tree retains the datablock without drawing a second tuft at the origin.
        attrs = {k: read(v) for k, v in ext['attributes'].items()}
        pos, rot, scales = (attrs[k] for k in ['TRANSLATION', 'ROTATION', 'SCALE'])
        if any(abs(q[0]) + abs(q[2]) > .00001 for q in rot):
            raise ValueError('Only Y-axis grass rotations are supported')
        if not all(len(v) == len(pos) for v in attrs.values()):
            raise ValueError('Mismatched instance counts')
        mesh = bpy.data.meshes.new(node['name'] + ' roots')
        mesh.from_pydata([axis(v) for v in pos], [], [])
        mesh.update()
        euler = mesh.attributes.new('meadow_euler', 'FLOAT_VECTOR', 'POINT')
        euler.data.foreach_set('vector', [u for q in rot for u in (0., 0., 2*atan2(q[1], q[3]))])
        scale = mesh.attributes.new('meadow_scale', 'FLOAT_VECTOR', 'POINT')
        scale.data.foreach_set('vector', [u for v in scales for u in (v[0], v[2], v[1])])
        set_color(mesh, 'meadow_irradiance', attrs['_COLOR_0'])
        obj = bpy.data.objects.new(node['name'], mesh)
        collection.objects.link(obj)
        plant(obj, prototype)
        obj['persistent_tufts'] = len(pos)
        groups[node['name']] = len(pos)
    if not groups:
        raise ValueError('No EXT_mesh_gpu_instancing grass groups found')
    bpy.context.view_layer.update()
    return groups


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    groups = attach(args.source)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.destination.resolve()), compress=True)
    print('MEADOW_ATTACHMENT', json.dumps({'pointObjects': len(groups), 'tufts': sum(groups.values()), 'groups': groups}))
