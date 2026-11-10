"""Export Z-up static contact geometry and test impacts with Blender Bullet.
blender -b yungu-lawn.blend --python-exit-code 1 --python collision_world.py -- OUTPUT
"""
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

import bpy
from mathutils import Vector

out = Path(sys.argv[sys.argv.index("--") + 1])
out.mkdir(parents=True, exist_ok=True)
source = Path(bpy.data.filepath)
with source.open("rb") as handle:
    source_digest = hashlib.file_digest(handle,"sha256").hexdigest()
parts = []
lamp_reports = []
ground_up = Vector((0, 0, 1))
segments = 32


def add(name, kind, start, end, radius, rings=None):
    start, end = Vector(start), Vector(end)
    if radius <= 0 or (end - start).length < 1e-7:
        raise ValueError(f"Invalid contact dimensions for {name}")
    p = dict(name=name, kind=kind, start=start, end=end, radius=float(radius), rings=rings)
    parts.append(p)
    return p


def revolve_profile(child, base, axis):
    # Use real vertices. A rotated world-space bounding box couples radius to mast
    # height and also includes the empty corners of round meshes.
    evaluated = child.evaluated_get(bpy.context.evaluated_depsgraph_get())
    profile = {}
    for vertex in evaluated.data.vertices:
        offset = evaluated.matrix_world @ vertex.co - base
        height = offset.dot(axis)
        radius = (offset - height * axis).length
        ring = round(height, 4)
        profile[ring] = max(profile.get(ring, 0), radius)
    return sorted(profile.items())


for obj in bpy.context.scene.objects:
    tf = obj.matrix_world
    base = tf.translation.copy()
    if obj.get("shape") == "capsule" and "end_local" in obj:
        local_end = Vector(obj["end_local"])
        direction = local_end.normalized()
        radial = direction.orthogonal().normalized()
        radial2 = direction.cross(radial).normalized()
        scale = max((tf.to_3x3() @ radial).length, (tf.to_3x3() @ radial2).length)
        add(obj.name, "capsule", base, tf @ local_end, obj["radius"] * scale)
    elif obj.get("asset_class") == "fixed path luminaire":
        axis = (tf.to_3x3() @ ground_up).normalized()
        source_axis = obj.get("captured_axis_blender")
        if source_axis is not None and axis.angle(Vector(source_axis).normalized()) > math.radians(.1):
            raise ValueError("Lamp transform and captured axis disagree")
        surfaces = {}
        for child in obj.children_recursive:
            if child.type != "MESH":
                continue
            label = child.name.lower()
            # Internal optic and support ribs sit inside the closed exterior.
            for token, role in (("post", "pole"), ("collar", "collar"), ("bowl", "bowl"), ("rim", "rim"), ("cap", "cap"), ("hood", "cap")):
                if token in label:
                    surfaces[role] = revolve_profile(child, base, axis)
                    break
        for required in ("pole", "rim", "cap"):
            if required not in surfaces or len(surfaces[required]) < 2:
                raise ValueError("Missing lamp exterior: " + required)
        for role, profile in surfaces.items():
            # The flared diffuser and neck collar are concave in side elevation.
            # Individual frusta preserve their waists.
            groups = [profile[i:i+2] for i in range(len(profile)-1)] if role in ("bowl","collar") else [profile]
            for index, g in enumerate(groups):
                low, high = g[0][0], g[-1][0]
                midpoint = (low + high) / 2
                name = obj.name + "-" + role + (f"-{index+1}" if len(groups)>1 else "")
                add(name, "revolved_hull", base+axis*low, base+axis*high, max(r for _,r in g),
                    [(h-midpoint, r) for h,r in g])
        low, high = surfaces["pole"][0][0], surfaces["cap"][-1][0]
        lamp_reports.append(dict(name=obj.name, base=list(base), axis=list(axis), tilt_from_up_deg=math.degrees(axis.angle(ground_up)),
            below_ground_post_tip=list(base+axis*low), cap_tip=list(base+axis*high), profiles_h_radius_m=surfaces,
            radial_sides=segments, max_ring_sagitta_m=max(r for profile in surfaces.values() for _,r in profile)*(1-math.cos(math.pi/segments))))
    elif obj.get("asset_class") == "adjustable landscape light":
        # A conservative envelope includes the tilted, offset landscape fixture head.
        axis = (tf.to_3x3() @ ground_up).normalized()
        profile = [ring for child in obj.children_recursive if child.type == "MESH" for ring in revolve_profile(child,base,axis)]
        add(obj.name, "cylinder", base, base+axis*max(h for h,_ in profile), max(r for _,r in profile))

trunks = [p for p in parts if p["kind"]=="capsule"]
cap = next(p for p in parts if p["name"].endswith("-cap"))
if not trunks or not lamp_reports:
    raise ValueError("Scene requires trunk and lamp proxies")


def values(items):
    return " ".join(f"{x:.9g}" for x in items)


def hull_points(rings):
    return [(radius * math.cos(i * math.tau/segments),radius * math.sin(i * math.tau/segments),height)
            for height,radius in rings for i in range(segments)]


def hull_faces(count):
    faces = [tuple(reversed(range(segments))),tuple(range((count-1)*segments,count*segments))]
    for ring in range(count-1):
        for i in range(segments):
            low = ring*segments+i
            nxt = ring*segments+(i+1)%segments
            faces.append((low,nxt,nxt+segments,low+segments))
    return faces


