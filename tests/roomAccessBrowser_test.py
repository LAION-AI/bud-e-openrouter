"""Read-only UI regression: tools need no API key; failed room checks recover.
Run with Playwright installed: python tests/roomAccessBrowser_test.py [ORIGIN]
No messages, provider calls, or room settings are changed.
"""
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

origin = sys.argv[1] if len(sys.argv) > 1 else 'https://school.bud-e.ai'
room = sys.argv[2] if len(sys.argv) > 2 else 'schuhmann'

with sync_playwright() as p:
    # Linux WebKit here lacks GStreamer's autoaudiosink and crashes when the
    # welcome MP3 is constructed. Audio is outside this read-only editor test.
    # Stub only Audio in that engine, not fetch, workers, editors or room checks.
    def prepare(context, engine):
        context.add_init_script("try {localStorage.setItem('bud-e-agreement','true');localStorage.setItem('school-bud-e-agreement','true')} catch(e) {}")
        if engine.name == 'webkit':
            context.add_init_script("""window.Audio=class extends EventTarget {
                constructor(src=''){super();this.src=src;this.paused=true;this.ended=false;this.currentTime=0;this.duration=0;this.readyState=0;}
                pause(){this.paused=true;} play(){this.paused=false;return Promise.resolve();} load(){} remove(){}
            };""")
    engines = [p.chromium]
    for engine in [p.firefox, p.webkit]:
        if Path(engine.executable_path).exists():
            engines.append(engine)
    for engine in engines:
        browser = engine.launch(headless=True)
        for width, height in [(1360, 1000), (390, 844)]:
            for path in ['/', '/' + room]:
                context = browser.new_context(viewport={'width': width, 'height': height})
                prepare(context, engine)
                page = context.new_page()
                errors = []
                missing = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('response', lambda r: missing.append(r.url) if '/_frsh/js/' in r.url and r.status != 200 else None)
                for name in ['Python', 'Scratch', 'Lernpfade']:
                    page.goto(origin + path, wait_until='domcontentloaded')
                    button = page.get_by_role('button', name=re.compile(name))
                    expect(button.first).to_be_visible(timeout=20000)
                    assert page.evaluate("!Object.keys(localStorage).some(k=> /api.?key/i.test(k) && localStorage[k])"), 'Expected a browser without API key'
                    button.first.click()
                    overlay = page.locator('div.fixed.inset-0:visible')
                    expect(overlay.first).to_be_visible(timeout=10000)
                    if name == 'Scratch':
                        expect(page.locator('iframe[title="Scratch Block-Editor"]')).to_be_visible()
                    else:
                        expect(overlay.get_by_role('button', name='Schließen', exact=True).first).to_be_visible()
                assert not missing, missing
                assert not errors, errors
                print('PASS', engine.name, width, path, 'Python/Scratch/Lernpfade, no key, no failed JS', flush=True)
                context.close()
        # A stalled public endpoint must stop loading and offer a usable retry.
        context = browser.new_context()
        prepare(context, engine)
        blocked = []
        context.route('**/api/classroom?action=public&slug=*', lambda route: blocked.append(route))
        page = context.new_page()
        page.goto(origin + '/' + room, wait_until='domcontentloaded')
        retry = page.get_by_role('button', name='Freigabe erneut prüfen')
        expect(retry).to_be_visible(timeout=18000)
        expect(page.get_by_text('Prüfe die Freigabe …', exact=False)).to_have_count(0)
        # Local editors still work even when this network request fails.
        page.get_by_role('button', name=re.compile('Python')).first.click()
        expect(page.locator('div.fixed.inset-0:visible').first).to_be_visible()
        page.locator('div.fixed.inset-0:visible').get_by_role('button', name='Schließen', exact=True).first.click()
        context.unroute('**/api/classroom?action=public&slug=*')
        for route in blocked:
            try:
                route.abort()
            except Exception:
                pass
        retry.click()
        expect(page.get_by_text('Von deiner Lehrkraft freigegeben bis', exact=False)).to_be_visible(timeout=15000)
        expect(retry).to_have_count(0)
        print('PASS', engine.name, 'stalled check times out, local tools work, retry restores actual open room', flush=True)
        context.close()
        browser.close()
