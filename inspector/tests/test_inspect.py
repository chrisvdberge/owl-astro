import numpy as np
import pytest

from astroinspect.inspect import inspect_image


def synthetic(fwhm=4.0, size=1200, nstars=250, noise=0.004, gradient=0.0, seed=1, ecc_sigma=(1.0, 1.0)):
    rng = np.random.default_rng(seed)
    img = np.full((size, size), 0.05, np.float32)
    yy, xx = np.mgrid[0:size, 0:size]
    img += gradient * (xx / size)
    k = 2 * (2 ** 0.25 - 1) ** 0.5  # Moffat beta=4 scale -> FWHM
    sx = fwhm / k * ecc_sigma[0]
    sy = fwhm / k * ecc_sigma[1]
    for _ in range(nstars):
        x, y = rng.uniform(30, size - 30, 2)
        amp = rng.uniform(0.05, 0.5)
        r = 25
        x0, y0 = int(x), int(y)
        gy, gx = np.mgrid[y0 - r: y0 + r + 1, x0 - r: x0 + r + 1]
        img[y0 - r: y0 + r + 1, x0 - r: x0 + r + 1] += amp * (1 + ((gx - x) / sx) ** 2 + ((gy - y) / sy) ** 2) ** -4
    img += rng.normal(0, noise, img.shape).astype(np.float32)
    return np.clip(img, 0, 1)[None]


def test_fwhm_recovered():
    res = inspect_image(synthetic(fwhm=4.0))
    assert res["stars"]["measured"] > 50
    assert res["stars"]["fwhm_px"]["median"] == pytest.approx(4.0, rel=0.08)
    assert res["stars"]["eccentricity"]["median"] < 0.25


def test_eccentricity_detected():
    res = inspect_image(synthetic(fwhm=4.0, ecc_sigma=(1.3, 0.8)))
    assert res["stars"]["eccentricity"]["median"] > 0.6


def test_noise_estimate():
    res = inspect_image(synthetic(noise=0.004))
    assert res["noise"]["sigma"] == pytest.approx(0.004, rel=0.15)


def test_flatness_flags_gradient():
    flat = inspect_image(synthetic(gradient=0.0))["background"]["flatness"]
    tilted = inspect_image(synthetic(gradient=0.03))["background"]["flatness"]
    assert tilted["peak_to_peak_pct"] > 3 * flat["peak_to_peak_pct"]
    assert tilted["linear_gradient_pct"] > 20


def test_plate_scale_from_args():
    res = inspect_image(synthetic(), pixel_size_um=3.76, focal_length_mm=500)
    assert res["image"]["plate_scale_arcsec_px"] == pytest.approx(1.551, rel=0.01)
    assert res["stars"]["fwhm_arcsec"]["median"] == pytest.approx(4.0 * 1.551, rel=0.1)
