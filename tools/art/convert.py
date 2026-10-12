# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10", "numpy>=1.26", "imageio-ffmpeg>=0.5"]
# ///
"""Turns the artist's sources in /assets into the game's pixel strips.

The sources are pixel art upscaled to 1024x1024 (JPEG stills, MP4 loops) on a black
background. For every source the script:
  1. finds the art-pixel size from where the colour edges fall (8 px for a 128x128 sprite);
  2. takes the median colour of the inner part of each art pixel, which removes JPEG and
     H.264 noise along the edges;
  3. keys out the black background and snaps colours to the sprite set's palette;
  4. splits a video into its distinct poses and the order they play in;
  5. crops every frame of the set to one shared box, so the feet stay on one line.
It writes horizontal strips to apps/game/public/assets and their entries to
apps/game/src/assets/manifest.json.

Run from the repository root:  uv run tools/art/convert.py
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "assets"
OUT = ROOT / "apps/game/public/assets"
MANIFEST = ROOT / "apps/game/src/assets/manifest.json"

# Sprite set -> display scale and animation -> source. Stills hold for `hold_ms`; videos keep the
# artist's timing unless `fps` is set. The first animation of a set gives the anchor (its first
# pose's feet). Enemies use idle / cast (the parry window) / release / hurt / death.
SCALE = 2
SETS = {
    "hero": {
        "idle": {"src": "breadthmc.mp4", "loop": True},
        "draw": {"src": "castingmc.mp4", "loop": True, "fps": 5},
        "cast": {"src": "attackmc.jpeg", "hold_ms": 380},
        "parry": {"src": "attackmc.jpeg", "hold_ms": 380},
        "hurt": {"src": "takingdamagemc.jpeg", "hold_ms": 360},
        "fail": {"src": "takingdamagemc.jpeg", "hold_ms": 420},
        "defeat": {"src": "deathmc.jpeg", "hold_ms": 1200},
    },
    "slime_mage": {
        "idle": {"src": "slimemagebreath.mp4", "loop": True},
        "cast": {"src": "slimemagecastingmagic.mp4", "loop": True},
        "release": {"src": "slimemageattack.jpeg", "hold_ms": 420},
        "hurt": {"src": "slimemagetakingdamage.jpeg", "hold_ms": 300},
        "death": {"src": "slimemagedeath.jpeg", "hold_ms": 1200},
    },
    "skeleton_mage": {
        "idle": {"src": "skeletonmagebreath.mp4", "loop": True},
        "cast": {"src": "skeletonmagecastingmagic.mp4", "loop": True},
        "release": {"src": "skeletonmageattack.jpeg", "hold_ms": 420},
        "hurt": {"src": "skeletonmagetakingdamage.jpeg", "hold_ms": 300},
        # No death drawing for the mage yet: the skeleton's bones and spirit, until one is found.
        "death": {"src": "skeletondeath.jpeg", "hold_ms": 1200, "fallback": True},
    },
    "skeleton": {
        "idle": {"src": "skeletonbreath.mp4", "loop": True},
        "release": {"src": "skeletonattack.jpeg", "hold_ms": 420},
        "hurt": {"src": "skeletontakingdamage.jpeg", "hold_ms": 300},
        "death": {"src": "skeletondeath.jpeg", "hold_ms": 1200},
    },
}
# The boss is drawn on the whole canvas; at 2 it stands a head taller than the skeletons and
# still clears its health bar at the top of the field.
SET_SCALE = {"boss": 2}

# New files are found by the artist's naming: <enemy><animation> ("bossbreath.mp4",
# "skeletonmagedeath.jpeg"), <animation>mc for the hero, mcattack<element>[+<element>] for spell
# flights, <ordinal>location for battle backgrounds.
ENEMY_PREFIXES = {"slimemage": "slime_mage", "skeletonmage": "skeleton_mage", "skeleton": "skeleton", "boss": "boss"}
ENEMY_ANIMS = [("castingmagic", "cast"), ("casting", "cast"), ("breath", "idle"), ("breadth", "idle"), ("takingdamage", "hurt"), ("death", "death"), ("attack", "release")]
HERO_ANIMS = {"parry": ["parry"], "fail": ["fail"], "defeat": ["defeat"], "death": ["defeat"], "takingdamage": ["hurt", "fail"], "attack": ["cast", "parry"], "casting": ["draw"], "breadth": ["idle"], "breath": ["idle"]}
HOLD_MS = {"release": 420, "hurt": 300, "death": 1200, "cast": 380, "parry": 380, "fail": 420, "defeat": 1200}
LOOPING = {"idle", "cast", "draw"}
# Combinations by their two elements, as the game names them (packages/glyphs spells.ts).
COMBOS = {frozenset(("fire", "water")): "steam", frozenset(("water", "air")): "ice", frozenset(("earth", "fire")): "magma"}
# Spell flights: the projectile is cut out of every frame and aligned by its head. Each clip grows
# the spell at the staff, flies it and bursts it on the target; `fly` (looped in flight) and `hit`
# (played where it lands) are frame numbers in playing order. Clips found by name use FX_ANIMS.
FX_ANIMS = {"fly": [2, 3, 4, 5], "hit": [6, 7, 8, 9, 10]}
FX = {
    "fx_fire": {"src": "mcattackfire.mp4", **FX_ANIMS},
    "fx_water": {"src": "mcattackwater.mp4", **FX_ANIMS},
    "fx_air": {"src": "mcattackair.mp4", **FX_ANIMS},
    "fx_earth": {"src": "mcattackearth.mp4", "fly": [3, 4], "hit": [6, 7, 8, 9]},
    "fx_steam": {"src": "mcattackfire+water.mp4", "fly": [1, 2], "hit": [4, 5, 6, 7]},
    "fx_ice": {"src": "mcattackwater+air.mp4", "fly": [0, 1], "hit": [4, 5, 6]},
    # The burning rock is in "fire+air" and a flame comet in "earth+fire": the names look swapped.
    "fx_magma": {"src": "mcattackfire+air.mp4", "fly": [3, 4], "hit": [6, 7, 8, 9]},
}
# Strip names for stills shared by several animations.
STILL_NAMES = {"attackmc.jpeg": "attack", "takingdamagemc.jpeg": "hurt", "deathmc.jpeg": "defeat"}
# Menus and battles without a location of their own use bg_chapter1; bg_location<n> is battle n's.
BACKGROUNDS = {"bg_chapter1": "mainbackground.jpeg"}
LOCATIONS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "boss": 4}
# Paintings drawn on black, which is keyed out: the grimoire book behind the battle's pages.
KEYED = {"grimoire": "grimour.jpeg"}
# Other media, re-encoded with ffmpeg: target path under apps/game/public -> (source, ffmpeg options).
MEDIA = {"audio/music.mp3": ("backgroundmusic.mp3", ["-b:a", "128k"])}

BLACK = 40  # max channel below this is background
SNAP = 20  # colours closer than this (RGB distance) merge into one palette entry


def art_pixel(rgb: np.ndarray) -> tuple[int, int]:
    """Art-pixel size and phase: the step whose grid lines carry the colour edges."""
    edges = np.abs(np.diff(rgb.astype(np.int16), axis=1)).sum(axis=2) > 60
    cols = edges.sum(axis=0)
    total = max(1, cols.sum())
    for size in (16, 8, 4, 2):
        for phase in range(size):
            if cols[phase::size].sum() / total > 0.9:
                return size, (phase + 1) % size
    return 1, 0


def downsample(rgb: np.ndarray, size: int, phase: int) -> np.ndarray:
    """Median of the inner half of each art pixel."""
    h, w, _ = rgb.shape
    inner = max(1, size // 4)
    rows = range(phase, h - size + 1, size)
    cols = range(phase, w - size + 1, size)
    out = np.zeros((len(rows), len(cols), 3), np.uint8)
    for i, y in enumerate(rows):
        block = rgb[y + inner : y + size - inner]
        for j, x in enumerate(cols):
            out[i, j] = np.median(block[:, x + inner : x + size - inner].reshape(-1, 3), axis=0)
    return out


def load_still(path: Path) -> list[np.ndarray]:
    return [np.asarray(Image.open(path).convert("RGB"))]


def load_video(path: Path) -> tuple[list[np.ndarray], list[float]]:
    """All decoded frames with their timestamps (s)."""
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([exe, "-hide_banner", "-loglevel", "error", "-i", str(path), "-fps_mode", "passthrough", f"{tmp}/%04d.png"], check=True)
        info = subprocess.run([exe, "-hide_banner", "-i", str(path), "-vf", "showinfo", "-f", "null", "-"], capture_output=True, text=True).stderr
        times = [float(line.split("pts_time:")[1].split()[0]) for line in info.splitlines() if "pts_time:" in line]
        frames = [np.asarray(Image.open(f).convert("RGB")) for f in sorted(Path(tmp).glob("*.png"))]
    return frames, times


def same(a: np.ndarray, b: np.ndarray) -> bool:
    return int((np.abs(a.astype(np.int16) - b.astype(np.int16)).max(axis=2) > 40).sum()) <= 3


def poses_of(frames: list[np.ndarray], times: list[float]) -> tuple[list[np.ndarray], list[int], float]:
    """Distinct poses, the looping order they play in, and the mean time per step."""
    poses: list[np.ndarray] = []
    steps: list[tuple[int, float]] = []  # (pose, start time)
    for frame, t in zip(frames, times):
        k = next((i for i, p in enumerate(poses) if same(frame, p)), None)
        if k is None:
            poses.append(frame)
            k = len(poses) - 1
        if not steps or steps[-1][0] != k:
            steps.append((k, t))
    order = [k for k, _ in steps]
    period = next(p for p in range(1, len(order) + 1) if all(order[i] == order[i + p] for i in range(len(order) - p)))
    step = (steps[-1][1] - steps[0][1]) / max(1, len(steps) - 1)
    return poses, order[:period], step


def opaque_mask(im: np.ndarray, keyed: bool) -> np.ndarray:
    return im.max(axis=2) >= BLACK if keyed else np.ones(im.shape[:2], bool)


def palette(images: list[np.ndarray], keyed: bool = True) -> np.ndarray:
    """Colours of the set, most frequent first, with near-duplicates merged."""
    pixels = np.concatenate([im[opaque_mask(im, keyed)] for im in images])
    colours, counts = np.unique(pixels, axis=0, return_counts=True)
    chosen: list[np.ndarray] = []
    for c in colours[np.argsort(-counts)].astype(np.int16):
        if all(np.linalg.norm(c - p) > SNAP for p in chosen):
            chosen.append(c)
    return np.array(chosen, np.int16)


def to_rgba(im: np.ndarray, pal: np.ndarray, keyed: bool = True) -> np.ndarray:
    rgba = np.zeros((*im.shape[:2], 4), np.uint8)
    opaque = opaque_mask(im, keyed)
    flat = im[opaque].astype(np.int32)
    nearest = np.argmin(((flat[:, None, :] - pal[None, :, :].astype(np.int32)) ** 2).sum(axis=2), axis=1)
    rgba[opaque, :3] = pal[nearest]
    rgba[opaque, 3] = 255
    return rgba


def bbox(rgba: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(rgba[:, :, 3])
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def convert_set(name: str, spec: dict[str, dict]) -> dict:
    sources: dict[str, tuple[list[np.ndarray], list[int], float | None]] = {}
    for src in {a["src"] for a in spec.values()}:
        path = SOURCES / src
        if path.suffix == ".mp4":
            frames, times = load_video(path)
            size, phase = art_pixel(frames[0])
            poses, order, step = poses_of([downsample(f, size, phase) for f in frames], times)
            sources[src] = (poses, order, step)
        else:
            (frame,) = load_still(path)
            size, phase = art_pixel(frame)
            sources[src] = ([downsample(frame, size, phase)], [0], None)
        print(f"{src}: art pixel {size}px, {len(sources[src][0])} pose(s), order {sources[src][1]}")

    pal = palette([p for poses, _, _ in sources.values() for p in poses])
    # A transparent border keeps the one-pixel margin below inside the image when the art touches
    # the canvas edge (the boss's outstretched hand).
    rgba = {src: [np.pad(to_rgba(p, pal), ((1, 1), (1, 1), (0, 0))) for p in poses] for src, (poses, _, _) in sources.items()}
    boxes = [bbox(im) for ims in rgba.values() for im in ims]
    x0, y0 = min(b[0] for b in boxes) - 1, min(b[1] for b in boxes) - 1
    x1, y1 = max(b[2] for b in boxes) + 1, max(b[3] for b in boxes) + 1
    w, h = x1 - x0, y1 - y0

    # Anchor: the median column of the first pose (the body outweighs a thin staff), on its lowest row.
    first = rgba[next(iter(spec.values()))["src"]][0]
    feet_x = float(np.median(np.nonzero(first[:, :, 3])[1]))
    feet_y = bbox(first)[3]
    anchor = [round((feet_x - x0) / w, 3), round((feet_y - y0) / h, 3)]
    # How far the sprite reaches in front of the anchor (the hero's staff), for where the field starts.
    reach = int(bbox(first)[2] - feet_x)
    print(f"{name}: frame {w}x{h}, anchor {anchor}, reach {reach}px, palette {len(pal)} colours")

    OUT.mkdir(parents=True, exist_ok=True)
    written: dict[str, str] = {}
    for src, ims in rgba.items():
        stem = STILL_NAMES.get(src) or next(anim for anim, a in spec.items() if a["src"] == src)
        file = f"{name}_{stem}_{w}x{h}_{len(ims)}f.png"
        strip = np.concatenate([im[y0:y1, x0:x1] for im in ims], axis=1)
        Image.fromarray(strip, "RGBA").save(OUT / file, optimize=True)
        written[src] = file

    anims: dict[str, dict] = {}
    for anim, a in spec.items():
        poses, order, step = sources[a["src"]]
        entry: dict = {"file": written[a["src"]], "frames": len(poses)}
        if step is None:
            entry["fps"] = round(1000 / a["hold_ms"], 3)
        else:
            entry["fps"] = a.get("fps", round(1 / step, 2))
            if order != list(range(len(poses))):
                entry["sequence"] = order
        if a.get("loop"):
            entry["loop"] = True
        anims[anim] = entry
    return {"frame": [w, h], "anchor": anchor, "reach": reach, "scale": SCALE, "anims": anims}


def convert_fx(name: str, spec: dict) -> dict:
    """A spell in flight: each pose cropped to the projectile, its head (right edge) on one line."""
    src = spec["src"]
    frames, times = load_video(SOURCES / src)
    size, phase = art_pixel(frames[0])
    poses, order, step = poses_of([downsample(f, size, phase) for f in frames], times)
    pal = palette(poses)
    cuts = []
    for pose in poses:
        rgba = to_rgba(pose, pal)
        x0, y0, x1, y1 = bbox(rgba)
        cuts.append(rgba[y0:y1, x0:x1])
    w = max(c.shape[1] for c in cuts) + 2
    h = max(c.shape[0] for c in cuts) + 2
    strip = np.zeros((h, w * len(cuts), 4), np.uint8)
    for i, cut in enumerate(cuts):
        ch, cw = cut.shape[:2]
        top = (h - ch) // 2
        strip[top : top + ch, i * w + w - 1 - cw : i * w + w - 1] = cut
    file = f"{name}_{w}x{h}_{len(cuts)}f.png"
    Image.fromarray(strip, "RGBA").save(OUT / file, optimize=True)
    print(f"{src}: {len(cuts)} frames -> {file}")
    anims: dict[str, dict] = {}
    for anim in ("fly", "hit"):
        sequence = [order[i] for i in spec[anim] if i < len(order)]
        anims[anim] = {"file": file, "frames": len(cuts), "fps": round(1 / step, 2), "sequence": sequence, **({"loop": True} if anim == "fly" else {})}
    return {"frame": [w, h], "anchor": [0.8, 0.5], "scale": SCALE, "anims": anims}


def convert_media(target: str, src: str, options: list[str]) -> None:
    out = ROOT / "apps/game/public" / target
    out.parent.mkdir(parents=True, exist_ok=True)
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([exe, "-hide_banner", "-loglevel", "error", "-y", "-i", str(SOURCES / src), *options, str(out)], check=True)
    print(f"{src} -> {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


def convert_background(key: str, src: str, keyed: bool = False) -> str:
    (frame,) = load_still(SOURCES / src)
    size, phase = art_pixel(frame)
    small = downsample(frame, size, phase)
    pal = palette([small], keyed=keyed)
    rgba = to_rgba(small, pal, keyed=keyed)
    file = f"{key}.png"
    Image.fromarray(rgba if keyed else rgba[:, :, :3], "RGBA" if keyed else "RGB").save(OUT / file, optimize=True)
    print(f"{src}: art pixel {size}px -> {file} {rgba.shape[1]}x{rgba.shape[0]}, palette {len(pal)} colours")
    return file


def anim_entry(anim: str, src: str, hero: bool) -> dict:
    if src.endswith(".mp4"):
        return {"src": src, **({"loop": True} if anim in LOOPING and not (hero and anim == "cast") else {})}
    return {"src": src, "hold_ms": HOLD_MS.get(anim, 400)}


def discover() -> tuple[dict[str, dict[str, dict]], dict[str, dict], dict[str, str]]:
    """Sprite sets, spell flights and battle backgrounds found by file name in /assets."""
    sets: dict[str, dict[str, dict]] = {}
    fx: dict[str, dict] = {}
    backgrounds: dict[str, str] = {}
    for path in sorted(SOURCES.iterdir()):
        stem, src = path.stem.lower(), path.name
        if path.suffix.lower() not in (".mp4", ".jpeg", ".jpg", ".png"):
            continue
        if stem.startswith("mcattack") and stem != "mcattack":
            elements = stem[len("mcattack") :].split("+")
            spell = elements[0] if len(elements) == 1 else COMBOS.get(frozenset(elements))
            if spell:
                fx[f"fx_{spell}"] = {"src": src, **FX_ANIMS}
        elif stem.endswith("location") and stem[: -len("location")] in LOCATIONS:
            backgrounds[f"bg_location{LOCATIONS[stem[: -len('location')]]}"] = src
        elif stem.endswith("mc"):
            for anim in HERO_ANIMS.get(stem[:-2], []):
                sets.setdefault("hero", {})[anim] = anim_entry(anim, src, hero=True)
        else:
            for suffix, anim in ENEMY_ANIMS:
                if stem.endswith(suffix) and len(stem) > len(suffix):
                    prefix = stem[: -len(suffix)]
                    name = ENEMY_PREFIXES.get(prefix, prefix)
                    sets.setdefault(name, {}).setdefault(anim, anim_entry(anim, src, hero=False))
                    break
    return sets, fx, backgrounds


def merged_sets(found: dict[str, dict[str, dict]]) -> dict[str, dict[str, dict]]:
    """The configured sets, plus found animations they lack or only cover with a fallback."""
    out = {name: dict(spec) for name, spec in SETS.items()}
    for name, anims in found.items():
        spec = out.setdefault(name, {})
        for anim, entry in anims.items():
            current = spec.get(anim)
            if current is None or (current.get("fallback") and current["src"] != entry["src"]):
                spec[anim] = entry
    # A set needs a resting animation first: it gives the anchor.
    return {name: dict(sorted(spec.items(), key=lambda kv: kv[0] not in ("idle", "walk"))) for name, spec in out.items() if any(a in spec for a in ("idle", "walk"))}


def main() -> None:
    manifest = json.loads(MANIFEST.read_text())
    found_sets, found_fx, found_backgrounds = discover()
    sets = merged_sets(found_sets)
    for name, spec in sets.items():
        manifest["sprites"][name] = {**convert_set(name, spec), **({"scale": SET_SCALE[name]} if name in SET_SCALE else {})}
    fx = {**found_fx, **FX}
    for name, spec in fx.items():
        manifest["sprites"][name] = convert_fx(name, spec)
    backgrounds = {**BACKGROUNDS, **found_backgrounds}
    manifest["images"] = {key: convert_background(key, src) for key, src in backgrounds.items()}
    keyed = {key: src for key, src in KEYED.items() if (SOURCES / src).exists()}
    manifest["images"].update({key: convert_background(key, src, keyed=True) for key, src in keyed.items()})
    for target, (src, options) in MEDIA.items():
        convert_media(target, src, options)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"updated {MANIFEST.relative_to(ROOT)}")
    used = {a["src"] for spec in sets.values() for a in spec.values()} | {s["src"] for s in fx.values()}
    used |= set(backgrounds.values()) | set(keyed.values()) | {src for src, _ in MEDIA.values()}
    unused = sorted(p.name for p in SOURCES.iterdir() if p.is_file() and p.name not in used)
    if unused:
        print(f"not used yet: {', '.join(unused)}")


if __name__ == "__main__":
    main()
