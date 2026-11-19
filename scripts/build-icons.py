from PIL import Image, ImageDraw
import os
ROOT=r'E:\China'
raw=os.path.join(ROOT,'assets','china-raw')
icons=os.path.join(ROOT,'extension','icons')
agents=os.path.join(ROOT,'extension','agents')

# มุมมนโปร่งใสแบบ "ตัดขอบ" (รัศมี ~19% ของด้าน) — ให้ไอคอนทุกตัวในโฟลเดอร์นี้หน้าตาเดียวกัน
RADIUS = 0.1875
def rounded(img, size):
    """ย่อภาพเป็นสี่เหลี่ยมจัตุรัสขนาด size แล้วตัดมุมให้โปร่งใส (ขอบเนียนด้วยการวาด 4x)"""
    im = img.convert('RGBA').resize((size, size), Image.LANCZOS)
    ss = 4
    mask = Image.new('L', (size*ss, size*ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size*ss-1, size*ss-1], radius=int(size*ss*RADIUS), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out

src=Image.open(os.path.join(raw,'app-icon.png')).convert('RGBA')
for s in (16,24,32,48,64,128,256,512):
    rounded(src, s).save(os.path.join(icons,f'icon-{s}.png'))
rounded(src, 256).save(os.path.join(icons,'china-auto.ico'),
    sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
rounded(src, 128).save(os.path.join(icons,'icon-128.ico'),sizes=[(16,16),(32,32),(48,48),(128,128)])
# ไอคอนหมวด (ขอบตัดเหมือนกัน)
cat=Image.open(os.path.join(raw,'category-sanguo.png')).convert('RGBA')
rounded(cat, 512).save(os.path.join(icons,'category-sanguo.png'))
rounded(cat, 256).save(os.path.join(icons,'category-sanguo.ico'),
    sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])

# agent sheets + worlds
for a in ('chatgpt','flow','meta','voice','edit'):
    Image.open(os.path.join(raw,f'agent-{a}.png')).save(os.path.join(agents,f'china-{a}.png'))
for w in ('day','night'):
    Image.open(os.path.join(raw,f'world-{w}.png')).convert('RGB').save(os.path.join(agents,f'china-{w}.png'))

# 12-frame GIFs (4x3 atlas -> 12 frames)
gifdir=os.path.join(ROOT,'extension','agents','gif')
os.makedirs(gifdir,exist_ok=True)
for a in ('chatgpt','flow','meta','voice','edit'):
    sheet=Image.open(os.path.join(raw,f'agent-{a}.png')).convert('RGBA')
    W,H=sheet.size; cw,ch=W//4,H//3
    frames=[sheet.crop((c*cw,r*ch,(c+1)*cw,(r+1)*ch)) for r in range(3) for c in range(4)]
    frames=[f.resize((cw//2,ch//2),Image.LANCZOS) for f in frames]
    conv=[]
    for f in frames:
        p=f.convert('RGBA')
        q=p.convert('P',palette=Image.ADAPTIVE,colors=255)
        mask=p.getchannel('A').point(lambda v:255 if v<128 else 0)
        q.paste(255,mask)
        conv.append(q)
    conv[0].save(os.path.join(gifdir,f'china-{a}.gif'),save_all=True,append_images=conv[1:],
                 duration=110,loop=0,transparency=255,disposal=2,optimize=False)
print('ok')
