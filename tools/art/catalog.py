"""그래픽 생성 카탈로그 — 프롬프트와 후처리 규격의 단일 원본.

`python3 tools/art/build.py`가 이 파일을 읽어 다음을 만든다.
  - tools/art/prompts.json              (노트북·후처리가 읽는 데이터)
  - tools/art/prompts_plain_oneline.txt (ChatGPT 등에 수동으로 붙여넣을 때)
  - tools/art/generate_images.ipynb     (Colab에서 자동 생성 + 후처리)

프롬프트 원칙
  - 모든 시트가 같은 STYLE 문단을 공유한다(시트 간 화풍 일관성).
  - 특정 게임 이름 대신 화풍을 구체적으로 묘사한다(저작권·거절 위험 회피, 결과도 더 일정).
  - 캔버스·격자·크기·기준선은 후처리(postprocess.py)가 기대하는 값과 일치해야 한다.
  - 진영 구분은 군복·장비·실루엣으로만, 혈흔·민간인 피해·실존 인물 없음 (PRD §1).
"""

# ---------------------------------------------------------------- 공통 문단

STYLE = (
    "ART STYLE: hand-pixeled 16-bit arcade sprite art in the spirit of late-1990s 2D run-and-gun games. "
    "It must look like a LOW-RESOLUTION sprite enlarged with nearest-neighbor: every art pixel is a crisp, uniform "
    "square block (about 2x2 image pixels), aligned to one pixel grid across the whole image. "
    "1-pixel dark-brown outline (#2A1A10) around every shape; cel shading with 3-4 flat tones per material; "
    "light from the upper left; small bright highlights; limited palette of about 32 colors for the whole sheet. "
    "Chunky heroic proportions (about 3 heads tall), big hands and boots, readable silhouettes, "
    "exaggerated hand-animated poses with squash and stretch. "
    "Forbidden: anti-aliasing, soft gradients, blur, glow bloom, painterly texture, 3D render, photo, "
    "text, letters, numbers, logos, watermark, signature."
)

CONTENT_RULES = (
    "CONTENT RULES: no blood, gore, wounds or corpses (hits are white flashes, sparks and dust); "
    "no civilian harm; no real people; factions are shown only by uniform, gear and small flag patches, "
    "never by caricatured faces or ethnicity; respectful, heroic arcade tone."
)

ALPHA_SOLID = (
    "BACKGROUND: real transparent background (PNG alpha), never a painted checkerboard, no floor, "
    "no cast ground shadow. If true transparency is impossible, use one flat pure magenta #FF00FF background instead."
)

ALPHA_FX = (
    "TRANSPARENCY: real transparent background (PNG alpha), never a painted checkerboard. "
    "Use pixel-art stepped opacity in hard-edged blocks, about 5 levels (0, 25, 50, 75, 100%): "
    "solid objects and blast cores 100%, glow halos 50%, smoke 25-75%, ground shadows and warning rings 25-50%. "
    "If true transparency is impossible, use one flat pure magenta #FF00FF background instead."
)

GRID_RULE = ("All rows and columns are exactly equal in size and evenly spaced; leave a clear empty gap between neighboring drawings. "
             "The grid is invisible: no grid lines, borders, numbers or labels anywhere.")

# ---------------------------------------------------------------- 유닛(캐릭터·적·NPC)

ALLY_ROWS = [
    ("attack", "1 ready stance; 2 aim begins; 3 weapon raised, peak anticipation; 4 fire or strike with a bright yellow-white flash; 5 exaggerated recoil and follow-through; 6 settle back toward ready"),
    ("defend", "1 ready; 2 flinch and raise guard (arm, weapon, plate or helmet); 3 brace low; 4 block impact with a small white spark; 5 pushed back slightly, holding guard; 6 lower guard"),
    ("skill", "1 ready; 2 crouch and gather; 3 raise an arm, radio or signal toward the sky, small white-gold glint starts; 4 glint peak, point or throw forward; 5 glint fades; 6 recover"),
    ("move_slow", "relaxed 6-frame walk cycle, weapon carried low, gentle 1-pixel bob"),
    ("move_fast", "6-frame run cycle, leaning forward, long strides, small dust puffs at the feet on frames 2 and 5"),
    ("crit", "1 ready; 2 deep wind-up with a thin golden outline; 3 freeze anticipation; 4 powerful strike with a big yellow-white flash and a pixel shock ring; 5 hold and recoil; 6 recover"),
]

# 유닛 종류(S/B 보병·보스, L 차량·항공기·포대)에 따라 이동·방어 설명이 다르다
ENEMY_ROWS_BY_TAG = {
    "S": [("move", "5-frame march or run cycle; fast units lean forward with small dust puffs"),
          ("defend", "1 ready; 2 flinch; 3 raise guard or crouch behind cover; 4 hold guard with a faint steel-blue shimmer; 5 lower guard")],
    "L": [("move", "5-frame loop: treads rolling or wheels turning with exhaust flicker; aircraft: a gentle flight wobble with engine glow"),
          ("defend", "1 ready; 2 hatch closes or crew ducks; 3 armor plates flash steel-blue; 4 hold with a faint shimmer; 5 reopen")],
}
ENEMY_ROWS = [
    ("move", ""),
    ("attack", "1 ready; 2 wind-up; 3 aim or raise weapon; 4 fire or strike with a flash; 5 recoil and recover"),
    ("defend", ""),
    ("crit", "heavy attack: 1-2 charge-up with a growing red pixel warning glow; 3 powerful strike or heavy shot with a large flash; 4 follow-through; 5 recovery"),
    ("hit", "damage reaction: 1 normal; 2 full white silhouette flash; 3 maximum recoil with squash; 4 wobble and stagger; 5 recover"),
]

NPC_ROWS = [
    ("idle", "gentle breathing, small weight shift, a blink on frame 4, a tiny prop movement (cloth, strap, tool)"),
    ("talk", "nod and head tilt, one hand gesturing, mouth opening and closing, a small three-dot speech bubble on frames 2-4"),
    ("give", "1 notice the player; 2 reach into bag or pocket; 3 extend an arm holding a small item with a white-gold glint; 4 item sparkles; 5 pull back with a small friendly wave"),
]

