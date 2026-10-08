from pathlib import Path
from math import sin, cos, pi
import random

# Each original design combines a distinct scene motif with its own palette.
THEMES = [
('neon-avenue','Neon Avenue','cinematic','city','#10091b','#f5edff','#ff69c6','#170d29','#351741','drift'),
('violet-nebula','Violet Nebula','cinematic','space','#110a26','#f4efff','#c68cff','#1b1038','#352050','shimmer'),
('aurora-fjord','Aurora Fjord','cinematic','mountain','#091720','#e8f7ff','#6eead1','#102b3b','#164039','breathe'),
('eclipse-temple','Eclipse Temple','cinematic','space','#100d23','#f2edff','#ffbe77','#201331','#3b2548','pulse'),
('emerald-circuit','Emerald Circuit','cinematic','leaves','#071817','#e5fff5','#51edba','#0d3028','#155044','drift'),
('deep-sea-signal','Deep Sea Signal','cinematic','ocean','#061522','#e4f8ff','#42dfff','#0b2b43','#104b55','breathe'),
('last-light','Last Light','cinematic','mountain','#20101d','#fff0dc','#ff9b68','#3a1830','#523126','shimmer'),
('chrome-dream','Chrome Dream','cinematic','glitch','#101324','#f2f5ff','#a5baff','#1b2340','#3b2c55','wave'),
('synthwave-coast','Synthwave Coast','vivid','ocean','#110925','#fff0ff','#ff68d2','#211044','#40215b','drift'),
('stardust-bloom','Stardust Bloom','vivid','space','#100a21','#f5edff','#ff94dd','#21133b','#432655','shimmer'),
('pixel-comet','Pixel Comet','retro','arcade','#080d22','#ecf6ff','#52ddff','#101c3a','#223e58','pulse'),
('neon-koi','Neon Koi','vivid','ocean','#07171b','#e9fff7','#ff7b70','#0c2c32','#144850','breathe'),
('ultraviolet-forest','Ultraviolet Forest','vivid','leaves','#100a20','#f2eaff','#d78bff','#1c1031','#3a2150','drift'),
('chromatic-crash','Chromatic Crash','vivid','glitch','#11101c','#fff0fb','#ff77a8','#211229','#392343','wave'),
('prism-canyon','Prism Canyon','vivid','dunes','#1c1020','#fff1df','#ff9a75','#351c32','#51302a','breathe'),
('night-drive','Night Drive','vivid','city','#080d1d','#eaf4ff','#54d7ff','#10172d','#26304b','drift'),
('solar-flare','Solar Flare','vivid','space','#1b0b18','#fff0dd','#ff9b46','#341426','#502821','pulse'),
('electric-meadow','Electric Meadow','vivid','floral','#091a16','#efffee','#77f06f','#102d1c','#194330','shimmer'),
('alpine-moon','Alpine Moon','nature','mountain','#10172a','#eff4ff','#9ebaff','#192844','#32435d','breathe'),
('sakura-afterglow','Sakura Afterglow','nature','floral','#1d1020','#fff0f4','#ff9ebd','#321b34','#553043','shimmer'),
('emberwood','Emberwood','nature','leaves','#1b120e','#fff0df','#ff995c','#302019','#4b3022','breathe'),
('coral-cathedral','Coral Cathedral','nature','ocean','#071b23','#e4fbf8','#64efce','#103543','#15505a','drift'),
('moon-garden','Moon Garden','nature','floral','#111223','#f1f0ff','#c5a2ff','#211b38','#34314c','pulse'),
('jade-canopy','Jade Canopy','nature','leaves','#091a18','#e5fff3','#63e6a3','#10332c','#195142','breathe'),
('glacier-veil','Glacier Veil','nature','mountain','#0a1720','#ebf8ff','#7ddfff','#132b3a','#1c4555','drift'),
('desert-bloom','Desert Bloom','nature','floral','#21140d','#fff0dc','#ffad68','#382218','#5a3522','shimmer'),
('tidal-forest','Tidal Forest','nature','ocean','#071914','#e7fff0','#7be7bd','#0f3027','#1e5140','wave'),
('wildflower-dusk','Wildflower Dusk','nature','floral','#171326','#f5efff','#f59bcb','#29203f','#49324e','breathe'),
('8bit-dreamscape','8-Bit Dreamscape','retro','arcade','#090f22','#eef8ff','#ffd85b','#172348','#342b58','pulse'),
('cassette-sunset','Cassette Sunset','retro','dunes','#1b1018','#fff0dc','#ff9b62','#321b2b','#4b2930','drift'),
('pixel-planet','Pixel Planet','retro','space','#080d21','#edf3ff','#88a8ff','#131d3c','#2b3159','shimmer'),
('arcade-rain','Arcade Rain','retro','city','#07141a','#e4fff7','#55efc4','#0d2930','#12473f','wave'),
('neon-boardwalk','Neon Boardwalk','retro','city','#111024','#fff0fb','#ff8bcf','#211939','#3b2851','breathe'),
('cloud-garden','Cloud Garden','pastel','floral','#22213a','#fff7f3','#ffafd0','#383451','#514258','breathe'),
('peony-sky','Peony Sky','pastel','floral','#1d1830','#fff4fa','#ffa8d1','#332546','#4b3454','shimmer'),
('lavender-coast','Lavender Coast','pastel','ocean','#14192f','#f1f3ff','#b9b6ff','#24294a','#394564','drift'),
('dawn-meadow','Dawn Meadow','pastel','mountain','#201c2a','#fff5e9','#ffbd91','#393044','#50413b','breathe'),
('copper-canyon','Copper Canyon','earth','dunes','#20140e','#f8ecdb','#e39a62','#392318','#59361f','drift'),
('mossstone','Mossstone','earth','leaves','#101710','#eef2dc','#b6ce73','#222a1d','#36452a','breathe'),
('amber-atlas','Amber Atlas','earth','mountain','#211909','#fff2ce','#f0c36c','#3a2910','#574016','shimmer'),
]

