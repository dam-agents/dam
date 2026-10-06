"""Assemble captured PNG frames into looping GIFs using Pillow."""
import os
import glob
from PIL import Image

FRAMES_DIR = os.path.join(os.path.dirname(__file__), "..", "avatar-gifs", "frames")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "avatar-gifs")

CHARS = ["stack", "shield", "roller", "tower", "wave", "compass", "spark", "lens"]
FPS = 20

for char in CHARS:
    char_dir = os.path.join(FRAMES_DIR, char)
    pngs = sorted(glob.glob(os.path.join(char_dir, "frame_*.png")))
    if not pngs:
        print(f"  No frames for {char}, skipping")
        continue

    frames = []
    for p in pngs:
        img = Image.open(p).convert("RGBA")
        # Resize to exactly 128x128 if needed
        if img.size != (128, 128):
            img = img.resize((128, 128), Image.LANCZOS)
        # Convert to palette mode for GIF with transparency
        # Create a white background composite for GIF (no transparency in GIF)
        bg = Image.new("RGBA", (128, 128), (255, 255, 255, 255))
        composite = Image.alpha_composite(bg, img)
        frames.append(composite.convert("RGB"))

    if not frames:
        continue

    out_path = os.path.join(OUT_DIR, f"{char}.gif")
    duration = 1000 // FPS  # ms per frame
    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,  # infinite loop
        optimize=True,
    )
    print(f"  {char}.gif — {len(frames)} frames, {len(frames) * duration}ms total")

print(f"\nGIFs saved to {OUT_DIR}")
