"""Offline dlib baseline with Aoi's Vision boxes, not an app model replacement."""

import bz2
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

import dlib
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / ".expo/face-benchmark/public-groups"
LAB = ROOT / ".expo/face-lab/dlib"
COMMIT = "fd81b6308a6a73d4ce08859eb2f4b628a21e27a2"
MODELS = [
    (
        "dlib_face_recognition_resnet_model_v1.dat.bz2",
        21428389,
        "6c3a71f376b4a6df36d6db00847253b0461cf5ab",
    ),
    (
        "shape_predictor_5_face_landmarks.dat.bz2",
        5706710,
        "3021e2b5f7074adc3cf0ea7590478aaf0b871876",
    ),
]


def prepare_models():
    LAB.mkdir(parents=True, exist_ok=True)
    base = f"https://raw.githubusercontent.com/davisking/dlib-models/{COMMIT}"
    license_file = LAB / "publisher-readme.md"
    if license_file.exists():
        license_evidence = license_file.read_text()
    else:
        with urllib.request.urlopen(f"{base}/README.md", timeout=30) as response:
            license_evidence = response.read(100_000).decode()
    if "released them into the public domain" not in license_evidence:
        raise RuntimeError("Checkpoint license evidence changed")
    license_file.write_text(license_evidence)
    ledger = []
    for name, size, blob in MODELS:
        packed = LAB / name
        if not packed.exists():
            temporary = LAB / f"{name}.partial"
            try:
                with (
                    urllib.request.urlopen(f"{base}/{name}", timeout=60) as response,
                    temporary.open("wb") as output,
                ):
                    total = 0
                    while block := response.read(64 * 1024):
                        total += len(block)
                        if total > size:
                            raise RuntimeError("Model exceeded publisher size")
                        output.write(block)
                temporary.rename(packed)
            finally:
                temporary.unlink(missing_ok=True)
        raw = packed.read_bytes()
        git_hash = hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()
        if len(raw) != size or git_hash != blob:
            raise RuntimeError("Pinned publisher model checksum mismatch")
        unpacked = packed.with_suffix("")
        decoder = bz2.BZ2Decompressor()
        decoded = decoder.decompress(raw, max_length=50 * 1024 * 1024)
        if not decoder.eof:
            raise RuntimeError("Model expanded beyond limit")
        unpacked.write_bytes(decoded)
        ledger.append(
            {
                "file": name,
                "bytes": size,
                "gitBlob": blob,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "unpackedSha256": hashlib.sha256(decoded).hexdigest(),
            }
        )
    (LAB / "models.json").write_text(
        json.dumps({"commit": COMMIT, "models": ledger}, indent=2)
    )


