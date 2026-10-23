"""Decode every published WebM frame and verify real alpha and motion."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.package / "manifest.json").read_text(encoding="utf-8"))
    width, height = manifest["canvas"]["width"], manifest["canvas"]["height"]
    report = {"renderer": manifest["renderer"], "actions": {}}
    sheet = Image.new("RGB", (5 * 220, len(manifest['actions']) * 252), (32, 29, 38))
    painter = ImageDraw.Draw(sheet)
    for row, (name, action) in enumerate(manifest["actions"].items()):
        path = args.package / action["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != action["sha256"]:
            raise ValueError(f"Checksum mismatch: {path.name}")
        probe = json.loads(subprocess.check_output(
            [shutil.which("ffprobe"), "-v", "error", "-show_streams", "-of", "json", str(path)], encoding="utf-8"))
        if any(stream["codec_type"] == "audio" for stream in probe["streams"]):
            raise ValueError("Pet animations must not contain an audio track")
        data = subprocess.check_output(
            [shutil.which("ffmpeg"), "-v", "error", "-c:v", "libvpx-vp9", "-i", str(path),
             "-f", "rawvideo", "-pix_fmt", "rgba", "-"])
        frames = np.frombuffer(data, np.uint8).reshape(-1, height, width, 4)
        if len(frames) != action["frames"]:
            raise ValueError(f"Decoded frame count mismatch: {name}")
        alpha = frames[..., 3]
        if not np.all(alpha.min(axis=(1, 2)) == 0) or not np.all(alpha.max(axis=(1, 2)) > 240):
            raise ValueError(f"Lost alpha/foreground: {name}")
        border = np.concatenate((alpha[:, 0, :], alpha[:, -1, :], alpha[:, :, 0], alpha[:, :, -1]), axis=1)
        if border.max() > 8:
            raise ValueError(f"Character touches canvas boundary: {name}")
        motion = float(np.mean(np.abs(frames[0].astype(np.float32) - frames[len(frames) // 2])))
        if motion < 0.1:
            raise ValueError(f"No actual character motion: {name}")
        seam = float(np.mean(np.abs(frames[0].astype(np.float32) - frames[-1])))
        report["actions"][name] = {"decodedFrames": len(frames), "actualAlpha": True,
                                   "borderAlphaMax": int(border.max()), "motionMean": round(motion, 3),
                                   "loopSeamMean": round(seam, 3), "bytes": path.stat().st_size}
        indices = np.linspace(0, len(frames) // 2, 5, dtype=int)
        for col, index in enumerate(indices):
            rgba = Image.fromarray(frames[index])
            rgba.thumbnail((210, 231), Image.Resampling.LANCZOS)
            background = Image.new("RGBA", rgba.size, (245, 242, 248, 255) if col % 2 else (32, 29, 38, 255))
            background.alpha_composite(rgba)
            sheet.paste(background.convert("RGB"), (col * 220 + 5, row * 252))
            painter.text((col * 220 + 8, row * 252 + 233), f"{name}  frame {index}", fill=(205, 197, 211))
        print(f"OK {name}: {len(frames)} frames, real alpha, moving, transparent borders", flush=True)
    args.report.mkdir(parents=True, exist_ok=True)
    (args.report / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    sheet.save(args.report / "contact-sheet.png")


if __name__ == "__main__":
    main()
