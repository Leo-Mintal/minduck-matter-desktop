"""Compile the supplied Suit Duck SVGs, preserving paths, filters and CSS motion paths.

Uses the same paused-WAAPI representation as coopanion-svg, extended locally for
offset-distance. Standard library only; source SVGs remain byte-for-byte intact.
"""
from copy import deepcopy
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets/companion-suit-duck"
OUTPUT = ROOT / "src/companion/figures/minduck-suit-duck"
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
TAG = lambda name: "{" + NS + "}" + name


def blocks(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    position = 0
    while position < len(css):
        start = css.find("{", position)
        if start < 0:
            if css[position:].strip():
                raise ValueError("Unexpected CSS suffix")
            break
        depth, end = 1, start + 1
        while end < len(css) and depth:
            depth += (css[end] == "{") - (css[end] == "}")
            end += 1
        if depth:
            raise ValueError("Unbalanced CSS")
        yield css[position:start].strip(), css[start + 1:end - 1]
        position = end


def declarations(text):
    result = {}
    for declaration in text.split(";"):
        if declaration.strip():
            key, colon, value = declaration.partition(":")
            if not colon:
                raise ValueError("Invalid CSS declaration")
            result[key.strip()] = value.strip()
    return result


def validate_node(node):
    if node.tag.rsplit("}", 1)[-1] in {"script", "foreignObject", "animate", "animateTransform", "set"}:
        raise ValueError("Unsupported SVG element")
    for key, value in node.attrib.items():
        attr = key.rsplit("}", 1)[-1].lower()
        if attr.startswith("on") or (attr == "href" and not value.startswith("#")):
            raise ValueError("External resource or event handler")
    for value in [*node.attrib.values(), node.text or ""]:
        if "@import" in value or any(not m.strip(" '\"").startswith("#")
                                    for m in re.findall(r"url\(([^)]+)\)", value)):
            raise ValueError("External CSS reference")


def read_source(name):
    raw = (ASSETS / "source" / name).read_bytes()
    text = raw.decode("utf-8-sig")
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ValueError("External XML declarations are not supported")
    root = ET.fromstring(text)
    ids = [e.get("id") for e in root.iter() if e.get("id")]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate SVG IDs")
    for node in root.iter():
        validate_node(node)
    return root, {"file": name, "sha256": hashlib.sha256(raw).hexdigest(),
                  "paths": len(list(root.iter(TAG("path")))), "filters": len(list(root.iter(TAG("filter"))))}


def repair_filter_bounds(root, provenance):
    regions = json.loads((ASSETS / "filter-bounds.json").read_text()).get(provenance["file"])
    if regions and regions["sha256"] != provenance["sha256"]:
        raise ValueError("Source changed: remeasure filter bounds for " + provenance["file"])
    bounds = regions["bounds"] if regions else {}
    repaired = set()
    for node in root.iter(TAG("filter")):
        keys = ("x", "y", "width", "height")
        if not any(re.search(r"inf|nan", node.get(key, ""), re.I) for key in keys):
            continue
        identifier = node.get("id")
        values = bounds.get(identifier)
        if (not isinstance(values, list) or len(values) != 4
                or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values)
                or values[2] <= 0 or values[3] <= 0):
            raise ValueError("Missing or invalid measured filter bounds: " + str(identifier))
        for key, value in zip(keys, values):
            node.set(key, str(value))
        repaired.add(identifier)
    if repaired != set(bounds):
        raise ValueError("Filter calibration does not match invalid source regions")
    return len(repaired)


def repair_sleeve_clips(root):
    """Avoid layered alpha-mask seams on the exported solid-white sleeve silhouettes."""
    repaired = 0
    for mask in list(root.iter(TAG("mask"))):
        children = list(mask)
        if (len(children) != 1 or children[0].tag != TAG("path")
                or not children[0].get("id", "").startswith("Arm_Silhouette_Clip")):
            continue
        silhouette = children[0]
        reference = "url(#" + mask.get("id", "") + ")"
        consumers = [node for node in root.iter() if node.get("mask") == reference]
        if (mask.get("maskUnits") != "userSpaceOnUse" or silhouette.get("fill") != "white"
                or set(silhouette.attrib) - {"id", "d", "fill"}
                or set(mask.attrib) - {"id", "style", "maskUnits", "x", "y", "width", "height"}
                or mask.get("style", "") not in {"mask-type:luminance", "mask-type:alpha"}
                or not consumers or any(node.get("clip-path") or not any(
                    part.get("id", "").startswith("Jacket_Sleeve_Near") for part in node.iter())
                    for node in consumers)):
            raise ValueError("Unreviewed sleeve silhouette mask: " + mask.get("id", ""))
        identifier = mask.get("id")
        mask.tag = TAG("clipPath")
        mask.attrib = {"id": identifier, "clipPathUnits": "userSpaceOnUse"}
        for node in consumers:
            node.set("clip-path", node.attrib.pop("mask"))
        repaired += 1
    return repaired


