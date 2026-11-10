"""Build the two low foreground forms from the campus photographs.

blender -b --factory-startup -P build_lawn_fixtures.py -- /path/to/photos output-dir
Coordinates use the frozen 3.41-m nominal lamp scale. The low dark item's function
and material are unconfirmed. This script mirrors its silhouette only.
"""
import argparse
import json
from pathlib import Path
import sys

import bpy
import numpy as np


# Corners recovered manually in source pixel coordinates, left-top origin.
COVER = {
    '01': [(785,1122),(910,1087),(1007,1101),(882,1140)],
    '02': [(889,955),(1006,920),(1108,936),(988,973)],
    '13': [(1104,1037),(1166,981),(1315,989),(1261,1052)],
}
# Median of the corresponding ground-plane ray intersections in Three.js X/Z.
COVER_WORLD = np.array([[-1.192,3.650],[-.489,2.604],[.103,3.181],[-.627,4.232]])
DARK_WORLD = np.array([[3.023,3.856],[3.284,3.138],[3.851,3.413],[3.509,4.269]])


def texture(sources, corners_by_view, target, name, width, height):
    uv = np.array([(0,0),(1,0),(1,1),(0,1)], float)
    y, x = np.mgrid[0:height,0:width]
    # An inner 1% border keeps grass off the painted surface.
    u = .01 + .98*(x.ravel()+.5)/width
    v = .01 + .98*(y.ravel()+.5)/height
    frames = []
    for stem, corners in corners_by_view.items():
        system = []
        for (a,b),(px,py) in zip(uv,corners):
            system.extend([[a,b,1,0,0,0,-a*px,-b*px], [0,0,0,a,b,1,-a*py,-b*py]])
        h = np.append(np.linalg.solve(np.asarray(system),np.asarray(corners).ravel()),1).reshape(3,3)
        xy = h @ np.vstack((u,v,np.ones_like(v)))
        px,py = xy[0]/xy[2],xy[1]/xy[2]
        image = bpy.data.images.load(str(sources/(stem+'.jpg')))
        w, hgt = image.size
        data = np.empty(w*hgt*4,dtype=np.float32)
        image.pixels.foreach_get(data)
        data = data.reshape(hgt,w,4)[::-1,:,:3]  # Blender stores bottom rows first.
        ix,iy = np.floor(px).astype(int),np.floor(py).astype(int)
        dx,dy = (px-ix)[:,None],(py-iy)[:,None]
        rgb = (1-dx)*(1-dy)*data[iy,ix]+dx*(1-dy)*data[iy,ix+1]+(1-dx)*dy*data[iy+1,ix]+dx*dy*data[iy+1,ix+1]
        frames.append(rgb)
        bpy.data.images.remove(image)
    # The photographed top is shaded. Retain its broad colour and marks with
    # a modest 0.25 EV allowance; the paint reflectance was never measured.
    rgb = np.clip(np.median(frames,axis=0)*2**.25,0,1)
    rgba = np.ones((width*height,4),dtype=np.float32)
    rgba[:,:3] = rgb
    dest = bpy.data.images.new(name,width,height,alpha=False)
    dest.pixels.foreach_set(rgba.ravel())
    dest.filepath_raw = str(target)
    dest.file_format = 'PNG'
    dest.save()
    dest.pack()
    return dest


def paint(name, rgb, rough, image=None):
    mat=bpy.data.materials.new(name)
    mat.use_nodes=True
    shader=mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(*rgb,1)
    shader.inputs['Roughness'].default_value=rough
    if image:
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image=image
        mat.node_tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
    return mat


def make_obj(name, vertices, faces, materials):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vertices,[],faces)
    mesh.update()
    for m in materials:mesh.materials.append(m)
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def bilinear(corners,u,v):
    a,b,c,d=corners
    return (1-u)*(1-v)*a+u*(1-v)*b+u*v*c+(1-u)*v*d


def point(xz,h):
    return float(xz[0]),-float(xz[1]),h


