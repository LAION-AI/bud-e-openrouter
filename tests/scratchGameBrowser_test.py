"""Playwright: actual Scratch assets, block execution, default preload, opt-out and undo.
Normal mode mocks only model replies. --real uses the existing active classroom/model
(one small request, plus at most one repair request; can incur provider costs).
Usage: python tests/scratchGameBrowser_test.py BASE SLUG [--real]
"""
import json, re, sys, zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

BASE=sys.argv[1].rstrip('/') if len(sys.argv)>1 else 'http://127.0.0.1:8161'
SLUG=sys.argv[2] if len(sys.argv)>2 else 'schuhmann'
REAL='--real' in sys.argv
if REAL and not BASE.startswith('https://'):
    raise SystemExit('Real provider tests require HTTPS; use the public active classroom. Local HTTP is intentionally rejected by the API.')
def b(opcode,inputs=None,fields=None,**extra):
    return dict(opcode=opcode,**({'inputs':inputs} if inputs else {}),**({'fields':fields} if fields else {}),**extra)
def has_variable(block,name):
    field=block.get('fields',{}).get('VARIABLE')
    return (field.get('value') if isinstance(field,dict) else field[0] if isinstance(field,list) and field else None)==name
def game(snapshot):
    reset=[b('motion_gotoxy',{'X':0,'Y':170})]
    return {'scratch':{'action':'propose','revision':snapshot['revision'],'summary':'Pfeiltasten bewegen das Raumschiff. Weiche dem Stern aus und sammle Punkte. Grüne Flagge startet das Spiel.',
      'title':'Sternen-Ausweichen','backdrop':'Stars','variables':[{'name':'Punkte','value':0}],
      'targets':[{'targetId':t['id'],'visible':False} for t in snapshot['targets'] if not t['isStage']],
      'sprites':[
        {'id':'player','name':'Spieler','asset':'Rocketship','x':0,'y':-140,'size':30,'scripts':[[b('event_whenflagclicked'),b('motion_gotoxy',{'X':0,'Y':-140}),b('control_forever',substack=[
          b('control_if',{'CONDITION':b('sensing_keypressed',{'KEY_OPTION':'left arrow'})},substack=[b('motion_changexby',{'DX':-6})]),
          b('control_if',{'CONDITION':b('sensing_keypressed',{'KEY_OPTION':'right arrow'})},substack=[b('motion_changexby',{'DX':6})]),b('control_wait',{'DURATION':0.03})])]]},
        {'id':'obstacle','name':'Stern','asset':'Star','x':0,'y':170,'size':35,'scripts':[[b('event_whenflagclicked'),b('data_setvariableto',{'VALUE':0},{'VARIABLE':'Punkte'}),b('data_showvariable',fields={'VARIABLE':'Punkte'}),*reset,b('control_forever',substack=[
          b('motion_changeyby',{'DY':-6}),
          b('control_if',{'CONDITION':b('sensing_touchingobject',{'TOUCHINGOBJECTMENU':'Spieler'})},substack=[b('data_changevariableby',{'VALUE':-1},{'VARIABLE':'Punkte'}),*reset]),
          b('control_if',{'CONDITION':b('operator_lt',{'OPERAND1':b('motion_yposition'),'OPERAND2':-175})},substack=[b('data_changevariableby',{'VALUE':1},{'VARIABLE':'Punkte'}),*reset]),b('control_wait',{'DURATION':0.03})])]]}
      ]}}