def render(theme):
    ident,name,category,motif,bg,ink,accent,c1,c3,motion=theme
    rng=random.Random(sum((i+1)*ord(c) for i,c in enumerate(ident)))
    defs=(f'<linearGradient id="sky" x2="0" y2="1"><stop stop-color="{c1}"/><stop offset=".58" stop-color="{bg}"/><stop offset="1" stop-color="{c3}"/></linearGradient>'
          f'<radialGradient id="glow"><stop stop-color="{accent}" stop-opacity=".8"/><stop offset=".28" stop-color="{accent}" stop-opacity=".24"/><stop offset="1" stop-color="{accent}" stop-opacity="0"/></radialGradient>'
          f'<linearGradient id="facet" x2=".8" y2="1"><stop stop-color="{ink}" stop-opacity=".7"/><stop offset="1" stop-color="{accent}" stop-opacity=".8"/></linearGradient>'
          '<filter id="soft"><feGaussianBlur stdDeviation="12"/></filter><filter id="shine"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
    art=[f'<path fill="url(#sky)" d="M0 0h1600v180H0z"/>',f'<ellipse cx="{rng.randint(120,1480)}" cy="{rng.randint(20,155)}" rx="480" ry="90" fill="url(#glow)" filter="url(#soft)"/>']
    for _ in range(76):
        x,y,r=rng.randint(0,1599),rng.randint(5,174),rng.choice([.8,1,1.2,1.6,2])
        art.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{rng.choice([ink,accent])}" opacity="{rng.uniform(.22,.78):.2f}"/>')
    if motif=='space':
        x,y,r=rng.randint(180,1440),rng.randint(25,90),rng.randint(22,48)
        art += [f'<ellipse cx="{x}" cy="{y}" rx="{r*4}" ry="{r*.68:.1f}" fill="none" stroke="{accent}" stroke-opacity=".42" stroke-width="2" transform="rotate(-12 {x} {y})"/>',f'<circle cx="{x}" cy="{y}" r="{r*1.8}" fill="url(#glow)"/><circle cx="{x}" cy="{y}" r="{r}" fill="url(#facet)"/><path d="M{x-r} {y}q{r} {-r*.7:.1f} {r*2} 0q{-r} {r*.7:.1f} {-r*2} 0" fill="none" stroke="{ink}" stroke-opacity=".6"/>']
        for _ in range(6):
            sx,sy,sw=rng.randint(0,1600),rng.randint(15,140),rng.randint(12,60)
            art.append(f'<path d="M{sx-sw} {sy}q{sw} -14 {sw*2} 0" fill="none" stroke="{accent}" stroke-opacity=".35" filter="url(#shine)"/>')
    elif motif=='mountain':
        for base,peakw,col,op in [(178,390,c3,.55),(180,300,c1,.82),(180,210,bg,1)]:
            x=-100; pts=[]
            while x<1700:
                w=rng.randint(peakw//2,peakw); pts += [(x,base),(x+w//2,base-rng.randint(18,120)),(x+w,base)]; x+=w
            d='M'+' '.join(f'{a} {b}' for a,b in pts)+' L1700 200 L-100 200Z'
            art.append(f'<path d="{d}" fill="{col}" opacity="{op}"/>')
        art.append(f'<path d="M0 158Q400 112 800 162T1600 135" fill="none" stroke="{accent}" stroke-opacity=".7" stroke-width="2"/>')
        art.append(f'<circle cx="{rng.randint(120,1450)}" cy="40" r="28" fill="{accent}" opacity=".26"/>')
    elif motif=='leaves':
        leaf=[]
        for j in range(9):
            x=25+j*195+rng.randint(-20,20); base=rng.randint(125,178); bend=rng.randint(-30,30)
            leaf.append(f'<path d="M{x} 190Q{x+bend} {base} {x+30} 0" fill="none" stroke="{c3}" stroke-width="3" opacity=".78"/>')
            for k in range(4):
                y=base-k*37; side=-1 if (j+k)%2 else 1; lx=x+30+(base-y)*.2+side*rng.randint(25,52); ly=y-rng.randint(8,24); rx=x+30+(base-y)*.2
                leaf.append(f'<path d="M{rx} {y}Q{lx+side*13} {ly-17} {lx} {ly}Q{lx-side*10} {ly+14} {rx} {y}" fill="{rng.choice([c1,c3,accent])}" opacity=".72" stroke="{accent}" stroke-opacity=".65"/><path d="M{rx} {y}L{lx} {ly}" stroke="{ink}" stroke-opacity=".45"/>')
        art.append('<g filter="url(#shine)">'+''.join(leaf)+'</g>')
    elif motif=='ocean':
        for k in range(6):
            y=68+k*23; amp=12+k*2
            art.append(f'<path d="M0 {y}Q200 {y-amp} 400 {y}T800 {y}T1200 {y}T1600 {y}" fill="none" stroke="{[c1,c3,bg,accent,ink,c1][k]}" stroke-width="{7-k*.55}" opacity="{.35+k*.08:.2f}"/>')
        for _ in range(13):
            x,y,r=rng.randint(20,1580),rng.randint(20,160),rng.randint(2,7)
            art.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{ink}" stroke-opacity=".54"/>')
    elif motif=='city':
        x=-8; buildings=[]
        while x<1610:
            w,h=rng.randint(35,105),rng.randint(36,122); y=166-h
            buildings.append(f'<path d="M{x} {y}h{w}v{h}h{-w}z" fill="{rng.choice([c1,c3,bg])}" opacity=".92"/>')
            for wx in range(x+8,x+w-4,15):
                for wy in range(y+9,164,17):
                    if rng.random()<.7: buildings.append(f'<rect x="{wx}" y="{wy}" width="4" height="6" fill="{accent}" opacity="{rng.uniform(.35,.9):.2f}"/>')
            x+=w+rng.randint(4,17)
        art.append('<g>'+''.join(buildings)+'</g>')
        art.append(f'<path d="M0 174L680 143h240l680 31M800 145L600 180M800 145l200 35" fill="none" stroke="{accent}" stroke-opacity=".7" stroke-width="2"/>')
    elif motif=='floral':
        flowers=[]
        for j in range(8):
            x=85+j*205+rng.randint(-28,28); y=rng.randint(35,95); r=rng.randint(11,18); bend=rng.randint(-45,45)
            flowers.append(f'<path d="M{x} 190Q{x+bend} 112 {x} {y+r}" fill="none" stroke="{c3}" stroke-width="3"/>')
            for k in range(2):
                yy=130-k*35; side=-1 if (j+k)%2 else 1
                flowers.append(f'<path d="M{x} {yy}q{side*34} -30 {side*52} -15q{-side*15} 25 {-side*52} 15" fill="{c1}" stroke="{accent}" stroke-opacity=".65"/>')
            for p in range(7):
                a=p*2*pi/7; cx=x+cos(a)*r*.72; cy=y+sin(a)*r*.72
                flowers.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{r*.53:.1f}" ry="{r*.32:.1f}" transform="rotate({p*51} {cx:.1f} {cy:.1f})" fill="{rng.choice([accent,ink,c3])}" opacity=".82"/>')
            flowers.append(f'<circle cx="{x}" cy="{y}" r="{r*.3:.1f}" fill="{c1}"/>')
        art.append('<g>'+''.join(flowers)+'</g>')
    elif motif=='glitch':
        for _ in range(27):
            x,y,w,h=rng.randint(-100,1550),rng.randint(0,177),rng.randint(20,300),rng.choice([1,2,3,5,8])
            art.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{rng.choice([accent,ink,c3])}" opacity="{rng.uniform(.16,.58):.2f}"/>')
        for x in range(70,1600,135): art.append(f'<path d="M{x} 0v180M0 {x%180}h1600" stroke="{accent}" stroke-opacity=".1"/>')
        for _ in range(3):
            x,y,r=rng.randint(150,1450),rng.randint(25,140),rng.randint(15,34)
            art.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{accent}" stroke-width="2"/><circle cx="{x}" cy="{y}" r="{r+8}" fill="none" stroke="{ink}" stroke-opacity=".5"/>')
    elif motif=='dunes':
        x,y,r=rng.randint(180,1400),rng.randint(15,70),rng.randint(22,38)
        art.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{accent}" opacity=".7"/>')
        for k in range(6):
            y=72+k*22; amp=rng.randint(12,28); offset=rng.randint(-90,90)
            art.append(f'<path d="M-20 {y+amp}Q360 {y-amp+offset} 790 {y+6}T1620 {y-amp}" fill="none" stroke="{[c3,c1,accent,ink,c3,bg][k]}" stroke-width="{13-k}" opacity="{.35+k*.08:.2f}"/>')
    elif motif=='arcade':
        grid=[]
        for x in range(-800,2401,160): grid.append(f'<path d="M800 88L{x} 180" stroke="{accent}" stroke-opacity=".46"/>')
        for y in [103,113,125,139,156,178]: grid.append(f'<path d="M0 {y}h1600" stroke="{accent}" stroke-opacity=".38"/>')
        art.append('<g fill="none" stroke-width="1.4">'+''.join(grid)+'</g>')
        for _ in range(25):
            x,y,r=rng.randint(20,1570),rng.randint(8,100),rng.choice([2,3,4])
            art.append(f'<rect x="{x//2*2}" y="{y//2*2}" width="{r*2}" height="{r*2}" fill="{rng.choice([ink,accent])}"/>')
        art.append(f'<path d="M1230 23h12v12h12v12h-12v12h-12V47h-12V35h12z" fill="{accent}"/>')
    art.append(f'<path d="M0 178h1600" stroke="{accent}" stroke-opacity=".52"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 180" preserveAspectRatio="xMidYMid slice"><defs>{defs}</defs>'+''.join(art)+'</svg>'

for theme in THEMES:
    (Path(__file__).resolve().parents[1]/'assets'/f'theme-{theme[0]}.svg').write_text(render(theme),encoding='utf-8')
print(f'Generated {len(THEMES)} unique theme illustrations')