ALLIES = [
    ("A01", "ROK Army rifleman: olive fatigues, steel M1 helmet, M1 Garand rifle, canteen and ammo belt"),
    ("A02", "ROK Army guard trooper: helmet, chest plate, tall riveted steel shield plate held in front, M1 carbine"),
    ("A03", "ROK Army mortar man: helmet, ammo satchel, small 60mm mortar tube carried on the shoulder"),
    ("A04", "student volunteer soldier: young face, oversized helmet, dark school jacket under web gear, scarf, carbine"),
    ("A05", "ROK Army grenadier: grenade bandolier across the chest, pouches, big overhand throwing arm"),
    ("A06", "ROK military police: white helmet band, armband, whistle, baton and pistol"),
    ("A07", "US Marine BAR gunner: green utility uniform, camouflage helmet cover, Browning Automatic Rifle"),
    ("A08", "US Army bazooka trooper: long M20 bazooka tube on the shoulder, helmet, rocket bag"),
    ("A09", "US Army medic: red-cross armband and helmet mark, medical bag, pistol holster"),
    ("A10", "ROK Army machine gunner: light machine gun with bipod, ammo belt across the chest"),
    ("A11", "ROK combat engineer: demolition pack, mine detector, small time bomb with a red LED"),
    ("A12", "ROK Army sniper: scoped rifle, helmet netting with leaves, scarf"),
    ("A13", "US Army Ranger: lean build, dark fatigues, Thompson submachine gun, combat knife"),
    ("A14", "US artillery forward observer: radio backpack with tall antenna, binoculars, signal flare"),
    ("A15", "US tank crewman: leather tanker helmet, goggles, coveralls, big wrench, pistol"),
    ("A16", "British infantryman: Brodie helmet, khaki battledress, Lee-Enfield rifle"),
    ("A17", "Turkish brigade assault trooper: small crescent-and-star patch, fixed bayonet, lunging stance"),
    ("A18", "Canadian sniper: small maple-leaf patch, scoped rifle, camouflage scarf"),
    ("A19", "Australian scout: slouch hat with one side of the brim pinned up, jungle-green uniform, light rifle"),
    ("A20", "Ethiopian Kagnew Battalion soldier: khaki uniform, helmet, rifle, small green-yellow-red patch"),
    ("A21", "Greek mountain trooper: beret, mountain pack with coiled rope, slung rifle, sturdy boots"),
    ("A22", "US forward air controller: radio set, bright orange signal panel, helmet"),
    ("A23", "US Navy gunfire spotter: navy dungarees, binoculars, field radio"),
    ("A24", "Filipino infantryman: small Philippine flag patch, helmet, carbine, agile stance"),
    ("A25", "French grenadier: helmet with a small tricolor patch, grenade bag, rifle grenade launcher"),
    ("A26", "Dutch infantryman: small orange-white-blue patch, helmet, rifle, steady stance"),
    ("A27", "Thai infantryman: small Thai flag patch, helmet, rifle, nimble dodge pose"),
    ("A28", "ROK raider: dark fatigues, headband, submachine gun, knife"),
    ("A29", "US helicopter pilot: flight helmet, goggles, flight suit, sidearm, signaling with a flare"),
    ("A30", "Allied staff officer (fictional, not a real person): officer cap, long coat, map case, binoculars, pointer baton"),
]

# 태그: S 보병(100px 프레임), B 보스(200px 프레임, 더 크게), L 차량·항공기·포대(200px 프레임, 너비 기준)
ENEMIES = [
    ("E01", "S", "KPA rifleman: khaki-brown uniform, side cap with a red star, bolt-action rifle, charging"),
    ("E02", "S", "KPA scout: light gear, crouched fast runner, pistol"),
    ("E03", "S", "KPA mortar crewman: mortar tube and shell box"),
    ("E04", "L", "T-34 medium tank: olive-green hull, red star on the turret"),
    ("E05", "B", "river-crossing commander: officer cap, medals, binoculars, pistol, wet boots"),
    ("E06", "S", "KPA occupation rifleman: khaki uniform, red armband, rifle"),
    ("E07", "S", "KPA sniper: scoped rifle, netting on the cap"),
    ("E08", "S", "KPA machine-gun team member: heavy machine gun with a gun shield on wheels"),
    ("E09", "L", "SU-76 self-propelled gun: open-top light armored gun"),
    ("E10", "B", "occupation division commander: long coat, peaked cap, medals, riding crop"),
    ("E11", "S", "KPA sapper: satchel charges, mines, shovel"),
    ("E12", "S", "KPA anti-tank gunner: long anti-tank rifle"),
    ("E13", "L", "courier motorcycle with sidecar: rider in goggles"),
    ("E14", "L", "T-34/85 tank: bigger turret, red star"),
    ("E15", "B", "artillery regiment commander: field telephone, shell crate, peaked cap"),
    ("E16", "S", "mountain infiltrator: leaves on the helmet, submachine gun, knife"),
    ("E17", "S", "KPA grenadier: grenade belts, overhand throw"),
    ("E18", "S", "flamethrower trooper: flamethrower backpack, orange pixel flame jet"),
    ("E19", "L", "76mm mountain gun emplacement: gun behind sandbags, one crew silhouette"),
    ("E20", "B", "mountain defense commander: fur-collar coat, binoculars"),
    ("E21", "S", "KPA assault trooper: drum-magazine submachine gun, sprinting"),
    ("E22", "S", "KPA mortar squad member: large mortar with an ammo carrier"),
    ("E23", "S", "KPA anti-aircraft gunner: AA machine gun on a tripod aimed upward"),
    ("E24", "L", "heavy self-propelled gun: large armored gun carriage"),
    ("E25", "B", "corps commander: sash, medals, peaked cap, swagger stick"),
    ("E26", "S", "urban sniper: rubble-colored camouflage cloak, scoped rifle"),
    ("E27", "S", "barricade engineer: barbed-wire roll and sandbags"),
    ("E28", "S", "political officer: red armband, megaphone, faint red aura"),
    ("E29", "L", "heavy tank: thick armor, big gun, red star"),
    ("E30", "B", "capital defense commander: grand greatcoat, medals, binoculars"),
    ("E31", "S", "PVA infantryman: quilted khaki-green winter uniform, cloth cap with a red star, rifle, running"),
    ("E32", "S", "PVA scout: white cloak over khaki, low crouched run"),
    ("E33", "S", "PVA signal trooper: bugle and whistle, cloth cap"),
    ("E34", "S", "PVA mortar crewman: mortar and ammo boxes"),
    ("E35", "B", "PVA division commander: quilted greatcoat, medals, field glasses"),
    ("E36", "S", "PVA sniper: snow-camouflage cloak, scoped rifle"),
    ("E37", "S", "PVA anti-tank assault soldier: pole charge and satchel charge"),
    ("E38", "L", "MiG-15 jet fighter seen from the side: silver swept-wing jet, red star"),
    ("E39", "L", "truck-mounted rocket launcher: multi-rail launcher"),
    ("E40", "B", "PVA corps commander: winter greatcoat, fur hat, medals"),
    ("E41", "S", "guard infantryman: polished uniform, red collar tabs, submachine gun"),
    ("E42", "S", "special forces soldier: dark uniform, beret, knife and submachine gun"),
    ("E43", "L", "twin-barrel anti-aircraft gun emplacement: barrels pointing up"),
    ("E44", "L", "heavy tank with a small red pennant"),
    ("E45", "B", "supreme defense commander: ornate uniform, many medals, cane"),
    ("E46", "S", "winter elite infantryman: fur hat, white winter camouflage, sliding on ice"),
    ("E47", "S", "PVA mountain elite: snow-camouflage cloak, automatic rifle"),
    ("E48", "L", "pair of MiG jet fighters flying in formation, seen from the side"),
    ("E49", "L", "armored rocket vehicle: tank hull with a rocket pod"),
    ("E50", "B", "final boss, fictional northern coalition supreme commander: imposing heavy greatcoat and cape, many medals, glowing dark-red aura"),
]

