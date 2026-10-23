"""Extract an exact 6..29s scene clip into green-screen MP4 and alpha WebM.

Uses the local anime segmentation model; does not redraw source frames.
Requires numpy, Pillow, OpenCV and ONNX Runtime (DirectML optional).
"""
import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if (ROOT / 'node_modules/.cache/pet-video-dml').exists():
    sys.path.insert(0, str(ROOT / 'node_modules/.cache/pet-video-dml'))
import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw


class Matte:
    def __init__(self, device):
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.enable_mem_pattern = False
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        providers = ['CPUExecutionProvider']
        if 'DmlExecutionProvider' in ort.get_available_providers():
            providers.insert(0, ('DmlExecutionProvider', {'device_id': device}))
        self.session = ort.InferenceSession(str(ROOT / 'node_modules/.cache/pet-video-models/isnetis-proxy.onnx'),
                                           sess_options=options, providers=providers)
        self.name = self.session.get_inputs()[0].name
        self.reference_support = None
        print('Providers:', self.session.get_providers(), flush=True)

    def mask(self, rgb, at):
        height, width = rgb.shape[:2]
        new_h = round(height * 1024 / width)
        py = (1024 - new_h) // 2
        inp = np.zeros((1024, 1024, 3), np.float32)
        inp[py:py+new_h] = cv2.resize(rgb, (1024, new_h)) / 255
        raw = self.session.run(None, {self.name: inp.transpose(2,0,1)[None]})[0].squeeze()[py:py+new_h]
        alpha = np.clip((cv2.resize(raw, (width, height)) - .08) / .84, 0, 1)
        # The source camera has finished zooming out by 7.2s. Exclude the
        # architectural column which the semantic model confuses with foliage.
        cutoff = 300 if at >= 7.5 else 0
        alpha[:cutoff] = 0
        if at >= 7.5:
            alpha[:360, :440] = 0
            alpha[:340, 800:] = 0
            alpha[300:520, 320:440] = 0
            if self.reference_support is not None:
                alpha[:470] *= self.reference_support[:470]
        # Restore the original bright swing suspension/leafy arc. These thin,
        # disconnected props are missed by a character-only semantic mask.
        # Coordinates below refer to the source's half-resolution 960x540 view.
        if at >= 7.2:
            xs = (np.arange(width) + 380) / 2
            ys = np.arange(height) / 2
            xx, yy = np.meshgrid(xs, ys)
            top = (xx > 375) & (xx < 590) & (yy > 25) & (yy < 270)
            ropes = (((np.abs(xx - 426) < 3) | (np.abs(xx - 539) < 3)) & (yy < 340))
            white = np.min(rgb.astype(np.float32), axis=2)
            chroma = np.max(rgb.astype(np.float32), axis=2) - white
            prop_alpha = np.clip((white - 195) / 40, 0, 1) * np.clip((40-chroma)/15,0,1) * (top | ropes)
            alpha = np.maximum(alpha, prop_alpha)
        # Keep only the connected body/seat and the explicitly restored props.
        count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > .15).astype(np.uint8), 8)
        support = np.zeros_like(alpha, np.uint8)
        for component in range(1, count):
            area = stats[component, cv2.CC_STAT_AREA]
            if area >= 80:
                support[labels == component] = 1
        support = cv2.dilate(support, np.ones((5,5),np.uint8))
        alpha *= support
        return alpha


def read_exact(pipe, size):
    result = bytearray()
    while len(result) < size:
        chunk = pipe.read(size - len(result))
        if not chunk:
            break
        result.extend(chunk)
    return result


