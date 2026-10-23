from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageFilter


def polygon_mask(size: tuple[int, int], points: list[tuple[int, int]]) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask


def rectangle_mask(size: tuple[int, int], box: tuple[int, int, int, int]) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rectangle(box, fill=255)
    return mask


def ellipse_mask(size: tuple[int, int], box: tuple[int, int, int, int]) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).ellipse(box, fill=255)
    return mask


def mask_intersection(left: Image.Image, right: Image.Image) -> Image.Image:
    a = np.asarray(left, dtype=np.uint16)
    b = np.asarray(right, dtype=np.uint16)
    return Image.fromarray((a * b // 255).astype(np.uint8), mode="L")


def mask_subtract(left: Image.Image, right: Image.Image) -> Image.Image:
    a = np.asarray(left, dtype=np.uint16)
    b = np.asarray(right, dtype=np.uint16)
    return Image.fromarray((a * (255 - b) // 255).astype(np.uint8), mode="L")


def feature_mask(
    image: Image.Image,
    region: Image.Image,
    *,
    saturation_min: int = 45,
    value_max: int = 210,
    grow: int = 3,
) -> Image.Image:
    hsv = np.asarray(image.convert("HSV"), dtype=np.uint8)
    selected = ((hsv[:, :, 1] >= saturation_min) & (hsv[:, :, 2] <= value_max)).astype(np.uint8) * 255
    mask = mask_intersection(Image.fromarray(selected, mode="L"), region)
    if grow > 1:
        mask = mask.filter(ImageFilter.MaxFilter(grow))
    return mask_intersection(mask, region)


def intersect_alpha(source: Image.Image, mask: Image.Image) -> Image.Image:
    out = np.asarray(source, dtype=np.uint8).copy()
    alpha = np.asarray(source.getchannel("A"), dtype=np.uint16)
    region = np.asarray(mask, dtype=np.uint16)
    final_alpha = ((alpha * region) // 255).astype(np.uint8)
    out[:, :, 3] = final_alpha
    out[final_alpha == 0, :3] = 0
    return Image.fromarray(out, mode="RGBA")


def save_layer(source: Image.Image, mask: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    intersect_alpha(source, mask).save(path)


def clean_transparent_noise(source: Image.Image) -> Image.Image:
    """Remove detached near-transparent generation noise without trimming edges."""
    out = np.asarray(source, dtype=np.uint8).copy()
    alpha = source.getchannel("A")
    stable = np.asarray(alpha, dtype=np.uint8) >= 24
    near_character = Image.fromarray(stable.astype(np.uint8) * 255, mode="L").filter(ImageFilter.MaxFilter(11))
    keep = np.asarray(near_character, dtype=np.uint8) > 0
    out[~keep] = 0
    return Image.fromarray(out, mode="RGBA")


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: create-visible-layers.py <xilian-v1-directory>")

    root = Path(sys.argv[1]).resolve()
    source_path = root / "source" / "approved.png"
    source = clean_transparent_noise(Image.open(source_path).convert("RGBA"))
    if source.size != (1195, 1316):
        raise ValueError(f"unexpected canvas {source.size}; expected (1195, 1316)")
    source.save(root / "source" / "approved-clean.png")

    size = source.size
    outer_front_hair = polygon_mask(
        size,
        [(185, 75), (860, 65), (1020, 620), (790, 690), (700, 570), (480, 655), (235, 620)]
    )
    face_cutout = polygon_mask(
        size,
        [(425, 330), (765, 330), (820, 470), (790, 585), (705, 630), (490, 630), (395, 565), (375, 465)]
    )
    hsv = np.asarray(source.convert("HSV"), dtype=np.uint8)
    pink = ((hsv[:, :, 0] >= 225) & (hsv[:, :, 1] >= 28) & (hsv[:, :, 2] >= 90)).astype(np.uint8) * 255
    pink = Image.fromarray(pink, mode="L").filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(11))
    outer_arr = np.asarray(outer_front_hair, dtype=np.uint16)
    face_arr = np.asarray(face_cutout, dtype=np.uint16)
    pink_arr = np.asarray(pink, dtype=np.uint16)
    front_hair = Image.fromarray(
        np.maximum(
            outer_arr * (255 - face_arr) // 255,
            pink_arr * face_arr // 255,
        ).astype(np.uint8),
        mode="L",
    )

    masks: dict[str, Image.Image] = {
        "back_hair_left": polygon_mask(size, [(18, 415), (315, 120), (505, 195), (520, 820), (430, 1010), (25, 1035)]),
        "back_hair_right": polygon_mask(size, [(675, 150), (850, 90), (1178, 410), (1175, 1035), (760, 1005), (675, 790)]),
        "head_ornament": polygon_mask(size, [(235, 0), (520, 0), (500, 405), (255, 405)]),
        "head_ornament_right": polygon_mask(size, [(738, 45), (820, 45), (840, 225), (735, 225)]),
        "front_hair": front_hair,
        "face_base": polygon_mask(size, [(405, 365), (795, 365), (820, 570), (720, 630), (480, 630), (375, 560)]),
        "eye_left": ellipse_mask(size, (425, 440, 555, 548)),
        "eye_right": ellipse_mask(size, (625, 440, 755, 548)),
        "mouth": ellipse_mask(size, (560, 548, 635, 600)),
        "arm_left": polygon_mask(size, [(365, 700), (520, 710), (500, 800), (430, 820), (390, 900), (265, 885), (285, 790)]),
        "arm_right": polygon_mask(size, [(680, 705), (820, 700), (905, 785), (930, 875), (805, 900), (760, 815), (690, 795)]),
        "torso": polygon_mask(size, [(455, 600), (735, 600), (785, 810), (690, 930), (500, 930), (410, 805)]),
        "waist_corsage": polygon_mask(size, [(455, 785), (625, 785), (675, 900), (565, 950), (455, 905)]),
        "skirt_left": polygon_mask(size, [(225, 810), (600, 790), (585, 1040), (420, 1218), (20, 1230), (210, 950)]),
        "skirt_right": polygon_mask(size, [(595, 790), (965, 810), (1178, 1228), (775, 1220), (610, 1040)]),
        "leg_left": polygon_mask(size, [(490, 895), (600, 895), (600, 1250), (505, 1250)]),
        "leg_right": polygon_mask(size, [(594, 895), (705, 895), (690, 1250), (594, 1250)]),
        "shoe_left": polygon_mask(size, [(490, 1165), (600, 1165), (600, 1316), (485, 1316)]),
        "shoe_right": polygon_mask(size, [(595, 1165), (710, 1165), (710, 1316), (595, 1316)])
    }

    out_dir = root / "layers-visible"
    out_dir.mkdir(parents=True, exist_ok=True)

    hair_front_mask = masks["front_hair"]
    head_ornament_mask = masks["head_ornament"]
    head_ornament_right_mask = masks["head_ornament_right"]
    hair_front_clean = mask_subtract(
        mask_subtract(hair_front_mask, head_ornament_mask),
        head_ornament_right_mask,
    )
    fine_masks: dict[str, Image.Image] = {
        # This crown bridge was absent from the v2 fine hair polygons, producing
        # the rectangular transparent notch visible at the top of the model.
        "hair_crown": mask_intersection(
            hair_front_clean,
            polygon_mask(size, [(490, 70), (742, 70), (760, 205), (475, 205)]),
        ),
        "hair_side_left": mask_intersection(hair_front_clean, polygon_mask(size, [(180, 320), (510, 280), (535, 675), (225, 690)])),
        "hair_bangs_left": mask_intersection(hair_front_clean, polygon_mask(size, [(390, 185), (575, 170), (590, 625), (410, 620)])),
        "hair_bangs_center": mask_intersection(hair_front_clean, polygon_mask(size, [(515, 135), (700, 135), (700, 620), (535, 620)])),
        "hair_bangs_right": mask_intersection(hair_front_clean, polygon_mask(size, [(650, 170), (850, 190), (820, 650), (665, 625)])),
        "hair_side_right": mask_intersection(hair_front_clean, polygon_mask(size, [(760, 280), (1015, 330), (990, 690), (735, 685)])),
        "skirt_front_left": mask_intersection(masks["skirt_left"], polygon_mask(size, [(300, 805), (605, 790), (600, 1035), (350, 1085)])),
        "skirt_front_right": mask_intersection(masks["skirt_right"], polygon_mask(size, [(585, 790), (850, 805), (855, 1085), (595, 1035)])),
        "tail_outer_left": mask_intersection(masks["skirt_left"], polygon_mask(size, [(0, 890), (410, 845), (500, 1080), (310, 1260), (0, 1260)])),
        "tail_inner_left": mask_intersection(masks["skirt_left"], polygon_mask(size, [(205, 820), (585, 830), (575, 1185), (315, 1210), (185, 1000)])),
        "tail_inner_right": mask_intersection(masks["skirt_right"], polygon_mask(size, [(605, 830), (985, 820), (1010, 1000), (880, 1210), (620, 1185)])),
        "tail_outer_right": mask_intersection(masks["skirt_right"], polygon_mask(size, [(785, 845), (1180, 900), (1180, 1240), (885, 1240), (695, 1080)])),
    }
    # A flattened illustration can place several visual elements inside the
    # same broad polygon (for example the back-hair polygon also crosses the
    # arm and skirt).  Saving every broad polygon independently caused those
    # pixels to be stacked several times in Cubism/PSD, producing dark specks
    # and triangular colour patches.  Assign each visible source pixel to the
    # foremost matching part instead.
    raw_visible_masks: dict[str, Image.Image] = {
        "head_ornament": masks["head_ornament"],
        "head_ornament_right": masks["head_ornament_right"],
        "hair_bangs_left": fine_masks["hair_bangs_left"],
        "hair_bangs_center": fine_masks["hair_bangs_center"],
        "hair_bangs_right": fine_masks["hair_bangs_right"],
        "hair_side_left": fine_masks["hair_side_left"],
        "hair_side_right": fine_masks["hair_side_right"],
        "hair_crown": fine_masks["hair_crown"],
        "arm_left": masks["arm_left"],
        "arm_right": masks["arm_right"],
        "waist_corsage": masks["waist_corsage"],
        "skirt_front_left": fine_masks["skirt_front_left"],
        "skirt_front_right": fine_masks["skirt_front_right"],
        "torso": masks["torso"],
        "shoe_left": masks["shoe_left"],
        "shoe_right": masks["shoe_right"],
        "leg_left": masks["leg_left"],
        "leg_right": masks["leg_right"],
        "tail_inner_left": fine_masks["tail_inner_left"],
        "tail_inner_right": fine_masks["tail_inner_right"],
        "tail_outer_left": fine_masks["tail_outer_left"],
        "tail_outer_right": fine_masks["tail_outer_right"],
        "back_hair_left": masks["back_hair_left"],
        "back_hair_right": masks["back_hair_right"],
    }
    claimed = Image.new("L", size, 0)
    for name, raw_mask in raw_visible_masks.items():
        owned_mask = mask_subtract(raw_mask, claimed)
        save_layer(source, owned_mask, out_dir / f"{name}.png")
        claimed = Image.fromarray(
            np.maximum(np.asarray(claimed), np.asarray(raw_mask)).astype(np.uint8),
            mode="L",
        )

    # Keep the coarser extraction layers for diagnostics only.  They are not
    # imported by the v3 PSD because they intentionally overlap many parts.
    coarse_dir = root / "layers-coarse"
    for name in ("front_hair", "face_base", "eye_left", "eye_right", "mouth", "skirt_left", "skirt_right"):
        save_layer(source, masks[name], coarse_dir / f"{name}.png")

    fill_plate_path = root / "fills" / "face-underlay-plate.png"
    if fill_plate_path.exists():
        fill_plate = Image.open(fill_plate_path).convert("RGBA")
        if fill_plate.size != size:
            raise ValueError(f"unexpected face fill canvas {fill_plate.size}; expected {size}")
        face_underlay = ellipse_mask(size, (408, 240, 800, 625))
        save_layer(fill_plate, face_underlay, root / "layers-fill" / "face_underlay.png")

    body_fill_path = root / "fills" / "body-underlay-plate.png"
    if body_fill_path.exists():
        body_fill = Image.open(body_fill_path).convert("RGBA")
        if body_fill.size != size:
            raise ValueError(f"unexpected body fill canvas {body_fill.size}; expected {size}")
        body_underlay = polygon_mask(
            size,
            [(405, 600), (790, 600), (820, 785), (740, 930), (620, 965), (475, 940), (380, 800)]
        )
        save_layer(body_fill, body_underlay, root / "layers-fill" / "body_underlay.png")

    expression_dir = root / "fills" / "expressions"
    sclera_plate_path = expression_dir / "eye-sclera-plate.png"
    closed_plate_path = expression_dir / "eyes-closed-plate.png"
    mouth_open_plate_path = expression_dir / "mouth-open-plate.png"
    if sclera_plate_path.exists() and closed_plate_path.exists() and mouth_open_plate_path.exists():
        sclera_plate = Image.open(sclera_plate_path).convert("RGBA")
        closed_plate = Image.open(closed_plate_path).convert("RGBA")
        mouth_open_plate = Image.open(mouth_open_plate_path).convert("RGBA")
        for plate in (sclera_plate, closed_plate, mouth_open_plate):
            if plate.size != size:
                raise ValueError(f"unexpected expression canvas {plate.size}; expected {size}")

        eye_left_shape = polygon_mask(size, [(425, 476), (458, 448), (518, 447), (555, 478), (538, 529), (488, 546), (445, 527)])
        eye_right_shape = polygon_mask(size, [(625, 478), (657, 450), (715, 447), (754, 476), (738, 527), (692, 546), (648, 528)])
        iris_left = ellipse_mask(size, (453, 475, 539, 548))
        iris_right = ellipse_mask(size, (651, 475, 737, 548))

        source_hsv = np.asarray(source.convert("HSV"), dtype=np.uint8)
        bright = ((source_hsv[:, :, 2] >= 240) & (source_hsv[:, :, 1] <= 70)).astype(np.uint8) * 255
        bright_mask = Image.fromarray(bright, mode="L")
        iris_color = (
            (((source_hsv[:, :, 0] >= 170) & (source_hsv[:, :, 0] <= 250) & (source_hsv[:, :, 1] >= 50)))
            | (source_hsv[:, :, 2] <= 140)
        ).astype(np.uint8) * 255
        iris_color_mask = Image.fromarray(iris_color, mode="L")
        highlight_left_region = polygon_mask(size, [(500, 472), (521, 498), (500, 524), (479, 498)])
        highlight_right_region = polygon_mask(size, [(694, 472), (715, 498), (694, 524), (673, 498)])
        highlight_left = mask_intersection(bright_mask, highlight_left_region)
        highlight_right = mask_intersection(bright_mask, highlight_right_region)

        expression_layers = root / "layers-expression"
        save_layer(sclera_plate, eye_left_shape, expression_layers / "eye_sclera_left.png")
        save_layer(sclera_plate, eye_right_shape, expression_layers / "eye_sclera_right.png")
        save_layer(source, mask_subtract(mask_intersection(iris_left, iris_color_mask), highlight_left), expression_layers / "eye_iris_left.png")
        save_layer(source, mask_subtract(mask_intersection(iris_right, iris_color_mask), highlight_right), expression_layers / "eye_iris_right.png")
        save_layer(source, highlight_left, expression_layers / "eye_highlight_left.png")
        save_layer(source, highlight_right, expression_layers / "eye_highlight_right.png")
        closed_left_region = ellipse_mask(size, (425, 482, 555, 548))
        closed_right_region = ellipse_mask(size, (625, 482, 755, 548))
        save_layer(closed_plate, feature_mask(closed_plate, closed_left_region, saturation_min=55, value_max=190, grow=5), expression_layers / "eye_closed_left.png")
        save_layer(closed_plate, feature_mask(closed_plate, closed_right_region, saturation_min=55, value_max=190, grow=5), expression_layers / "eye_closed_right.png")

        mouth_region = ellipse_mask(size, (555, 545, 642, 615))
        save_layer(source, feature_mask(source, mouth_region, saturation_min=45, value_max=225, grow=3), expression_layers / "mouth_closed.png")
        save_layer(mouth_open_plate, feature_mask(mouth_open_plate, mouth_region, saturation_min=45, value_max=235, grow=3), expression_layers / "mouth_open.png")

    composite_alpha = Image.new("L", size, 0)
    for mask in masks.values():
        composite_alpha = Image.fromarray(
            np.maximum(np.asarray(composite_alpha), np.asarray(mask)).astype(np.uint8), mode="L"
        )

    palette = [
        "#ff4f9a", "#48c8ff", "#ffd25f", "#8e6cff", "#64e0bf", "#ff8a5b",
        "#d661ff", "#4f77ff", "#ff6685", "#58d6d0", "#ffb84d", "#9973ff",
        "#ff74cc", "#7cc7ff", "#f19f62", "#84d45b"
    ]
    preview = source.copy()
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    legend = []
    for index, (name, mask) in enumerate(masks.items()):
        color = ImageColor.getrgb(palette[index % len(palette)])
        tint = Image.new("RGBA", size, (*color, 72))
        tint.putalpha(Image.fromarray((np.asarray(mask, dtype=np.uint16) * 72 // 255).astype(np.uint8), mode="L"))
        overlay = Image.alpha_composite(overlay, tint)
        legend.append({"name": name, "color": "#%02x%02x%02x" % color})
    preview = Image.alpha_composite(preview, overlay)
    guide_dir = root / "guides"
    guide_dir.mkdir(parents=True, exist_ok=True)
    preview.save(guide_dir / "layer-map.png")
    (guide_dir / "layer-map.json").write_text(json.dumps(legend, ensure_ascii=False, indent=2), encoding="utf-8")

    uncovered = source.copy()
    uncovered_alpha = np.asarray(source.getchannel("A"), dtype=np.uint16)
    covered = np.asarray(composite_alpha, dtype=np.uint16)
    uncovered.putalpha(Image.fromarray((uncovered_alpha * (255 - covered) // 255).astype(np.uint8), mode="L"))
    uncovered.save(guide_dir / "unassigned-visible-pixels.png")
    print(f"created {len(masks)} visible layers in {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