NPCS = [
    ("N01", "war correspondent: brimmed hat with a press card, trench coat, camera, notebook"),
    ("N02", "field surgeon: white apron over fatigues, helmet with a red cross, medical bag"),
    ("N03", "supply truck soldier: work cap, carrying an ammo crate, small hand cart"),
    ("N04", "elderly Korean villager: white hanbok-style clothes, straw hat, cane, cloth bundle; calm and dignified"),
    ("N05", "young radio operator: oversized helmet, field radio with antenna, headset"),
    ("N06", "interpreter: civilian jacket with an armband, round glasses, dictionary"),
    ("N07", "military chaplain: officer uniform, small plain cross badge, small book"),
    ("N08", "mechanic: coveralls, wrench, toolbox, goggles pushed up"),
    ("N09", "military police traffic controller: white helmet band, two signal batons"),
    ("N10", "dog handler with a military working dog: handler on the right, shepherd-type dog on the left, leash"),
]

SIZE_RULE = {
    "S": "infantry: the figure is about 60% of the cell height",
    "B": "boss: bulkier and taller, about 80% of the cell height, medals and long coat",
    "L": "vehicle, aircraft or emplacement: about 85% of the cell width (aircraft fly level, their lowest point on the baseline)",
}


def _rows_text(rows, frames):
    lines = [f"ROW {i + 1} {name} ({frames} frames): {desc}" for i, (name, desc) in enumerate(rows)]
    return "\n".join(lines)


def ally_prompt(uid, desc):
    return "\n".join([
        "Create ONE sprite animation sheet for a retro 2D survival action game set in the 1950 Korean War.",
        STYLE,
        CONTENT_RULES,
        ALPHA_SOLID,
        f"SUBJECT: {uid} {desc}. Ally unit (ROK Army, US forces or UN contingent); muted olive and khaki uniform colors with steel-gray metal.",
        "CANVAS: 1:1 square split into an invisible grid of 6 columns x 6 rows of equal square cells. "
        "Each row is one action animated in 6 frames, left to right; rows from top to bottom in the order listed. " + GRID_RULE,
        "FRAMES: the SAME character in all 36 cells, as if traced from one model sheet: identical design, colors, gear and size. "
        "Side view facing RIGHT. The figure is about 60% of the cell height; its BODY (not the weapon) is centered on the cell's vertical center line "
        "in every frame, feet on one shared baseline 8% above the cell bottom. Leave the empty space around the body for muzzle flashes and effects; nothing crosses a cell border. "
        "Each row loops smoothly from frame 6 back to frame 1.",
        "ROWS:\n" + _rows_text(ALLY_ROWS, 6),
    ])


def enemy_prompt(uid, tag, desc):
    return "\n".join([
        "Create ONE sprite animation sheet of an ENEMY unit for a retro 2D survival action game set in the 1950 Korean War.",
        STYLE,
        CONTENT_RULES + " Bosses are generic fictional commanders identified only by rank and costume.",
        ALPHA_SOLID,
        f"SUBJECT: {uid} {desc}. Enemy unit (Korean People's Army or Chinese People's Volunteer Army) shown as a game opponent; "
        "khaki, brown or quilted green uniforms with red-star badges and dark-red accents so it reads as hostile.",
        "CANVAS: 1:1 square split into an invisible grid of 5 columns x 5 rows of equal square cells. "
        "Each row is one action animated in 5 frames, left to right; rows from top to bottom in the order listed. " + GRID_RULE,
        f"FRAMES: the SAME unit in all 25 cells, as if traced from one model sheet: identical design, colors and size. "
        f"Side view facing RIGHT. Size: {SIZE_RULE[tag]}. Its body (not the weapon) is centered on the cell's vertical center line in every frame; feet, wheels or treads on one shared baseline "
        "8% above the cell bottom. Nothing crosses a cell border. "
        "Each row loops smoothly from frame 5 back to frame 1.",
        "ROWS:\n" + _rows_text(enemy_rows(tag), 5),
    ])


def enemy_rows(tag):
    variant = dict(ENEMY_ROWS_BY_TAG["L" if tag == "L" else "S"])
    return [(name, variant.get(name) or desc) for name, desc in ENEMY_ROWS]


def npc_prompt(uid, desc):
    return "\n".join([
        "Create ONE sprite animation sheet of a friendly NPC for a retro 2D survival action game set in the 1950 Korean War.",
        STYLE,
        CONTENT_RULES + " Kind, warm expressions; no injury or distress. A speech bubble may contain three dots only.",
        ALPHA_SOLID,
        f"SUBJECT: {uid} {desc}.",
        "CANVAS: 1:1 square split into an invisible grid of 5 columns x 5 rows of equal square cells. "
        "Use only the top 3 rows (each row is one action animated in 5 frames, left to right); rows 4 and 5 stay completely empty. " + GRID_RULE,
        "FRAMES: the SAME character in all 15 used cells, as if traced from one model sheet. Side view facing RIGHT toward the player. "
        "The figure is about 60% of the cell height, its body centered on the cell's vertical center line, feet on one shared baseline 8% above the cell bottom. "
        "Each row loops smoothly from frame 5 back to frame 1.",
        "ROWS:\n" + _rows_text(NPC_ROWS, 5),
    ])


