"""Two clean browser profiles; real crypto/storage, mocked provider only.
Usage: python personalBrowser_test.py http://127.0.0.1:8172
The server must use an isolated CLASSROOM_DATA_DIR, not production data.
"""
import base64, io, json, os, sys, time, uuid, wave
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

BACKEND=(sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8172').rstrip('/')
ORIGIN='https://personal.test'
SLUG='priv'+uuid.uuid4().hex[:12]
PASSWORD='BrowserPrivat!2026'
KEY='sk-or-v1-synthetic-browser-test-key'
PRIVATE='Nur fuer meine privaten Geraete 54321'
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVhcAAAAASUVORK5CYII=')
def wav():
    buffer=io.BytesIO()
    with wave.open(buffer,'wb') as audio:
        audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000);audio.writeframes(b'\x00\x00'*3200)
    return buffer.getvalue()

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'])
    server_bodies=[];provider_calls=[];provider_payloads=[];errors=[]
    def prepare(context):
        context.grant_permissions(['microphone'],origin=ORIGIN)
        def proxy(route):
            request=route.request;parsed=urlsplit(request.url)
            if request.method in ['POST','PUT']:
                body=request.post_data or ''
                assert KEY not in body and PASSWORD not in body and PRIVATE not in body, 'Private plaintext was sent to Buddy'
                server_bodies.append(body)
            headers={**request.headers,'host':'personal.test'}
            response=route.fetch(url=BACKEND+parsed.path+('?' + parsed.query if parsed.query else ''),headers=headers)
            route.fulfill(response=response)
        context.route(ORIGIN+'/**',proxy)
        def provider(route):
            request=route.request;parsed=urlsplit(request.url)
            headers={'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,content-type,http-referer,x-title'}
            if request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
            if request.method=='GET':
                if parsed.path.endswith('/models') and not parsed.query and parsed.hostname=='openrouter.ai':
                    models=[]
                    for role,inputs,outputs in [('chat',['text','image'],['text']),('image',['text','image'],['image','text']),('asr',['audio'],['transcription']),('tts',['text'],['audio'])]:
                        models.append({'id':'test/'+role,'name':'Test '+role,'architecture':{'input_modalities':inputs,'output_modalities':outputs},'pricing':{'prompt':'0','completion':'0'},'context_length':32768,'top_provider':{'max_completion_tokens':8192}})
                    for id,name in [('qwen/search','Qwen Search'),('openai/search','Search Model'),('google/gemini-search','Gemini Search'),('anthropic/claude-search','Claude Search'),('other/embedded','The Gemini Alternative')]:
                        models.append({'id':id,'name':name,'architecture':{'input_modalities':['text'],'output_modalities':['text']},'pricing':{'prompt':'0.000001','completion':'0.000002'},'context_length':32768})
                    route.fulfill(json={'data':models},headers=headers)
                elif parsed.path.endswith('/models'):route.fulfill(json={'data':[]},headers=headers)
                else:route.fulfill(status=404,json={'error':'test catalog'},headers=headers)
                return
            assert request.headers.get('authorization')=='Bearer '+KEY
            provider_calls.append(parsed.path)
            if parsed.path.endswith('/audio/transcriptions'):route.fulfill(json={'text':'Eine diktierte Nachricht'},headers=headers);return
            if parsed.path.endswith('/audio/speech'):route.fulfill(body=wav(),content_type='audio/wav',headers=headers);return
            body=request.post_data_json
            provider_payloads.append(body)
            if body.get('modalities'):
                route.fulfill(json={'choices':[{'message':{'images':[{'image_url':{'url':'data:image/png;base64,'+base64.b64encode(PNG).decode()}}]}}]},headers=headers)
            else:
                route.fulfill(body='data: '+json.dumps({'choices':[{'delta':{'content':'Private Antwort: **verstanden**.\n\n```python\nprint(2)\n```'}}]})+'\n\ndata: [DONE]\n\n',content_type='text/event-stream',headers=headers)
        context.route('https://openrouter.ai/api/v1/**',provider)
        context.route('https://eu.openrouter.ai/api/v1/**',provider)
        context.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
    first=browser.new_context(viewport={'width':1400,'height':1000},accept_downloads=True)
    second=browser.new_context(viewport={'width':390,'height':844},accept_downloads=True)
    prepare(first);prepare(second)
    a=first.new_page();a.goto(ORIGIN+'/my',wait_until='domcontentloaded')
    PNG=base64.b64decode(a.evaluate("()=>{const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.fillStyle='#6366f1';x.fillRect(0,0,32,32);return c.toDataURL('image/png').split(',')[1];}"))
    a.get_by_role('tab',name='Persönlicher Raum').click()
    a.get_by_label('Name für deine Adresse').fill(SLUG)
    a.get_by_label('Passwort',exact=True).fill(PASSWORD)
    a.get_by_label('Passwort wiederholen').fill(PASSWORD)
    a.get_by_label('Dein API-Key',exact=True).fill(KEY)
    a.get_by_role('checkbox').check()
    a.get_by_role('button',name='Persönlichen Raum verschlüsselt anlegen').click()
    settings=a.get_by_role('dialog',name='Persönliche Einstellungen');settings.wait_for(timeout=30000)
    settings.get_by_role('button',name='Modelle direkt beim Anbieter laden').click()
    expect(settings.get_by_role('button',name='Modelle direkt beim Anbieter laden')).to_be_enabled()
    chat_select=settings.get_by_role('combobox',name='Chat & Bilder verstehen',exact=True)
    groups=chat_select.locator('optgroup').evaluate_all('(groups)=>groups.map(g=>g.label)')
    assert groups.index('Anthropic')<groups.index('Google')<groups.index('OpenAI')<groups.index('Qwen'),groups
    search=settings.get_by_label('Modelle suchen',exact=True)
    search.fill('gem')
    choices=settings.get_by_role('listbox',name='Chat & Bilder verstehen Suchergebnisse').get_by_role('option')
    expect(choices.first).to_contain_text('Gemini Search')
    search.fill('ope')
    choices.first.click()
    expect(chat_select).to_have_value('openai/search')
    search.fill('unfindbaresmodell')
    expect(choices).to_have_count(0)
    expect(chat_select).to_have_value('openai/search')
    search.fill('')
    print('PASS alphabetic vendor groups, prefix-ranked search and direct search-result selection',flush=True)
    for role,label in [('chat','Chat & Bilder verstehen'),('image','Bilder erzeugen'),('asr','Spracheingabe · ASR'),('tts','Vorlesen · TTS')]:
        settings.get_by_label(label+' Modell-ID',exact=True).fill('test/'+role)
    for toggle in settings.get_by_role('checkbox',name='Aktiv').all():toggle.check()
    settings.get_by_role('button',name='Verschlüsselt speichern').click()
    settings.wait_for(state='hidden')
    print('PASS create, browser-only password/key and encrypted settings',flush=True)
    a.get_by_label('Deine Nachricht').fill(PRIVATE)
    a.locator('[data-personal-send]').click()
    a.get_by_text('Private Antwort:',exact=False).first.wait_for()
    a.get_by_role('button',name='Kopieren',exact=True).wait_for()
    a.get_by_role('button',name='Bild erzeugen').click()
    a.get_by_label('Deine Nachricht').fill('Ein kleines privates Bild')
    a.locator('[data-personal-send]').click()
    picture=a.locator('img[alt="Bild aus deinem verschlüsselten Verlauf"]')
    try:picture.wait_for()
    except Exception:
        print('IMAGE ERRORS',a.get_by_role('alert').all_text_contents(),provider_calls,flush=True)
        print('IMAGE STATE',a.locator('body').inner_text()[-1800:],flush=True)
        raise
    assert picture.get_attribute('src').startswith('data:image/jpeg;base64,'),'Generated PNG was not normalized to JPEG'
    expect(a.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    assert a.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)') not in [PRIVATE,KEY,PASSWORD]
    stored=a.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)')
    assert PRIVATE not in stored and KEY not in stored and PASSWORD not in stored
    print('PASS streaming chat, code box, JPEG image and no plaintext local storage',flush=True)
    a.get_by_role('button',name='💬 Chat',exact=True).click()
    before_asr=provider_calls.count('/api/v1/audio/transcriptions')
    before_messages=a.locator('article').count()
    a.get_by_role('button',name='Sprache aufnehmen',exact=True).click()
    microphone=a.get_by_role('button',name='Aufnahme stoppen',exact=True)
    expect(microphone).to_have_class(__import__('re').compile('bg-red-600'))
    a.wait_for_timeout(300)
    a.get_by_role('button',name='Stopp · Text einfügen',exact=True).click()
    expect(a.get_by_label('Deine Nachricht')).to_have_value('Eine diktierte Nachricht')
    assert a.locator('article').count()==before_messages, 'Stop unexpectedly sent transcript'
    assert provider_calls.count('/api/v1/audio/transcriptions')==before_asr+1
    a.get_by_label('Deine Nachricht').fill('')
    a.get_by_role('button',name='Sprache aufnehmen',exact=True).click()
    a.get_by_role('button',name='Aufnahme verwerfen',exact=True).click()
    a.wait_for_timeout(300)
    assert provider_calls.count('/api/v1/audio/transcriptions')==before_asr+1, 'Discard triggered ASR'
    expect(a.get_by_label('Deine Nachricht')).to_have_value('')
    a.get_by_label('Deine Nachricht').fill('Dazu:')
    a.get_by_role('button',name='Sprache aufnehmen',exact=True).click()
    a.get_by_role('button',name='Aufnahme stoppen',exact=True).wait_for()
    a.wait_for_timeout(300)
    a.get_by_role('button',name='Absenden',exact=True).click()
    a.locator('article').get_by_text('Dazu: Eine diktierte Nachricht',exact=True).wait_for()
    expect(a.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    print('PASS microphone red recording, stop without sending, discard without ASR, send with existing draft',flush=True)
    b=second.new_page();b.goto(ORIGIN+'/'+SLUG,wait_until='domcontentloaded')
    b.get_by_label('Passwort',exact=True).fill('NichtDasPasswort!2026')
    b.get_by_role('button',name='Mit Passwort entsperren').click()
    b.get_by_role('alert').filter(has_text='falsch').wait_for()
    b.get_by_label('Passwort',exact=True).fill(PASSWORD)
    b.get_by_role('button',name='Mit Passwort entsperren').click()
    b.locator('article').get_by_text(PRIVATE,exact=True).wait_for(timeout=30000)
    expect(b.locator('img[alt="Bild aus deinem verschlüsselten Verlauf"]')).to_have_count(1)
    assert b.locator('img[alt="Bild aus deinem verschlüsselten Verlauf"]').get_attribute('src').startswith('data:image/jpeg;base64,')
    print('PASS second clean mobile device, wrong password, restored chat and JPEG',flush=True)
    b.get_by_role('button',name='Neue Unterhaltung').click()
    b.get_by_label('Deine Nachricht').fill('Zweite private Unterhaltung')
    b.locator('[data-personal-send]').click()
    b.get_by_text('Private Antwort:',exact=False).first.wait_for()
    b.get_by_role('button',name='Sperren',exact=False).click()
    b.get_by_label('Passwort',exact=True).wait_for()
    assert b.get_by_text('Zweite private Unterhaltung',exact=True).count()==0
    b.get_by_label('Passwort',exact=True).fill(PASSWORD)
    b.get_by_role('button',name='Mit Passwort entsperren').click()
    b.locator('article').get_by_text('Zweite private Unterhaltung',exact=True).wait_for(timeout=30000)
    expect(b.get_by_role('navigation',name='Deine Unterhaltungen').get_by_role('button')).to_have_count(2)
    b.get_by_role('navigation',name='Deine Unterhaltungen').get_by_role('button',name=PRIVATE).click()
    b.locator('article').get_by_text(PRIVATE,exact=True).wait_for()
    expect(b.locator('img[alt="Bild aus deinem verschlüsselten Verlauf"]')).to_have_count(1)
    assert server_bodies and provider_calls and not errors,errors
    assert b.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Personal room overflows the mobile viewport'
    print('PASS multiple conversations, locking/reopening, switching history, direct provider calls and no page errors',flush=True)
    original_count=b.locator('article').count()
    original_id=b.locator('article').nth(0).get_attribute('data-message-id')
    b.locator('article').nth(1).get_by_role('button',name='Neu generieren').click()
    expect(b.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    expect(b.locator('article')).to_have_count(2)
    expect(b.get_by_role('navigation',name='Deine Unterhaltungen').get_by_role('button')).to_have_count(3)
    last_prompt=json.dumps(provider_payloads[-1]['messages'])
    assert PRIVATE in last_prompt and 'Dazu:' not in last_prompt and 'Private Antwort' not in last_prompt,'Regeneration leaked future/old response or duplicated prompt'
    b.locator('article').first.get_by_role('button',name='Bearbeiten').click()
    expect(b.get_by_label('Nachricht bearbeiten')).to_have_value(PRIVATE)
    b.get_by_label('Nachricht bearbeiten').fill(PRIVATE+' bearbeitet')
    b.get_by_role('button',name='Speichern & neu antworten').click()
    expect(b.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    expect(b.locator('article')).to_have_count(2)
    expect(b.locator('article').first).to_contain_text(PRIVATE+' bearbeitet')
    assert b.locator('article').first.get_attribute('data-message-id')!=original_id
    expect(b.get_by_role('navigation',name='Deine Unterhaltungen').get_by_role('button')).to_have_count(4)
    b.get_by_role('button',name='Zum Ausgangsverlauf').click()
    expect(b.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    expect(b.locator('article')).to_have_count(2)
    expect(b.locator('article').first).not_to_contain_text('bearbeitet')
    b.get_by_role('button',name='Zum Ausgangsverlauf').click()
    expect(b.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    expect(b.locator('article')).to_have_count(original_count)
    assert b.locator('article').first.get_attribute('data-message-id')==original_id
    b.locator('article').nth(3).get_by_role('button',name='Neu generieren').click()
    expect(b.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    expect(b.locator('article')).to_have_count(4)
    assert provider_payloads[-1].get('modalities') and provider_payloads[-1].get('model')=='test/image','Image regeneration incorrectly used the chat composer mode'
    expect(b.locator('img[alt="Bild aus deinem verschlüsselten Verlauf"]')).to_have_count(1)
    b.get_by_role('button',name='Zum Ausgangsverlauf').click()
    expect(b.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    before_branch_calls=len(provider_payloads)
    b.locator('article').nth(3).get_by_role('button',name='Ab hier abzweigen').click()
    expect(b.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    expect(b.locator('article')).to_have_count(4)
    expect(b.locator('img[alt="Bild aus deinem verschlüsselten Verlauf"]')).to_have_count(1)
    assert len(provider_payloads)==before_branch_calls,'Branching itself should not call a provider'
    print('PASS regenerate/edit create nested branches, omit future context, preserve original; explicit branch keeps image without inference',flush=True)
    b.get_by_role('button',name='Zum Ausgangsverlauf').click()
    expect(b.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    b.once('dialog',lambda dialog:dialog.accept())
    b.get_by_role('button',name='Löschen',exact=True).click()
    expect(b.get_by_role('button',name='Neue Unterhaltung')).to_be_enabled()
    expect(b.locator('article')).to_have_count(4)
    expect(b.locator('img[alt="Bild aus deinem verschlüsselten Verlauf"]')).to_have_count(1)
    b.get_by_role('button',name='Sperren',exact=False).click()
    b.get_by_label('Passwort',exact=True).fill(PASSWORD)
    b.get_by_role('button',name='Mit Passwort entsperren').click()
    b.locator('article').get_by_text(PRIVATE,exact=True).wait_for(timeout=30000)
    expect(b.locator('img[alt="Bild aus deinem verschlüsselten Verlauf"]')).to_have_count(1)
    expect(b.get_by_role('navigation',name='Deine Unterhaltungen').get_by_role('button')).to_have_count(5)
    assert not errors,errors
    assert b.evaluate('document.documentElement.scrollWidth<=innerWidth')
    print('PASS deleting original retains shared branch JPEG, encrypted branches restore after lock/reload, mobile layout intact',flush=True)
    a.screenshot(path='/tmp/bude-personal-desktop.png',full_page=True)
    b.screenshot(path='/tmp/bude-personal-mobile.png',full_page=True)
    browser.close()
