"""HTTP wrapper. Run: INSPECTOR_KEY=secret uvicorn astroinspect.server:app --port 8000"""
from __future__ import annotations

import hmac
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .inspect import inspect_file

app = FastAPI(title="astroinspect")
origins = [o for o in os.environ.get("INSPECTOR_ORIGINS", "http://localhost:5173").split(",") if o]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

ALLOWED = {".fits", ".fit", ".fts", ".tif", ".tiff"}


def _check_key(key: str | None) -> None:
    expected = os.environ.get("INSPECTOR_KEY")
    if expected and not (key and hmac.compare_digest(key, expected)):
        raise HTTPException(401, "invalid key")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/inspect")
async def inspect(
    file: UploadFile = File(...),
    pixel_size_um: float | None = Form(None),
    focal_length_mm: float | None = Form(None),
    x_inspector_key: str | None = Header(None),
):
    _check_key(x_inspector_key)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(415, f"unsupported file type {suffix!r}")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"upload{suffix}"
        with path.open("wb") as out:
            while chunk := await file.read(1 << 20):
                out.write(chunk)
        try:
            result = inspect_file(path, pixel_size_um=pixel_size_um, focal_length_mm=focal_length_mm)
        except ValueError as e:
            raise HTTPException(422, str(e))
    result["filename"] = file.filename
    return result