# ---------------------------------------------------------------- 바닥 타일

TILE_SETS = [
    ("tiles_1", [("T01", "riverbank sand and fine gravel, dry, no water visible (Gyeongsang)"),
                 ("T02", "dry field soil with faint short furrow marks in random directions"),
                 ("T03", "flat harvested rice paddy with short green-gold stubble (Jeolla)"),
                 ("T04", "ochre-red clay ground with a few short, faint wheel marks")]),
    ("tiles_2", [("T05", "rolling hill grass, short and dry (Chungcheong)"),
                 ("T06", "packed brown dirt with scattered gravel"),
                 ("T07", "forest floor of fallen autumn leaves (Gangwon)"),
                 ("T08", "rocky valley ground: small flat stones with moss between them")]),
    ("tiles_3", [("T09", "scrubby hillside grass with bare patches (Gyeonggi)"),
                 ("T10", "ruined village ground: dirt and broken roof-tile shards"),
                 ("T11", "cracked city asphalt with small faded paint flecks (Seoul)"),
                 ("T12", "collapsed brick and concrete rubble")]),
    ("tiles_4", [("T13", "reed plain: dry brown reeds and mud (Hwanghae)"),
                 ("T14", "dry yellow-brown loess plain with cracks"),
                 ("T15", "silver-grass tufts on gravelly ground (Pyongan)"),
                 ("T16", "mud after rain with small puddles and short tire marks")]),
    ("tiles_5", [("T17", "paved city street with patches of old snow (Pyongyang)"),
                 ("T18", "wet river sand with small ripple marks, no open water"),
                 ("T19", "snow-covered ground with faint footprints (Hamgyong)"),
                 ("T20", "frozen lake surface with ice cracks and snow dust")]),
]


def tiles_prompt(tiles):
    listing = "\n".join(f"{i + 1}. {tid}: {desc}" for i, (tid, desc) in enumerate(tiles))
    return "\n".join([
        "Create ONE image containing FOUR seamless ground textures for a retro 2D top-down survival game set in the 1950 Korean War.",
        STYLE.replace("Chunky heroic proportions (about 3 heads tall), big hands and boots, readable silhouettes, "
                      "exaggerated hand-animated poses with squash and stretch. ", "")
             .replace("about 2x2 image pixels", "about 8x8 image pixels"),
        "CANVAS: 1:1 square split into a 2x2 grid of four equal square tiles, edge to edge, no gaps or borders. "
        "Each tile is a 64x64-pixel texture enlarged 8 times, viewed straight down from above (90 degrees), "
        "and wraps seamlessly on its own: its left edge continues its right edge and its top edge continues its bottom edge.",
        "LOOK: flat ground only, medium-dark values and LOW contrast so bright character sprites stand out on top; "
        "an EVEN, uniform texture across the whole tile: no water edge or shoreline, no roads, paths, rails or lines that run across the tile, "
        "no single large feature, no gradient from one side to the other; "
        "no outlines on the ground texture itself, no large objects, no strong shadows, no people, no blood; "
        "4-6 small scattered details per tile (pebbles, tufts, cracks, puddles) spread evenly with no obvious repeat. "
        "Reading order: top-left, top-right, bottom-left, bottom-right.",
        "TILES:\n" + listing,
    ])


# ---------------------------------------------------------------- 배경 소품 (6프레임 루프)

# (출력 파일명, 행 설명, 프레임 크기, 기준 'h'|'w', 목표 px)
PROP_SETS = [
    ("props_1", [("tree_leaf", "broadleaf tree in summer green, leaves sway in the wind", 200, "h", 150),
                 ("tree_pine", "tall pine tree, branches sway gently", 200, "h", 160),
                 ("tree_dead", "burnt dead tree, bare branches tremble, a few ash flakes drift", 200, "h", 140),
                 ("tree_snow", "snow-laden pine, snow dust falls from the branches", 200, "h", 160),
                 ("grass", "tall grass tuft waving in the wind", 100, "h", 30)]),
    ("props_2", [("reed", "silver-grass or reed clump rippling", 100, "h", 40),
                 ("bush", "low shrub, leaves flutter", 100, "h", 34),
                 ("flag", "tattered plain military flag on a pole fluttering, no emblem", 100, "h", 80),
                 ("drum_fire", "steel oil drum with flickering fire on top", 100, "h", 44),
                 ("burnt_truck", "burnt-out truck wreck with a thin rising semi-transparent smoke column", 200, "w", 150)]),
    ("props_3", [("wire", "barbed-wire fence segment, slight wire shimmer", 100, "w", 90),
                 ("sandbag", "sandbag wall, only a tiny dust puff changes", 100, "w", 80),
                 ("rock", "mossy boulder, nearly static", 100, "h", 36)]),
]


def props_prompt(rows):
    listing = "\n".join(f"ROW {i + 1}: {desc}" for i, (_, desc, *_r) in enumerate(rows))
    empty = "" if len(rows) == 5 else f" Rows {len(rows) + 1}-5 stay completely empty."
    return "\n".join([
        "Create ONE animation sheet of background props for a retro 2D survival game set in the 1950 Korean War.",
        STYLE,
        "No people, no blood or gore.",
        ALPHA_SOLID,
        "CANVAS: 1:1 square split into an invisible grid of 6 columns x 5 rows of equal cells. "
        "Each row is one prop animated in 6 frames, left to right; rows from top to bottom in the order listed." + empty + " " + GRID_RULE,
        "FRAMES: each row shows the same prop in side view, centered in its cell, base or roots on one shared baseline "
        "8% above the cell bottom, same scale in every frame, fully inside its cell, about 80% of the cell height or width. "
        "Only the animated parts move, by a few pixels. Frame 6 loops back to frame 1 smoothly.",
        "ROWS:\n" + listing,
    ])


# ---------------------------------------------------------------- 이펙트 (6프레임)

