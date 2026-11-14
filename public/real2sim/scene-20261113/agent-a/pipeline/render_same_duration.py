#!/usr/bin/env python3
"""Render a time-aligned Agent A appearance preview from the assembled Blender scene.

The source video has no single globally registered camera trajectory in the current
reconstruction: COLMAP contains disconnected components.  This tool therefore
creates a smooth, explicitly labelled inferred orbit, while using any ref260/ref270
camera objects as optional anchors.  It preserves the source duration, portrait
resolution and 30 fps timebase so the result can be compared against the original.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--blend", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--source-video", default="")
    p.add_argument("--cameras-json", default="")
    p.add_argument("--duration", type=float, default=286.325)
    p.add_argument("--sample-fps", type=float, default=2.0)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--width", type=int, default=544)
    p.add_argument("--height", type=int, default=960)
    p.add_argument("--crf", type=int, default=21)
    p.add_argument("--resume", action="store_true")
    p.add_argument("--no-interpolate", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    return p.parse_args(argv)


def world_bbox():
    lo = Vector((float("inf"), float("inf"), float("inf")))
    hi = Vector((float("-inf"), float("-inf"), float("-inf")))
    count = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        name = obj.name.lower()
        # Ignore visual sky/environment shells when fitting the site orbit.
        # A sky sphere can be hundreds of metres across and would otherwise
        # pull the inferred camera path far away from the reconstructed site.
        if any(token in name for token in ("sky", "environment", "skysphere")):
            continue
        if max(float(v) for v in obj.dimensions) > 200.0:
            continue
        for corner in obj.bound_box:
            v = obj.matrix_world @ Vector(corner)
            lo.x = min(lo.x, v.x); lo.y = min(lo.y, v.y); lo.z = min(lo.z, v.z)
            hi.x = max(hi.x, v.x); hi.y = max(hi.y, v.y); hi.z = max(hi.z, v.z)
            count += 1
    if not count:
        return Vector((0, 0, 0)), Vector((20, 20, 10))
    return lo, hi


def look_at(obj, eye: Vector, target: Vector):
    obj.location = eye
    obj.rotation_euler = (target - eye).to_track_quat("-Z", "Y").to_euler()


def find_camera(names):
    lower = {o.name.lower(): o for o in bpy.context.scene.objects if o.type == "CAMERA"}
    for wanted in names:
        for name, obj in lower.items():
            if wanted.lower() in name:
                return obj
    return None


def prepare_camera(scene, lo, hi):
    cam = find_camera(["ref260", "ref270", "camera", "cam"])
    if cam is None:
        data = bpy.data.cameras.new("A_SameDuration_Camera")
        cam = bpy.data.objects.new("A_SameDuration_Camera", data)
        bpy.context.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = float(getattr(cam.data, "lens", 50.0) or 50.0)
    cam.data.sensor_width = float(getattr(cam.data, "sensor_width", 36.0) or 36.0)
    return cam


def build_orbit(cam, lo, hi, duration):
    # Prefer the two solved review cameras that are already in final-scene.
    # They share the scene frame and keep the delivery preview in a useful
    # close range; the repeated segment remains explicitly inferred.
    c0 = find_camera(["ref260"])
    c1 = find_camera(["ref270"])
    if c0 is not None and c1 is not None:
        m0 = c0.matrix_world.copy()
        m1 = c1.matrix_world.copy()
        q0 = m0.to_quaternion()
        q1 = m1.to_quaternion()
        p0 = m0.translation.copy()
        p1 = m1.translation.copy()
        def anchored_pose(t):
            cycle = (t % 42.0) / 42.0
            if cycle <= 0.5:
                f = 0.5 - 0.5 * math.cos(math.pi * (cycle * 2.0))
                loc = p0.lerp(p1, f)
                quat = q0.slerp(q1, f)
            else:
                f = 0.5 - 0.5 * math.cos(math.pi * ((cycle - 0.5) * 2.0))
                loc = p1.lerp(p0, f)
                quat = q1.slerp(q0, f)
            mat = quat.to_matrix().to_4x4()
            mat.translation = loc
            return mat
        return anchored_pose, "anchored_ref260_ref270_cycle"

    center = (lo + hi) * 0.5
    span = max(hi.x - lo.x, hi.y - lo.y, 1.0)
    radius = max(span * 0.28, 4.0)
    zbase = max(lo.z + (hi.z - lo.z) * 0.34, 1.25)
    zamp = max((hi.z - lo.z) * 0.06, 0.18)
    original_location = cam.matrix_world.translation.copy()
    start_angle = math.atan2(original_location.y - center.y, original_location.x - center.x)
    turns = 0.86
    def fallback_pose(t):
        u = max(0.0, min(1.0, t / duration))
        angle = start_angle + 2.0 * math.pi * turns * u
        r = radius * (1.0 + 0.035 * math.sin(2.0 * math.pi * u))
        eye = Vector((center.x + r * math.cos(angle), center.y + r * math.sin(angle), zbase + zamp * math.sin(2.0 * math.pi * u + 0.7)))
        target = center + Vector((0, 0, (hi.z - lo.z) * 0.05))
        return eye, target
    return fallback_pose, "inferred_smooth_orbit_site_bounds"

def configure_render(scene, args):
    engines = {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    if "BLENDER_EEVEE_NEXT" in engines:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    elif "BLENDER_EEVEE" in engines:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.fps = args.fps
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.quality = 92
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.render.image_settings.color_depth = "8"
    if hasattr(scene, "eevee"):
        if hasattr(scene.eevee, "taa_render_samples"):
            scene.eevee.taa_render_samples = 32


def render_samples(scene, cam, pose, args, frames_dir):
    frames_dir.mkdir(parents=True, exist_ok=True)
    count = int(math.floor(args.duration * args.sample_fps)) + 1
    meta = []
    for i in range(count):
        t = min(i / args.sample_fps, args.duration)
        frame_path = frames_dir / f"frame_{i:05d}.jpg"
        if args.resume and frame_path.exists() and frame_path.stat().st_size > 1000:
            continue
        pose_value = pose(t)
        if isinstance(pose_value, tuple):
            eye, target = pose_value
            look_at(cam, eye, target)
        else:
            cam.matrix_world = pose_value
        scene.frame_set(min(int(round(t * args.fps)), int(round(args.duration * args.fps))))
        scene.render.filepath = str(frame_path)
        bpy.ops.render.render(write_still=True)
        meta.append({"index": i, "time_seconds": round(t, 6), "path": str(frame_path)})
        if i % 20 == 0:
            print(f"rendered {i + 1}/{count} samples", flush=True)
    return count


def encode(frames_dir, out_mp4, args):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for the 30fps delivery video")
    vf = f"scale={args.width}:{args.height}:flags=lanczos,format=yuv420p"
    if not args.no_interpolate:
        vf += ",minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "warning", "-framerate", str(args.sample_fps), "-i", str(frames_dir / "frame_%05d.jpg"), "-vf", vf, "-t", f"{args.duration:.3f}", "-r", str(args.fps), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", str(args.crf), "-movflags", "+faststart", str(out_mp4)]
    subprocess.run(cmd, check=True)


def main():
    args = parse_args()
    out = Path(args.out_dir).resolve()
    frames = out / "sample-frames"
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.blend).resolve()))
    scene = bpy.context.scene
    lo, hi = world_bbox()
    cam = prepare_camera(scene, lo, hi)
    pose, camera_path = build_orbit(cam, lo, hi, args.duration)
    configure_render(scene, args)
    count = render_samples(scene, cam, pose, args, frames)
    out_mp4 = out / "agent-a-sim-same-duration-preview.mp4"
    encode(frames, out_mp4, args)
    receipt = {
        "schema_version": 1,
        "agent_id": "agent-a",
        "artifact": out_mp4.name,
        "source_video": args.source_video,
        "source_duration_seconds": args.duration,
        "output_duration_seconds": args.duration,
        "source_timebase_fps": args.fps,
        "output_timebase_fps": args.fps,
        "resolution": [args.width, args.height],
        "sample_fps": args.sample_fps,
        "sample_count": count,
        "render_engine": scene.render.engine,
        "camera_path": camera_path,
        "camera_registration_note": "The available registration contains disconnected COLMAP components; this preview is time-aligned and duration-matched, but its camera path is inferred and is not claimed as exact pose recovery.",
        "scene_bbox_min": list(lo),
        "scene_bbox_max": list(hi),
        "blend": str(Path(args.blend).resolve()),
        "cameras_json": str(Path(args.cameras_json).resolve()) if args.cameras_json else None,
        "render_backend": "Blender EEVEE + ffmpeg",
    }
    (out / "video-receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"video": str(out_mp4), "receipt": str(out / "video-receipt.json"), "frames": count}, ensure_ascii=False))


if __name__ == "__main__":
    main()
