"""Import a completed local checkpoint on the actual site; no paid calls allowed.
Verifies real-data warnings, original preview, and safe close without changing any room.
"""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
p=argparse.ArgumentParser()
p.add_argument('--url',default='https://school.bud-e.ai/schuhmann')
p.add_argument('--checkpoint',required=True,type=Path)
p.add_argument('--output',required=True,type=Path)
args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    ctx=browser.new_context(viewport={'width':1360,'height':1100})
    ctx.add_init_script("localStorage.setItem('school-bud-e-agreement','true');localStorage.setItem('bud-e-agreement','true')")
    forbidden=[]
    def block_paid(route):
        if route.request.method=='POST' and route.request.post_data_json.get('grading'):
            forbidden.append(route.request.url);route.abort()
        else:route.continue_()
    ctx.route('**/api/classroom*',block_paid)
    page=ctx.new_page();page.goto(args.url,wait_until='domcontentloaded')
    page.get_by_role('button',name='Korrekturvorschläge',exact=False).click()
    dialog=page.get_by_role('dialog',name='Agentische Korrekturvorschläge')
    expect(dialog.get_by_role('checkbox',name='Prüfpause einlegen',exact=False)).not_to_be_checked()
    dialog.get_by_label('Zwischenstand laden',exact=True).set_input_files(args.checkpoint)
    warnings=dialog.get_by_label('Widersprüche zwischen Abschrift und Rückmeldung',exact=True)
    expect(warnings).to_be_visible(timeout=30000)
    warnings.screenshot(path=args.output/'ui-pruefhinweise.png')
    dialog.locator('summary').filter(has_text='Abschrift prüfen').click()
    dialog.get_by_role('button',name='Originalseite 1 ansehen',exact=True).click()
    original=dialog.get_by_role('img',name='Originalseite 1 ·',exact=False)
    expect(original).to_be_visible(timeout=30000)
    original.screenshot(path=args.output/'ui-originalvorschau.png')
    messages=[]
    def stay(d):messages.append(d.message);d.dismiss()
    page.once('dialog',stay)
    dialog.get_by_role('button',name='Korrektur schließen',exact=True).click()
    expect(dialog).to_be_visible()
    assert messages and 'schließen' in messages[0].lower()
    page.once('dialog',lambda d:d.accept())
    dialog.get_by_role('button',name='Korrektur schließen',exact=True).click()
    expect(dialog).not_to_be_visible()
    assert not forbidden,'Completed import attempted a model request'
    print('PASS live default automatic, completed checkpoint, contradiction warning, local original preview, close cancellation; zero model calls')
    browser.close()
