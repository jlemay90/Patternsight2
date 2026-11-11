import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import engine
from server import Store, create_handler


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.entries = [{'id': 'one', 'text': 'A walk helped me settle.'}]

    def test_exact_quotes_accepted_but_fabrications_rejected(self):
        result = {
            'answer': 'You mentioned a walk.',
            'evidence': [{'entry_id': 'one', 'quote': 'A walk helped'}],
        }
        engine.validate_result(result, 'chat', self.entries)
        for evidence in [
            [{'entry_id': 'missing', 'quote': 'A walk'}],
            [{'entry_id': 'one', 'quote': 'I am cured'}],
            [{'entry_id': 'one', 'quote': ''}],
        ]:
            with self.assertRaises(ValueError):
                engine.validate_result({'answer': 'Answer', 'evidence': evidence}, 'chat', self.entries)

    def test_sparse_history_can_return_no_insights(self):
        self.assertEqual(
            engine.validate_result({'summary': 'Insufficient evidence.', 'insights': []}, 'analyze', self.entries)[
                'insights'
            ],
            [],
        )

    def test_insight_requires_evidence_and_quota_is_bounded(self):
        insight = {k: 'test' for k in ['title', 'observation', 'alternative', 'question', 'experiment']}
        insight.update(strength='low', evidence=[])
        with self.assertRaises(ValueError):
            engine.validate_result({'summary': 'Summary', 'insights': [insight]}, 'analyze', self.entries)
        insight['evidence'] = [{'entry_id': 'one', 'quote': 'walk'}]
        with self.assertRaises(ValueError):
            engine.validate_result({'summary': 'Summary', 'insights': [insight] * 4}, 'analyze', self.entries)

    def test_missing_key_is_explicit(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}):
            with self.assertRaisesRegex(engine.ProviderError, 'not connected'):
                engine.generate('analyze', self.entries, [])

    def test_provider_request_contract_and_response_validation(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def read(self):
                return json.dumps({
                    'candidates': [
                        {
                            'finishReason': 'STOP',
                            'content': {'parts': [{'text': json.dumps({'summary': 'Sparse', 'insights': []})}]},
                        }
                    ]
                }).encode()

        with (
            patch.dict(os.environ, {'GEMINI_API_KEY': 'synthetic-test-key'}),
            patch('urllib.request.urlopen', return_value=Response()) as call,
        ):
            self.assertEqual(engine.generate('analyze', self.entries, [])['insights'], [])
            request = call.call_args.args[0]
            payload = json.loads(request.data)
            self.assertIn('systemInstruction', payload)
            self.assertEqual(payload['generationConfig']['responseMimeType'], 'application/json')
            self.assertNotIn('synthetic-test-key', request.full_url)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'test.sqlite3'
        self.store = Store(self.path)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), create_handler(self.store))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, body=None, headers=None):
        request = urllib.request.Request(
            self.url + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type': 'application/json', **(headers or {})},
        )
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def add(self, text='A synthetic reflection.', mood=3, tags=None):
        status, payload = self.request(
            '/api/entries', {'text': text, 'mood': mood, 'tags': tags if tags is not None else ['test']}
        )
        self.assertEqual(status, 201)
        return self.store.entries()[0]

    def test_entry_survives_new_store_and_exports(self):
        entry = self.add('<script>alert("text only")</script>')
        self.assertEqual(Store(self.path).entries()[0]['text'], entry['text'])
        status, export = self.request('/api/export')
        self.assertEqual(status, 200)
        self.assertEqual(export['entries'][0]['id'], entry['id'])
        self.assertNotIn('GEMINI_API_KEY', json.dumps(export))

    def test_invalid_inputs_and_cross_origin_rejected(self):
        for body in [
            {'text': ' '},
            {'text': 'a', 'mood': True},
            {'text': 'a', 'mood': 6},
            {'text': 'a', 'tags': ['a' * 31]},
        ]:
            self.assertEqual(self.request('/api/entries', body)[0], 400)
        self.assertEqual(self.request('/api/entries', {'text': 'a'}, {'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/api/state', headers={'Host': 'evil.example'})[0], 403)

    def test_consent_and_missing_key(self):
        self.add()
        self.assertEqual(self.request('/api/analyze', {})[0], 400)
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}):
            status, result = self.request('/api/analyze', {'consent': True})
        self.assertEqual(status, 502)
        self.assertIn('not connected', result['error'])
        self.assertIsNone(self.store.latest())

    def test_feedback_is_passed_forward_and_delete_clears_derivatives(self):
        entry = self.add()
        insight = {k: 'Synthetic hypothesis' for k in ['title', 'observation', 'alternative', 'question', 'experiment']}
        insight.update(strength='low', evidence=[{'entry_id': entry['id'], 'quote': 'synthetic'}])
        with patch('engine.generate', return_value={'summary': 'Test', 'insights': [insight]}):
            status, analysis = self.request('/api/analyze', {'consent': True})
        self.assertEqual(status, 200)
        self.assertEqual(
            self.request(
                '/api/feedback',
                {'insight_id': analysis['insights'][0]['id'], 'rating': 'doesnt-fit', 'note': 'Another explanation'},
            )[0],
            200,
        )
        with patch('engine.generate', return_value={'answer': 'Uncertain.', 'evidence': []}) as generate:
            self.assertEqual(self.request('/api/chat', {'consent': True, 'question': 'What helps?'})[0], 200)
            self.assertEqual(generate.call_args.args[2][0]['note'], 'Another explanation')
        self.request('/api/delete', {'id': entry['id']})
        self.assertEqual(self.store.entries(), [])
        self.assertIsNone(self.store.latest())
        self.assertEqual(self.store.feedback(), [])

    def test_edit_entry_updates_text_and_clears_stale_derivatives(self):
        entry = self.add('Original reflection text.', mood=3, tags=['initial'])
        insight = {k: 'Synthetic hypothesis' for k in ['title', 'observation', 'alternative', 'question', 'experiment']}
        insight.update(strength='low', evidence=[{'entry_id': entry['id'], 'quote': 'Original'}])
        with patch('engine.generate', return_value={'summary': 'Test', 'insights': [insight]}):
            self.assertEqual(self.request('/api/analyze', {'consent': True})[0], 200)
        self.assertIsNotNone(self.store.latest())

        status, edit_res = self.request(
            '/api/edit',
            {'id': entry['id'], 'text': 'Updated reflection text after rethinking.', 'mood': 4, 'tags': ['updated']},
        )
        self.assertEqual(status, 200)
        self.assertTrue(edit_res['analysis_cleared'])
        updated_entry = self.store.entries()[0]
        self.assertEqual(updated_entry['text'], 'Updated reflection text after rethinking.')
        self.assertEqual(updated_entry['mood'], 4)
        self.assertEqual(updated_entry['tags'], ['updated'])
        self.assertIsNone(self.store.latest())

    def test_local_deterministic_insights_and_no_evidence_chat(self):
        self.add('Monday: A walk helped me settle after work.', mood=4, tags=['walk', 'work'])
        self.add('Wednesday: I walked but stayed frustrated after a conflict.', mood=2, tags=['walk', 'conflict'])

        status, analysis = self.request('/api/local-analyze', {})
        self.assertEqual(status, 200)
        self.assertTrue(1 <= len(analysis['insights']) <= 3)
        self.assertIn('Counterexample', analysis['insights'][0]['alternative'])

        status, chat_found = self.request('/api/local-chat', {'question': 'When did a walk help me settle?'})
        self.assertEqual(status, 200)
        self.assertTrue(len(chat_found['evidence']) > 0)

        status, chat_empty = self.request(
            '/api/local-chat', {'question': 'What does my journal say about scuba diving in Antarctica?'}
        )
        self.assertEqual(status, 200)
        self.assertEqual(chat_empty['evidence'], [])
        self.assertIn('no evidence', chat_empty['answer'].lower())

    def test_context_is_bounded_and_old_analysis_survives_provider_failure(self):
        for n in range(8):
            self.add(str(n) + 'x' * 9998)
        self.assertLessEqual(sum(len(e['text']) for e in self.store.context()), 60000)
        with patch('engine.generate', return_value={'summary': 'Earlier', 'insights': []}):
            self.request('/api/analyze', {'consent': True})
        with patch('engine.generate', side_effect=engine.ProviderError('Synthetic outage')):
            self.assertEqual(self.request('/api/analyze', {'consent': True})[0], 502)
        self.assertEqual(self.store.latest()['summary'], 'Earlier')

    def test_changed_context_during_generation_is_rejected(self):
        self.add()

        def changed(*args):
            with self.store.connect() as db:
                db.execute('DELETE FROM entries')
            return {'summary': 'Must not save', 'insights': []}

        with patch('engine.generate', side_effect=changed):
            self.assertEqual(self.request('/api/analyze', {'consent': True})[0], 409)
        self.assertIsNone(self.store.latest())


if __name__ == '__main__':
    unittest.main()
