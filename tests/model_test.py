"""Smoke-test real inference with the same tensor layout used by WebView and the web worker."""
import numpy as np
import onnxruntime as ort

options = ort.SessionOptions()
options.intra_op_num_threads = 2
session = ort.InferenceSession(
    "models/umxhq-vocals.onnx", options, providers=["CPUExecutionProvider"]
)
for frames in (20, 70, 192):
    t = np.arange(frames * 1024) / 44100
    audio = (np.sin(2 * np.pi * 220 * t) + 0.4 * np.sin(2 * np.pi * 880 * t)) / 4
    padded = np.pad(audio, (2048, 2048), mode="reflect")
    window = np.hanning(4097)[:-1]
    spec = np.array(
        [np.abs(np.fft.rfft(padded[n * 1024:n * 1024 + 4096] * window)) for n in range(frames)],
        dtype=np.float32,
    )
    magnitude = np.stack((spec, 0.9 * spec), axis=1)
    vocals = session.run(["vocals"], {"magnitude": magnitude})[0]
    assert vocals.shape == magnitude.shape
    assert np.isfinite(vocals).all()
    assert 0 < np.linalg.norm(vocals) < np.linalg.norm(magnitude)
print("Open-Unmix HQ: inference passed for 20, 70 and 192 frames")
