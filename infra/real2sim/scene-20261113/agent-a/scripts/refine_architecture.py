"""Observed facade refinements from video reference-14 (near 260 s)."""
import bpy,math
from mathutils import Vector

def material(name,color,rough=.7):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;return m

def box(v,f,c,size,angle=0):
    b=len(v);ca,sa=math.cos(angle),math.sin(angle)
    for z in [-1,1]:
        for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]:
            xx=x*size[0]/2;yy=y*size[1]/2;v.append((c[0]+ca*xx-sa*yy,c[1]+sa*xx+ca*yy,c[2]+z*size[2]/2))
    f.extend(tuple(b+i for i in face) for face in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
def mesh(name,v,f,mat,parent):
    m=bpy.data.meshes.new(name);m.from_pydata(v,[],f);m.update();o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o);o.parent=parent;m.materials.append(mat);return o

def ellipse_band(name,z0,z1,rx,ry,mat,parent,solid=False):
    v=[];f=[];n=256
    for z in [z0,z1]:
        for i in range(n):
            a=i*math.tau/n;v.append((4+rx*math.cos(a),36+ry*math.sin(a),z))
    for i in range(n):j=(i+1)%n;f.append((i,j,n+j,n+i))
    if solid:f.extend([tuple(range(n-1,-1,-1)),tuple(range(n,2*n))])
    return mesh(name,v,f,mat,parent)

def refine():
    cols=[o for o in bpy.data.objects if o.name.startswith('colonnade_column_') and not any(k in o.name for k in ['base','cap'])]
    if not cols:return
    root=cols[0].parent;concrete=material('Observed pale column concrete',(.62,.65,.63));shadow=material('Facade panel joints',(.25,.28,.27));brown=material('Observed warm bronze spandrel',(.25,.14,.075));fin=material('Observed upper vertical aluminum fins',(.46,.49,.48))
    # Original round pillars were a contact-sheet approximation; close footage resolves rectangular piers.
    for o in cols:
        i=int(o.name.rsplit('_',1)[-1]);a=i*math.tau/46;x=4+25.05*math.cos(a);y=36+11.05*math.sin(a)
        tangent=math.atan2(11.05*math.cos(a),-25.05*math.sin(a))
        v=[];f=[];box(v,f,(x,y,4.34),(0.95,1.55,7.72),tangent)
        old=o.data;me=bpy.data.meshes.new(o.name+'_rectangular');me.from_pydata(v,[],f);me.update();o.data=me;o.location=(0,0,0);o.rotation_euler=(0,0,0);o.scale=(1,1,1);me.materials.append(concrete)
        bevel=o.modifiers.new('Fine column edge','BEVEL');bevel.width=.025;bevel.segments=2
    for o in list(bpy.data.objects):
        if o.name.startswith('colonnade_column_base_') or o.name.startswith('colonnade_column_cap_'):bpy.data.objects.remove(o,do_unlink=True)
    ellipse_band('Continuous portico roof slab',8.12,8.78,25.8,11.8,concrete,root,True)
    ellipse_band('Warm bronze spandrel behind columns',6.55,7.8,23.82,9.87,brown,root)
    ellipse_band('Upper recessed clerestory',8.85,10.65,21.7,8.1,shadow,root,True)
    v=[];f=[]
    for i in range(560):
        a=i*math.tau/560;cx=4+22*math.cos(a);cy=36+8.4*math.sin(a);angle=math.atan2(8.4*math.cos(a),-22*math.sin(a));box(v,f,(cx,cy,9.75),(.065,.24,1.9),angle)
    mesh('Upper vertical louver array',v,f,fin,root)
    v=[];f=[]
    for i in range(46):
        a=i*math.tau/46;x=4+25.05*math.cos(a);y=36+11.05*math.sin(a);ang=math.atan2(11.05*math.cos(a),-25.05*math.sin(a))
        for z in [2.45,4.5,6.55]:box(v,f,(x,y,z),(.955,1.555,.012),ang)
    mesh('Column cladding horizontal seams',v,f,shadow,root)
    root['appearance_reference']='video close facade near 260 s: rectangular piers, warm spandrel, upper vertical fins'
    print('OBSERVED_FACADE_REFINED',len(cols),flush=True)
