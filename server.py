"""Local single-user app. Run: python server.py (Python 3.10+)."""
import argparse
import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import engine

ROOT = Path(__file__).parent


def load_env():
    path = ROOT / '.env'
    if path.exists():
        for line in path.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path):
        self.path = str(path)
        self.lock = threading.RLock()
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS entries (
                  id TEXT PRIMARY KEY, text TEXT NOT NULL, mood INTEGER,
                  tags TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS analyses (
                  id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS feedback (
                  insight_id TEXT PRIMARY KEY, rating TEXT NOT NULL, note TEXT NOT NULL,
                  insight TEXT NOT NULL, created_at TEXT NOT NULL);
                PRAGMA user_version=1;
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def entries(self):
        with self.connect() as db:
            rows = db.execute('SELECT * FROM entries ORDER BY created_at DESC, id DESC').fetchall()
        return [{**dict(r), 'tags': json.loads(r['tags'])} for r in rows]

    def feedback(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute('SELECT * FROM feedback ORDER BY created_at DESC')]

    def latest(self):
        with self.connect() as db:
            row = db.execute('SELECT payload FROM analyses ORDER BY created_at DESC LIMIT 1').fetchone()
        return json.loads(row['payload']) if row else None

    def context(self):
        # Honest bounded context, shared by analysis and chat. Recent entries only.
        selected, chars = [], 0
        for entry in self.entries()[:60]:
            size = len(entry['text'])
            if chars + size > 60000:
                break
            selected.append(entry)
            chars += size
        return list(reversed(selected))


def _validate_entry_fields(data):
    text = data.get('text')
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 10000:
        raise ValueError('Write between 1 and 10,000 characters.')
    mood = data.get('mood')
    if mood is not None and (type(mood) is not int or not 1 <= mood <= 5):
        raise ValueError('Mood must be 1–5 or empty.')
    tags = data.get('tags', [])
    if (
        not isinstance(tags, list)
        or len(tags) > 8
        or any(not isinstance(t, str) or not 1 <= len(t.strip()) <= 30 for t in tags)
    ):
        raise ValueError('Use up to eight tags of 1–30 characters.')
    return text.strip(), mood, [t.strip() for t in tags]


def create_handler(store):
    ai_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send(self, status, payload, content_type='application/json'):
            body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            self.send_response(status)
            self.send_header('Content-Type', f'{content_type}; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header(
                'Content-Security-Policy',
                "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
            )
            self.end_headers()
            self.wfile.write(body)

        def allowed(self):
            host = self.headers.get('Host', '')
            # Local loopback-only service; reject DNS rebinding host names.
            hostname = urlparse('http://' + host).hostname
            if hostname not in {'localhost', '127.0.0.1', '::1'}:
                self.send(403, {'error': 'Local access only.'})
                return False
            origin = self.headers.get('Origin')
            if origin and origin not in {'http://' + host, 'https://' + host}:
                self.send(403, {'error': 'Cross-origin requests are not allowed.'})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            path = urlparse(self.path).path
            if path == '/api/state':
                context = store.context()
                self.send(
                    200,
                    {
                        'entries': store.entries(),
                        'analysis': store.latest(),
                        'feedback': store.feedback(),
                        'ai_connected': engine.is_api_key_configured(),
                        'model': os.environ.get('GEMINI_MODEL', 'gemini-3.8-flash'),
                        'context_count': len(context),
                        'context_chars': sum(len(e['text']) for e in context),
                        'prompt_version': engine.PROMPT_VERSION,
                    },
                )
            elif path == '/api/export':
                self.send(
                    200,
                    {
                        'format_version': 1,
                        'exported_at': now(),
                        'entries': store.entries(),
                        'analysis': store.latest(),
                        'feedback': store.feedback(),
                    },
                )
            elif path == '/api/continuity':
                names = ['AGENT-HANDOFF.md', 'NEXT-AGENT-PROMPT.txt', 'TEST-REPORT.md']
                self.send(
                    200,
                    {
                        n: (ROOT / n).read_text() if (ROOT / n).exists() else 'Foundation in progress.'
                        for n in names
                    },
                )
            elif path == '/api/fixtures':
                fixture_path = ROOT / 'fixtures/reflection-cases.json'
                payload = json.loads(fixture_path.read_text()) if fixture_path.exists() else {'cases': []}
                self.send(200, payload)
            elif path in ['/', '/app.js', '/style.css']:
                filename = {'/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css'}[path]
                mime = {'/': 'text/html', '/app.js': 'text/javascript', '/style.css': 'text/css'}[path]
                self.send(200, (ROOT / 'static' / filename).read_bytes(), mime)
            else:
                self.send(404, {'error': 'Not found.'})

        def do_POST(self):
            if not self.allowed():
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 100000:
                    raise ValueError('Request must be between 1 and 100,000 bytes.')
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('Send application/json.')
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError('Expected a JSON object.')
                path = urlparse(self.path).path
                if path in ['/api/analyze', '/api/chat', '/api/local-analyze', '/api/local-chat']:
                    self.mutate(path, data)
                else:
                    with store.lock:
                        self.mutate(path, data)
            except (ValueError, TypeError, UnicodeError) as exc:
                self.send(400, {'error': str(exc)[:200]})
            except engine.ProviderError as exc:
                self.send(502, {'error': str(exc)})
            except sqlite3.Error:
                self.send(500, {'error': 'Local storage operation failed. Check disk space and permissions.'})

        def mutate(self, path, data):
            if path == '/api/entries':
                text, mood, tags = _validate_entry_fields(data)
                entry_id = str(uuid.uuid4())
                with store.connect() as db:
                    db.execute(
                        'INSERT INTO entries VALUES (?,?,?,?,?)',
                        (entry_id, text, mood, json.dumps(tags), now()),
                    )
                self.send(201, {'saved': True, 'id': entry_id})
            elif path == '/api/edit':
                entry_id = str(data.get('id', '')).strip()
                if not entry_id:
                    raise ValueError('Entry ID is required.')
                text, mood, tags = _validate_entry_fields(data)
                with store.connect() as db:
                    row = db.execute('SELECT text FROM entries WHERE id=?', (entry_id,)).fetchone()
                    if not row:
                        raise ValueError('Entry not found.')
                    text_changed = row['text'] != text
                    db.execute(
                        'UPDATE entries SET text=?, mood=?, tags=? WHERE id=?',
                        (text, mood, json.dumps(tags), entry_id),
                    )
                    if text_changed:
                        db.execute('DELETE FROM analyses')
                        db.execute('DELETE FROM feedback')
                self.send(200, {'updated': True, 'id': entry_id, 'analysis_cleared': text_changed})
            elif path == '/api/delete':
                with store.connect() as db:
                    db.execute('DELETE FROM entries WHERE id=?', (str(data.get('id', '')),))
                    # Remove derived text and corrections that could quote deleted entries.
                    db.execute('DELETE FROM analyses')
                    db.execute('DELETE FROM feedback')
                self.send(200, {'deleted': True})
            elif path == '/api/feedback':
                analysis = store.latest() or {'insights': []}
                insight = next(
                    (i for i in analysis['insights'] if i['id'] == data.get('insight_id')), None
                )
                if not insight or data.get('rating') not in ['fits', 'partly', 'doesnt-fit']:
                    raise ValueError('Choose a current insight and valid rating.')
                note = data.get('note', '')
                if not isinstance(note, str) or len(note) > 2000:
                    raise ValueError('Correction must be at most 2,000 characters.')
                with store.connect() as db:
                    db.execute(
                        'INSERT OR REPLACE INTO feedback VALUES (?,?,?,?,?)',
                        (insight['id'], data['rating'], note, json.dumps(insight), now()),
                    )
                self.send(200, {'saved': True})
            elif path in ['/api/local-analyze', '/api/local-chat']:
                with store.lock:
                    entries = store.context()
                    feedback = store.feedback()[:30]
                if not entries:
                    raise ValueError('Save an entry first.')
                question = data.get('question', '')
                if path == '/api/local-chat' and (
                    not isinstance(question, str) or not 1 <= len(question.strip()) <= 2000
                ):
                    raise ValueError('Ask a question of 1–2,000 characters.')
                mode = 'analyze' if path.endswith('analyze') else 'chat'
                result = engine.generate_local_deterministic(mode, entries, feedback, question)
                with store.lock:
                    result.update({
                        'created_at': now(),
                        'entry_ids': [e['id'] for e in entries],
                        'prompt_version': engine.PROMPT_VERSION,
                        'source': 'local-deterministic',
                    })
                    if mode == 'analyze':
                        for item in result['insights']:
                            item['id'] = str(uuid.uuid4())
                        with store.connect() as db:
                            db.execute(
                                'INSERT INTO analyses VALUES (?,?,?)',
                                (str(uuid.uuid4()), json.dumps(result), now()),
                            )
                    self.send(200, result)
            elif path in ['/api/analyze', '/api/chat']:
                if data.get('consent') is not True:
                    raise ValueError('Confirm sending the selected entries and saved corrections to Google.')
                with store.lock:
                    entries = store.context()
                    feedback = store.feedback()[:30]
                if not entries:
                    raise ValueError('Save an entry first.')
                question = data.get('question', '')
                if path == '/api/chat' and (
                    not isinstance(question, str) or not 1 <= len(question.strip()) <= 2000
                ):
                    raise ValueError('Ask a question of 1–2,000 characters.')
                if not ai_lock.acquire(blocking=False):
                    self.send(429, {'error': 'An AI request is already running. Please wait.'})
                    return
                try:
                    mode = 'analyze' if path.endswith('analyze') else 'chat'
                    result = engine.generate(mode, entries, feedback, question)
                    # A concurrent deletion or edit must never reintroduce private derived text.
                    with store.lock:
                        if (
                            [(e['id'], e['text']) for e in entries]
                            != [(e['id'], e['text']) for e in store.context()]
                            or feedback != store.feedback()[:30]
                        ):
                            self.send(
                                409,
                                {'error': 'Journal or feedback changed during analysis. Please try again.'},
                            )
                            return
                        result.update({
                            'created_at': now(),
                            'entry_ids': [e['id'] for e in entries],
                            'prompt_version': engine.PROMPT_VERSION,
                        })
                        if mode == 'analyze':
                            for item in result['insights']:
                                item['id'] = str(uuid.uuid4())
                            with store.connect() as db:
                                db.execute(
                                    'INSERT INTO analyses VALUES (?,?,?)',
                                    (str(uuid.uuid4()), json.dumps(result), now()),
                                )
                        self.send(200, result)
                finally:
                    ai_lock.release()
            else:
                self.send(404, {'error': 'Not found.'})

    return Handler


if __name__ == '__main__':
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8000')))
    parser.add_argument('--db', default=str(ROOT / 'data/patternsight.sqlite3'))
    args = parser.parse_args()
    httpd = ThreadingHTTPServer(('127.0.0.1', args.port), create_handler(Store(args.db)))
    print(f'PatternSight → http://127.0.0.1:{args.port}', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
