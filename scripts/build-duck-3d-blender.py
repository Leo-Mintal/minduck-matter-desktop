"""Build a small 3D walking duck from the untouched Minduck SVG.

The SVG remains the source of every visible front-facing contour. Blender gives
each imported layer real curve thickness and bevels, then animates the feet,
body and root controller as a looping walk cycle.

Example:

    blender -b --python scripts/build-duck-3d-blender.py -- \
      --source src/assets/duck.svg --output build/duck-pet-3d.blend
"""

from __future__ import annotations

import argparse
import copy
import importlib.util
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree as ET

import bpy
from mathutils import Vector


SCRIPT_DIR = Path(__file__).resolve().parent
BASE_PATH = SCRIPT_DIR / "build-duck-blender.py"
SPEC = importlib.util.spec_from_file_location("build_duck_blender_base", BASE_PATH)
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
assert SPEC.loader is not None
SPEC.loader.exec_module(BASE)


SVG_NS = BASE.SVG_NS
PARTS = BASE.PARTS


def parse_args():
    divider = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="src/assets/duck.svg")
    parser.add_argument("--output", default="build/duck-pet-3d.blend")
    return parser.parse_args(sys.argv[divider + 1 :])


def clear_scene():
    BASE.clear_scene()
    for datablock in bpy.data.lights:
        if datablock.users == 0:
            bpy.data.lights.remove(datablock)


def new_empty(name, parent=None):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    empty.empty_display_size = 0.02
    bpy.context.collection.objects.link(empty)
    if parent:
        empty.parent = parent
    return empty


def bounds_center(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points:
        return Vector((0, 0, 0))
    return sum(points, Vector()) / len(points)


def parent_keep_transform(obj, parent):
    matrix = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = matrix


def imported_objects(before):
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def import_layer(svg_path, parent, depth=0.018, bevel=0.002):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_curve.svg(filepath=str(svg_path))
    objects = imported_objects(before)
    if not objects:
        raise RuntimeError(f"Blender imported no objects from {svg_path.name}")
    parent.location = bounds_center(objects)
    bpy.context.view_layer.update()
    for obj in objects:
        parent_keep_transform(obj, parent)
        if hasattr(obj.data, "extrude"):
            obj.data.extrude = depth
            obj.data.bevel_depth = bevel
            obj.data.bevel_resolution = 3
            obj.data.resolution_u = 12
    return objects


def keyframe(obj, frame, *, location=None, rotation=None, scale=None):
    if location is not None:
        obj.location = location
        obj.keyframe_insert("location", frame=frame)
    if rotation is not None:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = rotation
        obj.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert("scale", frame=frame)


def animate_walk(rig, parts):
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 96
    scene.render.fps = 24

    for obj in (rig, *parts.values()):
        obj.rotation_mode = "XYZ"

    # A short forward/back root path keeps the duck walking in the shot while
    # the foot cycle supplies the recognizable alternating gait.
    keyframe(rig, 1, location=(-0.025, 0, 0), rotation=(0, 0, -0.015), scale=(1, 1, 1))
    keyframe(rig, 25, location=(-0.005, 0.002, 0), rotation=(0, 0, 0.012), scale=(1, 1, 1))
    keyframe(rig, 49, location=(0.025, 0, 0), rotation=(0, 0, -0.012), scale=(1, 1, 1))
    keyframe(rig, 73, location=(0.005, 0.002, 0), rotation=(0, 0, 0.015), scale=(1, 1, 1))
    keyframe(rig, 97, location=(-0.025, 0, 0), rotation=(0, 0, -0.015), scale=(1, 1, 1))

    body = parts["Body"]
    body_rest = body.location.copy()
    keyframe(body, 1, location=body_rest, scale=(1, 1, 1))
    keyframe(body, 13, location=(body_rest.x, body_rest.y + 0.003, body_rest.z), scale=(1.006, 0.994, 1))
    keyframe(body, 25, location=body_rest, scale=(1, 1, 1))
    keyframe(body, 37, location=(body_rest.x, body_rest.y + 0.003, body_rest.z), scale=(1.006, 0.994, 1))
    keyframe(body, 49, location=body_rest, scale=(1, 1, 1))
    keyframe(body, 61, location=(body_rest.x, body_rest.y + 0.003, body_rest.z), scale=(1.006, 0.994, 1))
    keyframe(body, 73, location=body_rest, scale=(1, 1, 1))
    keyframe(body, 85, location=(body_rest.x, body_rest.y + 0.003, body_rest.z), scale=(1.006, 0.994, 1))
    keyframe(body, 97, location=body_rest, scale=(1, 1, 1))

    wing = parts["FrontWing"]
    wing_rest = wing.location.copy()
    keyframe(wing, 1, location=wing_rest, rotation=(0.03, 0.08, 0.015))
    keyframe(wing, 25, location=wing_rest, rotation=(-0.02, -0.05, -0.01))
    keyframe(wing, 49, location=wing_rest, rotation=(0.03, 0.08, 0.015))
    keyframe(wing, 73, location=wing_rest, rotation=(-0.02, -0.05, -0.01))
    keyframe(wing, 97, location=wing_rest, rotation=(0.03, 0.08, 0.015))

    # Feet alternate forward/back and lift slightly during the swing phase.
    for name, phase in (("LeftFoot", 0), ("RightFoot", 24)):
        foot = parts[name]
        rest = foot.location.copy()
        for frame in range(1, 98, 24):
            local = (frame - 1 + phase) % 48
            if local < 24:
                step_x, lift, tilt = 0.012, 0.004, 0.10
            else:
                step_x, lift, tilt = -0.012, 0, -0.08
            if 8 <= local <= 16:
                lift = 0.008
            keyframe(
                foot,
                frame,
                location=(rest.x + step_x, rest.y + lift, rest.z),
                rotation=(0.05 if lift else 0.0, tilt, tilt * 0.55),
            )

    # A gentle blink keeps the 3D preview alive without changing the source
    # eye geometry.
    for name in ("EyeLeft", "EyeRight"):
        eye = parts[name]
        keyframe(eye, 1, scale=(1, 1, 1))
        keyframe(eye, 45, scale=(1, 1, 1))
        keyframe(eye, 47, scale=(1, 0.16, 1))
        keyframe(eye, 49, scale=(1, 1, 1))
        keyframe(eye, 97, scale=(1, 1, 1))

    for obj in (rig, *parts.values()):
        if not obj.animation_data or not obj.animation_data.action:
            continue
        for curve in obj.animation_data.action.fcurves:
            for point in curve.keyframe_points:
                point.interpolation = "BEZIER"
            curve.modifiers.new("CYCLES")


def setup_materials():
    for material in bpy.data.materials:
        if not material.name.startswith("SVGMat"):
            continue
        color = material.diffuse_color[:]
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.inputs["Base Color"].default_value = color
        shader.inputs["Roughness"].default_value = 0.38
        if shader.inputs.get("Specular IOR Level"):
            shader.inputs["Specular IOR Level"].default_value = 0.28
        material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])


