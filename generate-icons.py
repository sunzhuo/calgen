import struct
import zlib
import os
import math

def write_png(filename, width, height, pixels):
    """
    pixels is a list of bytearrays or bytes of length width * 4 per row (RGBA)
    """
    raw_data = bytearray()
    for row in pixels:
        raw_data.append(0)  # filter type 0 (None)
        raw_data.extend(row)
    
    compressed = zlib.compress(bytes(raw_data), 9)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0) # 8-bit RGBA
    png_data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')

    os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
    with open(filename, 'wb') as f:
        f.write(png_data)

def dist_seg(px, py, ax, ay, bx, by):
    dx = bx - ax
    dy = by - ay
    l2 = dx * dx + dy * dy
    if l2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def dist_rounded_rect_outline(px, py, cx, cy, bx, by, r, stroke_half_w):
    qx = abs(px - cx) - (bx - r)
    qy = abs(py - cy) - (by - r)
    d_out = math.hypot(max(0.0, qx), max(0.0, qy)) + min(0.0, max(qx, qy)) - r
    return abs(d_out) - stroke_half_w

def dist_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r

def dist_rounded_box_fill(px, py, cx, cy, bx, by, r):
    qx = abs(px - cx) - (bx - r)
    qy = abs(py - cy) - (by - r)
    return math.hypot(max(0.0, qx), max(0.0, qy)) + min(0.0, max(qx, qy)) - r

def render_icon(size, mode='squircle'):
    """
    mode:
      'squircle': rounded rect icon with brand gradient
      'round': circle icon with brand gradient
      'maskable': full bleed brand gradient (PWA maskable)
      'foreground': transparent background with centered white icon for Android adaptive icon
    """
    pixels = []
    
    # Colors
    bg_start = (79, 70, 229)   # #4f46e5
    bg_end   = (124, 58, 237)  # #7c3aed
    
    # Scale calendar shape
    if mode == 'foreground':
        # Android adaptive icon foreground: safe area is center 66dp out of 108dp
        # Scale factor 2.4 / 108.0 * size
        scale = (size / 108.0) * 2.4
    elif mode == 'maskable':
        # Maskable needs slightly more padding so nothing gets clipped by circle masks
        scale = (size / 24.0) * 0.52
    else:
        # Standard launcher icon / web icon
        scale = (size / 24.0) * 0.62

    cx_px = size / 2.0
    cy_px = size / 2.0
    stroke_half_w = 1.0  # in 24x24 units (stroke width = 2.0)

    corner_radius = size * 0.22 if mode == 'squircle' else 0

    for y in range(size):
        row = bytearray()
        py = y + 0.5
        for x in range(size):
            px = x + 0.5
            
            # 1. Background Coverage & Color
            if mode == 'foreground':
                bg_alpha = 0.0
                r_bg, g_bg, b_bg = 255, 255, 255
            elif mode == 'maskable':
                bg_alpha = 1.0
                t = (x + y) / (2.0 * size)
                r_bg = int(bg_start[0] * (1 - t) + bg_end[0] * t)
                g_bg = int(bg_start[1] * (1 - t) + bg_end[1] * t)
                b_bg = int(bg_start[2] * (1 - t) + bg_end[2] * t)
            elif mode == 'round':
                d_round = math.hypot(px - cx_px, py - cy_px) - (cx_px - 0.5)
                bg_alpha = max(0.0, min(1.0, 0.5 - d_round))
                if bg_alpha <= 0:
                    row.extend((0, 0, 0, 0))
                    continue
                t = (x + y) / (2.0 * size)
                r_bg = int(bg_start[0] * (1 - t) + bg_end[0] * t)
                g_bg = int(bg_start[1] * (1 - t) + bg_end[1] * t)
                b_bg = int(bg_start[2] * (1 - t) + bg_end[2] * t)
            else: # squircle
                d_box = dist_rounded_box_fill(px, py, cx_px, cy_px, cx_px, cy_px, corner_radius)
                bg_alpha = max(0.0, min(1.0, 0.5 - d_box))
                if bg_alpha <= 0:
                    row.extend((0, 0, 0, 0))
                    continue
                t = (x + y) / (2.0 * size)
                r_bg = int(bg_start[0] * (1 - t) + bg_end[0] * t)
                g_bg = int(bg_start[1] * (1 - t) + bg_end[1] * t)
                b_bg = int(bg_start[2] * (1 - t) + bg_end[2] * t)

            # 2. Calendar Shape in 24x24 space
            x24 = 12.0 + (px - cx_px) / scale
            y24 = 12.0 + (py - cy_px) / scale

            # Distance to calendar components:
            # - Outline rect (center 12, 13, half-w 9, half-h 9, radius 2)
            d_cal = dist_rounded_rect_outline(x24, y24, 12.0, 13.0, 9.0, 9.0, 2.0, stroke_half_w)
            # - Top pins
            d_cal = min(d_cal, dist_seg(x24, y24, 16.0, 2.0, 16.0, 6.0) - stroke_half_w)
            d_cal = min(d_cal, dist_seg(x24, y24, 8.0, 2.0, 8.0, 6.0) - stroke_half_w)
            # - Header horizontal line
            d_cal = min(d_cal, dist_seg(x24, y24, 3.0, 10.0, 21.0, 10.0) - stroke_half_w)
            # - Dots
            d_cal = min(d_cal, dist_circle(x24, y24, 8.0, 14.0, 1.0))
            d_cal = min(d_cal, dist_circle(x24, y24, 12.0, 14.0, 1.0))
            d_cal = min(d_cal, dist_circle(x24, y24, 16.0, 14.0, 1.0))
            d_cal = min(d_cal, dist_circle(x24, y24, 8.0, 18.0, 1.0))
            d_cal = min(d_cal, dist_circle(x24, y24, 12.0, 18.0, 1.0))

            # Anti-aliased coverage in pixel space
            dist_px = d_cal * scale
            white_alpha = max(0.0, min(1.0, 0.5 - dist_px))

            if mode == 'foreground':
                # Pure foreground transparent icon
                row.extend((255, 255, 255, int(round(white_alpha * 255))))
            else:
                # Blend white calendar over background gradient
                r_out = int(round(r_bg * (1.0 - white_alpha) + 255 * white_alpha))
                g_out = int(round(g_bg * (1.0 - white_alpha) + 255 * white_alpha))
                b_out = int(round(b_bg * (1.0 - white_alpha) + 255 * white_alpha))
                a_out = int(round(bg_alpha * 255))
                row.extend((r_out, g_out, b_out, a_out))
                
        pixels.append(row)
    
    return pixels

