"""Generate a small, image-only school-knowledge fixture, no real pupils/keys.
Run test-grading-upload.py on the resulting PDF with --automatic afterward.
"""
import argparse
import asyncio
import base64
from pathlib import Path
from playwright.async_api import async_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--font', default='/tmp/bude-grading-Caveat.ttf', type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
cases = [
    {'name': 'Test Mathe', 'lines': ['1. 7 + 5 = 13', '2. 6 mal 4 = 24']},
    {'name': 'Test Deutsch', 'lines': ['1. Mehrzahl von Kind: Kinder', '2. Die Katze schlafen.']},
    {'name': 'Test Englisch', 'lines': ['1. I goes to school.', '2. Mehrzahl von cat: cats']},
    {'name': 'Test Biologie', 'lines': ['1. Pflanzen brauchen Licht zur Fotosynthese.', '2. Fische atmen unter Wasser mit Lungen.']},
    {'name': 'Test Geschichte', 'lines': ['1. Die Berliner Mauer fiel 1990.', '2. Die deutsche Wiedervereinigung war 1990.']},
]

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        images = await page.evaluate('''async ({font,cases}) => {
          const face = new FontFace('FixtureHandwriting', `url(data:font/ttf;base64,${font})`);
          await face.load();document.fonts.add(face);
          return cases.map(item => {
            const canvas=document.createElement('canvas');canvas.width=1300;canvas.height=1800;
            const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1300,1800);
            ctx.fillStyle='#152843';ctx.font='38px sans-serif';
            ['Name: '+item.name,'Klasse: Test 8','Datum: 02.11.2026','Zwei Aufgaben, je 1 Punkt.'].forEach((text,i)=>ctx.fillText(text,65,95+i*80));
            ctx.font='47px FixtureHandwriting';ctx.fillStyle='#163b7a';
            item.lines.forEach((text,i)=>ctx.fillText(text,65,550+i*180));
            return canvas.toDataURL('image/jpeg',.95);
          });
        }''', {'font': base64.b64encode(args.font.read_bytes()).decode(), 'cases': cases})
        await page.set_content('<style>@page{size:A4;margin:0}body{margin:0}section{width:210mm;height:297mm;break-after:page}section:last-child{break-after:auto}img{width:100%;height:100%;object-fit:contain}</style>' + ''.join('<section><img src="'+src+'"></section>' for src in images))
        await page.wait_for_function('Array.from(document.images).every(img=>img.complete)')
        await page.pdf(path=str(args.output/'Schulwissen-Bildtest.pdf'), format='A4', print_background=True, margin={'top':'0','right':'0','bottom':'0','left':'0'})
        await browser.close()
    criteria = '''Synthetischer Funktionstest, keine echten Schülerarbeiten.
Jede Seite gehört zu einem anderen Testnamen. Ordne genau fünf Arbeiten zu.
Pro Arbeit zwei Aufgaben, jede Aufgabe 1 Punkt, insgesamt 2. Keine Note.
Vergib nur fachliche Punkte, keine Abzüge für Rechtschreibung außerhalb der gezielten Sprachaufgaben.
Gib je Person kurz die tatsächliche Antwort, die korrekte Lösung, Einzelpunkte und die Summe /2 an.
Kennzeichne unleserliche Stellen, erfinde keine Antworten oder Bewertungen.
Erwartungshorizont:
Test Mathe: 1) 7+5=12 (13 ist falsch); 2) 6*4=24 richtig. Erwartet insgesamt 1/2.
Test Deutsch: 1) Kinder ist richtig; 2) Die Katze schläft wäre richtig, schlafen ist falsch. Insgesamt 1/2.
Test Englisch: 1) I go to school wäre richtig, I goes ist falsch; 2) cats richtig. Insgesamt 1/2.
Test Biologie: 1) Licht zur Fotosynthese richtig; 2) Fische atmen hier mit Kiemen, nicht Lungen. Insgesamt 1/2.
Test Geschichte: 1) Mauerfall 1989, nicht 1990; 2) Wiedervereinigung 1990 richtig. Insgesamt 1/2.
Keine zusätzlichen Punkte, kein Notenschlüssel. Höchstens 140 Wörter pro Arbeit.
'''
    (args.output/'Erwartungshorizont.txt').write_text(criteria, encoding='utf-8')
    print('Created five synthetic image-only cases; expected score 1/2 for each.')

asyncio.run(main())
