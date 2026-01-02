#!/usr/bin/env python3
"""Generate simple placeholder icons for Focufy extension"""
try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("PIL not available, creating minimal icons...")

def create_icon(size):
    if HAS_PIL:
        img = Image.new('RGB', (size, size), color='#667eea')
        draw = ImageDraw.Draw(img)
        # Gradient effect (simple)
        for i in range(size):
            alpha = i / size
            color = (
                int(102 + (118 - 102) * alpha),  # R
                int(126 + (75 - 126) * alpha),   # G
                int(234 + (162 - 234) * alpha)   # B
            )
            draw.rectangle([(0, i), (size, i+1)], fill=color)
        # White circle
        margin = size // 6
        draw.ellipse([margin, margin, size-margin, size-margin], fill='white', outline='#764ba2', width=max(1, size//32))
        # F letter if large enough
        if size >= 48:
            try:
                font_size = size // 2
                font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
            except:
                try:
                    font = ImageFont.load_default()
                except:
                    font = None
            if font:
                text = "F"
                bbox = draw.textbbox((0, 0), text, font=font)
                text_width = bbox[2] - bbox[0]
                text_height = bbox[3] - bbox[1]
                position = ((size - text_width) // 2, (size - text_height) // 2 - size//16)
                draw.text(position, text, fill='#667eea', font=font)
        img.save(f'icon{size}.png')
        print(f'✅ Created icon{size}.png')
    else:
        # Fallback: create minimal 1x1 pixel and let Chrome handle it
        with open(f'icon{size}.png', 'wb') as f:
            # Minimal valid PNG (1x1 transparent)
            f.write(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82')
        print(f'✅ Created minimal icon{size}.png')

if __name__ == '__main__':
    for size in [16, 48, 128]:
        create_icon(size)
    print('✅ All icons created!')