def main():
    print("Generating Web PWA icons...")
    write_png('icons/icon-192.png', 192, 192, render_icon(192, 'squircle'))
    write_png('icons/icon-512.png', 512, 512, render_icon(512, 'squircle'))
    write_png('icons/icon-maskable.png', 512, 512, render_icon(512, 'maskable'))

    print("Generating Android mipmap icons...")
    densities = [
        ('mipmap-mdpi', 48, 108),
        ('mipmap-hdpi', 72, 162),
        ('mipmap-xhdpi', 96, 216),
        ('mipmap-xxhdpi', 144, 324),
        ('mipmap-xxxhdpi', 192, 432),
    ]

    for folder, size, fg_size in densities:
        path_base = os.path.join('android', 'app', 'src', 'main', 'res', folder)
        write_png(os.path.join(path_base, 'ic_launcher.png'), size, size, render_icon(size, 'squircle'))
        write_png(os.path.join(path_base, 'ic_launcher_round.png'), size, size, render_icon(size, 'round'))
        write_png(os.path.join(path_base, 'ic_maskable.png'), size, size, render_icon(size, 'maskable'))
        write_png(os.path.join(path_base, 'ic_launcher_foreground.png'), fg_size, fg_size, render_icon(fg_size, 'foreground'))
        print(f"Generated {folder}: {size}x{size} and {fg_size}x{fg_size}")

    if os.path.exists('android-project'):
        write_png('android-project/store_icon.png', 512, 512, render_icon(512, 'squircle'))
        print("Generated android-project/store_icon.png")

    print("All icons successfully generated!")

if __name__ == '__main__':
    main()