doc=ET.Element("mujoco",model="Yungu lawn contact geometry")
ET.SubElement(doc,"option",gravity="0 0 -9.81",timestep="0.002")
ET.SubElement(ET.SubElement(doc,"default"),"geom",friction=".65 .005 .0001",condim="3")
assets=ET.SubElement(doc,"asset")
world=ET.SubElement(doc,"worldbody")
ET.SubElement(world,"geom",name="ground",type="plane",size="80 80 .1",rgba=".29 .41 .17 1")
for p in parts:
    a,b=p["start"],p["end"]
    if p["rings"]:
        mesh=p["name"]+"-mesh"
        vertices=hull_points(p["rings"])
        ET.SubElement(assets,"mesh",name=mesh,vertex=values(component for xyz in vertices for component in xyz))
        ET.SubElement(world,"geom",name=p["name"],type="mesh",mesh=mesh,pos=values((a+b)/2),
                      quat=values((b-a).to_track_quat("Z","Y")),rgba=".40 .43 .45 1")
    else:
        ET.SubElement(world,"geom",name=p["name"],type=p["kind"],fromto=values([*a,*b]),size=values([p["radius"]]),rgba=".40 .33 .25 1")
ET.indent(doc)
xml=out/"contact-world.xml"
ET.ElementTree(doc).write(xml,encoding="utf-8",xml_declaration=True)

# The illustrative mesh is removed. Bullet sees the same profile rings as MJCF.
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.fps=120
scene.frame_end=180


def rigid(name, shape, active=False):
    obj=bpy.context.object
    obj.name=name
    bpy.ops.rigidbody.object_add()
    body=obj.rigid_body
    body.type="ACTIVE" if active else "PASSIVE"
    body.collision_shape=shape
    body.restitution=0
    body.friction=.65
    body.use_margin=True
    body.collision_margin=.0005
    return obj


bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,-.1))
bpy.context.object.dimensions=(180,180,.2)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
rigid("ground","BOX")
for p in parts:
    start,end=p["start"],p["end"]
    axis=end-start
    if p["rings"]:
        mesh=bpy.data.meshes.new(p["name"])
        mesh.from_pydata(hull_points(p["rings"]),[],hull_faces(len(p["rings"])));mesh.update()
        obj=bpy.data.objects.new(p["name"],mesh)
        bpy.context.collection.objects.link(obj)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True);bpy.context.view_layer.objects.active=obj
        obj.location=(start+end)/2;obj.rotation_euler=axis.to_track_quat("Z","Y").to_euler()
        rigid(p["name"],"CONVEX_HULL")
    else:
        bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=p["radius"],depth=axis.length,location=(start+end)/2)
        bpy.context.object.rotation_euler=axis.to_track_quat("Z","Y").to_euler()
        rigid(p["name"],"CYLINDER")
        if p["kind"]=="capsule":
            for tag,extreme in (("base",start),("tip",end)):
                bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=p["radius"],location=extreme)
                rigid(p["name"]+"-"+tag,"SPHERE")

radius=.06
trunk=next((p for p in trunks if "foreground" in p["name"]),trunks[0])
checks=[]
def drop(label,target,hit_geom):
    target=Vector(target)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=radius,location=target+ground_up*.75)
    obj=rigid("probe-"+str(len(checks)),"SPHERE",True)
    obj.rigid_body.mass=.1
    checks.append(dict(surface=label,target=list(target),source_geom=hit_geom,obj=obj,previous_z=None,previous_v=0,impact=None))
drop("flat ground",(-16,3,0),"ground")
drop("lamp cap",cap["end"],cap["name"])
drop("upper end of trunk proxy",trunk["end"]+ground_up*trunk["radius"],trunk["name"])
scene.rigidbody_world.substeps_per_frame=3
scene.rigidbody_world.solver_iterations=25
for frame in range(1,151):
    scene.frame_set(frame);bpy.context.view_layer.update()
    for q in checks:
        pos=q["obj"].matrix_world.translation
        z=pos.z
        if q["previous_z"] is not None:
            v=(z-q["previous_z"])*scene.render.fps
            if q["impact"] is None and q["previous_v"]<-.5 and v-q["previous_v"]>.25:
                q["impact"]={"frame":frame,"center_world":list(pos),"error_m":abs(z-(q["target"][2]+radius))}
            q["previous_v"]=v
        q["previous_z"]=z
results=[]
for q in checks:
    q.pop("obj");q.pop("previous_z");q.pop("previous_v")
    q["expected_first_contact_center_z_m"]=q["target"][2]+radius
    results.append(q)
with source.open("rb") as handle:
    if hashlib.file_digest(handle,"sha256").hexdigest() != source_digest:
        raise RuntimeError("Source .blend changed during export")
report=dict(source_blend=source.name,source_blend_sha256=source_digest,
            exporter_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            xml_sha256=hashlib.sha256(xml.read_bytes()).hexdigest(),generated_at_utc=datetime.now(timezone.utc).isoformat(),
            coordinates="Blender Z-up; scene scale is an engineering assumption",engine="Blender "+bpy.app.version_string+" Bullet",frames=150,
            fps=120,timestep_s=1/360,gravity_m_s2=-9.81,proxies=len(parts),tree_stems=len(trunks),lamps=lamp_reports,probe_radius_m=radius,probes=results,
            scope="Synthetic first impact with coarse static obstacles and planar ground. A sphere can roll off a tilted/domed cap; final rest height is not a cap measurement.")
(out/"contact-check.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({q["surface"]:q["impact"] for q in results}))
if any(not q["impact"] or q["impact"]["error_m"]>.015 for q in results):
    raise RuntimeError("First-impact tests exceed 15 mm synthetic tolerance")
