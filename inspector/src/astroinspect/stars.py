"""Star detection and elliptical Moffat (beta=4) PSF fitting."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import sep
from scipy.optimize import least_squares

# Moffat beta=4 (PixInsight FWHMEccentricity default): FWHM = 2 * s * sqrt(2^(1/beta) - 1)
BETA = 4.0
FWHM_PER_SCALE = 2.0 * (2 ** (1 / BETA) - 1) ** 0.5
MAX_FIT_STARS = 1500


@dataclass
class Star:
    x: float
    y: float
    fwhm: float
    eccentricity: float
    flux: float
    snr: float


def _moffat(p, xx, yy):
    amp, x0, y0, sx, sy, theta, bg = p
    c, s = np.cos(theta), np.sin(theta)
    dx, dy = xx - x0, yy - y0
    u = c * dx + s * dy
    v = -s * dx + c * dy
    return bg + amp * (1 + (u / sx) ** 2 + (v / sy) ** 2) ** -BETA


def detect_and_fit(
    lum: np.ndarray, bkg: "sep.Background", saturation: float, thresh_sigma: float = 5.0
) -> tuple[list[Star], int, int]:
    """Return (fitted stars, detected count, saturated count)."""
    sub = np.ascontiguousarray(lum - bkg.back(), dtype=np.float32)
    rms = float(bkg.globalrms)
    objs = sep.extract(sub, thresh_sigma, err=bkg.rms(), minarea=8)
    detected = len(objs)
    if detected == 0:
        return [], 0, 0

    h, w = lum.shape
    sky = float(np.median(bkg.back()))
    saturated = int(np.sum(objs["peak"] + sky >= saturation))

    margin = 14
    ok = (
        (objs["x"] > margin) & (objs["x"] < w - margin)
        & (objs["y"] > margin) & (objs["y"] < h - margin)
        & (objs["peak"] + sky < saturation)
        & (objs["flag"] < 8)
        & (objs["a"] < 15) & (objs["b"] > 0.6)
    )
    # Isolation: drop stars whose nearest detected neighbour is closer than 12 px.
    xy = np.column_stack([objs["x"], objs["y"]])
    if detected > 1:
        from scipy.spatial import cKDTree

        d, _ = cKDTree(xy).query(xy, k=2)
        ok &= d[:, 1] > 12
    # Bright stars bloat (wings, near-saturation), so a brightest-first sample reads high.
    # Sample evenly across the flux range instead, like a median over the whole population.
    ok &= objs["peak"] > 8 * rms
    idx = np.flatnonzero(ok)
    idx = idx[np.argsort(-objs["flux"][idx])]
    if len(idx) > MAX_FIT_STARS:
        idx = idx[np.linspace(0, len(idx) - 1, MAX_FIT_STARS).astype(int)]

    stars: list[Star] = []
    for i in idx:
        o = objs[i]
        sig0 = float(np.clip(0.5 * (o["a"] + o["b"]) * 1.2, 1.2, 8.0))
        s0 = 2.355 * sig0 / FWHM_PER_SCALE
        r = int(np.clip(round(3.5 * sig0), 6, 14))
        x0, y0 = int(round(o["x"])), int(round(o["y"]))
        cut = sub[y0 - r: y0 + r + 1, x0 - r: x0 + r + 1]
        if cut.shape != (2 * r + 1, 2 * r + 1):
            continue
        yy, xx = np.mgrid[-r: r + 1, -r: r + 1].astype(np.float64)
        p0 = [float(o["peak"]), o["x"] - x0, o["y"] - y0, s0, s0, 0.0, 0.0]
        lo = [0, -3, -3, 0.8, 0.8, -np.pi, -np.inf]
        hi = [np.inf, 3, 3, 20, 20, np.pi, np.inf]
        try:
            res = least_squares(
                lambda p: (_moffat(p, xx, yy) - cut).ravel(), p0, bounds=(lo, hi), max_nfev=60
            )
        except Exception:
            continue
        if not res.success:
            continue
        amp, _, _, sx, sy, _, _ = res.x
        if amp <= 0 or sx < 0.9 or sy < 0.9:
            continue
        smax, smin = max(sx, sy), min(sx, sy)
        flux = np.pi * amp * sx * sy / (BETA - 1)
        stars.append(
            Star(
                x=float(o["x"]),
                y=float(o["y"]),
                fwhm=float(FWHM_PER_SCALE * np.sqrt(sx * sy)),
                eccentricity=float(np.sqrt(max(0.0, 1 - (smin / smax) ** 2))),
                flux=float(flux),
                snr=float(flux / (rms * np.sqrt(np.pi * sx * sy * 9) + 1e-12)),
            )
        )

    if len(stars) >= 8:
        f = np.array([s.fwhm for s in stars])
        med = np.median(f)
        mad = 1.4826 * np.median(np.abs(f - med)) + 1e-6
        stars = [s for s in stars if abs(s.fwhm - med) < 4 * mad + 0.1 * med]
    return stars, detected, saturated
