"""Fetch the GuitarSet recordings and annotations used by the optional reference tests.

Requires remotezip. Dataset: https://doi.org/10.5281/zenodo.3371780 (CC BY 4.0).
"""
import json
import sys
from pathlib import Path
from urllib.request import urlretrieve
from zipfile import ZipFile

from remotezip import RemoteZip

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
base = "https://zenodo.org/records/3371780/files/"
annotations = root / "guitar-annotations.zip"
if not annotations.exists():
    urlretrieve(base + "annotation.zip", annotations)
names = [
    "00_BN1-129-Eb_comp", "03_BN1-129-Eb_comp", "05_BN3-154-E_comp",
    "00_SS3-84-Bb_comp", "00_SS3-84-Bb_solo",
]
with RemoteZip(base + "audio_mono-mic.zip?download=1", timeout=60) as audio, ZipFile(annotations) as labels:
    for name in names:
        recording = root / (name + ".wav")
        if not recording.exists():
            recording.write_bytes(audio.read(name + "_mic.wav"))
        jams = json.loads(labels.read(name + ".jams"))
        namespace = "note_midi" if name.endswith("_solo") else "chord"
        entries = [a["data"] for a in jams["annotations"] if a["namespace"] == namespace]
        selected = sum(entries, []) if namespace == "note_midi" else entries[0]
        (root / (name + ".json")).write_text(json.dumps(selected))
