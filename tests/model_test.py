"""Run the packaged model with the same complex tensor used by both runtimes."""
import numpy as np
import onnxruntime as ort

options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
options.enable_cpu_mem_arena = False
options.enable_mem_pattern = False
session = ort.InferenceSession(
    "models/uvr-mdx-inst-main-96.onnx", options, providers=["CPUExecutionProvider"]
)
frames = 96
t = np.arange(frames * 1024) / 44100
audio = (np.sin(2 * np.pi * 220 * t) + 0.4 * np.sin(2 * np.pi * 880 * t)) / 4
padded = np.pad(audio, (2048, 2048), mode="reflect")
window = np.hanning(4097)[:-1]
spec = np.stack([
    np.fft.rfft(padded[n * 1024:n * 1024 + 4096] * window)[:-1]
    for n in range(frames)
], axis=1)
mixture = np.stack((spec.real, spec.imag, 0.9 * spec.real, 0.9 * spec.imag))[None].astype(np.float32)
backing = session.run(["output"], {"input": mixture})[0]
assert backing.shape == (1, 4, 2048, 96)
assert np.isfinite(backing).all()
assert np.linalg.norm(backing) > 0
assert not np.allclose(mixture, backing)
print("UVR MDX-Net inference passed with 96 frames, complex stereo input and output")