def add_dodge_counter(snapshot):
    star=next(target for target in snapshot['targets'] if target['name']=='Stern')
    root=next(block for block in star['code'] if block['opcode']=='event_whenflagclicked' and block['topLevel'])
    # Begin just above the scoring line so the follow-up's new counter can be
    # exercised quickly; normal play starts with the original full-screen fall.
    reset=b('motion_gotoxy',{'X':0,'Y':-168})
    collision=b('sensing_touchingobject',{'TOUCHINGOBJECTMENU':'Spieler'})
    below=b('operator_lt',{'OPERAND1':b('motion_yposition'),'OPERAND2':-175})
    blocks=[b('event_whenflagclicked'),
      b('data_setvariableto',{'VALUE':0},{'VARIABLE':'Ausweichversuche'}),
      b('data_showvariable',fields={'VARIABLE':'Ausweichversuche'}),reset,
      b('control_forever',substack=[b('motion_changeyby',{'DY':-6}),
        b('control_if',{'CONDITION':collision},substack=[b('data_changevariableby',{'VALUE':-1},{'VARIABLE':'Punkte'}),reset]),
        # A collision resets the rock in the preceding branch, so reaching
        # the lower edge here means the player dodged successfully.
        b('control_if',{'CONDITION':below},substack=[b('data_changevariableby',{'VALUE':1},{'VARIABLE':'Ausweichversuche'}),reset]),
        b('control_wait',{'DURATION':0.03})])]
    return {'scratch':{'action':'propose','revision':snapshot['revision'],
      'summary':'Der Zähler Ausweichversuche steigt, wenn ein Stern den Spieler verfehlt und unten ankommt.',
      'variables':[{'name':'Ausweichversuche','value':0}],
      'scripts':[{'targetId':star['id'],'replace':root['id'],'blocks':blocks}]}}

