"""Real isolated teacher cookie login; provider balance mocked, no paid calls.
Uses testklasse / OnlyTest!Password2026 in a temporary preview database.
"""
import sys
from playwright.sync_api import sync_playwright, expect

backend=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8183'
origin='https://grading-budget-login.test'
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1280,'height':1000})
    context.add_init_script("try{localStorage.setItem('bud-e-agreement','true');localStorage.setItem('school-bud-e-agreement','true')}catch{}")
    held=[]; errors=[]; state={'hold':True,'login':0,'grading':0}
    def proxy(route):
        request=route.request
        url=request.url.replace(origin,backend,1)
        headers={**request.headers,'host':origin.split('://')[1]}
        if '/api/classroom' in request.url and request.method=='POST':
            data=request.post_data_json
            if data['action']=='login':state['login']+=1
            else:state['grading']+=1;raise AssertionError('Unexpected inference')
        if 'action=grading-status' in url and 'provider=1' in url:
            # Check the actual server authorization, but never call a provider
            # with the synthetic fixture key.
            response=route.fetch(url=url.replace('&provider=1',''),headers=headers)
            if response.status!=200:route.fulfill(response=response);return
            data=response.json()
            data['balance']={'accountAvailable':False,'requiresManagementKey':True,'keyLimit':10,'keyLimitRemaining':8,'keyLimitState':'limited','checkedAt':'2026-11-03T13:00:00Z'}
            if state['hold']:held.append((route,data));return
            route.fulfill(json=data);return
        route.fulfill(response=route.fetch(url=url,headers=headers,timeout=60000))
    context.route(origin+'/**',proxy)
    page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(origin+'/testklasse',wait_until='domcontentloaded')
    page.get_by_role('button',name='Korrekturvorschläge',exact=False).click()
    dialog=page.get_by_role('dialog',name='Agentische Korrekturvorschläge')
    expect(dialog.get_by_text('Lehrkraft-Anmeldung fehlt oder ist abgelaufen',exact=True)).to_be_visible()
    expect(dialog.get_by_text('1. Raumbudget',exact=True)).to_have_count(0)
    dialog.get_by_role('button',name='Als Lehrkraft Budget anzeigen').click()
    field=dialog.get_by_label('Raum-Passwort für Budgetanzeige')
    field.fill('WrongOnlyTest!Password')
    dialog.get_by_role('button',name='Anmelden und Budget laden').click()
    expect(dialog.get_by_text('Pseudonym oder Passwort stimmen nicht.',exact=True)).to_be_visible()
    expect(field).to_have_value('')
    field.fill('OnlyTest!Password2026')
    dialog.get_by_role('button',name='Anmelden und Budget laden').click()
    expect(dialog.get_by_text('frei verfügbar',exact=False)).to_be_visible(timeout=15000)
    expect(dialog.get_by_text('Anbieterstand wird geprüft …',exact=True)).to_be_visible()
    assert held,'Provider query must have started after local values were shown'
    state['hold']=False
    for route,data in held:route.fulfill(json=data)
    expect(dialog.get_by_text('Key-Restlimit:',exact=False)).to_be_visible()
    expect(dialog.get_by_text('nicht abrufbar',exact=True)).to_be_visible()
    assert state['login']==2 and state['grading']==0
    assert page.evaluate("!JSON.stringify(localStorage).includes('OnlyTest!Password2026')")
    # Teacher sessions are not permanent. Reproduce expiry and sign in in a
    # second tab: focus automatically refreshes the correction panel.
    context.clear_cookies()
    dialog.get_by_role('button',name='Budget aktualisieren').click()
    expect(dialog.get_by_text('Lehrkraft-Anmeldung fehlt oder ist abgelaufen',exact=True)).to_be_visible()
    expect(dialog.get_by_text('frei verfügbar',exact=False)).to_have_count(0)
    page.evaluate("async()=>{await fetch('/api/classroom',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'login',slug:'testklasse',password:'OnlyTest!Password2026'})});window.dispatchEvent(new Event('focus'))}")
    expect(dialog.get_by_text('frei verfügbar',exact=False)).to_be_visible(timeout=15000)
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    assert state['grading']==0
    print('PASS real teacher login/cookie, wrong password, expiry, focus refresh, immediate room budget despite delayed provider, mobile; no inference',flush=True)
    context.unroute_all(behavior='ignoreErrors');browser.close()
