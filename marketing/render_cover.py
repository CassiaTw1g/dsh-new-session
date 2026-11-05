#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""渲染小红书封面 marketing/xhs-cover-1080x1440.png

可重复运行：  python marketing/render_cover.py
要求：Python 3.10 + Pillow；Windows 中文字体（微软雅黑粗体优先）。
"""

from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ---------------------------------------------------------------- 基础参数
W, H = 1080, 1440
SCALE = 2                      # 2x 超采样后缩小，边缘更干净
W2, H2 = W * SCALE, H * SCALE
MARGIN = 90
CW = W - 2 * MARGIN            # 内容宽度 900

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PNG = os.path.join(OUT_DIR, "xhs-cover-1080x1440.png")

# ---------------------------------------------------------------- 字体兜底
FONT_BOLD_CANDIDATES = [
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/Deng.ttf",
    "C:/Windows/Fonts/STZHONGS.TTF",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_REG_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/Deng.ttf",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/STZHONGS.TTF",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_MONO_CANDIDATES = [
    "C:/Windows/Fonts/consola.ttf",
    "C:/Windows/Fonts/CascadiaMono.ttf",
    "C:/Windows/Fonts/CascadiaCode.ttf",
    "C:/Windows/Fonts/cour.ttf",
    "C:/Windows/Fonts/msyh.ttc",
]


def pick(candidates: list[str]) -> str:
    found = [p for p in candidates if os.path.exists(p)]
    if not found:
        sys.exit("找不到任何可用字体，候选: %s" % candidates)
    return found[0]


BOLD_PATH = pick(FONT_BOLD_CANDIDATES)
REG_PATH = pick(FONT_REG_CANDIDATES)
MONO_PATH = pick(FONT_MONO_CANDIDATES)

_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    """size 传设计稿字号，内部自动乘 SCALE。"""
    key = (path, size)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(path, size * SCALE, index=0)
    return _cache[key]


# ---------------------------------------------------------------- 配色
BG_TOP = (11, 16, 32)          # #0B1020
BG_BOT = (27, 42, 74)          # #1B2A4A
ACCENT = (122, 158, 255)       # #7A9EFF
ACCENT_SOFT = (99, 132, 224)
VIOLET = (167, 139, 250)
WHITE = (246, 249, 255)
GRAY = (156, 169, 199)
GRAY_DIM = (118, 132, 164)
CARD_FILL = (20, 27, 48)
CARD_LINE = (46, 61, 96)
BAR_FILL = (13, 18, 34)
BAR_LINE = (52, 70, 110)

checks: list[tuple[str, tuple[float, float, float, float], tuple[float, float, float, float]]] = []


def check(name: str, box, limit) -> None:
    checks.append((name, box, limit))


def sc(v: float) -> int:
    return int(round(v * SCALE))


# ---------------------------------------------------------------- 文字工具
def measure(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont):
    return draw.textbbox((0, 0), text, font=fnt, anchor="la")


def fit_size(draw, text: str, path: str, start: int, min_size: int, max_w: float, step: int = 2):
    """从 start 往下降，直到整行宽度 <= max_w。"""
    size = start
    while size > min_size:
        b = measure(draw, text, font(path, size))
        if (b[2] - b[0]) <= max_w * SCALE:
            return size
        size -= step
    return min_size


def draw_line(draw, text, path, size, xy, fill, max_w=None, min_size=None, name=""):
    """画一行字，必要时自动缩小；返回实际字号与 bbox（设计稿坐标系）。"""
    if max_w is not None:
        size = fit_size(draw, text, path, size, min_size or max(14, size - 14), max_w)
    fnt = font(path, size)
    x, y = xy
    draw.text((sc(x), sc(y)), text, font=fnt, fill=fill, anchor="la")
    b = measure(draw, text, fnt)
    box = (x + b[0] / SCALE, y + b[1] / SCALE, x + b[2] / SCALE, y + b[3] / SCALE)
    if name:
        check(name, box, (0, 0, W, H))
    return size, box


def measure_segments(draw, segments):
    width = 0
    h = 0
    for text, path, size, _fill in segments:
        b = measure(draw, text, font(path, size))
        width += b[2] - b[0]
        h = max(h, b[3])
    return width / SCALE, h / SCALE


def draw_segments(draw, segments, xy, max_w=None, name=""):
    x, y = xy
    if max_w is not None:
        w, _ = measure_segments(draw, segments)
        if w > max_w:
            k = max_w / w
            segments = [(t, p, max(12, int(s * k)), c) for t, p, s, c in segments]
    start_x = x
    for text, path, size, fill in segments:
        draw.text((sc(x), sc(y)), text, font=font(path, size), fill=fill, anchor="la")
        b = measure(draw, text, font(path, size))
        x += (b[2] - b[0]) / SCALE
    if name:
        check(name, (start_x, y, x, y + measure_segments(draw, segments)[1]), (0, 0, W, H))
    return x


# ---------------------------------------------------------------- 背景
def build_background() -> Image.Image:
    try:
        import numpy as np

        t = (np.linspace(0.0, 1.0, H2, dtype=np.float64) ** 0.92)[:, None, None]
        top = np.array(BG_TOP, dtype=np.float64)[None, None, :]
        bot = np.array(BG_BOT, dtype=np.float64)[None, None, :]
        line = top + (bot - top) * t                      # (H2,1,3)
        arr = np.repeat(line, W2, axis=1).astype(np.uint8)
        img = Image.fromarray(arr, "RGB").convert("RGBA")
    except Exception:                                      # 纯 Pillow 兜底
        img = Image.new("RGBA", (W2, H2))
        d = ImageDraw.Draw(img)
        for yy in range(H2):
            k = (yy / (H2 - 1)) ** 0.92
            c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * k) for i in range(3))
            d.line([(0, yy), (W2, yy)], fill=c + (255,))

    # 柔和光斑：小图绘制 + 高斯模糊 + 放大，快且柔
    gw, gh = W2 // 4, H2 // 4
    glow = Image.new("RGBA", (gw, gh), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    blobs = [
        (int(gw * 0.86), int(gh * 0.13), int(gw * 0.46), ACCENT, 78),
        (int(gw * 0.06), int(gh * 0.55), int(gw * 0.42), VIOLET, 52),
        (int(gw * 0.95), int(gh * 0.92), int(gw * 0.40), (60, 104, 220), 46),
    ]
    for cx, cy, r, color, alpha in blobs:
        for i in range(14, 0, -1):
            rr = int(r * i / 14)
            a = int(alpha * (1 - i / 15) ** 1.6)
            gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=color + (a,))
    glow = glow.filter(ImageFilter.GaussianBlur(28)).resize((W2, H2), Image.LANCZOS)
    img = Image.alpha_composite(img, glow)

    # 顶部/底部轻微压暗，聚焦中间
    shade = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for i in range(int(H2 * 0.22)):
        a = int(58 * (1 - i / (H2 * 0.22)) ** 1.5)
        sd.line([(0, i), (W2, i)], fill=(4, 7, 16, a))
    sd.rectangle([W2 // 2 - 0, H2 - int(H2 * 0.14), W2, H2], fill=(0, 0, 0, 0))
    img = Image.alpha_composite(img, shade)
    return img


# ---------------------------------------------------------------- 元素
def ring(img: Image.Image) -> None:
    layer = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy, r = 996, 126, 232
    d.ellipse([sc(cx - r), sc(cy - r), sc(cx + r), sc(cy + r)],
              outline=ACCENT + (46,), width=sc(2))
    d.ellipse([sc(cx - r + 34), sc(cy - r + 34), sc(cx + r - 34), sc(cy + r - 34)],
              outline=ACCENT + (22,), width=sc(1))
    img.alpha_composite(layer)


def pill(img: Image.Image, d: ImageDraw.ImageDraw, text: str, xy) -> float:
    x, y = xy
    size = 25
    fnt = font(REG_PATH, size)
    b = measure(d, text, fnt)
    tw = (b[2] - b[0]) / SCALE
    ph, pad = 58, 30
    pw = tw + pad * 2
    d.rounded_rectangle([sc(x), sc(y), sc(x + pw), sc(y + ph)], radius=sc(ph / 2),
                        fill=(19, 27, 49, 235), outline=(58, 78, 124, 255), width=sc(2))
    d.ellipse([sc(x + pad - 2), sc(y + ph / 2 - 5), sc(x + pad + 8), sc(y + ph / 2 + 5)],
              fill=ACCENT + (255,))
    draw_line(d, text, REG_PATH, size, (x + pad + 20, y + 15), (170, 190, 235), name="pill")
    return pw


def card(img, d, idx: int, title: str, note_segments, y: float, h: float) -> None:
    x0, x1 = MARGIN, W - MARGIN
    d.rounded_rectangle([sc(x0), sc(y), sc(x1), sc(y + h)], radius=sc(26),
                        fill=CARD_FILL + (242,), outline=CARD_LINE + (255,), width=sc(2))
    # 左侧竖向高光条
    d.rounded_rectangle([sc(x0), sc(y + 34), sc(x0 + 5), sc(y + h - 34)], radius=sc(3),
                        fill=ACCENT + (120,))

    # 序号圆点
    bx, bs = x0 + 40, 58
    by = y + (h - bs) / 2
    d.rounded_rectangle([sc(bx), sc(by), sc(bx + bs), sc(by + bs)], radius=sc(19),
                        fill=(33, 47, 84, 255), outline=ACCENT + (110,), width=sc(2))
    num = "0%d" % idx
    nf = font(MONO_PATH, 24)
    nb = measure(d, num, nf)
    d.text((sc(bx + bs / 2 - (nb[2] - nb[0]) / (2 * SCALE)),
            sc(by + bs / 2 - (nb[3] - nb[1]) / (2 * SCALE) - nb[1] / SCALE)),
           num, font=nf, fill=ACCENT + (255,), anchor="la")

    tx = bx + bs + 30
    tw = (x1 - 36) - tx
    draw_line(d, title, BOLD_PATH, 41, (tx, y + 34), WHITE, max_w=tw, min_size=30, name="card%d-title" % idx)
    draw_segments(d, note_segments, (tx, y + 94), max_w=tw, name="card%d-note" % idx)


def command_bar(img, d, cmd: str, y: float, h: float) -> None:
    x0, x1 = MARGIN, W - MARGIN
    d.rounded_rectangle([sc(x0), sc(y), sc(x1), sc(y + h)], radius=sc(22),
                        fill=BAR_FILL + (255,), outline=BAR_LINE + (255,), width=sc(2))
    # 三个小圆点当终端窗饰
    for i, c in enumerate([(255, 106, 92), (255, 189, 68), (81, 205, 128)]):
        cx = x0 + 34 + i * 22
        d.ellipse([sc(cx - 6), sc(y + 20 - 6), sc(cx + 6), sc(y + 20 + 6)], fill=c + (235,))

    px = x0 + 34
    draw_line(d, "$", BOLD_PATH, 32, (px, y + h / 2 - 22), ACCENT, name="bar-$")
    size = fit_size(d, cmd, MONO_PATH, 31, 19, (x1 - 34) - (px + 26))
    fnt = font(MONO_PATH, size)
    d.text((sc(px + 26), sc(y + h / 2 - 24)), cmd, font=fnt, fill=(224, 233, 250), anchor="la")
    b = measure(d, cmd, fnt)
    check("bar-cmd", (px + 26 + b[0] / SCALE, y, px + 26 + b[2] / SCALE, y + h), (x0, y, x1, y + h))


# ---------------------------------------------------------------- 主流程
def main() -> int:
    img = build_background()
    ring(img)
    d = ImageDraw.Draw(img)

    # 顶部标签胶囊
    pill(img, d, "DSH 插件 · MIT 开源", (MARGIN, 96))

    # 主标题（两行，≥96px）
    t1, t2 = "让 DeepSeek", "自己开新对话"
    s1, b1 = draw_line(d, t1, BOLD_PATH, 104, (MARGIN, 224), WHITE,
                       max_w=CW, min_size=96, name="title-1")
    s2, b2 = draw_line(d, t2, BOLD_PATH, 104, (MARGIN, b1[3] + 18), WHITE,
                       max_w=CW, min_size=96, name="title-2")

    # 副标题
    sub = "DeepSeek Harness 插件 · 模型自己建会话，不用你点左侧栏"
    sub_y = b2[3] + 26
    draw_line(d, sub, REG_PATH, 30, (MARGIN, sub_y), GRAY, max_w=CW, min_size=22, name="subtitle")

    # 三个卖点卡片
    top = 626
    ch, gap = 152, 26
    card(img, d, 1, "一句话新开对话",
         [("说「新开一段，把 X 做完」，模型自己建会话", REG_PATH, 25, GRAY_DIM)], top, ch)
    card(img, d, 2, "自带上下文交接",
         [("新会话自动带只读快照 ", REG_PATH, 25, GRAY_DIM),
          ("dsh-session:", MONO_PATH, 24, (150, 176, 240)),
          ("，不用复述背景", REG_PATH, 25, GRAY_DIM)], top + ch + gap, ch)
    card(img, d, 3, "自动切到新对话",
         [("结果落地后界面自动跳过去，卡片也能点", REG_PATH, 25, GRAY_DIM)], top + 2 * (ch + gap), ch)

    # 底部：装一行就够
    label_y = top + 3 * (ch + gap) - gap + 46
    draw_line(d, "装一行就够：", REG_PATH, 28, (MARGIN, label_y), (142, 158, 194), name="label")
    command_bar(img, d, "node tools/install-profile.mjs --profile desktop", label_y + 46, 92)

    # 页脚小字
    foot = "MIT · 16 组单测通过 · 新会话落在当前工作区"
    draw_line(d, foot, REG_PATH, 22, (MARGIN, H - 62), (92, 106, 138), name="footer")

    # 输出与自检
    final = img.convert("RGB").resize((W, H), Image.LANCZOS)
    if final.size != (W, H):
        raise SystemExit("尺寸错误: %s" % (final.size,))

    bad = []
    for name, box, limit in checks:
        if box[0] < limit[0] - 0.5 or box[1] < limit[1] - 0.5 \
                or box[2] > limit[2] + 0.5 or box[3] > limit[3] + 0.5:
            bad.append((name, [round(v, 1) for v in box], limit))
    side_bad = [n for n, b, _ in checks if b[0] < MARGIN - 1 or b[2] > W - MARGIN + 1]
    if bad or side_bad:
        for item in bad:
            print("溢出:", item)
        print("越界元素:", side_bad)
        raise SystemExit("排版自检未通过")

    final.save(OUT_PNG, "PNG", optimize=True, quality=95)

    with Image.open(OUT_PNG) as im:
        im.verify()
    with Image.open(OUT_PNG) as im:
        print("PNG 路径 :", OUT_PNG)
        print("尺寸     :", im.size, "模式:", im.mode)
        print("文件大小 :", os.path.getsize(OUT_PNG), "bytes",
              "(%.1f KB)" % (os.path.getsize(OUT_PNG) / 1024))
    print("字体     : bold=%s | reg=%s | mono=%s" % (os.path.basename(BOLD_PATH),
                                                     os.path.basename(REG_PATH),
                                                     os.path.basename(MONO_PATH)))
    print("标题字号 :", s1, "/", s2, " 元素自检:", len(checks), "项通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