def prefix(root, name):
    ids = {e.get("id"): name + e.get("id") for e in root.iter() if e.get("id")}
    for node in root.iter():
        for key, value in list(node.attrib.items()):
            if key == "id":
                value = ids[value]
            else:
                value = re.sub(r"url\(\s*['\"]?#([^'\"\s)]+)['\"]?\s*\)",
                               lambda m: "url(#" + ids[m[1]] + ")", value)
                if key.rsplit("}", 1)[-1] == "href" and value.startswith("#"):
                    value = "#" + ids[value[1:]]
            node.set(key, value)


def parse_frames(body):
    properties = {"transform": "transform", "opacity": "opacity", "offset-distance": "offsetDistance",
                  "animation-timing-function": "easing"}
    frames = []
    for positions, values in blocks(body):
        values = declarations(values)
        if set(values) - properties.keys():
            raise ValueError("Unsupported keyframe property: " + str(values.keys()))
        for position in positions.split(","):
            position = position.strip().replace("from", "0%").replace("to", "100%")
            if not re.fullmatch(r"[\d.]+%", position):
                raise ValueError("Unsupported keyframe offset")
            frames.append({"offset": float(position[:-1]) / 100,
                           **{properties[k]: v for k, v in values.items()}})
    frames.sort(key=lambda f: f["offset"])
    if not frames or frames[0]["offset"] != 0 or frames[-1]["offset"] != 1:
        raise ValueError("Animation must cover 0–100%")
    return frames


def parse_css(css):
    keyframes, rules = {}, []
    for selector, body in blocks(css):
        if selector == "svg" and declarations(body) == {"overflow": "visible"}:
            continue
        if not selector.startswith("@keyframes "):
            if not re.fullmatch(r"#[\w-]+", selector):
                raise ValueError("Unsupported CSS selector: " + selector)
            rules.append((selector[1:], declarations(body)))
            continue
        keyframes[selector.split()[1]] = parse_frames(body)
    return keyframes, rules


def compile_rules(name, by_id, keyframes, rules):
    animations, durations = [], set()
    static_properties = {"transform", "opacity", "transform-origin", "transform-box", "translate",
                         "offset-path", "offset-rotate", "offset-anchor"}
    for identifier, rule in rules:
        if identifier not in by_id or set(rule) - static_properties - {"animation"}:
            raise ValueError("Unsupported animation rule: " + identifier)
        node = by_id[identifier]
        styles = declarations(node.get("style", ""))
        styles.update({k: v for k, v in rule.items() if k != "animation"})
        node.set("style", ";".join(k + ":" + v for k, v in styles.items()))
        for animation in rule.get("animation", "").split(","):
            if not animation.strip():
                continue
            tokens = animation.split()
            if len(tokens) != 4 or tokens[2:] != ["linear", "infinite"] or not re.fullmatch(r"[\d.]+s", tokens[1]):
                raise ValueError("Unsupported animation options: " + animation)
            durations.add(float(tokens[1][:-1]))
            animations.append({"id": "suit-" + name + "-" + identifier,
                               "name": tokens[0], "keyframes": deepcopy(keyframes[tokens[0]])})
    if len(durations) != 1 or not animations:
        raise ValueError("Flow needs one common duration")
    return animations, durations.pop()


def compile_flow(name, spec):
    root, provenance = read_source(spec["file"])
    provenance["repairedFilterRegions"] = repair_filter_bounds(root, provenance)
    provenance["repairedSleeveClips"] = repair_sleeve_clips(root)
    by_id = {e.get("id"): e for e in root.iter() if e.get("id")}
    css = "\n".join(e.text or "" for e in root.iter(TAG("style")))
    animations, duration = compile_rules(name, by_id, *parse_css(css))
    for parent in list(root.iter()):
        for node in list(parent):
            if node.tag == TAG("style"):
                parent.remove(node)
    prefix(root, "suit-" + name + "-")
    # A nested SVG preserves transform-box:view-box and motion-path coordinates.
    box = root.get("viewBox").split()
    root.set("width", box[2])
    root.set("height", box[3])
    root.set("overflow", "visible")
    return {"svg": ET.tostring(root, encoding="unicode"), "duration": duration,
            "transform": f'translate({spec["x"]} {spec["y"]}) scale({spec["scale"]})',
            "animations": animations}, {**provenance, "duration": duration, "tracks": len(animations)}


def scoped_collection_css(css_blocks, ids):
    selected = [(s, body) for s, body in css_blocks if s.startswith("#") and s[1:] in ids]
    names = {a.strip().split()[0] for _, body in selected
             for a in declarations(body).get("animation", "").split(",") if a.strip()}
    css = ["svg {overflow:visible;}"]
    for selector, body in css_blocks:
        if selector.startswith("@keyframes "):
            keep = selector.split()[1] in names
        else:
            keep = selector.startswith("#") and selector[1:] in ids
        if keep:
            css.append(selector + "{" + body + "}")
    return "\n".join(css)


