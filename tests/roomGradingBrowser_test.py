"""Handwriting-font fixture in real room UIs. Providers are mocked by default.
Run against isolated preview databases, never production personal storage:
  python tests/roomGradingBrowser_test.py [--real]
--real uses school /schuhmann's configured provider for 3 short calls per room;
the key is read into process memory only, and never printed or written to files.
"""
import base64, io, json, os, re, subprocess, sys, uuid, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

REAL='--real' in sys.argv
BATCH='--batch' in sys.argv
ZIP='--zip' in sys.argv
AUTO='--auto' in sys.argv
PDF20='--pdf20' in sys.argv
RECOVERY='--recovery' in sys.argv
recovered=set()
FIXTURE_DIR=os.environ.get('GRADING_FIXTURE_DIR','/tmp/bude-batch-preview.DLez91')
assert not (REAL and PDF20),'Large-file transport test uses mocked providers only'
CLASS_ORIGIN='https://grading-school.test'
PRIVATE_ORIGIN='https://grading-private.test'
PRIVATE_SLUG='grade'+uuid.uuid4().hex[:10]
PASSWORD='OnlyTest!Password2026'
KEY='sk-or-v1-synthetic-grading-key'
MODEL='test/vision'
if REAL:
    result=subprocess.run(['deno','eval','import {findClassroom,serverSecret,parseConfig} from "/mnt/md3/spirit/school-bud-e-frontend+/utils/classroomStore.ts";const r=await findClassroom("schuhmann");if(!r)throw new Error("room missing");console.log(JSON.stringify({key:await serverSecret(r),model:parseConfig(r.config).models.chat,provider:r.provider}));'],capture_output=True,text=True,check=True)
    credentials=json.loads(result.stdout)
    assert credentials['provider']=='openrouter','This real test expects OpenRouter'
    KEY=credentials['key'];MODEL=credentials['model'];del credentials,result
    fixture_env={**os.environ,'CLASSROOM_DATA_DIR':FIXTURE_DIR,'GRADING_TEST_KEY':KEY,'GRADING_TEST_MODEL':MODEL}
    subprocess.run(['deno','eval','import{replaceSecret,defaultConfig,updateClassroom}from"/mnt/md3/spirit/bud-e-frontend/utils/classroomStore.ts";await replaceSecret("testklasse","openrouter",Deno.env.get("GRADING_TEST_KEY"));const c=defaultConfig();c.models.chat=Deno.env.get("GRADING_TEST_MODEL");await updateClassroom("testklasse",c,.5,Date.now()+3600000,false);'],env=fixture_env,check=True,capture_output=True)
    del fixture_env

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    errors=[];class_calls=[];private_calls=[]
    def prepare(context,origin,backend):
        context.add_init_script("try{localStorage.setItem('bud-e-agreement','true');localStorage.setItem('school-bud-e-agreement','true')}catch{}")
        def proxy(route):
            request=route.request
            url=request.url.replace(origin,backend,1)
            if request.method in ['POST','PUT'] and '/api/personal' in request.url:
                body=request.post_data or ''
                assert KEY not in body and PASSWORD not in body and 'Die Erde ist eine Scheibe' not in body,'Private plaintext sent to Buddy'
            if '/api/classroom' in request.url and request.method=='POST':
                data=request.post_data_json
                class_calls.append(data)
                if not REAL:
                    prompt=data['messages'][-1]['content']
                    route.fulfill(json={'reply':answer(prompt,'class'),'vision':True});return
            headers={**request.headers,'host':origin.split('://')[1]}
            response=route.fetch(url=url,headers=headers,timeout=480000)
            route.fulfill(response=response)
        context.route(origin+'/**',proxy)
        context.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
        if not REAL:
            def provider(route):
                request=route.request
                cors={'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,content-type,http-referer,x-title'}
                if request.method=='GET':
                    route.fulfill(json={'data':[{'id':MODEL,'name':'Test Vision','architecture':{'input_modalities':['text','image'],'output_modalities':['text']},'pricing':{'prompt':'0','completion':'0'},'context_length':32000,'top_provider':{'max_completion_tokens':8192}}]},headers=cors);return
                if request.method=='OPTIONS':route.fulfill(status=204,headers=cors);return
                data=request.post_data_json;private_calls.append(data)
                contents=data['messages'][-1]['content']
                prompt=contents if isinstance(contents,str) else next(part['text'] for part in contents if part['type']=='text')
                text=answer(prompt,'private')
                route.fulfill(body='data: '+json.dumps({'choices':[{'delta':{'content':text}}]})+'\n\ndata: [DONE]\n\n',content_type='text/event-stream',headers=cors)
            context.route('https://openrouter.ai/api/v1/**',provider)
            context.route('https://eu.openrouter.ai/api/v1/**',provider)
    def answer(prompt,room):
        if prompt.startswith('GRUPPIERUNG ALLER SEITEN'):
            if BATCH:
                groups=[{'student':'Spencer','pages':[3,1]+([5] if ZIP else [])},{'student':'Lea','pages':[2,4]+([6] if ZIP else [])}]
                if ZIP:groups.append({'student':'Nora','pages':[8,7]})
            elif REAL:groups=[{'student':'Spencer','pages':[1]},{'student':'Lea','pages':[2]}]
            else:groups=[{'student':'Mira Testkind','pages':[1]}]
            return json.dumps({'papers':groups})
        if 'Antworte ausschließlich mit JSON in dieser Form' in prompt:
            heads=re.findall(r'^--- Seite (\d+) \(([^)]+)\) ---',prompt,re.M)
            if RECOVERY and room not in recovered and heads and int(heads[0][0])==3:return '{"pages":[ broken JSON'
            return json.dumps({'pages':[{'page':int(n),'file':name,'student':('Spencer' if int(n) in [1,3,5] else 'Nora' if int(n)>6 else 'Lea') if BATCH else 'Mira Testkind','transcript':'Aufgabe 1: 7 + 5 = 13\nAufgabe 2: Die Erde ist eine Scheibe.','tasks':['1','2'],'figures':[]} for n,name in heads]})
        if prompt.startswith('Prüfe diese Originaldateien'):return 'Die Originale bestätigen die Abschrift: 7 + 5 = 13 und Erde ist eine Scheibe.'
        name=prompt.split('\n')[0].split(': ',1)[-1] if prompt.startswith(('BEWERTUNG EINER SCHÜLERARBEIT','QUALITAETSPRUEFUNG EINER SCHÜLERARBEIT')) else 'Mira Testkind'
        return '## '+name+'\n\nAufgabe 1: Du schreibst 7 + 5 = 13. Richtig ist 7 + 5 = 12. Zähle die fünf Schritte nach.\n\nAufgabe 2: Die Erde ist annähernd kugelförmig, keine Scheibe.\n\nKeine Note und keine Punkte: Es wurde kein Punkteschlüssel vorgegeben.\n<!-- BUDE_BEWERTUNG_FERTIG -->'
    class_context=browser.new_context(viewport={'width':1400,'height':1000},accept_downloads=True)
    private_context=browser.new_context(viewport={'width':390,'height':844},accept_downloads=True)
    prepare(class_context,CLASS_ORIGIN,'http://127.0.0.1:8183')
    prepare(private_context,PRIVATE_ORIGIN,'http://127.0.0.1:8182')
    page=class_context.new_page();page.goto(CLASS_ORIGIN+'/testklasse',wait_until='domcontentloaded')
    font=base64.b64encode(Path('/tmp/bude-grading-Caveat.ttf').read_bytes()).decode()
    jpeg=page.evaluate('''async (font)=>{const face=new FontFace('FixtureHandwriting',`url(data:font/ttf;base64,${font})`);await face.load();document.fonts.add(face);const c=document.createElement('canvas');c.width=1300;c.height=800;const x=c.getContext('2d');x.fillStyle='#fffdf4';x.fillRect(0,0,c.width,c.height);x.strokeStyle='#dce5ed';for(let y=140;y<780;y+=70){x.beginPath();x.moveTo(40,y);x.lineTo(1260,y);x.stroke();}x.font='52px FixtureHandwriting';x.fillStyle='#173b7a';['Mira Testkind','Aufgabe 1: 7 + 5 = 13','Aufgabe 2: Die Erde ist eine Scheibe.'].forEach((t,i)=>x.fillText(t,75,125+i*175));return c.toDataURL('image/jpeg',.95);}''',font)
    image=base64.b64decode(jpeg.split(',')[1]);Path('/tmp/bude-grading-handwriting-fixture.jpg').write_bytes(image)
    fixture={'name':'handschrift.jpg','mimeType':'image/jpeg','buffer':image}
    expected_names=['Mira Testkind'];expected_pages=1
    if BATCH or REAL:
        labels=['Spencer · Seite 2 von 2','Lea · Seite 1 von 2','Spencer · Seite 1 von 2','Lea · Seite 2 von 2'] if BATCH else ['Spencer · Seite 1 von 1','Lea · Seite 1 von 1']
        images=page.evaluate('''labels=>labels.map(label=>{const c=document.createElement('canvas');c.width=1300;c.height=1800;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,1300,1800);x.font='58px FixtureHandwriting';x.fillStyle='#173b7a';[label,'Aufgabe 1: 7 + 5 = 13','Aufgabe 2: Die Erde ist eine Scheibe.'].forEach((t,i)=>x.fillText(t,60,130+i*170));return c.toDataURL('image/jpeg',.9);})''',labels)
        doc=browser.new_page();doc.set_content('<style>@page{size:A4;margin:0}body{margin:0}section{width:210mm;height:297mm;break-after:page}section:last-child{break-after:auto}img{width:100%;height:100%;object-fit:contain}</style>'+''.join('<section><img src="'+src+'"></section>' for src in images));doc.wait_for_function('Array.from(document.images).every(i=>i.complete)')
        pdf=doc.pdf(format='A4',print_background=True,margin={'top':'0','right':'0','bottom':'0','left':'0'});doc.close()
        fixture={'name':'alle-schueler.pdf','mimeType':'application/pdf','buffer':pdf}
        expected_names=['Spencer','Lea'];expected_pages=len(labels)
        if ZIP:
            package=io.BytesIO();word=io.BytesIO()
            with zipfile.ZipFile(word,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Name: Spencer\nAufgabe 3: Schleifen wiederholen etwas.</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Name: Lea\nAufgabe 3: Eine Schleife hilft im Spiel.</w:t></w:r></w:p></w:body></w:document>')
            with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED) as z:
                z.writestr('klasse/alle.pdf',pdf);z.writestr('klasse/antworten.docx',word.getvalue());z.writestr('fotos/nora-2.jpg',image);z.writestr('fotos/nora-1.jpg',image)
            fixture={'name':'klassenstapel.zip','mimeType':'application/zip','buffer':package.getvalue()};expected_names.append('Nora');expected_pages+=4
    if PDF20:
        fixture={'name':'20mb-arbeit.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4\n'+b' '*(20_000_000-15)+b'\n%%EOF'}
        assert len(fixture['buffer'])==20_000_000
    def run_workflow(page):
        page.get_by_role('button',name='Korrekturvorschläge',exact=False).click()
        dialog=page.get_by_role('dialog',name='Agentische Korrekturvorschläge')
        dialog.get_by_label('Arbeiten hochladen').set_input_files(fixture)
        expect(dialog.get_by_role('button',name='Abschrift und Zuordnung starten')).to_be_enabled()
        criteria=dialog.get_by_label('Erwartungshorizont / Korrekturkriterien')
        criteria.fill('Richtig ist 7 + 5 = 12; die Erde ist annähernd kugelförmig. Gib höchstens 100 Wörter konkrete freundliche Rückmeldung je Schüler zu beiden Aufgaben. Keine Punkte und keine Note. Kennzeichne unsichere Lesestellen.')
        if AUTO:dialog.get_by_role('checkbox',name='Alle drei Stufen automatisch durchführen',exact=False).check()
        dialog.get_by_role('button',name='Alle drei Stufen starten' if AUTO else 'Abschrift und Zuordnung starten').click()
        if RECOVERY:
            room='class' if page.url.startswith(CLASS_ORIGIN) else 'private'
            dialog.get_by_role('button',name='Noch einmal versuchen',exact=True).wait_for(timeout=30000)
            expect(dialog.locator('textarea[aria-label^="Abschrift Seite "]')).to_have_count(expected_pages-1)
            with page.expect_download() as download:dialog.get_by_role('button',name='Zwischenstand herunterladen',exact=True).click()
            checkpoint=download.value.path().read_bytes();saved=json.loads(checkpoint)
            assert len(saved['work']['pages'])==expected_pages-1
            assert KEY not in checkpoint.decode() and PASSWORD not in checkpoint.decode()
            before=len(class_calls if room=='class' else private_calls)
            page.once('dialog',lambda dialog:dialog.accept())
            page.reload(wait_until='domcontentloaded')
            if room=='private':
                page.get_by_label('Passwort',exact=True).fill(PASSWORD);page.get_by_role('button',name='Mit Passwort entsperren').click()
            page.get_by_role('button',name='Korrekturvorschläge',exact=False).click()
            dialog=page.get_by_role('dialog',name='Agentische Korrekturvorschläge')
            dialog.get_by_label('Zwischenstand laden',exact=True).set_input_files({'name':'zwischenstand.json','mimeType':'application/json','buffer':checkpoint})
            dialog.get_by_text('Zwischenstand geladen:',exact=False).wait_for()
            assert len(class_calls if room=='class' else private_calls)==before,'Import must never start API requests'
            criteria=dialog.get_by_label('Erwartungshorizont / Korrekturkriterien')
            expect(criteria).to_have_value(re.compile('7 \\+ 5 = 12'))
            recovered.add(room)
            if AUTO:dialog.get_by_role('checkbox',name='Alle drei Stufen automatisch durchführen',exact=False).check()
            dialog.get_by_role('button',name='Abschrift und Zuordnung fortsetzen',exact=True).click()
        if not AUTO:
            criteria.wait_for(timeout=180000)
            review=dialog.get_by_role('checkbox',name='Ich habe Abschrift und Seitenzuordnung geprüft.')
            page.wait_for_function("""()=>document.querySelector('[role=dialog] input[type=checkbox][aria-label]') || [...document.querySelectorAll('[role=dialog] label')].some(e=>e.textContent.includes('Ich habe Abschrift und Seitenzuordnung geprüft.')) || document.querySelector('[role=dialog] [role=alert]')""",timeout=240000)
            alerts=dialog.locator('[role=alert]')
            assert not alerts.count(), alerts.all_inner_texts()
            review.wait_for(timeout=10000)
            expect(dialog.get_by_label('Abschrift Seite 1',exact=True)).to_have_value(re.compile('13'))
            expect(dialog.get_by_role('button',name='Korrekturvorschläge erstellen')).to_be_disabled()
            expect(dialog.locator('textarea[aria-label^="Abschrift Seite "]')).to_have_count(expected_pages)
            expect(dialog.get_by_role('progressbar',name='Korrekturfortschritt')).to_have_attribute('aria-valuenow','60')
            dialog.get_by_label('Feedback zur Abschrift').fill('Die Zahl 13 ist wörtlich so geschrieben, kein Lesefehler.')
            review.check();dialog.get_by_role('button',name='Korrekturvorschläge erstellen').click()
        dialog.get_by_role('heading',name=re.compile('Korrekturvorschläge fertig')).wait_for(timeout=240000)
        dialog.get_by_text('Im Chat verfügbar. Bitte vor Verwendung prüfen.',exact=True).wait_for(timeout=30000)
        with page.expect_download() as download:
            dialog.get_by_role('button',name='Korrekturvorschlag als Word herunterladen',exact=True).click()
        data=download.value.path().read_bytes()
        with zipfile.ZipFile(io.BytesIO(data)) as document:xml=document.read('word/document.xml').decode()
        assert '12' in xml and re.search('kugel',xml,re.I), 'Word document missing the actual correction'
        for name in expected_names:assert name in xml,'Word missing pupil '+name
        with page.expect_download() as pdf_download:dialog.get_by_role('button',name='Korrekturvorschlag als PDF herunterladen',exact=True).click()
        pdf_text=subprocess.run(['pdftotext',str(pdf_download.value.path()),'-'],capture_output=True,text=True,check=True).stdout
        for name in expected_names:assert name in pdf_text,'PDF missing pupil '+name
        expect(dialog.get_by_role('progressbar')).to_have_attribute('aria-valuenow','100')
        dialog.get_by_role('button',name='Korrektur schließen').click()
        page.get_by_role('button',name='Korrekturvorschlag als Word herunterladen',exact=True).wait_for()
        return xml
    run_workflow(page)
    composer=page.locator('textarea:visible').first
    composer.fill('#korrektur')
    page.get_by_role('button',name='Senden',exact=True).click()
    page.get_by_role('dialog',name='Agentische Korrekturvorschläge').wait_for()
    page.get_by_role('button',name='Korrektur schließen').click()
    composer.fill('')
    print('PASS classroom: handwriting-font image, verbatim mistakes, criteria gate, original check, correction and editable DOCX'+(' (REAL MODEL)' if REAL else ''),flush=True)
    private=private_context.new_page();private.goto(PRIVATE_ORIGIN+'/my',wait_until='domcontentloaded')
    private.get_by_role('tab',name='Persönlicher Raum').click()
    private.get_by_label('Name für deine Adresse').fill(PRIVATE_SLUG)
    private.get_by_label('Passwort',exact=True).fill(PASSWORD)
    private.get_by_label('Passwort wiederholen').fill(PASSWORD)
    private.get_by_label('Dein API-Key',exact=True).fill(KEY)
    private.get_by_role('checkbox').check()
    private.get_by_role('button',name='Persönlichen Raum verschlüsselt anlegen').click()
    settings=private.get_by_role('dialog',name='Persönliche Einstellungen');settings.wait_for(timeout=30000)
    settings.get_by_label('Chat & Bilder verstehen Modell-ID',exact=True).fill(MODEL)
    settings.get_by_role('button',name='Verschlüsselt speichern').click();settings.wait_for(state='hidden')
    run_workflow(private)
    private.get_by_label('Deine Nachricht',exact=True).fill('#korrektur')
    private.locator('[data-personal-send]').click()
    private.get_by_role('dialog',name='Agentische Korrekturvorschläge').wait_for()
    private.get_by_role('button',name='Korrektur schließen').click()
    private.get_by_label('Deine Nachricht',exact=True).fill('')
    private.get_by_role('button',name='Sperren',exact=False).click()
    private.get_by_label('Passwort',exact=True).fill(PASSWORD)
    private.get_by_role('button',name='Mit Passwort entsperren').click()
    private.get_by_role('button',name='Korrekturvorschlag als Word herunterladen',exact=True).wait_for(timeout=30000)
    assert private.evaluate('document.documentElement.scrollWidth<=innerWidth')
    print('PASS private: direct provider correction, ciphertext-only server requests, saved result restored after lock, mobile layout'+(' (REAL MODEL)' if REAL else ''),flush=True)
    if not REAL:
        expected_calls=expected_pages+1+2*len(expected_names)+(3 if RECOVERY else 0)
        assert len(class_calls)==expected_calls and len(private_calls)==expected_calls,(len(class_calls),len(private_calls),expected_calls)
        for calls in [class_calls,private_calls]:
            prompts=[(c['messages'][-1]['content'] if isinstance(c['messages'][-1]['content'],str) else next(p['text'] for p in c['messages'][-1]['content'] if p['type']=='text')) for c in calls]
            assert sum(p.startswith('GRUPPIERUNG ALLER SEITEN') for p in prompts)==1
            assert sum(p.startswith('BEWERTUNG EINER SCHÜLERARBEIT') for p in prompts)==len(expected_names)
    if PDF20:
        assert len(class_calls[0]['pdf']['data'])==26_666_668
        parts=private_calls[0]['messages'][-1]['content']
        assert any(part.get('file',{}).get('filename','').endswith('20mb-arbeit.pdf') for part in parts)
        print('PASS exact 20 MB PDF accepted, transmitted in both room UIs, correction completed; provider mocked',flush=True)
    assert not errors,errors
    private.screenshot(path='/tmp/bude-grading-private.png',full_page=True)
    browser.close()