def main():
    os.umask(0o077)
    cv2.setNumThreads(1)
    dlib.set_dnn_prefer_smallest_algorithms()
    prepare_models()
    recognizer = dlib.face_recognition_model_v1(
        str(LAB / "dlib_face_recognition_resnet_model_v1.dat")
    )
    landmarks = dlib.shape_predictor(str(LAB / "shape_predictor_5_face_landmarks.dat"))
    manifest = json.loads((DATA / "sources.json").read_text())
    if (
        manifest.get("publicFiguresOnly") is not True
        or not 0 < len(manifest["images"]) <= 12
    ):
        raise RuntimeError("Use the bounded public catalogue")
    references = []
    extra_references = []
    rows = []
    with tempfile.TemporaryDirectory(prefix="dlib-", dir=LAB) as directory:
        directory = Path(directory)
        (directory / "main.swift").write_bytes(
            (ROOT / "scripts/face-test-native.swift").read_bytes()
        )
        subprocess.run(
            [
                "xcrun",
                "swiftc",
                "-O",
                "-module-cache-path",
                str(directory / "cache"),
                str(ROOT / "modules/aoi-face-detector/ios/FacePhoto.swift"),
                str(directory / "main.swift"),
                "-o",
                str(directory / "native"),
            ],
            check=True,
            timeout=120,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        native = subprocess.Popen(
            [str(directory / "native")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        try:
            if not json.loads(native.stdout.readline()).get("ready"):
                raise RuntimeError("Native detector did not start")
            for index, source in enumerate(manifest["images"]):
                path = (DATA / source["file"]).resolve()
                if (
                    not path.is_relative_to(DATA.resolve())
                    or hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]
                ):
                    raise RuntimeError("Public input checksum mismatch")
                native.stdin.write(
                    json.dumps({"op": "detect", "uri": path.as_uri()}) + "\n"
                )
                native.stdin.flush()
                detected = json.loads(native.stdout.readline())
                if "error" in detected:
                    raise RuntimeError("Vision detection failed")
                detected = detected["value"]
                decoded = cv2.imread(str(path))
                if decoded is None:
                    raise RuntimeError("Could not decode public image")
                image = decoded[:, :, ::-1].copy()
                decoded.fill(0)
                height, width = image.shape[:2]
                if width != detected["width"] or height != detected["height"]:
                    raise RuntimeError("EXIF geometry differs from Vision")
                embeddings = []
                for box in detected["faces"]:
                    rectangle = dlib.rectangle(
                        max(0, round(box["x"])),
                        max(0, round(box["y"])),
                        min(width - 1, round(box["x"] + box["width"])),
                        min(height - 1, round(box["y"] + box["height"])),
                    )
                    shape = landmarks(image, rectangle)
                    embeddings.append(
                        np.array(
                            recognizer.compute_face_descriptor(image, shape, 0, 0.25)
                        )
                    )
                row = {
                    "id": f"public-{index}",
                    "role": source["role"],
                    "detected": len(embeddings),
                }
                if source["role"] in ["reference", "extra-reference"]:
                    if len(embeddings) != 1:
                        raise RuntimeError("Public enrollment must have one face")
                    (
                        references
                        if source["role"] == "reference"
                        else extra_references
                    ).append(embeddings[0].copy())
                elif source["role"] == "both":
                    if len(references) != 2 or len(extra_references) != 2:
                        raise RuntimeError("Independent public enrollment incomplete")
                    row["singleReferenceDistances"] = [
                        {
                            "you": float(np.linalg.norm(embedding - references[0])),
                            "partner": float(np.linalg.norm(embedding - references[1])),
                        }
                        for embedding in embeddings
                    ]
                    row["multipleReferenceDistances"] = [
                        {
                            "you": min(
                                float(np.linalg.norm(embedding - ref))
                                for ref in [references[0], extra_references[0]]
                            ),
                            "partner": min(
                                float(np.linalg.norm(embedding - ref))
                                for ref in [references[1], extra_references[1]]
                            ),
                        }
                        for embedding in embeddings
                    ]
                rows.append(row)
                image.fill(0)
                for embedding in embeddings:
                    embedding.fill(0)
                print(f"public-{index}: {len(embeddings)} faces processed", flush=True)
        finally:
            native.stdin.close()
            try:
                native.wait(timeout=3)
            except subprocess.TimeoutExpired:
                native.kill()
                native.wait(timeout=3)
            native.stdout.close()
            for reference in references + extra_references:
                reference.fill(0)
    report = {
        "model": "dlib_face_recognition_resnet_model_v1",
        "modelCommit": COMMIT,
        "runtime": dlib.__version__,
        "detection": "Aoi Vision fallback, unchanged",
        "alignment": "dlib 5-point predictor, 150px chip, padding 0.25",
        "metric": "Euclidean distance, unnormalized descriptors",
        "experimentalDistanceCutoff": 0.6,
        "appCutoffChanged": False,
        "publicOnly": True,
        "personalPhotosAccessed": False,
        "iPhoneCandidateTested": False,
        "recognitionAccuracyEstablished": False,
        "negativeCasesAvailable": 0,
        "rows": rows,
    }
    (LAB / "report.json").write_text(json.dumps(report, indent=2))
    subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(ROOT / "scripts/classify-dlib-report.mjs"),
            str(LAB / "report.json"),
            str(LAB / "policy-report.json"),
        ],
        check=True,
        timeout=30,
        stdout=subprocess.DEVNULL,
    )
    print("Public dlib baseline finished. No app model or enrollment changed.")


if __name__ == "__main__":
    main()