def svg_references(element):
    refs = set()
    for node in element.iter():
        for value in node.attrib.values():
            refs.update(re.findall(r"url\(['\"]?#([^'\")]+)", value))
        if (node.get("href") or "").startswith("#"):
            refs.add(node.get("href")[1:])
    return refs


def collection_definitions(group, by_id, definitions):
    refs = svg_references(group)
    previous = None
    while previous != refs:
        previous = refs.copy()
        for identifier in list(refs):
            refs.update(svg_references(by_id[identifier]))
    return [deepcopy(d) for d in definitions if any(e.get("id") in refs for e in d.iter())]


def split_collection(project, check):
    root, provenance = read_source("collection.svg")
    by_id = {e.get("id"): e for e in root.iter() if e.get("id")}
    css_blocks = list(blocks(root.find(TAG("style")).text))
    definitions = list(root.find(TAG("defs")))
    sources = {}
    for word, spec in project["flows"].items():
        group = by_id[spec["group"]]
        ids = {e.get("id") for e in group.iter() if e.get("id")}
        output = ET.Element(TAG("svg"), root.attrib)
        ET.SubElement(output, TAG("style")).text = scoped_collection_css(css_blocks, ids)
        output.append(deepcopy(group))
        defs = ET.SubElement(output, TAG("defs"))
        defs.extend(collection_definitions(group, by_id, definitions))
        content = ET.tostring(output, encoding="utf-8", xml_declaration=True)
        path = ASSETS / "source" / spec["file"]
        if check:
            if path.read_bytes() != content:
                raise ValueError("Split source is out of date: " + str(path))
        else:
            path.write_bytes(content)
        sources[word] = {"file": spec["file"], "group": spec["group"],
                         "sha256": hashlib.sha256(content).hexdigest()}
    return {**provenance, "actions": sources}


def compile_base():
    root, provenance = read_source("idle.svg")
    root.remove(root.find(TAG("style")))
    character = root.find(TAG("g"))
    character.attrib.pop("transform")
    root.attrib.update({"viewBox": "0 0 46.0165 51.38756", "width": "46.0165", "height": "51.38756",
                        "overflow": "visible"})
    roles = {"Wings_Far_3": "wing-back", "Legs_Right_2": "foot-back", "Wings_Near_3": "wing-front",
             "LeftEye_Glow_2": "eye-left-glow", "RightEye_Glow_2": "eye-right-glow",
             "LeftEye_2": "eye-left", "RightEye_2": "eye-right", "Beak_3": "beak",
             "LeftLegAndFoot_2": "foot-front", "HeadTuft_3": "crest",
             "Gold_Glasses___Original_IP_2": "monocle"}
    found = set()
    for parent in list(root.iter()):
        for index, node in enumerate(list(parent)):
            role = roles.get(node.get("id"))
            if not role:
                continue
            wrapper = ET.Element(TAG("g"), {"id": role})
            if role == "monocle":
                wrapper.set("data-upper", "")
            parent.remove(node)
            parent.insert(index, wrapper)
            wrapper.append(node)
            found.add(role)
    if found != set(roles.values()):
        raise ValueError("Missing semantic base parts: " + str(set(roles.values()) - found))
    for index, node in enumerate(list(character)):
        if node.get("id") in {"Body_3", "Suit_Torso___Exact_IP_2"}:
            wrapper = ET.Element(TAG("g"), {"data-upper": ""})
            character.remove(node)
            character.insert(index, wrapper)
            wrapper.append(node)
    prefix(root, "suit-")
    return ET.tostring(root, encoding="unicode"), provenance


def generate(check=False):
    project = json.loads((ASSETS / "project.json").read_text())
    collection = split_collection(project, check)
    base, provenance = compile_base()
    flows, sources = {}, {"base": provenance}
    for name, spec in project["flows"].items():
        flows[name], sources[name] = compile_flow(name, spec)
    compact = lambda obj: json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    files = {ASSETS / "collection.json": json.dumps(collection, ensure_ascii=False, indent=2) + "\n",
             OUTPUT / "artwork.svg": base + "\n",
             OUTPUT / "artwork.js": "// Generated by scripts/build-suit-duck.py; edit source SVGs instead.\n"
                                     + "export const ARTWORK = " + compact(base) + ";\n",
             OUTPUT / "flow-artwork.js": "// Generated by scripts/build-suit-duck.py; all animation times are source seconds.\n"
                                          + "export const FLOWS = " + compact(flows) + ";\n",
             ASSETS / "sources.json": json.dumps(sources, ensure_ascii=False, indent=2) + "\n"}
    for path, text in files.items():
        if check:
            if not path.exists() or path.read_text() != text:
                raise ValueError("Generated asset is out of date: " + str(path.relative_to(ROOT)))
        else:
            path.write_text(text)
    print(json.dumps({"checked" if check else "built": list(flows), "sources": sources}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    generate(parser.parse_args().check)