# (출력 파일명, 설명, 프레임 크기)
FX_SETS = [
    ("vfx_1", [("bomb_fall", "V01 BOMB_FALL: NO ground warning ring (the game draws the ally-teal marker itself); 1-2 small finned bomb high above with a thin falling streak; 3-5 bomb descending, scale 160% to 100%, shrinking ground shadow (50%), thin speed lines; 6 touchdown, white flash", 100),
               ("explosion_l", "V02 EXPLOSION_L: frame 1 is the BRIGHTEST and LARGEST: a pure white-to-yellow core filling about 60% of the cell, no outline; 2 orange fireball with a yellow core; 3 fireball breaks into smoke and debris; 4 gray smoke plume rises (75%) with embers; 5 smoke thins (50%); 6 last wisps (25%). NO crater, NO ground decal, NO shockwave ring (the game draws those)", 200),
               ("explosion_s", "V03 EXPLOSION_S: the same 6-step progression as EXPLOSION_L but smaller and faster, frame 1 brightest and largest, NO crater or ground decal", 100),
               ("bomber", "V04 BOMBER: twin-engine propeller bomber seen from directly above, flying toward the bottom, propellers spinning, 6-frame loop", 200),
               ("bomber_shadow", "V04 BOMBER_SHADOW: the identical bomber silhouette as a flat black shape at 50% opacity, same 6-frame animation", 200)]),
    ("vfx_2", [("timebomb", "V05 TIMEBOMB: 1 charge placed with a dust puff; 2 red LED slow blink; 3 medium blink; 4 fast blink with sparks; 5 white flash; 6 first blast frame", 100),
               ("burst_shell", "V06 BURST_SHELL: 1-2 colored smoke flare rising (50-75%); 3-6 small-to-medium shell impact with debris", 100),
               ("support_volley", "V07 SUPPORT_VOLLEY: 1 allied silhouettes fade in (25-75%); 2 three UN riflemen in mixed uniforms with small flag patches crouch to aim; 3-5 firing with muzzle flashes and ejected casings; 6 fade out", 200),
               ("hit_spark", "V12 HIT_SPARK: 1 white flash star; 2-4 yellow sparks radiating; 5-6 fast fade", 100),
               ("skill_AS03", "AS03 STRAFE (large effect, fills most of the cell, no background): a fighter plane seen from above passes; a line of bullet-impact dust dots and muzzle glare", 200)]),
    ("vfx_3", [("naval_shell", "V08 NAVAL_SHELL: 1 big muzzle glow at the cell edge; 2-4 shell arcing with a thin smoke trail (50%); 5-6 impact with a tall dirt-and-smoke column", 200),
               ("tank_charge", "V09 TANK_CHARGE: tank rolling right with animated treads, lingering semi-transparent dust trail (25-50%), pixel shock arcs ahead, 6-frame loop", 200),
               ("supply_drop", "V10 SUPPLY_DROP: 1-3 parachute crate descending; 4 landing dust; 5-6 green-white healing sparkles rising (50-100%)", 100),
               ("mines", "V11 MINES: 1-2 small mines drop and bury; 3 flash; 4-6 chain of small pops", 100),
               ("crit_ring", "V13 CRIT_RING: golden shock ring with radial lines expanding then fading over 6 frames", 100)]),
    ("vfx_4", [("muzzle", "V14 MUZZLE_FLASH: ONLY the flash itself, overlaid on a gun tip in the game, so NO soldier, hands or gun: a small star-shaped yellow-white flash pointing right that blooms then shrinks, plus a tiny brass shell casing popping out, over 6 frames", 100),
               ("dust", "V15 DUST_PUFF: soft dithered dust ring (25-50%) expanding and thinning over 6 frames", 100),
               ("skill_AS01", "AS01 CARPET_BOMB (large effect, fills most of the cell, no background): a bomber shadow sweeps across; three lines of explosions follow with smoke trails", 200),
               ("skill_AS04", "AS04 NAVAL_SALVO (large effect, fills most of the cell, no background): three wide muzzle flashes at the edge, then three shell impacts", 200),
               ("skill_AS06", "AS06 ALLIED_BATTALION (large effect, fills most of the cell, no background): a row of five UN riflemen with small flag patches fade in, fire, fade out", 200)]),
    ("vfx_5", [("skill_AS07", "AS07 ARMOR_CHARGE (large effect, fills most of the cell, no background): three tanks abreast with dust trails and shock arcs", 200),
               ("skill_AS09", "AS09 TOTAL_ASSAULT (large effect, fills most of the cell, no background): cascading explosions inside a golden pixel ring (50%)", 200),
               ("skill_AS10", "AS10 DEFENSE_DOME (large effect, fills most of the cell, no background): translucent steel-blue dome (fill 25%, rim 75%) with scanline pixels and an impact ripple", 200),
               ("skill_AS11", "AS11 ENCIRCLE (large effect, fills most of the cell, no background): a contracting ring (75%) with inward arrows, then an implosion flash", 200),
               ("skill_AS12", "AS12 JOINT_STRIKE (large effect, fills most of the cell, no background): bomber shadow, shell trail and volley glow merge into one white flash", 200)]),
    ("vfx_6", [("scorch_decal", "V16 SCORCH_DECAL: six STILL variants (not an animation), each a top-down scorch mark flattened 2:1 on the ground, dark brown-gray, stepped alpha 50-75%, no fire, no smoke", 100),
               ("dirt_spray", "V17 DIRT_SPRAY: a cone of dirt clods and dust bursting toward the RIGHT, rising then falling over 6 frames (the game rotates it)", 100),
               ("dust_ring", "V18 DUST_RING: a flat 2:1 ground-level dust ring expanding outward and thinning (25-50%), for big impacts and tanks", 200),
               ("embers", "V19 EMBERS: a few small glowing orange embers flickering and drifting upward, 6-frame loop", 100),
               ("flare_smoke", "V20 FLARE_SMOKE: teal-green signal smoke rising from a small canister on the ground, 6-frame loop", 100)]),
]

# 이펙트 시트 단계: 기본 P1(D05~D16), 대형 스킬 시트만 P3
FX_PHASE = {"vfx_5": "P3"}


def fx_prompt(rows):
    listing = "\n".join(f"ROW {i + 1}: {desc}" for i, (_, desc, _s) in enumerate(rows))
    return "\n".join([
        "Create ONE skill-effect animation sheet containing FIVE effects for a retro 2D survival game set in the 1950 Korean War.",
        STYLE.replace("Chunky heroic proportions (about 3 heads tall), big hands and boots, readable silhouettes, "
                      "exaggerated hand-animated poses with squash and stretch. ", "Bold, dramatic cartoon timing. ")
             .replace("1-pixel dark-brown outline (#2A1A10) around every shape", "1-pixel dark outline on solid objects only (not on smoke or glow)"),
        "No blood or gore.",
        ALPHA_FX,
        "CANVAS: 1:1 square split into an invisible grid of 6 columns x 5 rows of equal cells. "
        "Each row is one effect animated in 6 frames, left to right, with a clear start-to-end progression; rows from top to bottom in the order listed. "
        "Each effect is centered in its cell with the same ground-contact point in every frame of its row; small effects use about half of the cell, "
        "large ones fill most of it; nothing crosses a cell border. "
        "NO BACKGROUND SCENERY, even for large effects: draw only the effect itself (aircraft, shells, explosions, smoke, glow, soldiers) "
        "on transparency; never paint ground, sea, sky, clouds, maps or terrain behind it. " + GRID_RULE,
        "ROWS:\n" + listing,
    ])


