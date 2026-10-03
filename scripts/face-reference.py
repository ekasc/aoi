import json
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

cv2.setNumThreads(1)

root = Path(__file__).resolve().parent.parent
directory = Path(sys.argv[2])
directory.mkdir(parents=True, exist_ok=True)

if sys.argv[1] == "fixtures":
    y, x = np.mgrid[:180, :240]
    rgb = np.stack(
        [(x * 3 + y) % 256, (y * 2 + x) % 256, (x + y * 3) % 256], axis=2
    ).astype(np.uint8)
    cv2.imwrite(str(directory / "synthetic.png"), rgb[:, :, ::-1])
    sys.exit(0)

model_path = root / "assets/models/sface.onnx"
options = ort.SessionOptions()
options.intra_op_num_threads = 1
options.inter_op_num_threads = 1
options.log_severity_level = 3
session = ort.InferenceSession(
    str(model_path), sess_options=options, providers=["CPUExecutionProvider"]
)
assert [(v.name, v.shape, v.type) for v in session.get_inputs()] == [
    ("data", [1, 3, 112, 112], "tensor(float)")
]
assert [(v.name, v.shape, v.type) for v in session.get_outputs()] == [
    ("fc1", [1, 128], "tensor(float)")
]
recognizer = cv2.FaceRecognizerSF.create(str(model_path), "")
image = cv2.imread(str(directory / "synthetic.png"))
reports = []
for case in json.loads((directory / "cases.json").read_text()):
    # YuNet's reference row contains a box, five image-space points, and a score.
    face = np.array(
        [0, 0, image.shape[1], image.shape[0]]
        + [n for p in case["points"] for n in [p["x"], p["y"]]]
        + [1],
        dtype=np.float32,
    )
    crop = recognizer.alignCrop(image, face)
    reference_pixels = cv2.dnn.blobFromImage(
        crop, 1, (112, 112), (0, 0, 0), True, False
    )
    reference_embedding = recognizer.feature(crop).reshape(-1)
    if sys.argv[1] == "phone-reference":
        normalized = reference_embedding / np.linalg.norm(reference_embedding)
        reports.append({"case": case["name"], "embedding": normalized.tolist()})
        continue
    native_pixels = np.fromfile(
        directory / (case["name"] + ".bin"), dtype="<f4"
    ).reshape(1, 3, 112, 112)
    difference = np.abs(reference_pixels - native_pixels)
    native_embedding = session.run(["fc1"], {"data": native_pixels})[0].reshape(-1)
    assert np.isfinite(native_embedding).all() and native_embedding.shape == (128,)
    cosine = float(
        np.dot(reference_embedding, native_embedding)
        / (np.linalg.norm(reference_embedding) * np.linalg.norm(native_embedding))
    )
    report = {
        "case": case["name"],
        "max_pixel_error": float(difference.max()),
        "mean_pixel_error": float(difference.mean()),
        "embedding_cosine": cosine,
    }
    reports.append(report)
    assert difference.max() <= 8, report
    assert cosine >= 0.999, report
(
    directory
    / (
        "phone-reference.json"
        if sys.argv[1] == "phone-reference"
        else "reference-results.json"
    )
).write_text(json.dumps(reports, indent=2))
print(
    json.dumps(
        {
            "model_input": "data:float32[1,3,112,112]",
            "model_output": "fc1:float32[1,128]",
            "comparisons": reports,
        },
        indent=2,
    )
)
