"""Use only with a disposable running database at localhost:8000."""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'],
                                executable_path=os.environ.get('CHROMIUM_EXECUTABLE'))
    page = browser.new_page(viewport={'width': 1440, 'height': 1050})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8000')
    page.get_by_role('heading', name='What’s on your mind?').wait_for()
    page.locator('#entry-text').fill('Synthetic browser reflection: a walk gave me energy. <script>throw Error("unsafe")</script>')
    page.locator('[data-mood="4"]').click()
    page.locator('#tags').fill('walk, energy')
    page.get_by_role('button', name='Save reflection').click()
    page.locator('.entry').first.wait_for()
    assert 'Synthetic browser reflection' in page.locator('.entry').first.inner_text()
    page.reload()
    page.locator('.entry').first.wait_for()
    assert page.locator('.chart-bar').count() > 0
    page.locator('[data-page="insights"]').click()
    page.locator('#analyze').click()
    page.get_by_role('status').filter(has_text='Check the Google sharing').wait_for()
    page.locator('#ai-consent').check()
    page.locator('#analyze').click()
    page.get_by_role('status').filter(has_text='AI is not connected').wait_for()
    page.locator('[data-page="continuity"]').click()
    expect(page.locator('#handoff-prompt')).to_have_value(re.compile('Continue PatternSight'))
    assert 'Continue PatternSight' in page.locator('#handoff-prompt').input_value()
    page.locator('[data-page="journal"]').click()
    Path('artifacts').mkdir(exist_ok=True)
    page.screenshot(path='artifacts/desktop.png', full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path='artifacts/mobile.png', full_page=True)
    with page.expect_download() as download:
        page.locator('#export').click()
    assert download.value.suggested_filename.endswith('.json')
    page.on('dialog', lambda dialog: dialog.accept())
    page.locator('.delete-entry').first.click()
    expect(page.locator('.entry')).to_have_count(0)
    assert not errors, errors
    browser.close()
    print('PASS: desktop/mobile journal create, reload persistence, mood chart, consent, missing-key error, handoff panel, export, delete, no JS errors or horizontal overflow.')
