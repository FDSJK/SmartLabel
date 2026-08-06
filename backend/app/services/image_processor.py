import os
from PIL import Image as PILImage


SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}


def get_image_info(path: str) -> dict:
    """Return {width, height, channels, mode} or raise ValueError on unsupported/corrupt."""
    ext = os.path.splitext(path)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported image format: {ext}")
    img = PILImage.open(path)
    width, height = img.size
    mode = img.mode
    channel_map = {"L": 1, "LA": 2, "RGB": 3, "RGBA": 4, "CMYK": 4, "YCbCr": 3, "P": 1}
    channels = channel_map.get(mode, len(img.getbands()))
    return {"width": width, "height": height, "channels": channels, "mode": mode}


def convert_to_rgb(src_path: str, dst_dir: str) -> str:
    """Convert image to RGB, save to dst_dir. Returns relative path of the RGB copy."""
    img = PILImage.open(src_path)
    rgb = img.convert("RGB")
    base = os.path.splitext(os.path.basename(src_path))[0] + "_rgb.png"
    dst_path = os.path.join(dst_dir, base)
    rgb.save(dst_path, "PNG")
    return os.path.relpath(dst_path, start=os.path.dirname(os.path.dirname(dst_dir)))
