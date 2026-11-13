"""Appearance pass 2. Six independent linked roots; estimated metres, Z-up.
Continuous support, upward-wound surfaces, clipped foreground paving and fine turf.
"""
from __future__ import annotations
import math
import random
import bpy

SEED = 24117
TAU = 2 * math.pi
PATHS = [((-25.5, -17.2), (25.5, 17.2)), ((-25.5, 17.2), (25.5, -17.2))]


def _material(name, color, roughness=.85, metallic=0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color[:3], 1)
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metallic
    mat.diffuse_color = (*color[:3], 1)
    return mat


def _root(name, category):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    ob['asset_id'] = name
    ob['category'] = category
    ob['appearance_pass'] = 2
    return ob


def _mesh(name, verts, faces, mats, root, indices=None, smooth=False):
    me = bpy.data.meshes.new(name + '_mesh')
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = root
    for mat in mats if isinstance(mats, list) else [mats]:
        me.materials.append(mat)
    for i, p in enumerate(me.polygons):
        if indices is not None:
            p.material_index = indices[i]
        p.use_smooth = smooth
    return ob


def _box(v, f, center, size, z0, z1, angle=0):
    """Closed slab with outward normals; old box top winding faced down."""
    cx, cy = center
    sx, sy = size[0]/2, size[1]/2
    ca, sa = math.cos(angle), math.sin(angle)
    start = len(v)
    for z in [z0, z1]:
        for x, y in [(-sx,-sy),(sx,-sy),(sx,sy),(-sx,sy)]:
            v.append((cx+x*ca-y*sa, cy+x*sa+y*ca, z))
    for face in [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
        f.append(tuple(start+i for i in face))


def _solid_polygon(v, f, xy, z0, z1):
    if len(xy)<3:
        return
    start, n = len(v), len(xy)
    v.extend([(x,y,z0) for x,y in xy]);v.extend([(x,y,z1) for x,y in xy])
    f.append(tuple(start+i for i in reversed(range(n))))
    f.append(tuple(start+n+i for i in range(n)))
    for i in range(n):
        j=(i+1)%n;f.append((start+i,start+j,start+n+j,start+n+i))


def _annulus(v, f, inner, outer, z0, z1, count=256, amin=0, amax=TAU):
    """Closed continuous elliptical strip, quads on top consistently face up."""
    for i in range(count):
        a=amin+(amax-amin)*i/count;b=amin+(amax-amin)*(i+1)/count
        xy=[(inner[0]*math.cos(a),inner[1]*math.sin(a)),
            (outer[0]*math.cos(a),outer[1]*math.sin(a)),
            (outer[0]*math.cos(b),outer[1]*math.sin(b)),
            (inner[0]*math.cos(b),inner[1]*math.sin(b))]
        _solid_polygon(v,f,xy,z0,z1)


def _cylinder(name, r, h, center, mat, root, sides=20):
    x,y,z=center;v=[];f=[]
    for zz in [z-h/2,z+h/2]:
        v.extend([(x+r*math.cos(TAU*i/sides),y+r*math.sin(TAU*i/sides),zz) for i in range(sides)])
    f.append(tuple(reversed(range(sides))));f.append(tuple(range(sides,2*sides)))
    for i in range(sides):
        j=(i+1)%sides;f.append((i,j,sides+j,sides+i))
    ob=_mesh(name,v,f,mat,root)
    for p in list(ob.data.polygons)[2:]:p.use_smooth=True
    return ob


def _distance_segment(x,y,p0,p1):
    dx,dy=p1[0]-p0[0],p1[1]-p0[1]
    t=max(0,min(1,((x-p0[0])*dx+(y-p0[1])*dy)/(dx*dx+dy*dy)))
    return math.hypot(x-p0[0]-t*dx,y-p0[1]-t*dy)


def _turf_z(x,y):
    return .027+.011*math.sin(x*.19)*math.cos(y*.17)+.006*math.sin(x*.47+y*.31)


def _lawn(root):
    turf=_material('Grass continuous turf',(.15,.30,.085),.94)
    # A single material removes the old alternating triangular patchwork.
    v=[(0,0,_turf_z(0,0))];f=[];nr,na=40,192
    for ring in range(1,nr+1):
        t=ring/nr
        for i in range(na):
            a=TAU*i/na;x,y=28*t*math.cos(a),20*t*math.sin(a)
            v.append((x,y,_turf_z(x,y)))
    for i in range(na):f.append((0,1+i,1+(i+1)%na))
    for r in range(1,nr):
        a0=1+(r-1)*na;a1=1+r*na
        for i in range(na):
            j=(i+1)%na;f.append((a0+i,a1+i,a1+j,a0+j))
    _mesh('central_lawn_ground',v,f,turf,root,smooth=True)
    blade_mats=[_material('Turf blade olive',(.19,.32,.075),.9),
                _material('Turf blade green',(.12,.27,.05),.91),
                _material('Turf blade sunlit',(.25,.38,.095),.88)]
    rng=random.Random(SEED);v=[];f=[];ids=[]
    for _ in range(24000):
        rr=math.sqrt(rng.random())*.994;a=rng.random()*TAU
        x,y=28*rr*math.cos(a),20*rr*math.sin(a)
        # Keep a generous clear strip beyond the 2.16 m path edges.
        if any(_distance_segment(x,y,p0,p1)<1.24 for p0,p1 in PATHS):continue
        h=rng.uniform(.025,.07);w=rng.uniform(.0013,.0030)
        heading=rng.random()*TAU;bend=rng.uniform(.32,.9)*h
        dx,dy=math.cos(heading),math.sin(heading);sx,sy=-dy,dx
        base=len(v);z=_turf_z(x,y)+.001
        # Curved ribbons with varied lean, not giant upright crossed triangles.
        for t in [0,.38,.73]:
            bw=w*(1-t*.72);cx=x+dx*bend*t*t;cy=y+dy*bend*t*t
            v.extend([(cx-sx*bw,cy-sy*bw,z+h*t),(cx+sx*bw,cy+sy*bw,z+h*t)])
        v.append((x+dx*bend,y+dy*bend,z+h*.92))
        f.extend([(base,base+1,base+3,base+2),(base+2,base+3,base+5,base+4),(base+4,base+5,base+6)])
        ids.extend([rng.randrange(3)]*3)
    _mesh('lawn_fine_bent_blades',v,f,blade_mats,root,ids,smooth=True)


def _clip_outside_ellipse(poly, rx, ry):
    """Conservative tangent clip at tile centre; backing fill closes sub-mm seams."""
    cx=sum(x for x,y in poly)/len(poly);cy=sum(y for x,y in poly)/len(poly)
    radius=math.sqrt((cx/rx)**2+(cy/ry)**2)
    if radius<1e-8:return []
    nx=cx/(radius*rx*rx);ny=cy/(radius*ry*ry)
    out=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        da=a[0]*nx+a[1]*ny-1;db=b[0]*nx+b[1]*ny-1
        if da>=0:out.append(a)
        if (da>=0)!=(db>=0):
            t=da/(da-db);out.append((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))
    return out


def _stone_plaza(root):
    mat=_material('Granite continuous pale',(.53,.55,.52),.86)
    backing=_material('Paving foundation fine joints',(.43,.45,.42),.94)
    v=[];f=[]
    _box(v,f,(0,10),(120,140),-.45,-.035)
    _mesh('continuous_surrounding_foundation_120x140',v,f,backing,root)
    v=[];f=[]
    # Continuous bed under all foreground joints, never floating tile islands.
    _box(v,f,(0,-26.5),(63,13),-.035,.049)
    _mesh('foreground_plaza_continuous_bed',v,f,mat,root)
    v=[];f=[];sx,sy,gap=1.10,.55,.010
    for row in range(24):
        ya=-33+row*sy;yb=min(-20,ya+sy-gap)
        if yb<=ya:continue
        for col in range(59):
            xa=-31.5+col*sx-(sx/2 if row%2 else 0);xb=min(31.5,xa+sx-gap);xa=max(-31.5,xa)
            if xb<=xa:continue
            # Precise clipped front apron outside road, never slabs across asphalt.
            poly=_clip_outside_ellipse([(xa,ya),(xb,ya),(xb,yb),(xa,yb)],36.30,28.30)
            _solid_polygon(v,f,poly,.049,.060)
    _mesh('foreground_stone_plaza_clipped',v,f,mat,root)


def _paths(root):
    stone=_material('Path stone fine pavers',(.58,.60,.56),.86)
    joint=_material('Ring stone joint bed',(.48,.50,.47),.92)
    border=_material('Curb pale slim',(.64,.65,.61),.84)
    v=[];f=[];_annulus(v,f,(28,20),(32.25,24.25),-.035,.077)
    _mesh('elliptic_walk_continuous_bed',v,f,joint,root)
    v=[];f=[]
    # True annular sector pavers replace rotated rectangles with ragged overlaps.
    for r in range(6):
        for i in range(240):
            inner=(28+4.25*r/6+.006,20+4.25*r/6+.006)
            outer=(28+4.25*(r+1)/6-.006,20+4.25*(r+1)/6-.006)
            a=TAU*i/240+.00018;b=TAU*(i+1)/240-.00018
            _annulus(v,f,inner,outer,.077,.088,1,a,b)
    _mesh('elliptic_stone_walk_ring',v,f,stone,root)
    v=[];f=[];_annulus(v,f,(27.96,19.96),(28.09,20.09),-.035,.105)
    _mesh('continuous_lawn_paver_border',v,f,border,root)
    for k,(p0,p1) in enumerate(PATHS):
        dx,dy=p1[0]-p0[0],p1[1]-p0[1];length=math.hypot(dx,dy);angle=math.atan2(dy,dx)
        center=((p0[0]+p1[0])/2,(p0[1]+p1[1])/2)
        v=[];f=[];_box(v,f,center,(length,2.19),-.035,.082+k*.002,angle)
        _mesh('cross_path_%d_continuous_bed'%k,v,f,joint,root)
        v=[];f=[];count=math.ceil(length/.8);step=length/count
        for i in range(count):
            t=(i+.5)/count;xy=(p0[0]+dx*t,p0[1]+dy*t)
            _box(v,f,xy,(step-.008,2.16),.082+k*.002,.092+k*.002,angle)
        _mesh('cross_lawn_path_%d_pavers'%k,v,f,stone,root)


def _roads(root):
    asphalt=_material('Asphalt fine aggregate',(.105,.115,.11),.95)
    curb=_material('Curb concrete pale',(.61,.63,.59),.86)
    paint=_material('Road continuous yellow paint',(.91,.67,.065),.77)
    v=[];f=[];_annulus(v,f,(32.5,24.5),(36,28),-.035,.071,320)
    # Join the northern spur below the same road top. No foreground approach slab.
    _box(v,f,(4,35.5),(7,24),-.035,.070)
    _mesh('outer_asphalt_drive',v,f,asphalt,root)
    v=[];f=[];_annulus(v,f,(32.23,24.23),(32.50,24.50),-.035,.132,320)
    _annulus(v,f,(36,28),(36.27,28.27),-.035,.132,320)
    _mesh('elliptic_road_curbs',v,f,curb,root)
    v=[];f=[]
    _annulus(v,f,(35.58,27.58),(35.70,27.70),.072,.0735,384)
    _mesh('continuous_outer_yellow_edge_stripe',v,f,paint,root)


def _lamps(root):
    silver=_material('Lamp pale silver',(.68,.71,.69),.4,.65)
    head=_material('Lamp disk silver cap',(.61,.65,.63),.43,.55)
    diffuser=_material('Lamp ivory diffuser',(.89,.88,.80),.52)
    for i,a in enumerate((12,42,72,108,145,188,225,265,310,345)):
        t=math.radians(a);x,y=30*math.cos(t),22*math.sin(t)
        _cylinder('lamp_base_%02d'%i,.10,.10,(x,y,.14),silver,root)
        _cylinder('lamp_pole_%02d'%i,.038,3.70,(x,y,1.95),silver,root)
        _cylinder('lamp_diffuser_%02d'%i,.195,.038,(x,y,3.80),diffuser,root,32)
        _cylinder('lamp_disk_%02d'%i,.225,.045,(x,y,3.838),head,root,32)


def _bins_signs(root):
    blue=_material('Bin blue enamel',(.028,.20,.41),.58)
    black=_material('Bin black lid',(.025,.033,.032),.79)
    orange=_material('Safety orange',(.84,.27,.055),.67)
    silver=_material('Sign post',(.57,.61,.58),.46,.55)
    for i,(x,y) in enumerate(((-18,-5),(17,2.5))):
        v=[];f=[];_box(v,f,(x,y),(.56,.45),.06,.86)
        ob=_mesh('blue_bin_%02d'%i,v,f,blue,root)
        bevel=ob.modifiers.new('Soft moulded body corners','BEVEL');bevel.width=.025;bevel.segments=2
        v=[];f=[];_box(v,f,(x,y),(.61,.50),.86,.92)
        _box(v,f,(x,y+.22),(.36,.055),.92,.975)
        _box(v,f,(x,y-.228),(.28,.012),.70,.765)
        _mesh('bin_black_lid_handle_%02d'%i,v,f,black,root)
        for sign in [-1,1]:
            _cylinder('bin_foot_%d_%d'%(i,sign),.045,.08,(x+sign*.20,y+.16,.075),black,root,16)
    v=[];f=[];_box(v,f,(22,-8),(.42,.055),.85,1.48)
    _mesh('orange_wayfinding_sign',v,f,orange,root)
    _cylinder('sign_post',.025,1.4,(22,-8,.70),silver,root)


def build():
    roots=[_root('central_lawn','terrain'),_root('stone_plaza','paving'),
           _root('asphalt_road','roads_and_curbs'),_root('paths','paving'),
           _root('lamps','street_furniture'),_root('bins_signs','street_furniture')]
    for root,fn in zip(roots,[_lawn,_stone_plaza,_roads,_paths,_lamps,_bins_signs]):fn(root)
    return roots