# ---------------------------------------------------------------- 카드·아이콘·UI·지도

CARD_FRAMES = ["frame_common", "frame_rare", "frame_legend", "frame_minus", "card_back"]

CARD_FRAMES_PROMPT = "\n".join([
    "Create ONE image with FIVE card frames for a retro 2D card-and-survival game set in the 1950 Korean War.",
    STYLE.replace("Chunky heroic proportions (about 3 heads tall), big hands and boots, readable silhouettes, "
                  "exaggerated hand-animated poses with squash and stretch. ", ""),
    "No skulls, no blood. " + ALPHA_SOLID,
    "CANVAS: 1:1 square; five card frames side by side in one horizontal row, evenly spaced with clear transparent gaps; "
    "each card is a 5:7 portrait rectangle (like a 120x168-pixel card enlarged), pixel-stepped rounded corners. "
    "Identical layout for all five, all fields left EMPTY: a name banner across the top (top 12% of the card); "
    "a small round slot at the top-left corner for a branch icon; a large SQUARE illustration window right under the banner, "
    "about 87% of the card width, filled with flat dark gray; a parchment-colored description box below it; three small gem slots along the bottom edge.",
    "LEFT TO RIGHT: 1 COMMON: olive-green riveted steel frame, 1 gem lit. 2 RARE: silver-blue riveted plates, 2 gems lit. "
    "3 LEGENDARY: brass-gold ornate corners, 3 gems lit, a 50%-opacity golden pixel glow around the card. "
    "4 MINUS: dark maroon frame, yellow-black hazard stripes on the border, barbed wire on the edges, a caution triangle in the icon slot, no gems lit. "
    "5 BACK: card back (also used for face-down cards): dark olive ammo-crate wood pattern, a large pixel star emblem, rope-like border.",
])

TAG_ICONS = ["tag_infantry", "tag_artillery", "tag_armor", "tag_air", "tag_navy", "tag_intel", "tag_engineer", "tag_medical", "tag_allied"]

TAG_ICONS_PROMPT = "\n".join([
    "Create ONE image with NINE game icons for a retro 2D card-and-survival game set in the 1950 Korean War.",
    STYLE.replace("Chunky heroic proportions (about 3 heads tall), big hands and boots, readable silhouettes, "
                  "exaggerated hand-animated poses with squash and stretch. ", "")
         .replace("about 2x2 image pixels", "about 10x10 image pixels"),
    ALPHA_SOLID,
    "CANVAS: 1:1 square split into an invisible 3x3 grid; one icon per cell, centered, each designed as a bold 32x32-pixel icon "
    "enlarged about 10 times, thick outline, simple shape readable at small size. " + GRID_RULE,
    "READING ORDER: 1 rifle (infantry); 2 artillery shell (artillery); 3 tank (armor); 4 propeller plane (air force); 5 anchor (navy); "
    "6 radio with a magnifying glass (intelligence); 7 shovel and dynamite (engineer); 8 red cross (medical); 9 star with two crossed flags (allied).",
])

OVERLAYS = ["overlay_smoke", "overlay_static", "overlay_snow", "overlay_night", "overlay_crack", "overlay_success"]

OVERLAYS_PROMPT = "\n".join([
    "Create ONE image with SIX semi-transparent card overlay layers for a retro 2D card-and-survival game set in the 1950 Korean War.",
    STYLE.replace("Chunky heroic proportions (about 3 heads tall), big hands and boots, readable silhouettes, "
                  "exaggerated hand-animated poses with squash and stretch. ", "")
         .replace("1-pixel dark-brown outline (#2A1A10) around every shape; ", ""),
    "No skulls, no blood. " + ALPHA_FX,
    "CANVAS: 1:1 square split into an invisible grid of 3 columns x 2 rows; each cell holds one 5:7 portrait overlay "
    "(laid over a card in the game), mostly 25-75% opacity so the card underneath stays faintly visible. " + GRID_RULE,
    "READING ORDER: 1 SMOKE: gray pixel smoke clouds with broken dithered edges, denser toward the bottom. "
    "2 STATIC: radio interference, green and magenta pixel noise lines, scanlines, color-offset blocks. "
    "3 SNOW: white pixel flakes of different sizes with a 25% blue tint. "
    "4 NIGHT: deep blue-black 50-75% fill with a few star-like pixel specks. "
    "5 CRACK: cracks spreading from the center with thin smoke wisps (failure result). "
    "6 SUCCESS: golden pixel glow border with sparkles (success result).",
])

CARD_ART_P = [
    ("P01", "rifle squad firing a volley in a line"),
    ("P02", "three grenades in mid-air along an arc"),
    ("P03", "mortar crew firing, shell trail rising"),
    ("P04", "bomber seen from above dropping a bomb"),
    ("P05", "warship firing its guns toward a coast"),
    ("P06", "tank platoon advancing"),
    ("P07", "combat engineer planting a time bomb with a red LED"),
    ("P08", "field medical tent with a red cross"),
    ("P09", "UN flags and soldiers of several nations standing together"),
    ("P10", "scout with binoculars on a ridge"),
    ("P11", "radio operator repairing a field radio with sparks"),
    ("P12", "war-room map with pins and a glowing golden plan document"),
    ("P13", "reconnaissance report papers with an aerial photo"),
    ("P14", "officers gathered around a map table"),
    ("P15", "supply crates descending by parachute"),
    ("P16", "gold medal on a ribbon above a glowing star"),
]

