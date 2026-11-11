"""Actual browser → local API → SQLite with a mocked Gemini provider only."""
import os
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from playwright.sync_api import sync_playwright, expect

# Allow direct invocation from project root without installing the app.
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine
from server import Store, create_handler

observed_feedback = []


def synthetic_provider(mode, entries, feedback, question=''):
    observed_feedback.extend(feedback)
    quote = {'entry_id': entries[0]['id'], 'quote': 'A walk helped me settle.'}
    if mode == 'chat':
        return engine.validate_result({'answer': 'You mentioned that a walk helped. This is one observation, not a cause.', 'evidence': [quote]}, mode, entries)
    return engine.validate_result({'summary': 'A synthetic hypothesis to review.', 'insights': [{
        'title': 'A moment of settling', 'observation': 'You described feeling more settled after a walk. One entry is insufficient for a recurring pattern.',
        'strength': 'low', 'evidence': [quote], 'alternative': 'Time away from work may also matter.',
        'question': 'What part of the break felt helpful?', 'experiment': 'Optionally notice how the next short break feels.'}]}, mode, entries)


with tempfile.TemporaryDirectory() as temp, patch('engine.generate', side_effect=synthetic_provider):
    store = Store(Path(temp) / 'browser.sqlite3')
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), create_handler(store))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), args=['--no-sandbox'])
            page = browser.new_page(viewport={'width': 1366, 'height': 1000})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{httpd.server_port}')
            page.locator('#entry-text').fill('A walk helped me settle.')
            page.get_by_role('button', name='Save reflection').click()
            expect(page.locator('.entry')).to_have_count(1)
            page.locator('[data-page="insights"]').click()
            page.locator('#ai-consent').check()
            page.locator('#analyze').click()
            expect(page.locator('.insight')).to_have_count(1)
            page.locator('.correction').fill('The break mattered more than the walk.')
            page.get_by_role('button', name='Partly fits', exact=True).click()
            expect(page.get_by_role('button', name='Partly fits', exact=True)).to_have_class('selected')
            page.locator('.insight .evidence').click()
            expect(page.locator('#page-journal')).to_be_visible()
            page.locator('[data-page="chat"]').click()
            page.locator('#question').fill('What helped?')
            page.get_by_role('button', name='Ask', exact=False).click()
            expect(page.locator('.message')).to_have_count(2)
            expect(page.locator('.message .evidence')).to_have_count(1)
            assert observed_feedback[-1]['note'] == 'The break mattered more than the walk.'
            page.reload()
            page.locator('[data-page="insights"]').click()
            expect(page.locator('.insight')).to_have_count(1)
            expect(page.locator('.correction')).to_have_value('The break mattered more than the walk.')
            assert not errors, errors
            browser.close()
        print('PASS: mocked-provider browser/API/SQLite analysis, exact evidence navigation, saved correction, feedback-grounded chat, reload persistence; no live Google call.')
    finally:
        httpd.shutdown(); httpd.server_close(); thread.join()