with TemporaryDirectory(prefix='bude-game-test-') as directory, sync_playwright() as p:
  firefox='--firefox' in sys.argv
  browser=(p.firefox if firefox else p.chromium).launch(headless=True,args=[] if firefox else ['--no-sandbox'])
  for classroom in ([True] if REAL or '--classroom' in sys.argv else ([False] if '--main' in sys.argv else [True,False])):
    page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
    page.add_init_script("try{localStorage.setItem('bud-e-agreement','true');localStorage.setItem('bud-e-api-url','https://example.invalid');localStorage.setItem('bud-e-api-key','test-key');localStorage.setItem('bud-e-model','test-model');}catch{}")
    errors=[]; calls=[]; pending_snapshot=[]; rejected=[False]
    page.on('pageerror',lambda e:errors.append(str(e)))
    def intercept(route):
      if route.request.method=='GET':
        route.fulfill(json={'exists':True,'active':True,'reason':'active','slug':SLUG,'expiresAt':2000000000000,'enabled':{'chat':True,'tts':False,'asr':False}}); return
      body=route.request.post_data_json; calls.append(body)
      if classroom: assert len(body['messages'])<=12, 'Repair exceeds the real classroom API message limit'
      print('TEST request',classroom,len(calls),'stream',body.get('stream'),flush=True)
      flags=body.get('tools') or body.get('toolFlags'); snapshot=flags['scratchProject']; pending_snapshot.append(snapshot)
      assert flags['scratch'] and flags['scratchRequested'], {k:v for k,v in flags.items() if k!='scratchProject'}
      assert len(snapshot['library']['sprites'])==343
      assert 'Rocketship' in snapshot['library']['sprites'] and 'Star' in snapshot['library']['sprites']
      assert 'selectedTarget' not in json.dumps(body['messages']),'Snapshot must be separate request-scoped system data'
      # Refusal, wrong live target, then a complete bare/fenced plan. Later a
      # truncated counter is repaired after the conversation exceeds 12 turns.
      if len(calls)==1:
        assert flags['scratchEdit']
        reply='Ich kann Scratch leider nicht direkt bearbeiten.'
      elif len(calls)==2:
        assert flags['scratchEdit']
        invalid=game(snapshot)
        invalid['scratch']['targets'][0]['targetId']='invented-target-not-in-project'
        reply=json.dumps(invalid)
      elif len(calls)==3:
        assert flags['scratchEdit']
        assert 'Validierungsfehler' in body['messages'][-1]['content']
        bare=json.dumps(game(snapshot)['scratch'])
        reply='Hier kommt der Auftrag:\n```json\n'+bare.replace('{"action":','{action:',1)[:-1]+',}\n```'
      else:
        assert any(t['name']=='Stern' and t.get('code') for t in snapshot['targets']), 'Follow-up did not receive the live game project'
        if flags['scratchEdit']:
          counter=add_dodge_counter(snapshot)
          reply=(json.dumps(counter)[:-2] if len(calls)==10 else
            json.dumps({'name':'scratch','arguments':json.dumps(counter['scratch'])}))
        else:
          reply=f'Editorprüfung {len(calls)}: Ich sehe Spieler und Stern im eingebetteten Scratch-Editor.'
      if classroom: route.fulfill(json={'reply':reply})
      elif body.get('stream') is False: route.fulfill(json={'choices':[{'message':{'content':reply}}]})
      else: route.fulfill(content_type='text/event-stream',body='data: '+json.dumps(reply)+'\n\ndata: "[DONE]"\n\n')
    if not REAL:
      page.route('**/api/classroom**',intercept)
      page.route('**/api/chat',intercept)
      page.route('**/api/tts',lambda r:r.fulfill(status=400,body='disabled'))
    page.goto(BASE+('/'+SLUG if classroom else '/'),wait_until='networkidle',timeout=60000)
    if page.get_by_role('button',name='Akzeptieren',exact=True).is_visible():
      page.get_by_role('checkbox').check();page.get_by_role('button',name='Akzeptieren',exact=True).click()
    page.locator('iframe[title="Scratch Block-Editor"]').wait_for(state='attached',timeout=30000)
    assert not page.locator('iframe[title="Scratch Block-Editor"]').is_visible()
    composer=page.locator('textarea:visible').first
    prompt=('Scratch: Baue mir direkt ein kleines spielbares Ausweichspiel mit zwei neuen Figuren: Spieler (Asset Rocketship) und Stern (Asset Star). '
      'Blende die vorhandene Katze aus. Spieler startet bei x=0,y=-140, Größe 30 und wird mit linker/rechter Pfeiltaste bewegt. '
      'Stern startet bei x=0,y=170, Größe 35, fällt nach unten. Bei Berührung des Spielers ziehe einen Punkt ab und setze den Stern oben zurück; '
      'beim unberührten Erreichen des unteren Rands gibt es einen Punkt und der Stern startet oben neu. Bühnenvariable Punkte bei Flagge auf 0 setzen und anzeigen. '
      'Benutze eine kurze Wartezeit in beiden Endlosschleifen. Verwende die lokale Bibliothek und baue die Blöcke direkt ein, nicht nur eine Anleitung.')
    composer.fill(prompt);composer.press('Enter')
    print('TEST sent',classroom,flush=True)
    dialog=page.get_by_role('dialog',name='Scratch')
    try: dialog.wait_for(timeout=180000)
    except Exception:
      print('CHAT',page.locator('body').inner_text()[-4500:],flush=True);raise
    undo=dialog.get_by_role('button',name='KI-Änderung rückgängig');undo.wait_for(timeout=20000)
    assert dialog.get_by_role('checkbox').is_checked()
    assert not dialog.get_by_role('button',name='Änderung übernehmen').count()
    if not REAL: assert len(calls)==3,'Two bounded repairs expected: refusal then invalid live target'
    save=dialog.get_by_role('button',name='↓ Auf Computer speichern')
    def export(name):
      with page.expect_download() as info: save.click()
      target=Path(directory)/name;info.value.save_as(str(target))
      with zipfile.ZipFile(target) as z:
        project=json.loads(z.read('project.json'))
        for t in project['targets']:
          for asset in t['costumes']+t['sounds']:
            asset_file=asset.get('md5ext') or asset.get('md5') or (asset['assetId']+'.'+asset['dataFormat'])
            assert asset_file in z.namelist(),('Missing asset in SB3',asset_file)
        return project
    initial=export('game.sb3')
    player=next(t for t in initial['targets'] if t['name']=='Spieler')
    star=next(t for t in initial['targets'] if t['name']=='Stern')
    assert player['blocks'] and star['blocks']
    assert any(isinstance(v,dict) and v.get('opcode')=='sensing_touchingobject' for v in star['blocks'].values())
    frame=page.frame_locator('iframe[title="Scratch Block-Editor"]')
    frame.locator('[class*="green-flag_green-flag"]').first.click()
    page.wait_for_timeout(300)
    # The stage itself must have keyboard focus (Scratch GUI handles its document).
    frame.locator('canvas').first.click()
    page.keyboard.down('ArrowRight');page.wait_for_timeout(350);page.keyboard.up('ArrowRight')
    running=export('moving.sb3')
    moved=next(t for t in running['targets'] if t['name']=='Spieler')
    falling=next(t for t in running['targets'] if t['name']=='Stern')
    assert moved['x']>player['x']+10,('Arrow control did not execute',moved['x'],player['x'])
    assert falling['y']<star['y']-10,('Obstacle did not fall',falling['y'],star['y'])
    page.wait_for_timeout(6000 if REAL else 2400)
    counted=export('points.sb3')
    stage=next(t for t in counted['targets'] if t['isStage'])
    points=next(v[1] for v in stage['variables'].values() if v[0]=='Punkte')
    assert points>=1,('Score/collision loop did not execute',points)
    page.screenshot(path='/tmp/bude-scratch-game-'+('real' if REAL else str(classroom))+'.png')
    # Reproduce the reported follow-up, including its original typo.
    dialog.get_by_role('button',name='Scratch schließen').click()
    if not REAL:
      # Reading access must survive more than four follow-ups without the word
      # Scratch. These read-only requests must never apply an editor change.
      for question in ['Kannst du den Editor sehen?', 'Welche Figuren sind im Spiel?',
          'Wie funktionieren die Pfeiltasten?', 'Wo sehe ich die Punkte?',
          'Welche Blöcke steuern die Geschwindigkeit?', 'Kannst du den Editor noch sehen?']:
        expected=len(calls)+1
        composer.fill(question);composer.press('Enter')
        page.get_by_text(f'Editorprüfung {expected}: Ich sehe Spieler und Stern im eingebetteten Scratch-Editor.',exact=True).wait_for(timeout=20000)
        assert len(calls)==expected and not (calls[-1].get('tools') or calls[-1].get('toolFlags'))['scratchEdit']
        assert not dialog.is_visible(), 'Reading must not apply or reopen an editor change'
    composer.fill('mach mir noch nene punktezähler für erfolgreiche ausweichversuche')
    composer.press('Enter')
    dialog.wait_for(timeout=30000)
    undo.wait_for(timeout=20000)
    if not REAL:
      assert len(calls)==11,'The late truncated counter must be repaired without exceeding the classroom API limit'
      flags=calls[-1].get('tools') or calls[-1].get('toolFlags')
      assert flags['scratch'] and flags['scratchRequested'] and flags['scratchEdit']
      assert any(t['name']=='Stern' and t.get('code') for t in flags['scratchProject']['targets'])
    extended=export('dodge-counter.sb3')
    stage=next(t for t in extended['targets'] if t['isStage'])
    assert any(v[0]=='Ausweichversuche' for v in stage['variables'].values()), 'Counter variable was not added'
    star=next(t for t in extended['targets'] if t['name']=='Stern')
    assert any(block.get('opcode')=='data_changevariableby' and has_variable(block,'Ausweichversuche') for block in star['blocks'].values()), 'Counter is not wired into the successful-dodge logic'
    frame=page.frame_locator('iframe[title="Scratch Block-Editor"]')
    frame.locator('[class*="green-flag_green-flag"]').first.click()
    page.wait_for_timeout(2200)
    counted=export('dodge-counter-running.sb3')
    stage=next(t for t in counted['targets'] if t['isStage'])
    attempts=next(v[1] for v in stage['variables'].values() if v[0]=='Ausweichversuche')
    assert float(attempts)>=1,('Successful dodge attempts were not counted',attempts)
    undo.click();undo.wait_for(state='hidden')
    restored=export('undo.sb3')
    assert len(restored['targets'])==4,'Undo must restore the game state that existed before the counter was added'
    assert not any(block.get('opcode')=='data_changevariableby' and has_variable(block,'Ausweichversuche') for t in restored['targets'] for block in t['blocks'].values())
    assert 'selectedTarget' not in page.evaluate('JSON.stringify(localStorage)')
    assert not errors,errors
    print('PASS',('REAL provider + classroom' if REAL else ('mock provider + classroom' if classroom else 'mock provider + main')),
      'preload, default permission, direct game, trusted assets, real keyboard execution, falling star, points, local SB3 assets, undo, ephemeral context')
    page.close()
  browser.close()
