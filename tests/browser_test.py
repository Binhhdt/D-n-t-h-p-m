"""Browser regression checks. Serve this checkout and pass its local URL.

Requires Python playwright and Chromium. CHROMIUM can point to a system executable.
"""
import os
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.getenv("CHROMIUM"))
    context = browser.new_context(accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(sys.argv[1])
    page.evaluate("""async () => {
      const x=makeSong('bolero',78,[21,14,104,21],8),res=await analyzeSong(x);
      const t=res.beats[0];
      await DB.put({id:'chords',name:'Dự án phiên bản 1.0',file:null,time:Date.now(),
        state:{res,shift:0,style:'Bolero',lyIn:'Một dòng lời',src:'Một dòng lời',
          lines:[{text:'Một dòng lời',words:['Một','dòng','lời'],t,manual:true,pl:[{w:1,c:21}]}]}});
      await renderRecent();
    }""")
    page.locator("#recentList .open").filter(has_text="Dự án phiên bản 1.0").click()
    page.locator("#cResult").wait_for()
    assert "[Am]" in page.locator("#lySheet").inner_text()
    page.locator("#cTimeline button").filter(has_text="Am").first.click()
    page.locator("#cEditQuality").select_option("112")
    page.locator("#cEditSave").click()
    assert "[Am7]" in page.locator("#lySheet").inner_text()
    assert "Am7" in page.locator("#cChart").inner_text()
    assert page.evaluate("LY.lines[0].pl.some(p=>p.c===121&&p.w===1)")
    assert "Am7" in page.evaluate("lyText()")
    with page.expect_download() as download:
        page.locator("#cChartSave").click()
    assert "Am7" in download.value.path().read_text(encoding="utf-8")
    page.locator("#cUp").click()
    page.locator("#cUp").click()
    assert "Bm7" in page.locator("#cTimeline").inner_text()
    assert "[Bm7]" in page.locator("#lySheet").inner_text()
    page.locator("#cSimple").check()
    assert "Bm7" not in page.locator("#cTimeline").inner_text()
    page.locator("#cSimple").uncheck()
    page.locator("#cAddChord").click()
    page.locator("#cEditTime").fill("2.00")
    page.locator("[data-chord-nudge='0.1']").click()
    assert page.locator("#cEditTime").input_value() == "2.10"
    page.locator("#cEditSave").click()
    assert page.evaluate("cEvents().some(e=>e.manual&&e.t===2.1)")
    page.locator("#cTimeline button").filter(has_text="0:02.1").click()
    page.locator("#cEditRemove").click()
    assert not page.evaluate("cEvents().some(e=>e.t===2.1)")
    page.locator("#chords [data-back]").click()
    page.get_by_role("button", name="Lưu lại", exact=True).click()
    page.locator("#recentList .open").filter(has_text="Dự án phiên bản 1.0").click()
    page.locator("#cResult").wait_for()
    assert "[Bm7]" in page.locator("#lySheet").inner_text()

    page.evaluate("show('vocal')")
    page.locator("#demo").click()
    page.locator("#result").wait_for()
    page.locator("#fixBtn").click()
    page.wait_for_function("S.fixed&&document.querySelector('#fixProg').hidden")
    assert page.evaluate("S.fixed.buf.length===S.orig.buf.length")
    page.evaluate("show('tone')")
    page.locator("#tDemo").click()
    page.locator("#tResult").wait_for()
    page.locator("#tUp").click()
    page.locator("#tApply").click()
    page.wait_for_function("TS.out&&document.querySelector('#tProg').hidden")
    assert page.evaluate("TS.out.length===TS.buf.length")
    assert not errors, errors
    print("Legacy project, chord editing and persistence, PSOLA, and WSOLA passed")
