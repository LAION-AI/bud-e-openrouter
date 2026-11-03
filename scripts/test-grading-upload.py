"""Real browser upload using the classroom's configured credentials and budget.
Contains no keys. Saves UI checkpoints and actual provider responses locally.
Requires Playwright. Default stops at review; --finish assesses after review.
"""
import argparse
import asyncio
import json
import re
import time
from pathlib import Path
from playwright.async_api import async_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='https://school.bud-e.ai/schuhmann')
parser.add_argument('--pdf', type=Path)
parser.add_argument('--auftrag', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--checkpoint', type=Path)
parser.add_argument('--feedback', type=Path)
parser.add_argument('--finish', action='store_true')
parser.add_argument('--automatic', action='store_true')
parser.add_argument('--recheck-selection', action='store_true')
parser.add_argument('--reread-page', type=int, action='append', default=[])
parser.add_argument('--recheck-feedback', action='store_true')
args = parser.parse_args()
args.output.mkdir(mode=0o700, parents=True, exist_ok=True)

def read_text(path):
    data = path.read_bytes()
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return data.decode('cp1252')

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(accept_downloads=True, viewport={'width': 1440, 'height': 1100})
        await context.add_init_script("try {localStorage.setItem('school-bud-e-agreement','true');localStorage.setItem('bud-e-agreement','true')} catch(e) {}")
        page = await context.new_page()
        pending = set()
        calls = 0
        cost = 0.0
        async def capture(response):
            nonlocal calls, cost
            if '/api/classroom' not in response.url or response.request.method != 'POST':
                return
            try:
                request = response.request.post_data_json
                if not request.get('grading'):
                    return
                result = await response.json()
                calls += 1
                cost += result.get('cost', 0) or 0
                with (args.output / 'api-antworten.jsonl').open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps({'time': time.time(), 'status': response.status, 'format': request.get('gradingFormat'), 'outputLimit': request.get('gradingMaxOutput'), 'response': result}, ensure_ascii=False) + '\n')
            except Exception as error:
                print('Capture:', type(error).__name__, flush=True)
        def on_response(response):
            task = asyncio.create_task(capture(response))
            pending.add(task)
            task.add_done_callback(pending.discard)
        page.on('response', on_response)
        page.on('dialog', lambda dialog: asyncio.create_task(dialog.accept()))
        await page.goto(args.url, wait_until='domcontentloaded', timeout=60000)
        await page.get_by_role('button', name='Korrekturvorschläge', exact=False).click(timeout=30000)
        dialog = page.get_by_role('dialog', name='Agentische Korrekturvorschläge')
        if args.checkpoint:
            await dialog.get_by_label('Zwischenstand laden', exact=True).set_input_files(args.checkpoint)
            await dialog.get_by_text('Zwischenstand geladen:', exact=False).wait_for(timeout=30000)
        else:
            if not args.pdf:
                raise RuntimeError('--pdf or --checkpoint is required')
            await dialog.get_by_label('Arbeiten hochladen', exact=True).set_input_files(args.pdf)
        for number in args.reread_page:
            target=dialog.get_by_role('button',name=f'Seite {number} erneut abschreiben',exact=True)
            if not await target.is_visible():
                await dialog.locator('summary').filter(has_text='Abschrift prüfen').click()
            await target.click()
        if args.recheck_feedback:
            await dialog.get_by_role('button',name='Rückmeldungen erneut prüfen',exact=True).click()
        criteria=dialog.get_by_label('Erwartungshorizont / Korrekturkriterien', exact=True)
        if await criteria.is_visible():
            await criteria.fill(read_text(args.auftrag))
        if args.feedback:
            await dialog.get_by_label('Feedback zur Abschrift', exact=True).fill(read_text(args.feedback))
        pause=dialog.get_by_role('checkbox',name='Prüfpause einlegen',exact=False)
        if await pause.count():
            await pause.set_checked(not args.automatic)
        elif args.automatic and await dialog.get_by_role('checkbox',name='Alle drei Stufen automatisch durchführen',exact=False).count():  # old UI compatibility
            await dialog.get_by_role('checkbox',name='Alle drei Stufen automatisch durchführen',exact=False).check()
        if args.recheck_selection:
            await dialog.get_by_role('button',name='Zuordnung mit aktuellem Auftrag erneut prüfen',exact=True).click()

        async def checkpoint(label):
            path = args.output / ('zwischenstand-' + label + '.json')
            async with page.expect_download(timeout=60000) as download:
                await dialog.get_by_role('button', name='Zwischenstand herunterladen', exact=True).click()
            await (await download.value).save_as(path)
            return path

        started_mark = False
        retries = 0
        last_save = 0
        started = time.monotonic()
        try:
            review = dialog.get_by_role('checkbox', name='Ich habe Abschrift und Seitenzuordnung geprüft.', exact=True)
            already_finished=await dialog.get_by_role('heading',name=re.compile('Korrekturvorschläge fertig')).count()
            if already_finished:
                pass
            elif args.automatic and await review.count():
                await dialog.get_by_role('button',name='Korrekturvorschläge erstellen',exact=True).click()
                started_mark=True
            elif not args.recheck_selection and not await review.count():
                start = dialog.get_by_role('button', name=re.compile('Alle drei Stufen starten|Abschrift und Zuordnung (starten|fortsetzen)'))
                await start.click()
            while time.monotonic() - started < 7200:
                await page.wait_for_timeout(10000)
                progress = dialog.get_by_role('progressbar').first
                percent = await progress.get_attribute('aria-valuenow') if await progress.count() else '?'
                transcript_count = await dialog.locator('textarea[aria-label^="Abschrift Seite "]').count()
                print(f'Progress {percent}% · {transcript_count} Seiten · {calls} API-Antworten · ${cost:.6f}', flush=True)
                now = time.monotonic()
                if now - last_save > 55:
                    await checkpoint('laufend')
                    last_save = now
                alerts = dialog.locator('[role=alert]')
                if await alerts.count():
                    error = '\n'.join(await alerts.all_inner_texts())
                    print('UI-Fehler:', error[:1500], flush=True)
                    await checkpoint('fehler-' + str(retries))
                    if re.search(r'Guthaben|Ausgabenrahmen|geschlossen|Freigabe|API.Key|Erwartungshorizont|Rückfrage|Teilpunkt', error, re.I) or retries >= 2:
                        raise RuntimeError('Paused safely; inspect saved checkpoint and UI error')
                    retry = dialog.get_by_role('button', name='Noch einmal versuchen', exact=True)
                    if await retry.count() and await retry.is_enabled():
                        retries += 1
                        await retry.click()
                        continue
                    raise RuntimeError('Retry needs review; checkpoint saved')
                finished = dialog.get_by_role('heading', name=re.compile('Korrekturvorschläge fertig'))
                if await finished.count():
                    path = await checkpoint('fertig')
                    for kind, filename in [('Word', 'Korrekturvorschlaege-alle.docx'), ('PDF', 'Korrekturvorschlaege-alle.pdf')]:
                        async with page.expect_download(timeout=60000) as download:
                            await dialog.get_by_role('button', name=f'Korrekturvorschlag als {kind} herunterladen', exact=True).click()
                        await (await download.value).save_as(args.output / filename)
                    for kind, ext in [('PDF','pdf'),('Word','docx')]:
                        target=dialog.get_by_role('button',name=f'Prüfmappe als {kind} herunterladen',exact=True)
                        if await target.count():
                            async with page.expect_download(timeout=240000) as download:
                                await target.click()
                            await (await download.value).save_as(args.output / f'Pruefmappe-Originale-Abschriften-Feedback.{ext}')
                    await page.screenshot(path=args.output / 'ui-fertig.png', full_page=True)
                    print('DONE', path, flush=True)
                    break
                if not args.automatic and await review.count() and await review.is_enabled() and not started_mark:
                    path = await checkpoint('pruefpause')
                    if not args.finish:
                        print('REVIEW READY', path, flush=True)
                        break
                    await review.check()
                    await dialog.get_by_role('button', name='Korrekturvorschläge erstellen', exact=True).click()
                    started_mark = True
            else:
                raise RuntimeError('Two-hour safety timeout')
        except BaseException:
            try:
                await checkpoint('unterbrochen')
                await page.screenshot(path=args.output / 'ui-fehler.png', full_page=True)
            except Exception:
                pass
            raise
        finally:
            if pending:
                await asyncio.gather(*list(pending), return_exceptions=True)
            print(f'Total: {calls} API responses, charged ${cost:.6f}', flush=True)
            await browser.close()

asyncio.run(main())
