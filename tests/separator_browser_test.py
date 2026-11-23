"""Run the separator in Chromium with real WAV and MP3 inputs of at least 10 seconds.

Serve the repository, then pass its URL and the two stereo fixture paths.
Requires Python Playwright, Chromium, and ffmpeg. The worker loads ORT from its CDN.
"""
import argparse
import os
import subprocess
import wave

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("url")
parser.add_argument("stereo_wav")
parser.add_argument("stereo_mp3")
args = parser.parse_args()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.getenv("CHROMIUM"))
    context = browser.new_context(accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.locator("#goSeparator").click()

    def separate(path, consent=False):
        page.locator("#sepFile").set_input_files(path)
        page.locator("#sepStart").click()
        if consent:
            page.get_by_role("button", name="Tải mô hình", exact=True).click()
        page.locator("#sepCancel").wait_for(state="hidden", timeout=240_000)
        assert "100%" in page.locator("#sepStatus").inner_text(), page.locator("#sepStatus").inner_text()
        assert page.evaluate("""() => ['V','I'].every(key =>
          SEP.stems[key].numberOfChannels===2 &&
          SEP.stems[key].length===SEP.original.length &&
          SEP.stems[key].sampleRate===SEP.original.sampleRate
        )""")
        return page.evaluate("SEP.original.length")

    samples = separate(args.stereo_wav, consent=True)
    for key in ("V", "I"):
        play = page.locator("#sepPlay" + key)
        play.click()
        page.wait_for_function("key => SEP.playing===key && sepPosition(key)>0.2", arg=key)
        play.click()
        for extension in ("wav", "mp3"):
            with page.expect_download() as download:
                page.locator(f'[data-export-stem="{key},{extension}"]').click()
            filename = download.value.path()
            if extension == "wav":
                with wave.open(str(filename)) as handle:
                    assert (handle.getnchannels(), handle.getframerate(), handle.getnframes()) == (2, 44100, samples)
            subprocess.run(["ffmpeg", "-v", "error", "-i", str(filename), "-f", "null", "-"], check=True)

    page.locator("#sepToChords").click()
    page.locator("#cResult").wait_for()
    assert page.evaluate("CS.buf===SEP.stems.I && CS.source==='instrumental'")
    page.locator("#cComparison summary").click()
    page.locator("#cCompareRows tr").first.wait_for()
    page.locator("#cSource").select_option("original")
    assert page.evaluate("CS.source==='original'")
    page.evaluate("show('separator')")
    separate(args.stereo_mp3)

    page.locator("#sepStart").click()
    page.locator("#sepCancel").click()
    page.locator("#sepCancel").wait_for(state="hidden")
    assert "Đã hủy" in page.locator("#sepStatus").inner_text()
    assert not page.locator("#sepResults").is_visible()
    assert not errors, errors
    print("UVR MDX-Net, stereo WAV and MP3, preview, exports, chord analysis and cancel passed")