def configure_scene(rig):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 480
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.render.engine = "BLENDER_EEVEE_NEXT"

    setup_materials()
    curve_objects = [obj for obj in scene.objects if obj.type == "CURVE"]
    points = [obj.matrix_world @ Vector(corner) for obj in curve_objects for corner in obj.bound_box]
    if not points:
        raise RuntimeError("The imported SVG has no renderable curve geometry")
    min_x, max_x = min(p.x for p in points), max(p.x for p in points)
    min_y, max_y = min(p.y for p in points), max(p.y for p in points)
    center = Vector(((min_x + max_x) / 2, (min_y + max_y) / 2, 0))
    height = max_y - min_y

    # The oblique camera reveals the extruded sides while keeping the SVG
    # silhouette readable from the front.
    camera_data = bpy.data.cameras.new("Duck3DCamera")
    camera = bpy.data.objects.new("Duck3DCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = center + Vector((0, 0, height * 3.0))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = height * 1.80
    camera_data.sensor_width = 36
    camera.rotation_euler = (0, 0, 0)
    scene.camera = camera

    # Soft key and fill lights create visible bevel highlights on the depth.
    key_data = bpy.data.lights.new("DuckKey", "AREA")
    key_data.energy = 2.0
    key_data.shape = "DISK"
    key_data.size = height * 1.4
    key = bpy.data.objects.new("DuckKey", key_data)
    bpy.context.collection.objects.link(key)
    key.location = center + Vector((height * 0.9, height * 1.3, height * 1.8))
    key.rotation_euler = (0.35, 0.0, 0.55)

    fill_data = bpy.data.lights.new("DuckFill", "AREA")
    fill_data.energy = 0.8
    fill_data.size = height
    fill = bpy.data.objects.new("DuckFill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = center + Vector((-height * 1.2, height * 0.4, height * 1.1))
    fill.rotation_euler = (0.65, 0.0, -0.85)

    rig["source_asset"] = "src/assets/duck.svg"
    rig["asset_policy"] = "Original SVG paths are imported without redrawing or recoloring"
    rig["animation_mode"] = "3D extruded SVG walking cycle"
    rig["walk_cycle_frames"] = 96
    rig["depth_extrusion"] = 0.018


def build(source, output):
    clear_scene()
    ET.register_namespace("", SVG_NS)
    source_root = ET.parse(source).getroot()
    defs = [copy.deepcopy(child) for child in source_root if BASE.local_name(child.tag) == "defs"]
    painted = BASE.painted_elements(source_root)
    if len(painted) != 11:
        raise RuntimeError(f"Expected 11 SVG paths, found {len(painted)}")

    rig = new_empty("Duck_3D_Rig")
    parts = {}
    with tempfile.TemporaryDirectory(prefix="minduck-duck-3d-") as temporary:
        temporary_path = Path(temporary)
        for part_name, indexes in PARTS.items():
            layer_root = ET.Element(source_root.tag, dict(source_root.attrib))
            for definition in defs:
                layer_root.append(copy.deepcopy(definition))
            for index in indexes:
                layer_root.append(copy.deepcopy(painted[index]))
            layer_path = temporary_path / f"{part_name}.svg"
            ET.ElementTree(layer_root).write(layer_path, encoding="unicode", xml_declaration=True)
            parts[part_name] = new_empty(f"Duck3D_{part_name}", rig)
            import_layer(layer_path, parts[part_name])
            parts[part_name].location.z += max(indexes) * 0.004

    animate_walk(rig, parts)
    configure_scene(rig)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    print(f"Saved Blender 3D scene: {output}")


if __name__ == "__main__":
    arguments = parse_args()
    build(Path(arguments.source).resolve(), Path(arguments.output).resolve())
