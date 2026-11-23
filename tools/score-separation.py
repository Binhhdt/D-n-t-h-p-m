"""Compare two instrumental estimates with aligned, stereo reference stems.

Supply excerpts with the same starting sample. Requires numpy and ffmpeg.
"""
import argparse
import subprocess

import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("instrumental")
parser.add_argument("vocal")
parser.add_argument("before")
parser.add_argument("after")
args = parser.parse_args()


def samples(path):
    data = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", path, "-ac", "2", "-ar", "44100",
        "-f", "f32le", "pipe:1",
    ])
    return np.frombuffer(data, dtype="<f4").astype(np.float64).reshape(-1, 2)


def db_ratio(numerator, denominator):
    floor = np.finfo(np.float64).tiny
    return 10 * (np.log10(max(numerator, floor)) - np.log10(max(denominator, floor)))


def power(signal):
    return signal @ signal


def score(output, music, vocal):
    reference = np.column_stack((music, vocal))
    gain, vocal_gain = np.linalg.lstsq(reference, output, rcond=None)[0]
    backing = music * gain
    leakage = vocal * vocal_gain
    projection = music * ((music @ output) / power(music))
    return {
        "leakage_dB": db_ratio(power(leakage), power(backing)),
        "residual_dB": db_ratio(power(output - backing - leakage), power(backing)),
        "instrumental_SI_SDR_dB": db_ratio(power(projection), power(output - projection)),
    }


audios = [samples(path) for path in (args.instrumental, args.vocal, args.before, args.after)]
length = min(map(len, audios))
music, vocal, before, after = [a[:length].ravel() for a in audios]
if length == 0 or not power(music) or not power(vocal):
    parser.error("The aligned excerpts must contain both music and vocals.")
for label, output in (("before", before), ("after", after)):
    print(label, " · ".join(f"{key}={value:.2f}" for key, value in score(output, music, vocal).items()))
