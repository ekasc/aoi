#!/usr/bin/env python3
"""Generate airy volumetric cloud banks for the MemorySky header.

Reproducible (fixed seeds, no network): domain-blended fBm shaped into
horizontal banks with noise-perturbed edges, wispy broken coverage, and
depth shading from multi-scale height gradients — not ellipse blobs.
Dense undersides shade cool dark lavender, lit tops/rims glow warm
peach, so banks read with volume instead of flat white-gray.
Edges feather to transparent on all sides so renderer placements bleed
offscreen and clip without hard seams. Two variants (a: lower/denser,
b: upper/wispier) drift as separate parallax layers in front of stars.

Outputs (1200x500 transparent PNG):
  assets/images/memory-sky-cloud-a.png
  assets/images/memory-sky-cloud-b.png

Usage:
  python3 scripts/generate-memory-sky-clouds.py [--out-dir assets/images]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

W, H = 1200, 500

OCTAVES = (6, 12, 24, 48, 96, 192)
WEIGHTS = (0.32, 0.26, 0.20, 0.12, 0.07, 0.03)


def _upsample(grid: np.ndarray) -> np.ndarray:
    img = Image.fromarray((grid * 255.0).astype(np.uint8))
    return np.asarray(img.resize((W, H), Image.BILINEAR), dtype=np.float64) / 255.0


def fbm(rng: np.random.Generator) -> np.ndarray:
    field = np.zeros((H, W), dtype=np.float64)
    for cells, weight in zip(OCTAVES, WEIGHTS):
        rows = max(2, round(cells * H / W))
        grid = rng.random((rows + 2, cells + 2))
        field += weight * _upsample(grid)
    lo, hi = field.min(), field.max()
    return (field - lo) / (hi - lo) if hi > lo else field


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _gaussian_blur_float(field: np.ndarray, sigma: float) -> np.ndarray:
    """Separable float Gaussian blur (no 8-bit quantization)."""
    radius = int(np.ceil(3.0 * sigma))
    xs = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-0.5 * (xs / sigma) ** 2)
    kernel /= kernel.sum()
    hh, ww = field.shape
    padded = np.pad(field, ((0, 0), (radius, radius)), mode="reflect")
    tmp = np.zeros_like(field)
    for i, k in enumerate(kernel):
        tmp += k * padded[:, i : i + ww]
    padded2 = np.pad(tmp, ((radius, radius), (0, 0)), mode="reflect")
    out = np.zeros_like(field)
    for j, k in enumerate(kernel):
        out += k * padded2[j : j + hh, :]
    return out


def make_bank(seed, center_y, thickness, lo, hi, bias, max_a, lit_rgb, sh_rgb):
    rng = np.random.default_rng(seed)
    base = fbm(rng)
    warp = fbm(rng)
    detail = fbm(np.random.default_rng(seed + 999))

    ys = np.linspace(0.0, 1.0, H, dtype=np.float64)[:, None]
    xs = np.linspace(0.0, 1.0, W, dtype=np.float64)[None, :]

    wander = (warp.mean(axis=0, keepdims=True) - 0.5) * 0.52
    dist = np.abs(ys - (center_y + wander)) / thickness
    vertical = np.exp(-(dist**2) * 2.2)

    side = 1.0 + bias * (0.5 - xs)
    ends = smoothstep(0.0, 0.09, xs) * (1.0 - smoothstep(0.91, 1.0, xs))

    blended = base * 0.68 + warp * 0.32
    density = blended * (0.42 + 0.58 * vertical) * side
    density = density * (0.80 + 0.40 * np.abs(warp - 0.5))
    coverage = smoothstep(lo, hi, density * (0.72 + 0.56 * detail))

    # Height shading: float separable Gaussian on density lit from above.
    # No uint8 quantization before gradient, no quantile/smoothstep stretch.
    h = _gaussian_blur_float(np.clip(density, 0.0, 1.0), 10.0)
    gy, gx = np.gradient(h)
    s = 28.0
    nx, ny = -gx * s, -gy * s
    lv = np.array([0.38, -0.62, 0.68])
    lv /= np.linalg.norm(lv)
    diffuse = (nx * lv[0] + ny * lv[1] + lv[2]) / np.sqrt(nx * nx + ny * ny + 1.0)
    lit = np.clip(0.35 + 0.5 * diffuse, 0.0, 1.0)
    band = coverage * (1.0 - coverage) * 4.0
    rim = np.clip(-gy * s * 0.5, 0.0, 1.0)
    lit = np.clip(lit + band * rim * 0.25, 0.0, 1.0)

    lit_c = np.array(lit_rgb, dtype=np.float64)[None, None, :]
    sh_c = np.array(sh_rgb, dtype=np.float64)[None, None, :]
    rgb = sh_c * (1.0 - lit[:, :, None]) + lit_c * lit[:, :, None]
    rgb *= (0.97 + 0.06 * detail)[:, :, None]

    # Airy alpha: wide soft coverage, hollowed cores, no opaque slabs.
    feather_y = smoothstep(0.0, 0.10, ys) * (1.0 - smoothstep(0.90, 1.0, ys))
    alpha = coverage * ends * feather_y * max_a
    alpha *= 1.0 - 0.32 * smoothstep(0.62, 0.95, blended)
    alpha *= 0.72 + 0.28 * detail

    out = np.zeros((H, W, 4), dtype=np.uint8)
    out[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    out[:, :, 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    img = Image.fromarray(out)
    r, g, b, a = img.split()
    r = r.filter(ImageFilter.GaussianBlur(1.0))
    g = g.filter(ImageFilter.GaussianBlur(1.0))
    b = b.filter(ImageFilter.GaussianBlur(1.0))
    a = a.filter(ImageFilter.GaussianBlur(2.6))
    return Image.merge("RGBA", (r, g, b, a))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="assets/images")
    args = ap.parse_args()
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    a = make_bank(7, 0.60, 0.34, 0.34, 0.62, 0.55, 0.80, (255, 201, 178), (127, 111, 172))
    b = make_bank(21, 0.42, 0.28, 0.38, 0.66, -0.55, 0.68, (255, 208, 188), (138, 122, 184))
    for name, img in (("memory-sky-cloud-a.png", a), ("memory-sky-cloud-b.png", b)):
        target = out / name
        img.save(target, format="PNG")
        alpha = np.asarray(img)[:, :, 3] / 255.0
        print(f"{target}: size={img.size} cov>8%={100.0 * (alpha > 0.08).mean():.1f}% max={alpha.max():.2f}")


if __name__ == "__main__":
    main()
