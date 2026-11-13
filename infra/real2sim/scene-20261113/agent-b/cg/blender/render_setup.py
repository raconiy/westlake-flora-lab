"""Agent B (Opus 5.5) — shared render settings: Cycles/OptiX, overcast sky matched to the video, leaf translucency.
The video was shot under thin high cloud (bright diffuse sky, weak sun disc, soft shadows)."""
import bpy, json, pathlib
def cycles(sc, spp=128, w=544, h=960, gpu=True):
    sc.render.engine = "CYCLES"; sc.cycles.samples = spp; sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = w, h; sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Base Contrast"; sc.view_settings.exposure = 0.0
    sc.cycles.max_bounces = 6; sc.cycles.transparent_max_bounces = 16; sc.cycles.diffuse_bounces = 3
    if gpu:
        pr = bpy.context.preferences.addons["cycles"].preferences; pr.compute_device_type = "OPTIX"; pr.get_devices()
        for d in pr.devices: d.use = d.type == "OPTIX"
        sc.cycles.device = "GPU"
def world_sky(sc, sun_elev=28.0, sun_az=200.0, sun_strength=0.35, sky_strength=1.0, turbidity_mix=0.55):
    w = bpy.data.worlds.new("agentb_overcast"); sc.world = w; w.use_nodes = True; nt = w.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    sky = nt.nodes.new("ShaderNodeTexSky"); sky.sky_type = "NISHITA" if hasattr(sky, "sky_type") else sky.sky_type
    import math
    try:
        sky.sky_type = "NISHITA"; sky.sun_elevation = math.radians(sun_elev); sky.sun_rotation = math.radians(sun_az)
        sky.sun_intensity = sun_strength; sky.air_density = 1.0; sky.dust_density = 3.0; sky.sun_disc = True
    except Exception: pass
    # overcast: blend clear sky with a flat bright grey-blue dome (thin cloud)
    grad = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(grad.outputs["Generated"], sep.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); nt.links.new(sep.outputs["Z"], ramp.inputs[0])
    ramp.color_ramp.elements[0].position = 0.45; ramp.color_ramp.elements[0].color = (0.62, 0.66, 0.70, 1)
    ramp.color_ramp.elements[1].position = 0.9; ramp.color_ramp.elements[1].color = (0.50, 0.58, 0.70, 1)
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.inputs["Factor"].default_value = turbidity_mix
    nt.links.new(sky.outputs["Color"], mix.inputs[6]); nt.links.new(ramp.outputs["Color"], mix.inputs[7])
    bg = nt.nodes.new("ShaderNodeBackground"); bg.inputs["Strength"].default_value = sky_strength
    nt.links.new(mix.outputs[2], bg.inputs["Color"]); nt.links.new(bg.outputs[0], out.inputs[0])
    return w
def translucent_leaves():
    """render-time only: mix Principled with Translucent BSDF on materials tagged agentb_translucency"""
    for m in bpy.data.materials:
        t = m.get("agentb_translucency")
        if t is None or not m.use_nodes or m.get("agentb_trans_done"): continue
        nt = m.node_tree; bs = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"); out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
        src = bs.inputs["Base Color"].links[0].from_socket if bs.inputs["Base Color"].links else None
        if src: nt.links.new(src, tr.inputs["Color"])
        mx = nt.nodes.new("ShaderNodeMixShader"); mx.inputs[0].default_value = float(t)
        nt.links.new(bs.outputs[0], mx.inputs[1]); nt.links.new(tr.outputs[0], mx.inputs[2])
        # keep alpha cut-out: transparent where alpha < 0.5
        tp = nt.nodes.new("ShaderNodeBsdfTransparent"); mx2 = nt.nodes.new("ShaderNodeMixShader")
        alpha_src = bs.inputs["Alpha"].links[0].from_socket if bs.inputs["Alpha"].links else None
        if alpha_src:
            gt = nt.nodes.new("ShaderNodeMath"); gt.operation = "GREATER_THAN"; gt.inputs[1].default_value = 0.5
            nt.links.new(alpha_src, gt.inputs[0]); nt.links.new(gt.outputs[0], mx2.inputs[0])
            nt.links.new(tp.outputs[0], mx2.inputs[1]); nt.links.new(mx.outputs[0], mx2.inputs[2]); nt.links.new(mx2.outputs[0], out.inputs[0])
        else: nt.links.new(mx.outputs[0], out.inputs[0])
        m["agentb_trans_done"] = 1

def world_video_sky(sc, image_path, strength=1.0, view="Standard", exposure=0.0):
    """environment = equirectangular sky reconstructed from the video (cg/environment/build_sky.py).
    Background pixels then match the observed sky; illumination is the same dome (LDR, so the clipped sun is
    supplied separately by the measured sun lamp)."""
    w = bpy.data.worlds.new("agentb_video_sky"); sc.world = w; w.use_nodes = True; nt = w.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld"); env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(image_path)); env.interpolation = "Cubic"
    bg = nt.nodes.new("ShaderNodeBackground"); bg.inputs["Strength"].default_value = strength
    nt.links.new(env.outputs["Color"], bg.inputs["Color"]); nt.links.new(bg.outputs[0], out.inputs[0])
    sc.view_settings.view_transform = view; sc.view_settings.look = "None"; sc.view_settings.exposure = exposure
    return w
