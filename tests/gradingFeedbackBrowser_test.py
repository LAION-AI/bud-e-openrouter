"""Read-only UI smoke tests with synthetic provider replies; no real keys/costs.
Usage: python tests/gradingFeedbackBrowser_test.py http://127.0.0.1:8182
"""
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

backend = sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8182'
class_slug = sys.argv[2] if len(sys.argv)>2 else 'testklasse'
origin = 'https://grading-feedback.test'
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1360,'height':1000},accept_downloads=True)
    context.add_init_script("try{localStorage.setItem('bud-e-agreement','true');localStorage.setItem('school-bud-e-agreement','true')}catch{}")
    state={'fault':'room_budget','calls':0,'transcripts':0,'balance':0,'guidance':0}
    errors=[]; held=[]
    def proxy(route):
        request=route.request
        if '/api/classroom' in request.url:
            if 'action=public' in request.url:
                route.fulfill(json={'exists':True,'active':True,'expiresAt':9999999999999,'enabled':{'chat':True}});return
            if 'action=grading-status' in request.url:
                state['balance']+=1
                route.fulfill(json={'scope':'classroom','provider':'openrouter','checkedAt':123,'room':{'budgetUsd':10,'spentUsd':2,'reservedUsd':7.9,'activeCalls':5,'active':True,'disabled':False,'expiresAt':9999999999999},'balance':{'accountAvailable':False,'requiresManagementKey':True,'keyLimit':5,'keyLimitRemaining':0.05,'keyLimitState':'limited','checkedAt':'2026-11-03T12:00:00Z'}});return
            if request.method=='POST':
                state['calls']+=1
                prompt=request.post_data_json['messages'][-1]['content']
                if 'Antworte ausschließlich mit JSON in dieser Form' in prompt:
                    state['transcripts']+=1
                    n=int(re.search(r'^--- Seite (\d+)',prompt,re.M)[1])
                    reply=json.dumps({'pages':[{'page':n,'student':f'Person {n}','transcript':'Version A\nAufgabe 1: 2 + 2 = 4','tasks':['1'],'figures':[]}]})
                elif prompt.startswith('GRUPPIERUNG ALLER SEITEN'):
                    reply=json.dumps({'papers':[{'student':f'Person {n}','pages':[n]} for n in range(1,5)]})
                elif prompt.startswith('GEMEINSAMER'):
                    state['guidance']+=1
                    if state['fault']=='hold':held.append(route);return
                    if state['fault']:
                        code=state['fault']
                        route.fulfill(status=403 if code=='room_budget' else 502,json={'code':code,'error':'Der verbleibende Ausgabenrahmen reicht nicht für einen vollständigen Korrekturschritt.' if code=='room_budget' else 'Auf dem Anbieter-Konto ist nicht genug Guthaben.'});return
                    reply='Aufgabe 1: 4\n<!-- BUDE_MASSSTAB_FERTIG -->'
                else:
                    name=prompt.split('\n')[0].split(': ',1)[-1]
                    reply=f'## {name}\n\nDu hast richtig gerechnet. Punkte: 1/1\n<!-- BUDE_BEWERTUNG_FERTIG -->'
                route.fulfill(json={'reply':reply,'vision':True});return
        route.fulfill(response=route.fetch(url=request.url.replace(origin,backend,1),timeout=60000))
    context.route(origin+'/**',proxy)
    page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
    page.clock.install()
    def open_dialog():
        page.goto(origin+'/'+class_slug,wait_until='domcontentloaded')
        page.get_by_role('button',name='Korrekturvorschläge',exact=False).click()
        return page.get_by_role('dialog',name='Agentische Korrekturvorschläge')
    dialog=open_dialog()
    expect(dialog.get_by_text('Raumbudget',exact=False).first).to_be_visible()
    expect(dialog.get_by_text('nicht abrufbar',exact=True)).to_be_visible()
    expect(dialog.get_by_text('Wenig Guthaben oder Key-Spielraum übrig.',exact=False)).to_be_visible()
    dialog.get_by_role('button',name='Wie sichere ich und mache später weiter?').click()
    expect(dialog.get_by_text('Die Endung .json ist richtig',exact=False)).to_be_visible()
    fixtures=[{'name':f'arbeit{n}.txt','mimeType':'text/plain','buffer':f'Person {n}\nVersion A\nAufgabe 1: 2 + 2 = 4'.encode()} for n in range(1,5)]
    dialog.get_by_label('Arbeiten hochladen',exact=True).set_input_files(fixtures)
    criteria=dialog.get_by_label('Erwartungshorizont / Korrekturkriterien',exact=True)
    criteria.fill('Aufgabe 1: 4 ist richtig. Je richtige Antwort 1 Punkt, sonst 0 Punkte. Ohne Note.')
    dialog.get_by_role('checkbox',name='Alle drei Stufen automatisch durchführen',exact=False).check()
    dialog.get_by_role('button',name='Alle drei Stufen starten').click()
    alert=dialog.get_by_role('alert')
    expect(alert).to_contain_text('Das Raumbudget reicht',timeout=30000)
    expect(alert).to_contain_text('nicht das Guthaben')
    assert state['transcripts']==4
    with page.expect_download() as download:alert.get_by_role('button',name='Sicherung jetzt herunterladen').click()
    checkpoint=download.value.path().read_bytes();parsed=json.loads(checkpoint)
    assert len(parsed['work']['pages'])==4 and len(parsed['work']['papers'])==4
    state['fault']='provider_credit'
    alert.get_by_role('button',name='Noch einmal versuchen').click()
    expect(alert).to_contain_text('zu wenig Guthaben',timeout=30000)
    expect(alert).to_contain_text('Ein höheres Raumbudget allein löst das nicht')
    assert state['transcripts']==4
    page.screenshot(path='/tmp/grading-feedback-budget.png',full_page=True)
    page.on('dialog',lambda d:d.accept())
    dialog.get_by_role('button',name='Korrektur schließen').click()
    dialog=open_dialog();before=state['calls']
    dialog.get_by_label('Zwischenstand laden',exact=True).set_input_files({'name':'stand.json','mimeType':'application/json','buffer':checkpoint})
    expect(dialog.get_by_text('Zwischenstand geladen:',exact=False)).to_be_visible()
    assert state['calls']==before,'Import started an unwanted paid call'
    state['fault']='hold'
    dialog.get_by_role('checkbox',name='Ich habe Abschrift und Seitenzuordnung geprüft.').check()
    dialog.get_by_role('button',name='Korrekturvorschläge erstellen',exact=True).click()
    expect(dialog.get_by_text('Lösungsschlüssel vorbereiten:',exact=False)).to_be_visible(timeout=30000)
    page.wait_for_function("document.querySelector('[role=timer]')?.textContent.includes('1 KI-Schritte')")
    page.clock.fast_forward(91000)
    expect(dialog.get_by_text('Es gibt länger keine neue Rückmeldung.',exact=False)).to_be_visible()
    dialog.get_by_role('button',name='Pausieren',exact=True).click()
    expect(dialog.get_by_role('alert')).to_contain_text('Die Korrektur ist pausiert.')
    for route in held:
        try:route.abort()
        except Exception:pass
    state['fault']=''
    dialog.get_by_role('button',name='Noch einmal versuchen').click()
    expect(dialog.get_by_role('heading',name=re.compile('Korrekturvorschläge fertig'))).to_be_visible(timeout=30000)
    assert state['transcripts']==4,'Resume purchased completed transcriptions again'
    with page.expect_download() as pdf:dialog.get_by_role('button',name='Korrekturvorschlag als PDF herunterladen',exact=True).click()
    assert pdf.value.path().read_bytes().startswith(b'%PDF')
    with page.expect_download() as doc:dialog.get_by_role('button',name='Korrekturvorschlag als Word herunterladen',exact=True).click()
    assert doc.value.path().read_bytes().startswith(b'PK')
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    print('PASS budget vs provider errors, warnings, checkpoint download/import, solution-key progress, stalled-answer warning, pause/resume without repeating pages, PDF/DOCX, mobile; zero paid calls',flush=True)
    context.unroute_all(behavior='ignoreErrors')
    browser.close()
