"""Background model, flatness and grid maps."""
from __future__ import annotations

import numpy as np
import sep


def background(lum: np.ndarray) -> "sep.Background":
    h, w = lum.shape
    box = int(np.clip(min(h, w) // 16, 32, 256))
    return sep.Background(np.ascontiguousarray(lum, dtype=np.float32), bw=box, bh=box, fw=3, fh=3)


def block_means(a: np.ndarray, n: int) -> list[list[float]]:
    rows = np.array_split(np.arange(a.shape[0]), n)
    cols = np.array_split(np.arange(a.shape[1]), n)
    return [[float(a[np.ix_(r, c)].mean()) for c in cols] for r in rows]


def flatness(back: np.ndarray, grid: int = 8) -> dict:
    med = float(np.median(back))
    if med <= 0:
        return {"error": "non-positive background"}
    rel = back / med - 1.0
    h, w = back.shape
    ch, cw = max(1, int(h * 0.1)), max(1, int(w * 0.1))
    corners = np.concatenate(
        [rel[:ch, :cw].ravel(), rel[:ch, -cw:].ravel(), rel[-ch:, :cw].ravel(), rel[-ch:, -cw:].ravel()]
    )
    centre = rel[int(h * 0.4): int(h * 0.6), int(w * 0.4): int(w * 0.6)]
    # Least-squares plane over a coarse grid -> dominant linear gradient.
    ys, xs = np.mgrid[0:h:16, 0:w:16]
    sample = rel[::16, ::16]
    A = np.column_stack([xs.ravel() / w, ys.ravel() / h, np.ones(xs.size)])
    (ax, ay, _), *_ = np.linalg.lstsq(A, sample.ravel(), rcond=None)
    p1, p99 = np.percentile(rel, [1, 99])
    return {
        "peak_to_peak_pct": float((p99 - p1) * 100),
        "rms_pct": float(rel.std() * 100),
        "corner_vs_centre_pct": float((corners.mean() - centre.mean()) * 100),
        "linear_gradient_pct": float(np.hypot(ax, ay) * 100),
        "gradient_direction_deg": float(np.degrees(np.arctan2(ay, ax))),
        "grid": [[round(v * 100, 3) for v in row] for row in block_means(rel, grid)],
    }


def noise_sigma(lum: np.ndarray) -> float:
    """Robust white-noise estimate (Immerkaer); the MAD makes it insensitive to stars."""
    from scipy.ndimage import convolve

    k = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float32)
    out = convolve(lum, k, mode="nearest")
    return float(1.4826 * np.median(np.abs(out - np.median(out))) / 6.0)


def star_grid(stars, shape: tuple[int, int], n: int = 5, min_stars: int = 3) -> dict:
    h, w = shape
    fw = [[[] for _ in range(n)] for _ in range(n)]
    ec = [[[] for _ in range(n)] for _ in range(n)]
    for s in stars:
        r = min(n - 1, int(s.y / h * n))
        c = min(n - 1, int(s.x / w * n))
        fw[r][c].append(s.fwhm)
        ec[r][c].append(s.eccentricity)
    med = lambda v: round(float(np.median(v)), 3) if len(v) >= min_stars else None
    return {
        "size": n,
        "fwhm_px": [[med(c) for c in row] for row in fw],
        "eccentricity": [[med(c) for c in row] for row in ec],
        "count": [[len(c) for c in row] for row in fw],
    }


def tilt(grid_fwhm: list[list[float | None]]) -> dict | None:
    """Fit a plane to per-cell FWHM; large slope across the field means tilt/curvature."""
    pts = [(c, r, v) for r, row in enumerate(grid_fwhm) for c, v in enumerate(row) if v is not None]
    if len(pts) < 6:
        return None
    n = len(grid_fwhm)
    x = np.array([p[0] for p in pts], float) / (n - 1)
    y = np.array([p[1] for p in pts], float) / (n - 1)
    v = np.array([p[2] for p in pts], float)
    A = np.column_stack([x, y, np.ones_like(x)])
    (ax, ay, c), *_ = np.linalg.lstsq(A, v, rcond=None)
    vals = np.array([p[2] for p in pts])
    return {
        "slope_pct": float(np.hypot(ax, ay) / np.median(vals) * 100),
        "direction_deg": float(np.degrees(np.arctan2(ay, ax))),
        "centre_vs_edge_pct": float(
            (np.mean(vals[np.hypot(x - 0.5, y - 0.5) > 0.4]) / np.mean(vals[np.hypot(x - 0.5, y - 0.5) <= 0.4]) - 1) * 100
        )
        if np.any(np.hypot(x - 0.5, y - 0.5) > 0.4) and np.any(np.hypot(x - 0.5, y - 0.5) <= 0.4)
        else None,
    }
