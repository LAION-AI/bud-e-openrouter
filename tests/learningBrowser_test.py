"""Read-only browser acceptance: junior tabs, all 18 links, exercises, mobile.
Usage: python tests/learningBrowser_test.py http://127.0.0.1:8182
No provider calls or changes to rooms. Requires Playwright/Chromium.
"""
import re
import sys
from playwright.sync_api import sync_playwright, expect

origin = sys.argv[1].rstrip('/')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1360, 'height': 1000})
    context.add_init_script("localStorage.setItem('bud-e-agreement','true');localStorage.setItem('school-bud-e-agreement','true')")
    context.grant_permissions(['clipboard-read', 'clipboard-write'])
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    catalogue = context.request.get(origin + '/api/learning-paths?reload=1').json()
    assert not catalogue['errors'], catalogue['errors']
    subject = next(s for s in catalogue['subjects'] if s['key'] == 'natur-und-technik')
    targets = [(m['key'], path) for m in subject['modules'] for path in m['paths']]
    assert len(targets) == 18
    page.goto(origin, wait_until='domcontentloaded')
    page.get_by_role('button', name=re.compile('Lernpfade')).first.click()
    tabs = page.get_by_role('tablist', name='Klassenstufe wählen')
    expect(tabs.get_by_role('tab')).to_have_count(3)
    expect(tabs.get_by_role('tab', name='Sekundarstufe 1', exact=True)).to_have_attribute('aria-selected', 'true')
    tabs.get_by_role('tab', name='Klasse 5–6', exact=True).click()
    expect(page.get_by_role('button', name=re.compile('Natur und Technik'))).to_be_visible()
    assert not page.get_by_role('button', name=re.compile('Informatische Grundbildung')).count()
    # Keyboard navigation works without using a mouse.
    tabs.get_by_role('tab', name='Klasse 5–6', exact=True).press('End')
    expect(tabs.get_by_role('tab', name='Sekundarstufe 2', exact=True)).to_have_attribute('aria-selected', 'true')
    tabs.get_by_role('tab', name='Sekundarstufe 2', exact=True).press('Home')
    expect(tabs.get_by_role('tab', name='Klasse 5–6', exact=True)).to_have_attribute('aria-selected', 'true')
    page.get_by_role('button', name=re.compile('Natur und Technik')).click()
    for module in subject['modules']:
        expect(page.get_by_role('heading', name=module['title']['de'], exact=True)).to_be_visible()
    print('PASS three stage tabs, junior subject and six modules, keyboard navigation', flush=True)
    for module, path in targets:
        query = '?lernpfad=natur-und-technik/' + module + '/' + path['key']
        page.goto(origin + '/' + query, wait_until='domcontentloaded')
        expect(page.get_by_text('Seite 1 von 4', exact=True)).to_be_visible(timeout=20000)
        expect(page.get_by_role('heading', name=path['screens'][0]['title']['de'], exact=True)).to_be_visible()
        for at in range(1, 3):
            page.get_by_role('button', name='Weiter', exact=True).click()
            expect(page.get_by_role('heading', name=path['screens'][at]['title']['de'], exact=True)).to_be_visible()
        page.get_by_role('button', name='Weiter', exact=True).click()
        expect(page.get_by_text('Seite 4 von 4', exact=True)).to_be_visible()
        expect(page.get_by_role('heading', name='Überprüfe dich selbst', exact=True)).to_be_visible()
        expect(page.get_by_role('heading', name='Deine Idee für den Alltag', exact=True)).to_be_visible()
    print('PASS all 18 readable direct links, all 54 content pages and exercise pages', flush=True)
    mobile = browser.new_context(viewport={'width': 390, 'height': 844})
    mobile.add_init_script("localStorage.setItem('bud-e-agreement','true');localStorage.setItem('school-bud-e-agreement','true')")
    small = mobile.new_page()
    small.on('pageerror', lambda error: errors.append(str(error)))
    small.goto(origin, wait_until='domcontentloaded')
    small.get_by_role('button', name=re.compile('Lernpfade')).first.click()
    small.get_by_role('tab', name='Klasse 5–6', exact=True).click()
    small.get_by_role('button', name=re.compile('Natur und Technik')).click()
    assert small.evaluate('document.documentElement.scrollWidth <= innerWidth')
    small.screenshot(path='/tmp/learning-junior-mobile.png', full_page=True)
    assert not errors, errors
    print('PASS mobile stage tabs and module tiles, no overflow or JavaScript errors', flush=True)
    browser.close()
