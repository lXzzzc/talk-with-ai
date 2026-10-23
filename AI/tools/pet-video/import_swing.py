"""Key a green-screen swing clip, preserving the complete swing as foreground.

Usage: python tools/pet-video/import_swing.py <source.mp4>
Requires ffmpeg, numpy and Pillow. Does not modify the source video.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

WIDTH, HEIGHT, FPS = 958, 540, 24
ACTION = 'swing-diagonal'


def frames(source):
    decoder = subprocess.Popen([
        'ffmpeg', '-v', 'error', '-i', str(source), '-t', '10', '-an',
        '-vf', f'fps={FPS},scale={WIDTH}:{HEIGHT}', '-f', 'rawvideo',
        '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    try:
        size = WIDTH * HEIGHT * 3
        while True:
            data = bytearray()
            while len(data) < size:
                chunk = decoder.stdout.read(size - len(data))
                if not chunk:
                    break
                data.extend(chunk)
            if not data:
                break
            if len(data) != size:
                raise RuntimeError('Incomplete source frame')
            rgb = np.frombuffer(data, np.uint8).reshape(HEIGHT, WIDTH, 3).copy()
            # Green dominance removes the screen without a human-only mask,
            # so thin ropes, leaves and the winged seat remain visible.
            color = rgb.astype(np.float32)
            green = color[..., 1] - np.maximum(color[..., 0], color[..., 2])
            alpha = np.clip((75 - green) / 60, 0, 1)
            # Exclude only the source's corner watermarks in empty screen areas.
            alpha[:50, :100] = 0
            alpha[490:, 800:] = 0
            color[..., 1] -= np.maximum(green, 0) * (1 - alpha)
            rgba = np.dstack((color.clip(0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)))
            yield Image.fromarray(rgba)
    finally:
        decoder.stdout.close()
        if decoder.wait() != 0:
            raise RuntimeError('Source decoding failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    dest = Path(__file__).resolve().parents[2] / 'public/pets/xilian-video-v2'
    manifest_path = dest / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    # Measure every frame, then use one fixed transform for the whole clip.
    # The standing pet's feet anchor is deliberately not used for this pose.
    bounds = [WIDTH, HEIGHT, 0, 0]
    with tempfile.TemporaryDirectory(prefix='xilian-swing-') as temporary:
        cache = Path(temporary)
        count = 0
        for count, frame in enumerate(frames(args.source), 1):
            alpha = np.array(frame)[..., 3]
            ys, xs = np.where(alpha > 16)
            if not len(xs):
                raise RuntimeError('No swing foreground')
            bounds = [min(bounds[0], int(xs.min())), min(bounds[1], int(ys.min())),
                      max(bounds[2], int(xs.max()) + 1), max(bounds[3], int(ys.max()) + 1)]
            frame.save(cache / f'{count:04d}.png')
        if count != 240:
            raise RuntimeError(f'Expected 240 frames, got {count}')
        scale = min(320 / (bounds[2] - bounds[0]), 320 / (bounds[3] - bounds[1]))
        size = (round((bounds[2] - bounds[0]) * scale), round((bounds[3] - bounds[1]) * scale))
        target = dest / f'{ACTION}-v1.webm'
        encoder = subprocess.Popen([
            'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
            '-s', '360x360', '-r', str(FPS), '-i', '-', '-an', '-c:v', 'libvpx-vp9',
            '-pix_fmt', 'yuva420p', '-crf', '24', '-b:v', '0', '-auto-alt-ref', '0',
            '-row-mt', '1', '-cpu-used', '4', str(target)], stdin=subprocess.PIPE)
        try:
            for index in range(1, count + 1):
                with Image.open(cache / f'{index:04d}.png') as image:
                    # Resize premultiplied colors to avoid green/dark fringes.
                    resized = image.crop(bounds).convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')
                canvas = Image.new('RGBA', (360, 360))
                canvas.paste(resized, ((360 - size[0]) // 2, (360 - size[1]) // 2))
                if index == 1:
                    canvas.save(dest / f'{ACTION}-poster.png')
                encoder.stdin.write(canvas.tobytes())
        finally:
            encoder.stdin.close()
            if encoder.wait() != 0:
                raise RuntimeError('Transparent WebM encoding failed')
    manifest['actions'][ACTION] = dict(
        id=ACTION, label='羽翼秋千·斜轴轻荡', file=target.name, duration=count / FPS,
        fps=FPS, frames=count, sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
        sourceSha256=hashlib.sha256(args.source.read_bytes()).hexdigest(),
        sourceFile=args.source.name, loopMethod='source', sourceBounds=bounds)
    # Keep idle at 70%; share the original random-gesture budget with the swing.
    ambient = manifest['pools']['ambient']
    if not any(entry['action'] == ACTION for entry in ambient):
        for entry in ambient:
            if entry['action'] != 'idle':
                entry['weight'] = 4
        ambient.append(dict(action=ACTION, weight=6))
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Imported {ACTION}: {count} frames, fixed bounds {bounds}', flush=True)


if __name__ == '__main__':
    main()
