"""Verify a SDK-free Android detector path against OpenCV's reference decoder."""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"


def decode(outputs, cutoff=0.9):
    boxes, scores, landmarks = [], [], []
    for stride in [8, 16, 32]:
        cls = outputs[f"cls_{stride}"][0, :, 0]
        obj = outputs[f"obj_{stride}"][0, :, 0]
        bbox = outputs[f"bbox_{stride}"][0]
        kps = outputs[f"kps_{stride}"][0]
        confidence = np.sqrt(np.clip(cls, 0, 1) * np.clip(obj, 0, 1))
        for index in np.flatnonzero(confidence >= cutoff):
            row, column = divmod(int(index), 640 // stride)
            center = (bbox[index, :2] + [column, row]) * stride
            size = np.exp(bbox[index, 2:]) * stride
            boxes.append(
                [
                    float(center[0] - size[0] / 2),
                    float(center[1] - size[1] / 2),
                    float(size[0]),
                    float(size[1]),
                ]
            )
            scores.append(float(confidence[index]))
            landmarks.append(
                ((kps[index].reshape(5, 2) + [column, row]) * stride).reshape(-1)
            )
    retained = cv2.dnn.NMSBoxes(boxes, scores, cutoff, 0.3, top_k=5000)
    return [
        np.asarray(
            boxes[int(index)] + list(landmarks[int(index)]) + [scores[int(index)]],
            dtype=np.float32,
        )
        for index in np.asarray(retained).reshape(-1)
    ]


def probe(directory, model, output):
    cv2.setNumThreads(1)
    directory, model = Path(directory), Path(model)
    if hashlib.sha256(model.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError("Detector checksum mismatch")
    manifest = json.loads((directory / "sources.json").read_text())
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    session = ort.InferenceSession(
        str(model), sess_options=options, providers=["CPUExecutionProvider"]
    )
    if session.get_inputs()[0].shape != [1, 3, 640, 640]:
        raise RuntimeError("Unexpected detector input shape")
    reference = cv2.FaceDetectorYN.create(str(model), "", (640, 640), 0.9, 0.3, 5000)
    rows = []
    for source in manifest["images"]:
        if source["role"] != "both":
            continue
        path = (directory / source["file"]).resolve()
        if (
            not path.is_relative_to(directory.resolve())
            or hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]
        ):
            raise RuntimeError("Public input path or checksum mismatch")
        image = cv2.imread(str(path))
        if image is None:
            raise RuntimeError("Public input could not be decoded")
        height, width = image.shape[:2]
        scale = 640 / max(width, height)
        resized = cv2.resize(image, (round(width * scale), round(height * scale)))
        canvas = np.zeros((640, 640, 3), dtype=np.uint8)
        canvas[: resized.shape[0], : resized.shape[1]] = resized
        pixels = np.transpose(canvas.astype(np.float32), (2, 0, 1))[None]
        result = []
        try:
            result = session.run(None, {"input": pixels})
            tensors = {
                item.name: value for item, value in zip(session.get_outputs(), result)
            }
            actual = decode(tensors)
            expected = reference.detect(canvas)[1]
            expected = [] if expected is None else list(expected)
            if len(actual) != len(expected):
                raise RuntimeError("Detector count differs from OpenCV reference")
            remaining = list(expected)
            error = 0
            for face in actual:
                distances = [float(np.max(np.abs(face - other))) for other in remaining]
                index = int(np.argmin(distances))
                if not np.isfinite(distances[index]) or distances[index] > 0.01:
                    raise RuntimeError(
                        "Detector geometry differs from OpenCV reference"
                    )
                error = max(error, distances[index])
                remaining.pop(index)
            rows.append(
                {
                    "case": source["file"],
                    "faces": len(actual),
                    "maxOutputError": error,
                    "landmarksPerFace": 5,
                    "lowerDetectorCutoffFaces": len(decode(tensors, 0.6)),
                }
            )
        finally:
            pixels.fill(0)
            for value in result:
                value.fill(0)
    report = {
        "modelSha256": SHA256,
        "runtime": ort.__version__,
        "provider": "CPUExecutionProvider",
        "runsWithoutMLKit": True,
        "input": "BGR float32 NCHW [1,3,640,640], raw 0..255, top-left letterbox",
        "rows": rows,
        "androidDeviceVerified": False,
        "identityAccuracyEstablished": False,
        "limitations": [
            "Mac CPU prototype only, not an Android implementation.",
            "Face counts do not prove the intended people were detected.",
            "Changing detector confidence is not changing identity similarity.",
        ],
    }
    Path(output).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    parser.add_argument("model")
    parser.add_argument("output")
    args = parser.parse_args()
    probe(args.directory, args.model, args.output)
