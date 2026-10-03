import json
import sys

import numpy as np
import onnxruntime as ort

assert ort.__version__ == "1.24.3", "Run --setup to install the pinned runtime"
options = ort.SessionOptions()
options.intra_op_num_threads = 1
options.inter_op_num_threads = 1
options.log_severity_level = 3
session = ort.InferenceSession(
    sys.argv[1], sess_options=options, providers=["CPUExecutionProvider"]
)
assert [(v.name, v.shape, v.type) for v in session.get_inputs()] == [
    ("data", [1, 3, 112, 112], "tensor(float)")
]
assert [(v.name, v.shape, v.type) for v in session.get_outputs()] == [
    ("fc1", [1, 128], "tensor(float)")
]
print(
    json.dumps(
        {
            "ready": True,
            "runtime": "onnxruntime-" + ort.__version__,
            "provider": "CPUExecutionProvider",
        }
    ),
    flush=True,
)
for line in sys.stdin:
    pixels = None
    output = None
    try:
        request = json.loads(line)
        pixels = np.asarray(request["pixels"], dtype=np.float32)
        if (
            pixels.size != 3 * 112 * 112
            or not np.isfinite(pixels).all()
            or pixels.min() < 0
            or pixels.max() > 255
        ):
            raise ValueError("Invalid pixels")
        output = session.run(["fc1"], {"data": pixels.reshape(1, 3, 112, 112)})[
            0
        ].reshape(-1)
        if output.shape != (128,) or not np.isfinite(output).all():
            raise ValueError("Invalid embedding")
        print(json.dumps({"value": output.tolist()}), flush=True)
    except Exception:
        print(json.dumps({"error": "Model inference failed"}), flush=True)
    finally:
        if pixels is not None:
            pixels.fill(0)
        if output is not None:
            output.fill(0)
