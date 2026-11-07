"""Build a Blender 2.5D rig from the untouched Minduck duck SVG.

Run with Blender, for example:

    blender -b --python scripts/build-duck-blender.py -- \
      --source src/assets/duck.svg --output build/duck-pet.blend

The source SVG is only read. A temporary SVG is generated for each semantic
layer so Blender's SVG importer can keep the original path geometry, fills and
filters while the imported objects receive animation-friendly parents.
"""

from __future__ import annotations

import argparse
import copy
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree as ET

import bpy
from mathutils import Vector


SVG_NS = "http://www.w3.org/2000/svg"
PARTS = {
    "RightFoot": [0],
    "Body": [1],
    "FrontWing": [2],
    "EyeLeft": [3, 5],
    "EyeRight": [4, 6],
    "Beak": [7],
    "LeftFoot": [8, 9],
    "Tuft": [10],
}


def parse_args():
    divider = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="src/assets/duck.svg")
    parser.add_argument("--output", default="build/duck-pet.blend")
    return parser.parse_args(sys.argv[divider + 1 :])


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def painted_elements(node, inherited_filter=None):
    """Collect painted paths while retaining a parent's SVG filter wrapper."""

    current_filter = node.attrib.get("filter", inherited_filter)
    if local_name(node.tag) == "path":
        path = copy.deepcopy(node)
        if current_filter and "filter" not in path.attrib:
            wrapper = ET.Element(f"{{{SVG_NS}}}g", {"filter": current_filter})
            wrapper.append(path)
            return [wrapper]
        return [path]
    result = []
    for child in node:
        if local_name(child.tag) == "defs":
            continue
        result.extend(painted_elements(child, current_filter))
    return result


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.curves, bpy.data.meshes, bpy.data.materials, bpy.data.cameras):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def new_empty(name, parent=None):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    empty.empty_display_size = 0.15
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
    obj.parent = parent
    parent.matrix_world.translation = parent.location
    obj.matrix_parent_inverse = parent.matrix_world.inverted()


def imported_objects(before):
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def import_layer(svg_path, parent):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_curve.svg(filepath=str(svg_path))
    objects = imported_objects(before)
    if not objects:
        raise RuntimeError(f"Blender imported no objects from {svg_path.name}")
    center = bounds_center(objects)
    parent.location = center
    for obj in objects:
        parent_keep_transform(obj, parent)
        if hasattr(obj.data, "extrude"):
            obj.data.extrude = 0.002
        if hasattr(obj.data, "bevel_depth"):
            obj.data.bevel_depth = 0
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


def animate_rig(rig, parts):
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 96
    scene.render.fps = 24

    for obj in (rig, *parts.values()):
        if obj:
            obj.rotation_mode = "XYZ"

    keyframe(rig, 1, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1))
    keyframe(rig, 24, location=(0, 0.002, 0), rotation=(0, 0, -0.008), scale=(1, 1, 1))
    keyframe(rig, 48, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1))
    keyframe(rig, 72, location=(0, 0.001, 0), rotation=(0, 0, 0.006), scale=(1, 1, 1))
    keyframe(rig, 96, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1))

    body = parts["Body"]
    body_rest = body.location.copy()
    keyframe(body, 1, location=body_rest, scale=(1, 1, 1))
    keyframe(body, 48, location=(body_rest.x, body_rest.y + 0.002, body_rest.z), scale=(1.008, 0.994, 1))
    keyframe(body, 96, location=body_rest, scale=(1, 1, 1))

    wing = parts["FrontWing"]
    keyframe(wing, 1, rotation=(0, 0, 0))
    keyframe(wing, 32, rotation=(0, 0.06, 0.02))
    keyframe(wing, 64, rotation=(0, -0.04, -0.01))
    keyframe(wing, 96, rotation=(0, 0, 0))

    for name, direction in (("LeftFoot", -1), ("RightFoot", 1)):
        foot = parts[name]
        keyframe(foot, 1, rotation=(0, 0, 0))
        keyframe(foot, 48, rotation=(0, 0, direction * 0.035))
        keyframe(foot, 96, rotation=(0, 0, 0))

    for name in ("EyeLeft", "EyeRight"):
        eye = parts[name]
        keyframe(eye, 1, scale=(1, 1, 1))
        keyframe(eye, 43, scale=(1, 1, 1))
        keyframe(eye, 45, scale=(1, 0.14, 1))
        keyframe(eye, 47, scale=(1, 1, 1))
        keyframe(eye, 96, scale=(1, 1, 1))

    for obj in (rig, *parts.values()):
        if obj and obj.animation_data and obj.animation_data.action:
            for curve in obj.animation_data.action.fcurves:
                for point in curve.keyframe_points:
                    point.interpolation = "BEZIER"
                curve.modifiers.new("CYCLES")


def configure_scene(rig):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 380
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.world.color = (0.02, 0.02, 0.02)
    scene.view_settings.view_transform = "Standard"

    for material in bpy.data.materials:
        if not material.name.startswith("SVGMat"):
            continue
        color = material.diffuse_color[:]
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        emission = nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = color
        material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])

    curve_objects = [obj for obj in scene.objects if obj.type == "CURVE"]
    points = [obj.matrix_world @ Vector(corner) for obj in curve_objects for corner in obj.bound_box]
    if not points:
        raise RuntimeError("The imported SVG has no renderable curve geometry")
    min_x = min(point.x for point in points)
    max_x = max(point.x for point in points)
    min_y = min(point.y for point in points)
    max_y = max(point.y for point in points)
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    height = max_y - min_y

    camera_data = bpy.data.cameras.new("DuckCamera")
    camera = bpy.data.objects.new("DuckCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (center_x, center_y, 20)
    camera.rotation_euler = (0, 0, 0)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = height * 1.12
    scene.camera = camera

    rig["source_asset"] = "src/assets/duck.svg"
    rig["asset_policy"] = "Original SVG paths are imported without redrawing or recoloring"
    rig["animation_mode"] = "2.5D layered SVG"


def build(source, output):
    clear_scene()
    ET.register_namespace("", SVG_NS)
    source_root = ET.parse(source).getroot()
    defs = [copy.deepcopy(child) for child in source_root if local_name(child.tag) == "defs"]
    painted = painted_elements(source_root)
    if len(painted) != 11:
        raise RuntimeError(f"Expected 11 SVG paths, found {len(painted)}")

    rig = new_empty("Duck_Rig")
    parts = {}
    with tempfile.TemporaryDirectory(prefix="minduck-duck-") as temporary:
        temporary_path = Path(temporary)
        for part_name, indexes in PARTS.items():
            layer_root = ET.Element(source_root.tag, dict(source_root.attrib))
            for definition in defs:
                layer_root.append(copy.deepcopy(definition))
            for index in indexes:
                layer_root.append(copy.deepcopy(painted[index]))
            layer_path = temporary_path / f"{part_name}.svg"
            ET.ElementTree(layer_root).write(layer_path, encoding="unicode", xml_declaration=True)
            parts[part_name] = new_empty(f"Duck_{part_name}", rig)
            import_layer(layer_path, parts[part_name])
            parts[part_name].location.z += max(indexes) * 0.0015

    animate_rig(rig, parts)
    configure_scene(rig)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    print(f"Saved Blender scene: {output}")


if __name__ == "__main__":
    arguments = parse_args()
    build(Path(arguments.source).resolve(), Path(arguments.output).resolve())
