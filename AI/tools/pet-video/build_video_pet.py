"""Extract transparent pet clips from a user's video, without redrawing it.

Pipeline inspired by PC2005-cloud/dsh-pet. Foreground masks use SkyTNT's
Apache-2.0 anime-segmentation ONNX model, executed locally with ONNX Runtime.
No model or source video is included in the application bundle.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image


def probe(path: Path) -> dict:
    result = subprocess.run(
        [shutil.which("ffprobe") or "ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", str(path)],
        check=True, capture_output=True, encoding="utf-8",
    )
    data = json.loads(result.stdout)
    return {**data["streams"][0], "duration": float(data["format"]["duration"])}


class Segmenter:
    def __init__(self, model: Path):
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
        input_info = self.session.get_inputs()[0]
        self.name = input_info.name
        self.size = int(input_info.shape[-1])
        print(f"segmentation input: {input_info.shape}", flush=True)

    def mask(self, rgb: np.ndarray) -> np.ndarray:
        height, width = rgb.shape[:2]
        scale = self.size / max(width, height)
        new_w, new_h = round(width * scale), round(height * scale)
        pad_x, pad_y = (self.size - new_w) // 2, (self.size - new_h) // 2
        image = np.zeros((self.size, self.size, 3), dtype=np.float32)
        image[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = cv2.resize(rgb, (new_w, new_h)) / 255.0
        prediction = self.session.run(None, {self.name: image.transpose(2, 0, 1)[None]})[0].squeeze()
        prediction = prediction[pad_y:pad_y + new_h, pad_x:pad_x + new_w]
        prediction = cv2.resize(prediction, (width, height), interpolation=cv2.INTER_LINEAR)
        # Keep the dominant character, discarding disconnected scene particles.
        count, labels, stats, _ = cv2.connectedComponentsWithStats((prediction > 0.35).astype(np.uint8), 8)
        if count <= 1:
            raise RuntimeError("No character foreground found")
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        support = cv2.dilate((labels == largest).astype(np.uint8), np.ones((7, 7), np.uint8))
        return np.clip((prediction - 0.04) / 0.92, 0, 1) * support


def read_frame(source: Path, at: float) -> np.ndarray:
    capture = cv2.VideoCapture(str(source))
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, at * 1000)
        ok, bgr = capture.read()
        if not ok:
            raise RuntimeError(f"Cannot read video at {at}s")
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    finally:
        capture.release()


def crop_frame(rgb: np.ndarray) -> np.ndarray:
    height, width = rgb.shape[:2]
    return rgb[:, round(width * 0.22):round(width * 0.78)]


def sample(args, segmenter: Segmenter):
    rgb = crop_frame(read_frame(args.source, args.sample))
    began = time.perf_counter()
    mask = segmenter.mask(rgb)
    rgba = np.dstack((rgb, np.round(mask * 255).astype(np.uint8)))
    Image.fromarray(rgba).save(args.output / "sample.png")
    for name, color in [("white", (255, 255, 255)), ("dark", (28, 25, 35))]:
        composite = rgb * mask[..., None] + np.array(color) * (1 - mask[..., None])
        Image.fromarray(composite.astype(np.uint8)).save(args.output / f"sample-{name}.png")
    print(f"sample inference: {time.perf_counter() - began:.2f}s; alpha range {mask.min():.3f}..{mask.max():.3f}", flush=True)


def read_exact(pipe, size: int) -> bytes:
    chunks, remaining = [], size
    while remaining:
        chunk = pipe.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def render_clip(args, segmenter, clip, metadata):
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    fps, canvas_w, canvas_h, feet_y = 24, 640, 704, 672
    frames_dir = Path(__file__).resolve().parents[2] / "node_modules" / ".cache" / "pet-video-frames" / clip["id"]
    frames_dir.mkdir(parents=True, exist_ok=True)
    if args.reuse_frames:
        frames = sorted(frames_dir.glob("[0-9][0-9][0-9][0-9][0-9].png"))[:round(clip["duration"] * fps)]
        if len(frames) < round(clip["duration"] * fps):
            raise RuntimeError("Not enough cached frames")
        return encode_clip(args, clip, frames, fps, canvas_w, canvas_h)
    # One fixed transform per clip: never chase each frame's bounding box.
    boxes = []
    for offset in (0, clip["duration"] / 2, clip["duration"] - 0.05):
        rgb = crop_frame(read_frame(args.source, clip["start"] + offset))
        mask = segmenter.mask(rgb)
        ys, xs = np.where(mask > 0.5)
        boxes.append((int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    scale = min(592 / (y1 - y0 + 1), 584 / (x1 - x0 + 1))
    matrix = np.float32([[scale, 0, canvas_w / 2 - (x0 + x1) * scale / 2],
                         [0, scale, feet_y - y1 * scale]])
    width, height = metadata["width"], metadata["height"]
    crop_x, crop_end = round(width * 0.22), round(width * 0.78)
    crop_w = crop_end - crop_x
    decoder = subprocess.Popen(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", str(clip["start"]), "-i", str(args.source),
         "-t", str(clip["duration"]), "-an", "-vf", f"fps={fps},crop={crop_w}:{height}:{crop_x}:0",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE,
    )
    frames, alpha_stats = [], []
    began = time.perf_counter()
    try:
        while True:
            data = read_exact(decoder.stdout, crop_w * height * 3)
            if not data:
                break
            if len(data) != crop_w * height * 3:
                raise RuntimeError("Incomplete decoded frame")
            rgb = np.frombuffer(data, np.uint8).reshape(height, crop_w, 3)
            mask = segmenter.mask(rgb)
            rgba = np.dstack((rgb, np.round(mask * 255).astype(np.uint8)))
            # Resample premultiplied RGB, then unpremultiply: avoids dark fringes.
            premultiplied = rgba.astype(np.float32)
            premultiplied[..., :3] *= premultiplied[..., 3:4] / 255
            moved = cv2.warpAffine(premultiplied, matrix, (canvas_w, canvas_h), flags=cv2.INTER_LINEAR)
            moved[..., :3] = np.divide(moved[..., :3] * 255, moved[..., 3:4],
                                      out=np.zeros_like(moved[..., :3]), where=moved[..., 3:4] > 0)
            moved = np.clip(np.round(moved), 0, 255).astype(np.uint8)
            alpha = moved[..., 3]
            if alpha.max() < 240 or alpha.min() != 0:
                raise RuntimeError("Invalid transparency in processed frame")
            ys, xs = np.where(alpha > 127)
            alpha_stats.append({"bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                                "opaquePixels": int((alpha > 240).sum())})
            frame_path = frames_dir / f"{len(frames):05d}.png"
            Image.fromarray(moved).save(frame_path)
            frames.append(frame_path)
            if len(frames) % 12 == 0:
                print(f"{clip['id']}: {len(frames)} frames, {time.perf_counter() - began:.1f}s", flush=True)
    finally:
        decoder.stdout.close()
        if decoder.wait() != 0:
            raise RuntimeError("Source video decoding failed")
    if len(frames) < 12:
        raise RuntimeError("Too few frames for an action")
    return encode_clip(args, clip, frames, fps, canvas_w, canvas_h)


def encode_clip(args, clip, original_frames, fps, canvas_w, canvas_h):
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    refined_dir = original_frames[0].parent / "refined"
    refined_dir.mkdir(exist_ok=True)
    with Image.open(original_frames[0]) as first:
        reference = np.array(first.convert("RGBA"))
    ref_gray = cv2.cvtColor(reference[..., :3], cv2.COLOR_RGB2GRAY)
    ref_support = (reference[..., 3] > 90).astype(np.uint8) * 255
    yy, xx = np.mgrid[:canvas_h, :canvas_w].astype(np.float32)
    frames, alpha_stats = [], []
    for i, path in enumerate(original_frames):
        with Image.open(path) as source:
            rgba = np.array(source.convert("RGBA"))
        if i:
            gray = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2GRAY)
            flow = cv2.calcOpticalFlowFarneback(gray, ref_gray, None, 0.5, 4, 31, 5, 7, 1.5, 0)
            support = cv2.remap(ref_support, xx + flow[..., 0], yy + flow[..., 1], cv2.INTER_NEAREST,
                                borderMode=cv2.BORDER_CONSTANT)
        else:
            support = ref_support
        support = cv2.dilate(support, np.ones((7, 7), np.uint8))
        # Preserve semantic masks around moving hair/hands. The reference
        # constraint is only needed for spurious ground glow beneath the feet.
        support[:round(canvas_h * 0.83)] = 255
        rgba[..., 3] = np.where(support > 0, rgba[..., 3], 0)
        rgba[rgba[..., 3] == 0, :3] = 0
        output = refined_dir / path.name
        Image.fromarray(rgba).save(output)
        frames.append(output)
        ys, xs = np.where(rgba[..., 3] > 127)
        alpha_stats.append({"bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]})
    # Reversing short natural gestures avoids a hard pose jump at loop end.
    sequence = frames + frames[-2:0:-1]
    output_path = args.output / f"{clip['id']}-v1.webm"
    encoder = subprocess.Popen(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba",
         "-s", f"{canvas_w}x{canvas_h}", "-r", str(fps), "-i", "-", "-an", "-c:v", "libvpx-vp9",
         "-pix_fmt", "yuva420p", "-crf", "24", "-b:v", "0", "-auto-alt-ref", "0", "-row-mt", "1",
         "-deadline", "good", "-cpu-used", "4", str(output_path)], stdin=subprocess.PIPE,
    )
    try:
        for frame_path in sequence:
            with Image.open(frame_path) as frame:
                encoder.stdin.write(frame.convert("RGBA").tobytes())
    finally:
        encoder.stdin.close()
        if encoder.wait() != 0:
            raise RuntimeError("Transparent WebM encoding failed")
    with Image.open(frames[0]) as poster:
        poster.save(args.output / f"{clip['id']}-poster.png")
    print(f"{clip['id']}: encoded {len(sequence)} frames -> {output_path.name}", flush=True)
    return {
        "id": clip["id"], "label": clip["label"], "file": output_path.name,
        "duration": len(sequence) / fps, "fps": fps, "frames": len(sequence),
        "sourceStart": clip["start"], "sourceDuration": clip["duration"],
        "loopMethod": "forward-reverse", "sha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
        "alphaCheckedFrames": len(alpha_stats),
        "bounds": [min(s["bbox"][0] for s in alpha_stats), min(s["bbox"][1] for s in alpha_stats),
                   max(s["bbox"][2] for s in alpha_stats), max(s["bbox"][3] for s in alpha_stats)],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sample", type=float)
    parser.add_argument("--clips", type=Path)
    parser.add_argument("--reuse-frames", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    metadata = probe(args.source)
    print(json.dumps(metadata), flush=True)
    segmenter = None if args.reuse_frames else Segmenter(args.model)
    if args.sample is not None:
        sample(args, segmenter)
        return
    if not args.clips:
        parser.error("--clips is required when not sampling")
    clips = json.loads(args.clips.read_text(encoding="utf-8"))["clips"]
    for clip in clips:
        if clip["start"] < 0 or clip["start"] + clip["duration"] > metadata["duration"]:
            raise ValueError(f"Invalid source interval: {clip['id']}")
    rendered = [render_clip(args, segmenter, clip, metadata) for clip in clips]
    manifest = {
        "version": 1, "renderer": "alpha-video", "canvas": {"width": 640, "height": 704},
        "anchor": {"x": 320, "feetY": 672}, "sourceFile": args.source.name,
        "sourceSha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
        "model": "SkyTNT/anime-segmentation isnetis.onnx (Apache-2.0)",
        "modelSha256": hashlib.sha256(args.model.read_bytes()).hexdigest(),
        "actions": {clip["id"]: clip for clip in rendered},
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Video pet package complete", flush=True)


if __name__ == "__main__":
    main()