CARD_ART_M = [
    ("M01", "false intelligence report with a big red X stamp"),
    ("M02", "friendly fire: a shell landing near our own trench, warning triangle"),
    ("M03", "empty supply crate and torn tarp"),
    ("M04", "dud shell stuck in the ground with thin smoke"),
    ("M05", "tired soldier sitting in the rain, lowered flag"),
    ("M06", "frosted boots in deep snow with icicles"),
    ("M07", "broken radio with a cut wire"),
    ("M08", "mixed-up order papers flying in confusion"),
    ("M00", "dark storm clouds over a muddy battlefield (spare generic bad-luck art)"),
]


def card_art_prompt(items, cols, mood):
    n = len(items)
    listing = "\n".join(f"{cid}: {desc}" for cid, desc in items)
    unused = "" if n == cols * cols else f" Use the first {n} cells; the remaining cells stay completely empty."
    return "\n".join([
        f"Create ONE image with {n} card illustrations for a retro 2D card game set in the 1950 Korean War.",
        STYLE.replace("about 2x2 image pixels", "about 2.5x2.5 image pixels"),
        CONTENT_RULES,
        f"CANVAS: 1:1 square split into an invisible {cols}x{cols} grid of equal square cells.{unused} "
        "Each cell is one full-bleed square illustration (like a 104x104-pixel card picture enlarged): one centered subject "
        "with a strong readable silhouette on a simple scene background, " + mood + ". No borders, frames or gaps. " + GRID_RULE,
        "READING ORDER (left to right, top to bottom):\n" + listing,
    ])


SKILL_ICONS = [
    ("AS01", "carpet bombing: three bombs falling in a row"),
    ("AS02", "precision strike: crosshair over a single large bomb"),
    ("AS03", "strafing run: fighter plane with a dotted bullet line"),
    ("AS04", "naval salvo: warship gun turret firing"),
    ("AS05", "artillery barrage: howitzer with three shells"),
    ("AS06", "allied battalion: three helmets side by side with a small flag"),
    ("AS07", "armor breakthrough: tank front view with speed lines"),
    ("AS08", "airdrop: parachute with a supply crate"),
    ("AS09", "total assault: starburst explosion with crossed rifles"),
    ("AS10", "hold the line: steel shield dome"),
    ("AS11", "encirclement: ring of inward arrows"),
    ("AS12", "joint strike: plane, shell and rifle joined in a triangle"),
]

UPGRADE_ICONS = [
    ("hp", "red heart with a plus"), ("defense", "steel helmet"), ("speed", "boot with wind lines"),
    ("attack", "rifle bullet with a power flash"), ("attack_speed", "ammo belt with motion lines"),
    ("range", "binoculars"), ("crit_chance", "golden crosshair"), ("crit_damage", "cracked target with a starburst"),
    ("magnet", "horseshoe magnet pulling a star"), ("luck", "four-leaf clover on a dog tag"),
    ("hand_plus", "three fanned cards with a plus"), ("draw_speed", "card with a stopwatch"),
    ("weapon_rifle", "M1 rifle"), ("weapon_grenade", "hand grenade"), ("weapon_mortar", "mortar tube"),
    ("reroll", "two circular arrows"),
]

UI_ICONS = [
    ("star_xp", "small glowing supply star (experience pickup)"), ("seal", "round red wax seal stamp with a star (guaranteed success)"),
    ("bullet", "small rifle bullet flying right"), ("shell", "artillery shell flying right"), ("merit", "bronze merit medal"),
    ("tp", "lightning bolt in a gear (tactical points)"), ("op", "folded operation map (operation experience)"),
    ("lock", "padlock"), ("flag_ally", "small blue-teal allied pennant on a short pole"),
]


def icons_prompt(title, items, cols, rows):
    n = len(items)
    listing = "; ".join(f"{i + 1} {desc}" for i, (_, desc) in enumerate(items))
    return "\n".join([
        f"Create ONE image with {n} {title} for a retro 2D survival game set in the 1950 Korean War.",
        STYLE.replace("Chunky heroic proportions (about 3 heads tall), big hands and boots, readable silhouettes, "
                      "exaggerated hand-animated poses with squash and stretch. ", "")
             .replace("about 2x2 image pixels", "about 8x8 image pixels"),
        "No skulls, no blood. " + ALPHA_SOLID,
        f"CANVAS: 1:1 square split into an invisible grid of {cols} columns x {rows} rows; one icon per cell, centered, "
        "each designed as a bold 32x32-pixel icon enlarged, thick outline, simple shape readable at small size, consistent style across all icons. "
        + GRID_RULE,
        "READING ORDER (left to right, top to bottom): " + listing + ".",
    ])


MAP_PROMPT = "\n".join([
    "Create ONE stage-select map of the Korean peninsula for a retro 2D game set in the 1950 Korean War.",
    STYLE.replace("Chunky heroic proportions (about 3 heads tall), big hands and boots, readable silhouettes, "
                  "exaggerated hand-animated poses with squash and stretch. ", "")
         .replace("about 2x2 image pixels", "about 3x3 image pixels")
         .replace("limited palette of about 32 colors", "earthy sepia-olive wartime map palette"),
    "CANVAS: 1024x1536 portrait, top-down map. Accurate overall peninsula shape: jagged west coast with many small islands, "
    "smoother east coast, Taebaek mountains along the east, Jeju island in the south. Ocean in dark teal with simple pixel waves; "
    "tiny pixel mountains and rivers.",
    "Divide the land into 10 regions with thin dark borders and a distinct muted tint each, south to north: "
    "1 Gyeongsang (southeast), 2 Jeolla (southwest), 3 Chungcheong, 4 Gangwon (east), 5 Gyeonggi, 6 Seoul (small city marker inside Gyeonggi), "
    "7 Hwanghae, 8 Pyongan, 9 Pyongyang (small city marker inside Pyongan), 10 Hamgyong (northeast). "
    "Put one small empty round badge at the center of each region for in-game icons. "
    "A few decorative war-map touches (compass rose, torn paper edge), but absolutely no text, letters or numbers.",
])

# ---------------------------------------------------------------- 단계 배정

P1_UNITS = {"A01", "A02", "A03", "E01", "E02", "E03", "E04", "E05", "N01", "N02"}
P2_UNITS = {f"A{i:02d}" for i in range(4, 16)} | {f"E{i:02d}" for i in range(6, 26)} | {"N03", "N04", "N05"}


def unit_phase(uid):
    if uid in P1_UNITS:
        return "P1"
    if uid in P2_UNITS:
        return "P2"
    return "P3"


# ---------------------------------------------------------------- 항목 조립

