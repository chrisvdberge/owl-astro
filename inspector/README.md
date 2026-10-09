# astroinspect

Standalone image inspector for the planner: give it a FITS or TIFF (stacked or not), get JSON metrics.

## Metrics
- Stars: count, FWHM (px / arcsec), eccentricity, star SNR, 5x5 FWHM/eccentricity grid, tilt
- Background: median, flatness (peak-to-peak, RMS, corner vs centre, linear gradient, 8x8 map), colour neutrality
- Noise sigma, sky/noise, clipping

FWHM is an elliptical Moffat (beta=4) fit per star, geometric mean of the axes, matching PixInsight FWHMEccentricity (checked on a real stack: 2.76 vs 2.65 px, eccentricity 0.406 vs 0.405). Best on linear data; stretched images get a warning.
Plate scale comes from `--pixel-size`/`--focal-length`, else the FITS WCS, else `XPIXSZ`+`FOCALLEN`.

## Use
```bash
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/astroinspect stack.fits --summary
.venv/bin/astroinspect stack.fits --pixel-size 3.76 --focal-length 480 -o out.json
INSPECTOR_KEY=secret .venv/bin/uvicorn astroinspect.server:app --port 8000   # POST /inspect
.venv/bin/pytest
```
Server env: `INSPECTOR_KEY` (required header `X-Inspector-Key` when set), `INSPECTOR_ORIGINS` (CORS, comma separated).
