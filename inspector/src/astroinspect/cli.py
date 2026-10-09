from __future__ import annotations

import argparse
import json
from pathlib import Path

from .inspect import inspect_file


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="astroinspect", description="Inspect an astro image.")
    ap.add_argument("image", type=Path, help="FITS or TIFF file")
    ap.add_argument("--pixel-size", type=float, help="pixel size in microns")
    ap.add_argument("--focal-length", type=float, help="focal length in mm")
    ap.add_argument("-o", "--output", type=Path, help="write JSON here (default: stdout)")
    ap.add_argument("--summary", action="store_true", help="print a human-readable summary")
    args = ap.parse_args(argv)

    result = inspect_file(args.image, pixel_size_um=args.pixel_size, focal_length_mm=args.focal_length)
    text = json.dumps(result, indent=2)
    if args.output:
        args.output.write_text(text)
    elif not args.summary:
        print(text)
    if args.summary:
        print(summary(result))
    return 0


def summary(r: dict) -> str:
    s, b, n = r["stars"], r["background"], r["noise"]
    lines = [f"{r['filename']}  {r['image']['width']}x{r['image']['height']}x{r['image']['channels']}"]
    if s["fwhm_px"]:
        unit = ""
        if s["fwhm_arcsec"]:
            unit = f"  ({s['fwhm_arcsec']['median']:.2f} arcsec)"
        lines.append(f"FWHM          {s['fwhm_px']['median']:.2f} px{unit}")
        lines.append(f"Eccentricity  {s['eccentricity']['median']:.3f}")
        lines.append(f"Stars         {s['measured']} measured / {s['detected']} detected, {s['saturated']} saturated")
        lines.append(f"Star SNR      {s['snr']['median']:.1f}")
        if s["tilt"]:
            lines.append(f"FWHM tilt     {s['tilt']['slope_pct']:.1f}% across field")
    f = b["flatness"]
    lines.append(f"Background    {b['median']:.4f}  p-p {f['peak_to_peak_pct']:.2f}%  rms {f['rms_pct']:.2f}%  corners {f['corner_vs_centre_pct']:+.2f}%")
    lines.append(f"Noise sigma   {n['sigma']:.5f}  sky/noise {n['sky_to_noise']:.1f}")
    for w in r["warnings"]:
        lines.append(f"! {w}")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
