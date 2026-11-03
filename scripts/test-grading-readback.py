"""Targeted real-model OCR diagnostic through the room's normal API (no key access).
Generated crops remain local. Original files and room settings are untouched.
"""
import argparse, asyncio, base64, json
from pathlib import Path
from playwright.async_api import async_playwright

p=argparse.ArgumentParser()
p.add_argument('--checkpoint',required=True,type=Path)
p.add_argument('--image',required=True,type=Path)
p.add_argument('--output',required=True,type=Path)
p.add_argument('--url',default='https://school.bud-e.ai/schuhmann')
args=p.parse_args()
prompt='''Lies ausschließlich die tatsächlich sichtbare BLAUE HANDSCHRIFT in den drei Lücken im Abschnitt über Bits und Bytes ab. NICHT lösen, NICHT verbessern, NICHT erwartete Fachbegriffe ergänzen. Die drei Ortsanker lauten: 1. „Acht davon sind ein ...“, 2. „1.024 Byte ergeben ein ...“, 3. „1.024 Kilobyte ein ...“. Schreibe pro Zeile den Ortsanker und exakt das handschriftliche Wort; bei unleserlichen Buchstaben [?] verwenden. Es geht um die beobachtete Schrift, auch wenn die Wörter inhaltlich falsch sind. Keine Bewertung, keine Erklärung der richtigen Lösung.'''

async def main():
    saved=json.loads(args.checkpoint.read_text())
    source=next(s for s in saved['work']['sources'] if s['index']==1)
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True)
        page=await browser.new_page()
        await page.goto(args.url,wait_until='domcontentloaded')
        images=await page.evaluate('''async data=>{const im=new Image();im.src=data;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;c.getContext('2d').drawImage(im,0,0);const full=c.toDataURL('image/jpeg',.94);c.width=2060;c.height=540;c.getContext('2d').drawImage(im,60,730,1030,270,0,0,2060,540);return {full,crop:c.toDataURL('image/jpeg',.96)};}''','data:image/png;base64,'+base64.b64encode(args.image.read_bytes()).decode())
        slug=args.url.rstrip('/').split('/')[-1]
        cases=[('Original-PDF',[],{'name':source['name'],'data':source['content'].split(',')[1]}),('Bildausschnitt',[images['crop']],None),('Ganzes-Bild-plus-Detail',[images['full'],images['crop']],None)]
        async def ask(case):
            name,imgs,pdf=case
            body={'action':'chat','slug':slug,'grading':True,'gradingMaxOutput':8192,'toolContinuation':True,'messages':[{'role':'user','content':prompt}],'tools':{},'images':imgs}
            if pdf:body['pdf']=pdf
            result=await page.evaluate('''async body=>{const r=await fetch('/api/classroom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,...await r.json()};}''',body)
            print(name,json.dumps(result,ensure_ascii=False),flush=True)
            return {'case':name,'result':result}
        results=await asyncio.gather(*(ask(case) for case in cases))
        args.output.write_text(json.dumps(results,ensure_ascii=False,indent=2))
        await browser.close()
asyncio.run(main())
