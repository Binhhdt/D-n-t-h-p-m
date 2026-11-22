"""Export the official MIT-licensed UMX-HQ vocals weights to ONNX.

With Python 3.12, install openunmix==1.3.0, torch==2.7.1, torchaudio==2.7.1,
onnx==1.19.1 and onnxruntime==1.22.0. Use CPU builds for torch/torchaudio.
Run from the repo root. The app uses the checked-in model at runtime.
"""
import argparse
import hashlib
from pathlib import Path
from urllib.request import urlretrieve

import numpy as np
import onnx
import onnxruntime as ort
import torch
from openunmix.model import OpenUnmix

URL = "https://zenodo.org/records/3370489/files/vocals-b62c91ce.pth"
CHECKSUM = "b62c91cedbc7a066f1778ead5b5cecb377aa3a46a31af1cce7c5c8769339d083"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("weights", type=Path, help="Cache file for the official checkpoint")
args = parser.parse_args()
if not args.weights.exists():
    urlretrieve(URL, args.weights)
if hashlib.sha256(args.weights.read_bytes()).hexdigest() != CHECKSUM:
    raise ValueError("Unexpected checkpoint SHA-256")


class SpectralModel(torch.nn.Module):
    def __init__(self):
        super().__init__()
        state = torch.load(args.weights, map_location="cpu", weights_only=True)
        self.vocals = OpenUnmix(nb_bins=2049, max_bin=state["input_mean"].numel())
        for name in ("sample_rate", "stft.window", "transform.0.window"):
            state.pop(name, None)
        self.vocals.load_state_dict(state)
        self.vocals.freeze()

    def forward(self, magnitude):
        # The app passes time-major FFT magnitudes, one stereo excerpt at a time.
        out = self.vocals(magnitude.permute(1, 2, 0).unsqueeze(0))
        return out.squeeze(0).permute(2, 0, 1)


torch.set_num_threads(2)
torch.manual_seed(41)
model = SpectralModel().eval()
example = torch.rand(64, 2, 2049)
out_path = "models/umxhq-vocals.onnx"
torch.onnx.export(
    model, (example,), out_path, opset_version=17, dynamo=False,
    input_names=["magnitude"], output_names=["vocals"],
    dynamic_axes={"magnitude": {0: "frames"}, "vocals": {0: "frames"}},
)
# Upstream reads x.data.shape, so legacy tracing freezes two frame dimensions.
# Keep the stereo and batch dimensions fixed and infer only the time dimension.
graph = onnx.load(out_path)
constants = {node.output[0]: node for node in graph.graph.node if node.op_type == "Constant"}
for name, expected in (("/vocals/Reshape_1", [64, 1, 512]), ("/vocals/Reshape_3", [64, 1, 2, 2049])):
    reshape = next(node for node in graph.graph.node if node.name == name)
    value = constants[reshape.input[1]].attribute[0].t
    shape = onnx.numpy_helper.to_array(value)
    assert shape.tolist() == expected
    value.CopyFrom(onnx.numpy_helper.from_array(np.array([-1, *expected[1:]], dtype=np.int64)))
onnx.checker.check_model(graph)
onnx.save(graph, out_path)
options = ort.SessionOptions()
options.intra_op_num_threads = 2
session = ort.InferenceSession(out_path, options, providers=["CPUExecutionProvider"])
for frames in (32, 64, 192):
    x = torch.rand(frames, 2, 2049)
    expected = model(x).detach().numpy()
    actual = session.run(None, {"magnitude": x.numpy()})[0]
    np.testing.assert_allclose(actual, expected, atol=2e-5, rtol=3e-4)
print(f"{Path(out_path).stat().st_size} bytes")
