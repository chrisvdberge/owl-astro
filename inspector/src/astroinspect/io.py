"""Load FITS / TIFF images into a (channels, height, width) float32 array."""
from __future__ import annotations

from pathlib import Path

import numpy as np


def _normalise(data: np.ndarray, source_dtype: np.dtype) -> np.ndarray:
    """Scale integer data to 0..1 so metrics are comparable across bit depths."""
    if np.issubdtype(source_dtype, np.integer):
        return data.astype(np.float32) / float(np.iinfo(source_dtype).max)
    return data.astype(np.float32)


def _to_chw(arr: np.ndarray) -> np.ndarray:
    arr = np.squeeze(arr)
    if arr.ndim == 2:
        return arr[None, :, :]
    if arr.ndim == 3:
        # FITS is (C,H,W); TIFF is usually (H,W,C). Channel axis is the small one.
        if arr.shape[0] <= 4 and arr.shape[0] < arr.shape[-1]:
            return arr
        if arr.shape[-1] <= 4:
            return np.moveaxis(arr, -1, 0)
    raise ValueError(f"Unsupported image shape {arr.shape}")


def load_image(path: str | Path) -> tuple[np.ndarray, dict, str]:
    """Return (data[C,H,W] float32, header dict, source dtype name)."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in {".fits", ".fit", ".fts"}:
        from astropy.io import fits

        with fits.open(path, memmap=False) as hdul:
            hdu = next((h for h in hdul if h.data is not None and h.data.ndim >= 2), None)
            if hdu is None:
                raise ValueError("No image data found in FITS file")
            raw = hdu.data
            header = {k: v for k, v in hdu.header.items() if isinstance(v, (int, float, str, bool))}
        # astropy applies BZERO/BSCALE; uint16 data arrives as uint16 or float.
        dtype = raw.dtype
        data = _normalise(np.asarray(raw), dtype if np.issubdtype(dtype, np.integer) else np.dtype("float32"))
        return _to_chw(data), header, str(dtype)
    if suffix in {".tif", ".tiff"}:
        import tifffile

        raw = tifffile.imread(path)
        data = _normalise(np.asarray(raw), raw.dtype)
        return _to_chw(data), {}, str(raw.dtype)
    if suffix == ".xisf":
        raise ValueError("XISF is not supported yet; export to FITS or TIFF from PixInsight")
    raise ValueError(f"Unsupported file type: {suffix or path.name}")


def plate_scale_arcsec(
    header: dict, pixel_size_um: float | None, focal_length_mm: float | None
) -> tuple[float | None, str | None]:
    """Arcsec per pixel, preferring explicit args, then WCS, then pixel size + focal length."""
    if pixel_size_um and focal_length_mm:
        return 206.265 * pixel_size_um / focal_length_mm, "arguments"
    cd11, cd12 = header.get("CD1_1"), header.get("CD1_2")
    cd21, cd22 = header.get("CD2_1"), header.get("CD2_2")
    if None not in (cd11, cd12, cd21, cd22):
        det = abs(cd11 * cd22 - cd12 * cd21)
        if det > 0:
            return float(np.sqrt(det)) * 3600.0, "wcs"
    if header.get("CDELT2"):
        return abs(float(header["CDELT2"])) * 3600.0, "wcs"
    px = header.get("XPIXSZ") or header.get("PIXSIZE1")
    fl = header.get("FOCALLEN")
    if px and fl:
        binning = header.get("XBINNING") or 1
        return 206.265 * float(px) * float(binning) / float(fl), "header"
    return None, None
