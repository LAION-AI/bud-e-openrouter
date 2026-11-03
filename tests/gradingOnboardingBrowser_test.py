"""Novice workflow and accessible help, no paid requests or student data.
Usage: python tests/gradingOnboardingBrowser_test.py http://127.0.0.1:8183
"""
import json, sys
from playwright.sync_api import sync_playwright, expect

backend = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8183'
origin = 'https://grading-onboarding.test'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1360, 'height': 1000}, accept_downloads=True)
    context.add_init_script("localStorage.setItem('school-bud-e-agreement','true');localStorage.setItem('bud-e-agreement','true')")
    calls = []; errors = []
    def proxy(route):
        request = route.request
        if '/api/classroom' in request.url:
            if 'action=public' in request.url:
                route.fulfill(json={'exists': True, 'active': True, 'expiresAt':9999999999999,'enabled':{'chat':True}}); return
            if 'action=grading-status' in request.url:
                route.fulfill(status=403,json={'error':'teacher login required','code':'auth_required'}); return
            if request.method == 'POST':
                calls.append(request.url);route.fulfill(status=500,json={'error':'No inference allowed in this test'});return
        route.fulfill(response=route.fetch(url=request.url.replace(origin, backend, 1),timeout=60000))
    context.route(origin+'/**', proxy)
    page = context.new_page()
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(origin+'/testklasse',wait_until='domcontentloaded')
    page.get_by_role('button',name='Korrekturvorschläge',exact=False).click()
    dialog = page.get_by_role('dialog',name='Agentische Korrekturvorschläge')
    upload = dialog.get_by_label('Arbeiten hochladen',exact=True)
    restore = dialog.locator('summary').filter(has_text='Schon angefangen? Zwischenstand laden')
    assert upload.bounding_box()['y'] < 500, 'Upload should be in the initial viewport'
    assert upload.bounding_box()['y'] < restore.bounding_box()['y']
    expect(dialog.get_by_label('Zwischenstand laden',exact=True)).not_to_be_visible()
    expect(dialog.get_by_role('checkbox',name='Prüfpause einlegen',exact=False)).not_to_be_checked()
    expect(dialog.get_by_role('button',name='Alle drei Stufen starten',exact=True)).to_be_disabled()
    page.screenshot(path='/tmp/grading-onboarding-start.png')
    upload.set_input_files({'name':'probe.txt','mimeType':'text/plain','buffer':b'Person A\nAufgabe 1: 2 + 2 = 4'})
    criteria = dialog.get_by_label('Erwartungshorizont / Korrekturkriterien',exact=True)
    criteria.fill('Je richtige Antwort 1 Punkt, sonst 0 Punkte. Keine Teilpunkte. Keine Note. Tippfehler: Ansatzz.')
    saved_text = criteria.input_value()
    start = dialog.get_by_role('button',name='Alle drei Stufen starten',exact=True)
    expect(start).to_be_enabled()
    launcher = dialog.get_by_role('button',name='Kurzanleitung – in 5 Schritten',exact=True)
    launcher.click()
    for number in range(1,6):
        expect(dialog.get_by_text(f'Schritt {number} von 5',exact=False)).to_be_visible()
        expect(dialog.locator('h3[tabindex="-1"]')).to_be_focused()
        expect(upload).not_to_be_visible()
        assert page.get_by_role('dialog').count()==1, 'Help must not create nested modals'
        if number==3:expect(dialog.get_by_text('Ein API-Key ist ein geheimer Zugangscode',exact=False)).to_be_visible()
        if number<5:dialog.get_by_role('button',name='Weiter',exact=True).click()
    expect(dialog.get_by_text('Heruntergeladene PDF-, Word- und JSON-Dateien sind unverschlüsselt',exact=False)).to_be_visible()
    dialog.get_by_role('button',name='Zur Korrektur',exact=True).click()
    expect(launcher).to_be_focused();expect(criteria).to_have_value(saved_text)
    expect(dialog.get_by_text('1 Seiten/Abschnitte ausgewählt',exact=False)).to_be_visible()
    launcher.click();dialog.get_by_role('button',name='Anleitung schließen',exact=True).click()
    expect(criteria).to_have_value(saved_text)
    info=dialog.get_by_role('button',name='Info: Erwartungshorizont',exact=True)
    info.hover();expect(dialog.get_by_role('tooltip')).to_contain_text('Bewertungsmaßstab')
    page.mouse.move(0,0);expect(dialog.get_by_role('tooltip')).not_to_be_visible()
    info.focus();expect(dialog.get_by_role('tooltip')).to_be_visible()
    page.keyboard.press('Escape');expect(dialog.get_by_role('tooltip')).not_to_be_visible()
    expect(info).to_be_focused()
    page.set_viewport_size({'width':390,'height':844})
    info.click();expect(dialog.get_by_role('tooltip')).to_be_visible()
    box=dialog.get_by_role('tooltip').bounding_box()
    assert box['x']>=0 and box['x']+box['width']<=390 and box['y']>=0 and box['y']+box['height']<=844
    info.click();expect(dialog.get_by_role('tooltip')).not_to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    restore.click()
    with page.expect_download() as download:
        dialog.get_by_role('button',name='Sicherungsdatei herunterladen',exact=True).click()
    checkpoint = download.value.path().read_bytes()
    assert json.loads(checkpoint)['criteria']==saved_text
    # Wrong file and valid recovery: typed criteria/upload must survive a bad import.
    load=dialog.get_by_label('Zwischenstand laden',exact=True)
    load.set_input_files({'name':'kaputt.json','mimeType':'application/json','buffer':b'{ keine json datei'})
    expect(dialog.get_by_role('alert')).to_be_visible()
    expect(criteria).to_have_value(saved_text)
    load.set_input_files({'name':'sicherung.json','mimeType':'application/json','buffer':checkpoint})
    expect(dialog.get_by_text('Zwischenstand geladen:',exact=False)).to_be_visible()
    expect(criteria).to_have_value(saved_text)
    assert not calls, 'Onboarding, upload, backup/import must not buy inference'
    assert not errors, errors
    print('PASS upload-first, collapsed restore, automatic default, 5-screen help, no nested modal, preserved inputs, hover/keyboard/touch help, mobile fit, corrupt checkpoint recovery, zero model calls')
    context.unroute_all(behavior='ignoreErrors')
    browser.close()