def cover(image):
    # Chamfer the four corners by ~12 mm instead of aliasing a sharp rectangular rim.
    uv=[(.012,0),(.988,0),(1,.018),(1,.982),(.988,1),(.012,1),(0,.982),(0,.018)]
    expand=lambda u,v,h: point(bilinear(COVER_WORLD,u,v),h)
    vertices=[expand(u,v,.001) for u,v in uv]+[expand(u,v,.017) for u,v in uv]
    n=len(uv)
    faces=[tuple(range(n)),tuple(range(2*n-1,n-1,-1))]
    faces += [(i,n+i,n+(i+1)%n,(i+1)%n) for i in range(n)]
    top=paint('Photographed green access cover',(.03,.055,.044),.83,image)
    edge=paint('Access cover exposed rim',(.026,.040,.034),.85)
    obj=make_obj('Capture17 foreground green cover',vertices,faces,[edge,top])
    obj.data.polygons[1].material_index=1
    layer=obj.data.uv_layers.new(name='Photo projective rectification')
    for p in obj.data.polygons:
        for loop in p.loop_indices:
            layer.data[loop].uv=uv[obj.data.loops[loop].vertex_index%n]
    bevel=obj.modifiers.new('Worn rim','BEVEL')
    bevel.width=.0035;bevel.segments=2
    obj['basis']='Four corner markings in photos 01, 02 and 13 intersected with the registered ground plane. Maximum corner disagreement 0.235 m. Estimated thickness 16 mm.'
    obj['photo_files']='01.jpg,02.jpg,13.jpg'
    obj['fixed_to_ground']=True
    return obj


def dark_form():
    # A low, irregular front and folded upper border are visible. Inward and
    # rear surfaces remain inferred. No mechanism or unobserved pipes added.
    outer=[(0,.16),(.13,.02),(.32,.012),(.53,.045),(.80,0),(.97,.04),
           (1,.26),(.975,.58),(.996,.90),(.87,.978),(.56,1),(.20,.95)]
    # Reorder graph anticlockwise around the unit footprint; the rear-left
    # corner has a low rounded outline and the other three vary in height.
    outer.extend([(.035,.84),(-.02,.49)])
    n=len(outer)
    base=[point(bilinear(DARK_WORLD,u,v),.002) for u,v in outer]
    heights=[.109,.122,.110,.113,.106,.130,.106,.081,.145,.105,.075,.082,.080,.070]
    ring=[point(bilinear(DARK_WORLD,.5+(u-.5)*.96,.5+(v-.5)*.96),h) for (u,v),h in zip(outer,heights)]
    interior=[point(bilinear(DARK_WORLD,.50+(u-.5)*.62,.50+(v-.5)*.61),max(.046,h*.60)) for (u,v),h in zip(outer,heights)]
    middle=point(bilinear(DARK_WORLD,.49,.52),.054)
    vertices=base+ring+interior+[middle]
    faces=[tuple(range(n))]
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,n+i,n+j,j),(n+i,2*n+i,2*n+j,n+j),(2*n+i,3*n,2*n+j)])
    mat=paint('Unidentified low object – dark sides',(.009,.014,.013),.91)
    top=paint('Unidentified low object – weathered surface',(.025,.037,.023),.95)
    obj=make_obj('Capture17 low object silhouette – function unknown',vertices,faces,[mat,top])
    for i in range(n):
        obj.data.polygons[3*i+2].material_index=i%3!=0
        obj.data.polygons[3*i+3].material_index=1
    obj['basis']='Visible low dark rim and uneven green-grey top in photo 01 and partial views 02/04. The observable left corner suggests ~0.11–0.14 m under a local vertical assumption; right fringe and rear shape unresolved.'
    obj['fixed_to_ground']=True
    return obj


parser=argparse.ArgumentParser()
parser.add_argument('photos',type=Path)
parser.add_argument('destination',type=Path)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
dst=args.destination.resolve();dst.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
tex=texture(args.photos,COVER,dst/'cover-top.png','Registered cover top',256,160)
objects=[cover(tex),dark_form()]
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.export_scene.gltf(filepath=str(dst/'yungu-ground-fixtures.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True)
bpy.ops.wm.save_as_mainfile(filepath=str(dst/'ground-fixtures.blend'),compress=True)
print('CAPTURE_FIXTURES',json.dumps([o.name for o in objects]))
