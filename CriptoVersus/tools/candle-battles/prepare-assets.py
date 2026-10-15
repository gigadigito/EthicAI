"""Build the small runtime atlas from the supplied art; never stretch a fighter sheet."""
import argparse, hashlib, json, zipfile
from pathlib import Path
from PIL import Image
p=argparse.ArgumentParser()
p.add_argument('archive', type=Path)
a=p.parse_args()
root=Path(__file__).resolve().parents[2]
out=root/'wwwroot/games/candle-battles/assets'
source=Path(__file__).parent/'source'
source.mkdir(parents=True, exist_ok=True)
out.mkdir(parents=True, exist_ok=True)
z=zipfile.ZipFile(a.archive)
prefix='CandleBattles_Assets/'
base=z.read(prefix+'assets/sprites/characters/source/candle_fighters_base.png')
(source/'candle_fighters_base.png').write_bytes(base)
import io
im=Image.open(io.BytesIO(base)).convert('RGBA')
face=im.crop((61, 132, 94, 172))
# Only eyes / brows / mouth: remove the lime body, retaining dark antialiased ink.
for y in range(face.height):
    for x in range(face.width):
        r,g,b,alpha=face.getpixel((x,y))
        ink=max(0, min(1, (125-max(r,g,b))/65))
        face.putpixel((x,y),(5,18,19,round(alpha*ink)))
face=face.crop(face.getbbox())
blocks=Image.open(io.BytesIO(z.read(prefix+'assets/sprites/blocks/source/territory_tiles.png'))).convert('RGBA')
vfx=Image.open(io.BytesIO(z.read(prefix+'assets/sprites/effects/source/combat_vfx.png'))).convert('RGBA')
items={'face':face, 'tile-left':blocks.crop((46,190,176,320)), 'tile-right':blocks.crop((46,405,176,535)), 'impact-left':vfx.crop((16,10,166,170)), 'impact-right':vfx.crop((16,164,166,324))}
hud=Image.open(io.BytesIO(z.read(prefix+'assets/sprites/ui/source/hud_icons.png'))).convert('RGBA')
items['logo-BTC']=hud.crop((29,45,219,245))
items['logo-ETH']=hud.crop((223,45,416,245))
atlas=Image.new('RGBA',(1536,256))
frames={}; x=4
for name,img in items.items():
    atlas.alpha_composite(img,(x,4))
    frames[name]={'frame':{'x':x,'y':4,'w':img.width,'h':img.height},'rotated':False,'trimmed':False,'spriteSourceSize':{'x':0,'y':0,'w':img.width,'h':img.height},'sourceSize':{'w':img.width,'h':img.height}}
    x+=img.width+8
atlas.save(out/'modular.png',optimize=True)
(out/'modular.json').write_text(json.dumps({'frames':frames,'meta':{'image':'modular.png','size':{'w':1536,'h':256},'scale':'1'}},indent=2))
audio=[]
for e in z.infolist():
    relative=e.filename.removeprefix(prefix)
    if relative.startswith('assets/audio/') and relative.endswith('.wav') and '..' not in Path(relative).parts:
        target=out/relative.removeprefix('assets/')
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(z.read(e)); audio.append(relative.removeprefix('assets/'))
(out/'manifest.json').write_text(json.dumps({'atlas':'modular.json','texture':'modular.png','audio':audio,'sourceSha256':hashlib.sha256(base).hexdigest(),'poses':{'run':8,'punch':6,'break':8,'recover':3},'notes':'Fixed-size face ink extracted from approved base sheet. Articulated limbs redrawn from approved poses. Body and wicks are financial geometry.'},indent=2))
print('Atlas:',len(frames),'frames; audio:',len(audio),'files; face:',face.size)
