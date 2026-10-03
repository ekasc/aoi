"""Compare alignment controls on public synthetic data, without changing Aoi."""

import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

import cv2
import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent.parent
YUNET_SHA = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
REVISION = "47534e27c9851bb1128ccc0102f1145e27f23f98"


def prepare_yunet():
    folder = ROOT / ".expo/face-lab"
    folder.mkdir(parents=True, exist_ok=True)
    model = folder / "yunet.onnx"
    if not model.exists():
        url = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{REVISION}/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(232590)
        if len(data) != 232589 or hashlib.sha256(data).hexdigest() != YUNET_SHA:
            raise RuntimeError("YuNet size or checksum mismatch")
        model.write_bytes(data)
        license_url = f"https://raw.githubusercontent.com/opencv/opencv_zoo/{REVISION}/models/face_detection_yunet/LICENSE"
        with urllib.request.urlopen(license_url, timeout=30) as response:
            license_data = response.read(10000)
        if b"MIT License" not in license_data:
            raise RuntimeError("YuNet license evidence is missing")
        (folder / "YUNET-LICENSE.txt").write_bytes(license_data)
    if hashlib.sha256(model.read_bytes()).hexdigest() != YUNET_SHA:
        raise RuntimeError("YuNet checksum mismatch")
    return model


def compare(directory, output):
    cv2.setNumThreads(1)
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    if (
        manifest.get("synthetic") is not True
        or manifest.get("dataset") != "HyperFace-10k-LDM"
        or manifest.get("license") != "CC-BY-SA-4.0"
    ):
        raise RuntimeError("Use the prepared, licensed synthetic dataset")
    descriptor = json.loads((ROOT / "features/album/sface-model.json").read_text())
    sface = ROOT / "assets/models/sface.onnx"
    if hashlib.sha256(sface.read_bytes()).hexdigest() != descriptor["sha256"]:
        raise RuntimeError("SFace checksum mismatch")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    session = ort.InferenceSession(
        str(sface), sess_options=options, providers=["CPUExecutionProvider"]
    )
    detector = cv2.FaceDetectorYN.create(
        str(prepare_yunet()), "", (320, 320), 0.9, 0.3, 5000
    )
    aligner = cv2.FaceRecognizerSF.create(str(sface), "")

    def load(item):
        path = (directory / item["file"]).resolve()
        if (
            not path.is_relative_to(directory.resolve())
            or hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]
        ):
            raise RuntimeError("Synthetic input path or checksum mismatch")
        image = cv2.imread(str(path))
        if image is None:
            raise RuntimeError("Could not read synthetic image")
        return image

    def embed(crop):
        pixels = cv2.dnn.blobFromImage(crop, 1, (112, 112), (0, 0, 0), True, False)
        try:
            feature = session.run(["fc1"], {"data": pixels})[0].reshape(-1)
            norm = np.linalg.norm(feature)
            if feature.shape != (128,) or not np.isfinite(feature).all() or norm == 0:
                raise RuntimeError("Invalid SFace output")
            return feature / norm
        finally:
            pixels.fill(0)

    def faces(image):
        detector.setInputSize((image.shape[1], image.shape[0]))
        detected = detector.detect(image)[1]
        return (
            []
            if detected is None
            else [embed(aligner.alignCrop(image, face)) for face in detected]
        )

    report = {
        "dataset": manifest["dataset"],
        "sourceIdentities": [
            identity["sourceIdentity"] for identity in manifest["identities"]
        ],
        "sfaceSha256": descriptor["sha256"],
        "yunetSha256": YUNET_SHA,
        "runtime": ort.__version__,
        "methods": {},
    }
    for method in ["aligned-input-control", "yunet"]:
        embeddings = {}
        failures = []
        try:
            for identity in manifest["identities"]:
                for item in identity["images"]:
                    image = load(item)
                    if method == "aligned-input-control":
                        if image.shape[:2] != (112, 112):
                            raise RuntimeError(
                                "Aligned control requires 112px publisher portraits"
                            )
                        embeddings[item["file"]] = embed(image)
                    else:
                        values = faces(image)
                        if len(values) != 1:
                            failures.append(item["file"])
                            for value in values:
                                value.fill(0)
                        else:
                            embeddings[item["file"]] = values[0]
            verification = []
            for identity in manifest["identities"]:
                for query in identity["images"][1:]:
                    for reference in manifest["identities"]:
                        a = embeddings.get(query["file"])
                        b = embeddings.get(reference["images"][0]["file"])
                        verification.append(
                            {
                                "sameIdentity": identity["label"] == reference["label"],
                                "score": None
                                if a is None or b is None
                                else float(np.dot(a, b)),
                            }
                        )
            rows = []
            if method == "yunet":
                for pair in manifest["pairCases"]:
                    refs = [
                        next(
                            identity
                            for identity in manifest["identities"]
                            if identity["label"] == label
                        )["images"][0]["file"]
                        for label in [pair["you"], pair["partner"]]
                    ]
                    enrolled = [embeddings.get(file) for file in refs]
                    for item in pair["photos"]:
                        if any(value is None for value in enrolled):
                            rows.append(
                                {
                                    "bothPresent": item["bothPresent"],
                                    "failed": True,
                                    "scores": [],
                                }
                            )
                            continue
                        values = faces(load(item))
                        try:
                            rows.append(
                                {
                                    "bothPresent": item["bothPresent"],
                                    "failed": False,
                                    "scores": [
                                        {
                                            "you": float(np.dot(value, enrolled[0])),
                                            "partner": float(
                                                np.dot(value, enrolled[1])
                                            ),
                                        }
                                        for value in values
                                    ],
                                }
                            )
                        finally:
                            for value in values:
                                value.fill(0)
            report["methods"][method] = {
                "verification": verification,
                "rows": rows,
                "processingFailures": failures,
            }
            print(f"Measured {method}", flush=True)
        finally:
            for value in embeddings.values():
                value.fill(0)
    Path(output).write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    parser.add_argument("output")
    args = parser.parse_args()
    compare(args.directory, args.output)
