"""Verify the published UVR model and set its input/output time dimension to 96.

Requires onnx==1.19.1. Run from the repository root with the source ONNX path.
"""
import argparse
import hashlib
from pathlib import Path

import onnx

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
args = parser.parse_args()
source = args.source.read_bytes()
if hashlib.sha256(source).hexdigest() != "628d621d64a06237949de109571cad488c977ab1b34f53d852428d44e492f198":
    raise ValueError("Unexpected UVR-MDX-NET-Inst_Main checkpoint")
model = onnx.load_model_from_string(source)
for tensor in (*model.graph.input, *model.graph.output):
    shape = tensor.type.tensor_type.shape.dim
    assert [dim.dim_value for dim in shape[1:]] == [4, 2048, 256]
    shape[3].dim_value = 96
for prop in model.metadata_props:
    if prop.key == "dim_t":
        prop.value = "96"
onnx.checker.check_model(model)
onnx.save(model, "models/uvr-mdx-inst-main-96.onnx")
