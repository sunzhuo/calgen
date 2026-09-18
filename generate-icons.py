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

    with open(filename, 'wb') as f:
        f.write(png_data)

def render_icon(size, is_maskable=False):
    pixels = []
    
    # Colors
    bg_indigo_start = (79, 70, 229, 255)   # #4f46e5
    bg_purple_end   = (124, 58, 237, 255)  # #7c3aed
    cal_white       = (255, 255, 255, 255)
    cal_header_red  = (239, 68, 68, 255)   # #ef4444
    cal_binder      = (51, 65, 85, 255)     # #334155
    cal_grid_gray   = (226, 232, 240, 255) # #e2e8f0
    cal_grid_accent = (99, 102, 241, 255)  # #6366f1
    cal_grid_green  = (16, 185, 129, 255)  # #10b981
    
    corner_radius = 0 if is_maskable else int(size * 0.22)
    padding = int(size * 0.12) if is_maskable else int(size * 0.14)
    cal_w = size - padding * 2
    cal_h = int(size * 0.65)
    cal_x0 = padding
    cal_y0 = int(size * 0.22)
    header_h = int(cal_h * 0.26)
    
    for y in range(size):
        row = bytearray()
        for x in range(size):
            # Check outer squircle / rounded rect for non-maskable
            in_bg = True
            if not is_maskable:
                dx = max(0, max(corner_radius - x, x - (size - 1 - corner_radius)))
                dy = max(0, max(corner_radius - y, y - (size - 1 - corner_radius)))
                if dx * dx + dy * dy > corner_radius * corner_radius:
                    in_bg = False
            
            if not in_bg:
                row.extend((0, 0, 0, 0))
                continue
            
            # Base gradient
            t = (x + y) / (2.0 * size)
            r = int(bg_indigo_start[0] * (1 - t) + bg_purple_end[0] * t)
            g = int(bg_indigo_start[1] * (1 - t) + bg_purple_end[1] * t)
            b = int(bg_indigo_start[2] * (1 - t) + bg_purple_end[2] * t)
            color = (r, g, b, 255)
            
            # Check calendar shape
            cal_r = int(size * 0.06)
            in_cal = False
            if cal_x0 <= x < cal_x0 + cal_w and cal_y0 <= y < cal_y0 + cal_h:
                cdx = max(0, max(cal_r - (x - cal_x0), (x - cal_x0) - (cal_w - 1 - cal_r)))
                cdy = max(0, max(cal_r - (y - cal_y0), (y - cal_y0) - (cal_h - 1 - cal_r)))
                if cdx * cdx + cdy * cdy <= cal_r * cal_r:
                    in_cal = True
            
            if in_cal:
                # Inside calendar
                if y < cal_y0 + header_h:
                    color = cal_header_red
                else:
                    color = cal_white
                    
                    # Inner grid items
                    grid_y_start = cal_y0 + header_h + int(size * 0.05)
                    grid_cell_w = int(size * 0.12)
                    grid_cell_h = int(size * 0.07)
                    spacing_x = int(size * 0.04)
                    spacing_y = int(size * 0.035)
                    
                    for r_idx in range(2):
                        for c_idx in range(3):
                            gx = cal_x0 + int(size * 0.08) + c_idx * (grid_cell_w + spacing_x)
                            gy = grid_y_start + r_idx * (grid_cell_h + spacing_y)
                            if gx <= x < gx + grid_cell_w and gy <= y < gy + grid_cell_h:
                                if r_idx == 0 and c_idx == 1:
                                    color = cal_grid_accent
                                elif r_idx == 1 and c_idx == 0:
                                    color = cal_grid_green
                                else:
                                    color = cal_grid_gray

            # Binder rings
            ring_w = int(size * 0.05)
            ring_h = int(size * 0.11)
            ring_y = cal_y0 - int(ring_h * 0.35)
            ring1_x = cal_x0 + int(cal_w * 0.25) - ring_w // 2
            ring2_x = cal_x0 + int(cal_w * 0.75) - ring_w // 2
            
            if ((ring1_x <= x < ring1_x + ring_w) or (ring2_x <= x < ring2_x + ring_w)) and (ring_y <= y < ring_y + ring_h):
                color = cal_binder

            row.extend(color)
        pixels.append(row)
    
    return pixels

os.makedirs('icons', exist_ok=True)
write_png('icons/icon-192.png', 192, 192, render_icon(192, False))
write_png('icons/icon-512.png', 512, 512, render_icon(512, False))
write_png('icons/icon-maskable.png', 512, 512, render_icon(512, True))
print("Icons generated successfully!")
