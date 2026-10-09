"""Top-level inspection: image in, JSON-serialisable dict out."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from . import field
from .io import load_image, plate_scale_arcsec
from .stars import detect_and_fit

SCHEMA_VERSION = 1


def _stat(values: list[float]) -> dict | None:
    if not values:
        return None
    a = np.array(values)
    return {
        "median": float(np.median(a)),
        "mean": float(a.mean()),
        "std": float(a.std()),
        "p10": float(np.percentile(a, 10)),
        "p90": float(np.percentile(a, 90)),
    }


def inspect_image(
    data: np.ndarray,
    header: dict | None = None,
    source_dtype: str = "float32",
    pixel_size_um: float | None = None,
    focal_length_mm: float | None = None,
    filename: str | None = None,
    grid: int = 5,
) -> dict:
    header = header or {}
    c, h, w = data.shape
    lum = np.ascontiguousarray(data.mean(axis=0), dtype=np.float32)
    warnings: list[str] = []

    scale, scale_src = plate_scale_arcsec(header, pixel_size_um, focal_length_mm)

    bkg = field.background(lum)
    back = bkg.back()
    sky = float(np.median(back))
    if sky > 0.12:
        warnings.append(
            "Image looks stretched (non-linear). FWHM, SNR and noise are most meaningful on linear data."
        )

    saturation = 0.98 * float(max(lum.max(), 1e-6))
    stars, detected, saturated = detect_and_fit(lum, bkg, saturation)
    if len(stars) < 20:
        warnings.append(f"Only {len(stars)} usable stars measured; star metrics are unreliable.")

    fwhm = [s.fwhm for s in stars]
    ecc = [s.eccentricity for s in stars]
    sgrid = field.star_grid(stars, (h, w), n=grid)

    noise = field.noise_sigma(lum)
    snr_vals = [s.snr for s in stars]

    chan_bg = [float(np.median(field.background(np.ascontiguousarray(data[i])).back())) for i in range(c)]
    chan_mean = float(np.mean(chan_bg)) if chan_bg else 0.0
    colour = None
    if c >= 3 and chan_mean > 0:
        colour = {
            "channel_background": chan_bg,
            "neutrality_spread_pct": float((max(chan_bg) - min(chan_bg)) / chan_mean * 100),
        }

    result = {
        "schema_version": SCHEMA_VERSION,
        "filename": filename,
        "image": {
            "width": w,
            "height": h,
            "channels": c,
            "source_dtype": source_dtype,
            "linear": sky <= 0.12,
            "plate_scale_arcsec_px": scale,
            "plate_scale_source": scale_src,
            "object": header.get("OBJECT"),
            "ra": header.get("RA") or header.get("OBJCTRA"),
            "dec": header.get("DEC") or header.get("OBJCTDEC"),
            "exposure_s": header.get("EXPTIME") or header.get("EXPOSURE"),
        },
        "stars": {
            "detected": int(detected),
            "measured": len(stars),
            "saturated": int(saturated),
            "fwhm_px": _stat(fwhm),
            "fwhm_arcsec": _stat([f * scale for f in fwhm]) if scale else None,
            "eccentricity": _stat(ecc),
            "snr": _stat(snr_vals),
            "grid": sgrid,
            "tilt": field.tilt(sgrid["fwhm_px"]),
        },
        "background": {
            "median": sky,
            "flatness": field.flatness(back),
            "colour": colour,
        },
        "noise": {
            "sigma": noise,
            "sky_to_noise": float(sky / noise) if noise > 0 else None,
        },
        "clipping": {
            "black_pct": float(np.mean(lum <= 0) * 100),
            "white_pct": float(np.mean(lum >= float(lum.max()) * 0.999) * 100),
        },
        "warnings": warnings,
    }
    return result


def inspect_file(path: str | Path, **kwargs) -> dict:
    data, header, dtype = load_image(path)
    return inspect_image(data, header, dtype, filename=Path(path).name, **kwargs)