def output_frame(rgb, alpha):
    rgba = np.dstack((rgb, np.round(alpha*255).astype(np.uint8)))
    image = Image.fromarray(rgba).convert('RGBa').resize((704, 582), Image.Resampling.LANCZOS).convert('RGBA')
    canvas = Image.new('RGBA', (768,768))
    canvas.paste(image, (32,93))
    return canvas


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--device', type=int, default=1)
    parser.add_argument('--samples', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    matte = Matte(args.device)
    capture = cv2.VideoCapture(str(args.source));capture.set(cv2.CAP_PROP_POS_MSEC,10000)
    ok,bgr=capture.read();capture.release()
    if not ok:raise RuntimeError('Cannot read reference frame')
    reference=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)[:960,380:1540]
    reference_mask=matte.mask(reference,10)
    matte.reference_support=cv2.dilate((reference_mask>.8).astype(np.uint8),np.ones((25,25),np.uint8))
    if args.samples:
        sheet = Image.new('RGB', (6*384, 800), (32,29,38))
        for i, at in enumerate([6,7.5,10,17,24,28.9]):
            capture = cv2.VideoCapture(str(args.source));capture.set(cv2.CAP_PROP_POS_MSEC,at*1000)
            ok,bgr=capture.read();capture.release()
            if not ok:raise RuntimeError('Cannot read sample')
            rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)[:960,380:1540]
            image=output_frame(rgb,matte.mask(rgb,at));image.save(args.output/f'sample-{at}.png')
            image=image.resize((384,384),Image.Resampling.LANCZOS)
            for y,color in [(0,(32,29,38,255)),(400,(0,255,0,255))]:
                bg=Image.new('RGBA',image.size,color);bg.alpha_composite(image);sheet.paste(bg.convert('RGB'),(i*384,y))
        sheet.save(args.output/'samples.png')
        return
    decoder = subprocess.Popen(['ffmpeg','-v','error','-ss','6','-i',str(args.source),'-t','23','-an',
        '-vf','fps=30,crop=1160:960:380:0','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
    alpha_path = args.output/'荡秋千_6-29秒_透明版.webm'
    green_path = args.output/'荡秋千_6-29秒_绿幕版.mp4'
    common=['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-s','768x768','-r','30','-i','-','-an']
    alpha_encoder=subprocess.Popen(common+['-c:v','libvpx-vp9','-pix_fmt','yuva420p','-crf','26','-b:v','0',
        '-auto-alt-ref','0','-row-mt','1','-cpu-used','4',str(alpha_path)],stdin=subprocess.PIPE)
    green_encoder=subprocess.Popen(common+['-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-preset','fast',
        '-movflags','+faststart',str(green_path)],stdin=subprocess.PIPE)
    count=0;began=time.perf_counter()
    try:
        while True:
            data=read_exact(decoder.stdout,1160*960*3)
            if not data:break
            if len(data)!=1160*960*3:raise RuntimeError('Incomplete frame')
            rgb=np.frombuffer(data,np.uint8).reshape(960,1160,3)
            image=output_frame(rgb,matte.mask(rgb,6+count/30))
            alpha_encoder.stdin.write(image.tobytes())
            green=Image.new('RGBA',image.size,(0,255,0,255));green.alpha_composite(image)
            green_encoder.stdin.write(green.tobytes())
            if count in [0,45,120,330,540,687]:
                image.save(args.output/f'frame-{count:04d}.png')
            count+=1
            if count%30==0:print(f'{count}/690 frames, {time.perf_counter()-began:.1f}s',flush=True)
    finally:
        decoder.stdout.close();alpha_encoder.stdin.close();green_encoder.stdin.close()
        codes=[decoder.wait(),alpha_encoder.wait(),green_encoder.wait()]
        if any(codes):raise RuntimeError(f'Video subprocess failed: {codes}')
    if count!=690:raise RuntimeError(f'Unexpected frame count: {count}')
    report=dict(source=args.source.name,sourceSha256=hashlib.sha256(args.source.read_bytes()).hexdigest(),
                start=6,end=29,duration=23,fps=30,frames=count,width=768,height=768,audio=False,
                notes='Original zoom and swing appearance/disappearance retained. No seamless-loop claim.',
                files={p.name:dict(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in [alpha_path,green_path]})
    (args.output/'处理记录.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Finished:',json.dumps(report,ensure_ascii=True),flush=True)


if __name__=='__main__':main()