def build_items():
    items = []

    def add(name, phase, prompt, post, size="1024x1024", transparent=True):
        items.append({"name": name, "phase": phase, "size": size, "transparent": transparent, "prompt": prompt, "post": post})

    # P1에 필요한 것부터 앞에 둔다(START~END로 잘라 돌려도 우선순위대로 나오게)
    add("tiles_1", "P1", tiles_prompt(TILE_SETS[0][1]), {"kind": "tiles", "ids": [t for t, _ in TILE_SETS[0][1]]}, transparent=False)
    for uid, desc in ALLIES:
        if unit_phase(uid) == "P1":
            add(f"ally_{uid}", "P1", ally_prompt(uid, desc), {"kind": "unit", "id": uid, "faction": "ally", "tag": "S"})
    for uid, tag, desc in ENEMIES:
        if unit_phase(uid) == "P1":
            add(f"enemy_{uid}", "P1", enemy_prompt(uid, tag, desc), {"kind": "unit", "id": uid, "faction": "enemy", "tag": tag})
    for uid, desc in NPCS:
        if unit_phase(uid) == "P1":
            add(f"npc_{uid}", "P1", npc_prompt(uid, desc), {"kind": "unit", "id": uid, "faction": "npc", "tag": "S"})
    add("card_frames", "P1", CARD_FRAMES_PROMPT, {"kind": "row", "count": 5, "names": CARD_FRAMES, "folder": "cards", "w": 120, "h": 168})
    add("card_tags", "P1", TAG_ICONS_PROMPT, {"kind": "grid", "cols": 3, "rows": 3, "names": TAG_ICONS, "folder": "ui", "w": 32, "h": 32})
    add("card_overlays", "P1", OVERLAYS_PROMPT, {"kind": "grid", "cols": 3, "rows": 2, "names": OVERLAYS, "folder": "ui", "w": 120, "h": 168, "alpha": "steps", "fill": "stretch"})
    add("card_art_p", "P1", card_art_prompt(CARD_ART_P, 4, "bright heroic palette"),
        {"kind": "grid", "cols": 4, "rows": 4, "names": [c for c, _ in CARD_ART_P], "folder": "cards", "w": 104, "h": 104, "alpha": "none", "fill": "stretch"}, transparent=False)
    add("card_art_m", "P1", card_art_prompt(CARD_ART_M, 3, "darker, gloomier palette"),
        {"kind": "grid", "cols": 3, "rows": 3, "names": [c for c, _ in CARD_ART_M], "folder": "cards", "w": 104, "h": 104, "alpha": "none", "fill": "stretch"}, transparent=False)
    add("icons_ui", "P1", icons_prompt("small UI icons", UI_ICONS, 3, 3), {"kind": "grid", "cols": 3, "rows": 3, "names": [n for n, _ in UI_ICONS], "folder": "ui", "w": 32, "h": 32})
    add("icons_upgrades", "P1", icons_prompt("upgrade icons", UPGRADE_ICONS, 4, 4),
        {"kind": "grid", "cols": 4, "rows": 4, "names": [f"icon_upgrade_{n}" for n, _ in UPGRADE_ICONS], "folder": "ui", "w": 32, "h": 32})
    add("icons_skills", "P1", icons_prompt("skill icons", SKILL_ICONS, 4, 3), {"kind": "grid", "cols": 4, "rows": 3, "names": [n for n, _ in SKILL_ICONS], "folder": "skills", "w": 32, "h": 32})
    for name, rows in FX_SETS:
        add(name, FX_PHASE.get(name, "P1"), fx_prompt(rows), {"kind": "fx", "rows": [{"name": n, "frame": s} for n, _d, s in rows]})
    add("props_1", "P2", props_prompt(PROP_SETS[0][1]), {"kind": "props", "rows": [{"name": n, "frame": f, "fit": m, "px": px} for n, _d, f, m, px in PROP_SETS[0][1]]})

    # P2
    add("map_korea", "P2", MAP_PROMPT, {"kind": "map", "w": 360, "h": 540}, size="1024x1536", transparent=False)
    add("tiles_2", "P2", tiles_prompt(TILE_SETS[1][1]), {"kind": "tiles", "ids": [t for t, _ in TILE_SETS[1][1]]}, transparent=False)
    add("tiles_3", "P2", tiles_prompt(TILE_SETS[2][1]), {"kind": "tiles", "ids": [t for t, _ in TILE_SETS[2][1]]}, transparent=False)
    for uid, desc in ALLIES:
        if unit_phase(uid) == "P2":
            add(f"ally_{uid}", "P2", ally_prompt(uid, desc), {"kind": "unit", "id": uid, "faction": "ally", "tag": "S"})
    for uid, tag, desc in ENEMIES:
        if unit_phase(uid) == "P2":
            add(f"enemy_{uid}", "P2", enemy_prompt(uid, tag, desc), {"kind": "unit", "id": uid, "faction": "enemy", "tag": tag})
    for uid, desc in NPCS:
        if unit_phase(uid) == "P2":
            add(f"npc_{uid}", "P2", npc_prompt(uid, desc), {"kind": "unit", "id": uid, "faction": "npc", "tag": "S"})

    # P3
    add("tiles_4", "P3", tiles_prompt(TILE_SETS[3][1]), {"kind": "tiles", "ids": [t for t, _ in TILE_SETS[3][1]]}, transparent=False)
    add("tiles_5", "P3", tiles_prompt(TILE_SETS[4][1]), {"kind": "tiles", "ids": [t for t, _ in TILE_SETS[4][1]]}, transparent=False)
    for name, rows in PROP_SETS[1:]:
        add(name, "P3", props_prompt(rows), {"kind": "props", "rows": [{"name": n, "frame": f, "fit": m, "px": px} for n, _d, f, m, px in rows]})
    for uid, desc in ALLIES:
        if unit_phase(uid) == "P3":
            add(f"ally_{uid}", "P3", ally_prompt(uid, desc), {"kind": "unit", "id": uid, "faction": "ally", "tag": "S"})
    for uid, tag, desc in ENEMIES:
        if unit_phase(uid) == "P3":
            add(f"enemy_{uid}", "P3", enemy_prompt(uid, tag, desc), {"kind": "unit", "id": uid, "faction": "enemy", "tag": tag})
    for uid, desc in NPCS:
        if unit_phase(uid) == "P3":
            add(f"npc_{uid}", "P3", npc_prompt(uid, desc), {"kind": "unit", "id": uid, "faction": "npc", "tag": "S"})

    for i, it in enumerate(items, 1):
        it["no"] = i
    return items
