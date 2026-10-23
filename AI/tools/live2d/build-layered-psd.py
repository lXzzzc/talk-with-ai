from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import Group, PixelLayer


def pixel_layer(psd: PSDImage, path: Path, name: str) -> PixelLayer:
    image = Image.open(path).convert("RGBA")
    if image.size != psd.size:
        raise ValueError(f"{path} uses {image.size}, expected {psd.size}")
    return PixelLayer.frompil(image, psd, layer_name=name, top=0, left=0)


def add_group(parent: PSDImage | Group, psd: PSDImage, name: str, layers: list[tuple[str, Path, bool]]) -> Group:
    group = Group.new(name=name, open_folder=True, parent=parent)
    for layer_name, path, visible in layers:
        layer = pixel_layer(psd, path, layer_name)
        layer.visible = visible
        group.append(layer)
    return group


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: build-layered-psd.py <xilian-v1-directory>")

    root = Path(sys.argv[1]).resolve()
    approved_path = root / "source" / "approved-clean.png"
    if not approved_path.exists():
        approved_path = root / "source" / "approved.png"
    approved = Image.open(approved_path).convert("RGBA")
    psd = PSDImage.new(mode="RGBA", size=approved.size, color=0)

    visible = root / "layers-visible"
    fill = root / "layers-fill"

    add_group(
        psd,
        psd,
        "01_Hair_Back",
        [
            ("BackHair_L", visible / "back_hair_left.png", True),
            ("BackHair_R", visible / "back_hair_right.png", True),
        ],
    )
    add_group(
        psd,
        psd,
        "02_Body",
        [
            ("Body_Underlay", fill / "body_underlay.png", True),
            ("Leg_L", visible / "leg_left.png", True),
            ("Leg_R", visible / "leg_right.png", True),
            ("Shoe_L", visible / "shoe_left.png", True),
            ("Shoe_R", visible / "shoe_right.png", True),
            ("Tail_Outer_L", visible / "tail_outer_left.png", True),
            ("Tail_Inner_L", visible / "tail_inner_left.png", True),
            ("Tail_Inner_R", visible / "tail_inner_right.png", True),
            ("Tail_Outer_R", visible / "tail_outer_right.png", True),
            ("Skirt_Front_L", visible / "skirt_front_left.png", True),
            ("Skirt_Front_R", visible / "skirt_front_right.png", True),
            ("Torso", visible / "torso.png", True),
            ("Waist_Corsage", visible / "waist_corsage.png", True),
            ("Arm_L", visible / "arm_left.png", True),
            ("Arm_R", visible / "arm_right.png", True),
        ],
    )
    head = Group.new(name="03_Head", open_folder=True, parent=psd)
    head.append(pixel_layer(psd, fill / "face_underlay.png", "Face_Underlay"))
    expression = root / "layers-expression"
    add_group(head, psd, "Eye_L", [
        ("Eye_Sclera_L", expression / "eye_sclera_left.png", True),
        ("Eye_Iris_L", expression / "eye_iris_left.png", True),
        ("Eye_Highlight_L", expression / "eye_highlight_left.png", True),
        ("Eye_Closed_L", expression / "eye_closed_left.png", False),
    ])
    add_group(head, psd, "Eye_R", [
        ("Eye_Sclera_R", expression / "eye_sclera_right.png", True),
        ("Eye_Iris_R", expression / "eye_iris_right.png", True),
        ("Eye_Highlight_R", expression / "eye_highlight_right.png", True),
        ("Eye_Closed_R", expression / "eye_closed_right.png", False),
    ])
    add_group(head, psd, "Mouth", [
        ("Mouth_Closed", expression / "mouth_closed.png", True),
        ("Mouth_Open", expression / "mouth_open.png", False),
    ])
    add_group(head, psd, "Hair_Front", [
        ("Hair_Crown", visible / "hair_crown.png", True),
        ("Hair_Side_L", visible / "hair_side_left.png", True),
        ("Hair_Bangs_L", visible / "hair_bangs_left.png", True),
        ("Hair_Bangs_C", visible / "hair_bangs_center.png", True),
        ("Hair_Bangs_R", visible / "hair_bangs_right.png", True),
        ("Hair_Side_R", visible / "hair_side_right.png", True),
        ("Head_Ornament", visible / "head_ornament.png", True),
        ("Head_Ornament_R", visible / "head_ornament_right.png", True),
    ])

    reference = add_group(
        psd,
        psd,
        "99_Reference_DO_NOT_EDIT",
        [("Approved_Full_Reference", approved_path, True)],
    )
    reference.visible = False

    output = root / "xilian-v3-layered.psd"
    psd.save(output)
    psd.composite(color=1.0, alpha=1.0).convert("RGB").save(root / "guides" / "psd-v3-composite.png")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
