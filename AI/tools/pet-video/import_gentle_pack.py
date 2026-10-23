"""Import the approved dsh-pet pack into the application's square video stage.

Only crop empty horizontal margins; never alter the character or source files.
Usage: python import_gentle_pack.py <xilian-animation directory>
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ENTRIES = [
    ('idle', '安静陪伴'), ('greeting', '温柔行礼'), ('rest', '倦意轻憩'),
    ('glance', '轻轻回眸'), ('care', '温柔关切'), ('listen', '静静倾听'),
    ('blessing', '无声祝福'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    dest = Path(__file__).resolve().parents[2] / 'public/pets/xilian-video-v2'
    dest.mkdir(parents=True, exist_ok=True)
    actions = {}
    for action, label in ENTRIES:
        source = args.source / f'{label}.webm'
        target = dest / f'{action}-v2.webm'
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', str(source),
            '-vf', 'crop=360:360:140:0,format=yuva420p', '-an',
            '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '28', '-b:v', '0',
            '-auto-alt-ref', '0', '-row-mt', '1', '-cpu-used', '4', str(target),
        ], check=True)
        actions[action] = dict(id=action, label=label, file=target.name,
                               duration=10, fps=24, frames=240,
                               sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
                               sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest())
        print(f'Imported {label}: {target.name}', flush=True)
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-c:v', 'libvpx-vp9',
        '-i', str(dest / actions['idle']['file']), '-frames:v', '1',
        '-update', '1', str(dest / 'idle-poster.png'),
    ], check=True)
    manifest = dict(version=2, renderer='alpha-video', canvas=dict(width=360, height=360),
                    anchor=dict(x=180, feetY=330), actions=actions,
                    pools=dict(
                        ambient=[dict(action='idle', weight=70)] + [
                            dict(action=action, weight=5) for action, _ in ENTRIES if action != 'idle'],
                        tap=[dict(action='care', weight=1), dict(action='listen', weight=1)],
                        speech=[dict(action='care', weight=1), dict(action='listen', weight=1)]),
                    notes='温柔人设；语音播放使用回应手势，无口型同步。含蓄欢喜与羞涩浅笑因源视频裁切未导入。')
    (dest / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
