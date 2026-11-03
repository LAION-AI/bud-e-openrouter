"""Read-only acceptance of both physics stages, share URLs and conceptual tasks.
Run: python tests/physicsLearningBrowser_test.py https://school.bud-e.ai
Requires Playwright. No API key, model requests, room changes or uploads.
"""
import re
import sys
from playwright.sync_api import sync_playwright, expect

origin = sys.argv[1].rstrip('/')
partial = '--partial' in sys.argv
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1400, 'height': 1000})
    context.grant_permissions(['clipboard-read', 'clipboard-write'])
    context.add_init_script("localStorage.setItem('bud-e-agreement','true');localStorage.setItem('school-bud-e-agreement','true')")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    report = context.request.get(origin + '/api/learning-paths?reload=1').json()
    assert not report['errors'] and not report['warnings'], report
    physics = next(s for s in report['subjects'] if s['key'] == 'physik')
    upper = [m for m in physics['modules'] if m.get('level') == 'sek2']
    acoustics = next(m for m in physics['modules'] if m['key'] == 'akustik')
    assert len(upper) >= 3 if partial else len(upper) == 4
    assert sum(len(m['paths']) for m in upper) >= 10 if partial else sum(len(m['paths']) for m in upper) == 13
    assert len(acoustics['paths']) == 5
    page.goto(origin, wait_until='domcontentloaded')
    page.get_by_role('button', name=re.compile('Lernpfade')).first.click()
    page.get_by_role('tab', name='Sekundarstufe 2', exact=True).click()
    page.get_by_role('button', name=re.compile('Physik')).click()
    expect(page.get_by_role('tab', name='Sekundarstufe 2', exact=True)).to_have_attribute('aria-selected', 'true')
    for module in upper:
        expect(page.get_by_role('heading', name=module['title']['de'], exact=True)).to_be_visible()
    print('PASS physics accessible through secondary-2 tab,', len(upper), 'modules and no API key', flush=True)
    targets = [(m, path) for m in upper for path in m['paths']] + [(acoustics, path) for path in acoustics['paths'] if path['key'] in ['musik-und-klangfarben', 'echo-und-raumakustik', 'doppler-echo-und-ultraschall']]
    for module, path in targets:
        page.goto(origin + '/?lernpfad=physik/' + module['key'] + '/' + path['key'], wait_until='domcontentloaded')
        pages = len(path['screens']) + 1
        expect(page.get_by_text('Seite 1 von ' + str(pages), exact=True)).to_be_visible(timeout=20000)
        for index, screen in enumerate(path['screens']):
            expect(page.get_by_role('heading', name=screen['title']['de'], exact=True)).to_be_visible()
            if index == 0:
                page.get_by_role('button', name='Link zu diesem Lernpfad kopieren', exact=True).click()
                expect(page.get_by_text('Link kopiert. Er öffnet diesen Lernpfad auf Seite 1.', exact=True)).to_be_visible()
            page.get_by_role('button', name='Weiter', exact=True).click()
        expect(page.get_by_role('heading', name='Überprüfe dich selbst', exact=True)).to_be_visible()
        expect(page.get_by_text('Seite ' + str(pages) + ' von ' + str(pages), exact=True)).to_be_visible()
    print('PASS all', len(targets), 'new path links, every content page, copy link and exercise page', flush=True)
    context.close()
    mobile = browser.new_context(viewport={'width': 390, 'height': 844})
    mobile.add_init_script("localStorage.setItem('bud-e-agreement','true');localStorage.setItem('school-bud-e-agreement','true')")
    small = mobile.new_page()
    small.on('pageerror', lambda error: errors.append(str(error)))
    module = upper[-1]
    path = module['paths'][-1]
    small.goto(origin + '/?lernpfad=physik/' + module['key'] + '/' + path['key'], wait_until='domcontentloaded')
    expect(small.get_by_role('heading', name=path['screens'][0]['title']['de'], exact=True)).to_be_visible(timeout=20000)
    assert small.evaluate('document.documentElement.scrollWidth <= innerWidth')
    small.screenshot(path='/tmp/physics-learning-mobile.png', full_page=True)
    assert not errors, errors
    print('PASS mobile direct link, no horizontal overflow or JavaScript errors', flush=True)
    browser.close()
