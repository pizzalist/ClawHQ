#!/usr/bin/env python3
from PIL import Image
from pathlib import Path

frames_dir = Path('docs/media/frames')
out = Path('docs/media/demo-flow.gif')

files = sorted(frames_dir.glob('frame-*.png'))
if not files:
    raise SystemExit('No frames found in docs/media/frames')

images = [Image.open(f).convert('P', palette=Image.ADAPTIVE) for f in files]
# keep file size reasonable
images = [img.resize((1280, 730)) for img in images]

images[0].save(
    out,
    save_all=True,
    append_images=images[1:],
    duration=700,
    loop=0,
    optimize=True,
)
print(f'[gif] wrote {out} from {len(images)} frames')
