"""Repair scene-derived pet mattes with two models and optical-flow guidance.

Run --stage keys, then --stage render. Original source pixels and timing are
preserved; reconstructed mattes replace the earlier fixed rectangular masks.
"""
import argparse
import bisect
import hashlib
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'node_modules/.cache/pet-video-dml'))
import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw
from extract_scene_swing import output_frame, read_exact
import subprocess

HEIGHT, WIDTH = 960, 1160


def session(model):
    options = ort.SessionOptions()
    options.enable_mem_pattern = False
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.intra_op_num_threads = 4
    options.log_severity_level = 3
    return ort.InferenceSession(str(ROOT / 'node_modules/.cache/pet-video-models' / model),
        sess_options=options, providers=[('DmlExecutionProvider', {'device_id': 1}), 'CPUExecutionProvider'])


def source_frame(source, index):
    capture = cv2.VideoCapture(str(source))
    capture.set(cv2.CAP_PROP_POS_MSEC, (6 + index / 30) * 1000)
    ok, bgr = capture.read()
    capture.release()
    if not ok:
        raise RuntimeError(f'Cannot read source frame {index}')
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)[:HEIGHT, 380:1540]


def prepare_keys(args):
    key_indices = sorted(set(range(0, 690, 15)) | set(range(0, 61, 5)) | {687, 689})
    model = None
    began = time.perf_counter()
    prior = ROOT / 'reports/video-pet/swing-6-29/repair-probe'
    for number, index in enumerate(key_indices):
        alpha_path = args.cache / f'{index:04d}-alpha.npy'
        rgb_path = args.cache / f'{index:04d}-rgb.png'
        if not rgb_path.exists():
            Image.fromarray(source_frame(args.source, index)).save(rgb_path)
        if not alpha_path.exists():
            at = 6 + index / 30
            matching = [p for p in prior.glob('alpha-*.npy')
                        if abs(float(p.stem.removeprefix('alpha-')) - at) < .0001]
            if matching:
                alpha = np.load(matching[0])
            else:
                if model is None:
                    model = session('birefnet-lite-fp16.onnx')
                rgb = np.array(Image.open(rgb_path))
                inp = (cv2.resize(rgb, (1024, 1024)).astype(np.float32) / 255
                       - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
                raw = model.run(None, {model.get_inputs()[0].name: inp.transpose(2, 0, 1)[None]})[0].squeeze()
                alpha = cv2.resize(1 / (1 + np.exp(-np.clip(raw.astype(np.float32), -50, 50))), (WIDTH, HEIGHT))
            np.save(alpha_path, alpha.astype(np.float16))
        print(f'Key mattes {number+1}/{len(key_indices)}, {time.perf_counter()-began:.1f}s', flush=True)
    (args.cache / 'keys.json').write_text(json.dumps(key_indices), encoding='utf-8')


class RepairMatte:
    def __init__(self, cache):
        self.model = session('isnetis-proxy.onnx')
        self.keys = json.loads((cache / 'keys.json').read_text(encoding='utf-8'))
        self.anchors = {}
        for index in self.keys:
            rgb = np.array(Image.open(cache / f'{index:04d}-rgb.png'))
            gray = cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), (580, 480))
            alpha = cv2.resize(np.load(cache / f'{index:04d}-alpha.npy').astype(np.float32), (580, 480))
            self.anchors[index] = (gray, alpha)
        self.flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self.yy, self.xx = np.mgrid[:480, :580].astype(np.float32)
        xx, yy = np.meshgrid((np.arange(WIDTH) + 380) / 2, np.arange(HEIGHT) / 2)
        self.prop_roi = (xx > 375) & (xx < 590) & (yy > 5) & (yy < 275)
        self.rows = np.arange(HEIGHT)[:, None]
        self.previous_gray = None
        self.previous_alpha = None

    def warp(self, gray, anchor):
        reference, alpha = self.anchors[anchor]
        flow = self.flow.calc(gray, reference, None)
        return cv2.remap(alpha, self.xx + flow[..., 0], self.yy + flow[..., 1], cv2.INTER_LINEAR,
                         borderMode=cv2.BORDER_CONSTANT)

    def mask(self, rgb, index):
        gray = cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), (580, 480))
        if index in self.anchors:
            biref = self.anchors[index][1]
        else:
            position = bisect.bisect_left(self.keys, index)
            before, after = self.keys[position-1], self.keys[position]
            amount = (index-before) / (after-before)
            biref = self.warp(gray, before) * (1-amount) + self.warp(gray, after) * amount
        biref = cv2.resize(biref, (WIDTH, HEIGHT))
        nh = round(HEIGHT * 1024 / WIDTH)
        py = (1024-nh) // 2
        inp = np.zeros((1024, 1024, 3), np.float32)
        inp[py:py+nh] = cv2.resize(rgb, (1024, nh)) / 255
        raw = self.model.run(None, {self.model.get_inputs()[0].name: inp.transpose(2, 0, 1)[None]})[0].squeeze()[py:py+nh]
        anime = cv2.resize(raw, (WIDTH, HEIGHT)).clip(0, 1)
        color = rgb.astype(np.float32)
        pink = ((color[..., 0] > color[..., 1]+15) & (color[..., 0] > color[..., 2]+2)
                & (color[..., 0] > 140) & (biref > .5))
        ys = np.where(pink)[0]
        head_top = int(np.percentile(ys, 1)) if len(ys) else 300
        distance = cv2.distanceTransform((~pink).astype(np.uint8), cv2.DIST_L2, 5)
        protect = np.clip((35-distance)/15, 0, 1)
        protect *= np.clip((anime-.15)/.25, 0, 1)
        agreement = np.minimum(biref, anime) ** 3
        upper = np.clip((head_top+110-self.rows)/50, 0, 1)
        alpha = np.maximum(biref, anime) * (1-upper*(1-protect)*(1-agreement))
        alpha = np.clip((alpha-.04)/.4, 0, 1)
        core = (alpha > .4).astype(np.uint8)
        closed = cv2.morphologyEx(core, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
        count, labels, stats, _ = cv2.connectedComponentsWithStats(1-closed, 8)
        fill = (stats[:, cv2.CC_STAT_AREA] < 1800) & (stats[:, cv2.CC_STAT_TOP] > head_top)
        fill[0] = False
        closed[fill[labels]] = 1
        alpha = np.maximum(alpha, cv2.erode(closed, np.ones((3, 3), np.uint8)))
        # White leaves and ropes are opaque foreground, even when the person
        # segmentation network assigns them low confidence. Retain their
        # coloured antialiased edge instead of cutting out their dim interiors.
        if index >= 45:
            low = color.min(2)
            chroma = color.max(2)-low
            props_core = ((low > 205) & (chroma < 60) & self.prop_roi).astype(np.uint8)
            props_core = cv2.morphologyEx(props_core, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
            props = cv2.GaussianBlur(cv2.dilate(props_core, np.ones((3, 3), np.uint8)).astype(np.float32), (3, 3), .6)
            alpha = np.maximum(alpha, props)
        # Flow-align a small contribution from the previous matte. This
        # suppresses isolated one-frame holes without freezing the animation.
        small = cv2.resize(alpha, (580, 480))
        if self.previous_alpha is not None:
            flow = self.flow.calc(gray, self.previous_gray, None)
            previous = cv2.remap(self.previous_alpha, self.xx+flow[..., 0], self.yy+flow[..., 1],
                                 cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            stable = np.maximum(small, previous*.65)
            alpha = np.maximum(alpha, cv2.resize(stable, (WIDTH, HEIGHT)))
        self.previous_gray, self.previous_alpha = gray, small
        return np.clip((alpha-.02)/.96, 0, 1)


def render(args):
    matte = RepairMatte(args.cache)
    decoder = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', '6', '-i', str(args.source), '-t', '23', '-an',
        '-vf', 'fps=30,crop=1160:960:380:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    mp4 = args.output / '荡秋千_6-29秒_绿幕修复版_v2.mp4'
    webm = args.output / 'swing-source-6-29-repaired-v2.webm'
    common = ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '768x768', '-r', '30', '-i', '-', '-an']
    green_encoder = subprocess.Popen(common+['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'fast', '-movflags', '+faststart', str(mp4)], stdin=subprocess.PIPE)
    alpha_encoder = subprocess.Popen(common+['-vf', 'scale=360:360', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '24', '-b:v', '0', '-auto-alt-ref', '0', '-row-mt', '1', '-cpu-used', '4', str(webm)], stdin=subprocess.PIPE)
    sheet = Image.new('RGB', (6*240, 4*260), (32, 29, 38))
    draw = ImageDraw.Draw(sheet)
    count = 0
    began = time.perf_counter()
    samples = 0
    try:
        while True:
            data = read_exact(decoder.stdout, WIDTH*HEIGHT*3)
            if not data:
                break
            if len(data) != WIDTH*HEIGHT*3:
                raise RuntimeError('Incomplete source frame')
            rgb = np.frombuffer(data, np.uint8).reshape(HEIGHT, WIDTH, 3)
            image = output_frame(rgb, matte.mask(rgb, count))
            alpha_encoder.stdin.write(image.tobytes())
            green = Image.new('RGBA', image.size, (0, 255, 0, 255))
            green.alpha_composite(image)
            green_encoder.stdin.write(green.tobytes())
            if count % 30 == 0 or count == 689:
                x, y = (samples%6)*240, (samples//6)*260
                sheet.paste(green.resize((230, 230), Image.Resampling.LANCZOS).convert('RGB'), (x, y))
                draw.text((x+4, y+235), f'source {6+count/30:.2f}s', fill='white')
                samples += 1
            if count == 120:
                image.resize((360, 360), Image.Resampling.LANCZOS).save(args.output/'swing-repaired-v2-poster.png')
            count += 1
            if count % 30 == 0:
                print(f'Repair render {count}/690, {time.perf_counter()-began:.1f}s', flush=True)
    finally:
        decoder.stdout.close(); green_encoder.stdin.close(); alpha_encoder.stdin.close()
        codes = [decoder.wait(), green_encoder.wait(), alpha_encoder.wait()]
        if any(codes):
            raise RuntimeError(f'Video process failure {codes}')
    if count != 690:
        raise RuntimeError(f'Wrong frame count: {count}')
    sheet.save(args.output/'修复版逐秒预览.png')
    metadata = dict(source=args.source.name, start=6, end=29, duration=23, fps=30, frames=count,
        method='two-model matte fusion, optical-flow anchor interpolation, hole filling, original RGB',
        originalZoomAndFadeRetained=True, originalOccludedPixelsNotInvented=True,
        files={p.name: dict(bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in [mp4, webm]})
    (args.output/'修复记录.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Repair exported successfully', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', choices=['keys', 'render'], required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    if args.stage == 'keys':
        prepare_keys(args)
    else:
        render(args)


if __name__ == '__main__':
    main()
