"""Versioned Gemini contract and deterministic, testable evidence validation."""
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
PROMPT_VERSION = 'reflect-v1'

EVIDENCE = {
    'type': 'OBJECT',
    'properties': {
        'entry_id': {'type': 'STRING'},
        'quote': {'type': 'STRING'},
    },
    'required': ['entry_id', 'quote'],
}

INSIGHT = {
    'type': 'OBJECT',
    'properties': {
        **{k: {'type': 'STRING'} for k in ['title', 'observation', 'alternative', 'question', 'experiment']},
        'counterexample': {'type': 'STRING'},
        'strength': {'type': 'STRING', 'enum': ['low', 'medium']},
        'evidence': {'type': 'ARRAY', 'items': EVIDENCE},
    },
    'required': ['title', 'observation', 'alternative', 'question', 'experiment', 'strength', 'evidence'],
}

SCHEMAS = {
    'analyze': {
        'type': 'OBJECT',
        'properties': {
            'summary': {'type': 'STRING'},
            'insights': {'type': 'ARRAY', 'items': INSIGHT, 'maxItems': 3},
        },
        'required': ['summary', 'insights'],
    },
    'chat': {
        'type': 'OBJECT',
        'properties': {
            'answer': {'type': 'STRING'},
            'evidence': {'type': 'ARRAY', 'items': EVIDENCE},
        },
        'required': ['answer', 'evidence'],
    },
}


class ProviderError(Exception):
    pass


def check_text(obj, key, maximum=8000):
    value = obj.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f'Invalid {key}')


def validate_evidence(evidence, entries, required=False):
    if not isinstance(evidence, list) or len(evidence) > 30 or (required and not evidence):
        raise ValueError('Invalid evidence list')
    lookup = {e['id']: e['text'] for e in entries}
    for item in evidence:
        if not isinstance(item, dict):
            raise ValueError('Invalid evidence')
        if not isinstance(item.get('entry_id'), str) or item['entry_id'] not in lookup:
            raise ValueError('Unknown evidence entry')
        quote = item.get('quote')
        if not isinstance(quote, str) or not quote.strip() or quote not in lookup[item['entry_id']]:
            raise ValueError('Evidence quote does not match source')


def validate_result(result, mode, entries):
    if not isinstance(result, dict):
        raise ValueError('Expected an object')
    if mode == 'chat':
        check_text(result, 'answer')
        validate_evidence(result.get('evidence'), entries)
    else:
        check_text(result, 'summary')
        insights = result.get('insights')
        if not isinstance(insights, list) or len(insights) > 3:
            raise ValueError('Expected zero to three insights')
        for item in insights:
            if not isinstance(item, dict):
                raise ValueError('Invalid insight')
            for key in ['title', 'observation', 'alternative', 'question', 'experiment']:
                check_text(item, key, 3000)
            if 'counterexample' in item and item['counterexample'] is not None:
                if not isinstance(item['counterexample'], str) or len(item['counterexample']) > 3000:
                    raise ValueError('Invalid counterexample')
            if item.get('strength') not in ('low', 'medium'):
                raise ValueError('Invalid strength')
            validate_evidence(item.get('evidence'), entries, required=True)
    return result


def is_api_key_configured():
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    return bool(key and key not in ('MY_GEMINI_API_KEY', 'YOUR_API_KEY'))


def generate(mode, entries, feedback, question=''):
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    model = os.environ.get('GEMINI_MODEL', 'gemini-3.8-flash').strip() or 'gemini-3.8-flash'
    if not is_api_key_configured():
        raise ProviderError('AI is not connected. Set GEMINI_API_KEY in .env and restart the server.')
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+', model):
        raise ProviderError('Invalid GEMINI_MODEL configuration.')
    context = {'task': mode, 'entries': entries, 'owner_feedback': feedback, 'question': question}
    payload = {
        'systemInstruction': {'parts': [{'text': (ROOT / 'prompts/reflect-v1.txt').read_text()}]},
        'contents': [{'role': 'user', 'parts': [{'text': json.dumps(context)}]}],
        'generationConfig': {
            'temperature': 0.2,
            'maxOutputTokens': 8192,
            'responseMimeType': 'application/json',
            'responseSchema': SCHEMAS[mode],
        },
    }
    request = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'x-goog-api-key': key},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=55) as response:
            body = json.load(response)
        candidate = body['candidates'][0]
        if candidate.get('finishReason') != 'STOP':
            raise ProviderError('The model did not finish its response. Try a smaller context or another model.')
        raw = ''.join(p.get('text', '') for p in candidate['content']['parts'] if not p.get('thought'))
        return validate_result(json.loads(raw), mode, entries)
    except urllib.error.HTTPError as exc:
        # Never return provider bodies: they may echo private text or credentials.
        raise ProviderError(
            f'Google returned HTTP {exc.code}. Check the model, API key and quota; your entries remain saved.'
        ) from None
    except (urllib.error.URLError, TimeoutError):
        raise ProviderError('Google could not be reached. Your entries remain saved; try again later.') from None
    except (KeyError, IndexError, TypeError, ValueError):
        raise ProviderError(
            'The model response failed structure or exact-quote checks. No new analysis was saved.'
        ) from None


def _extract_exact_quote(text, keywords):
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+|\n+', text) if s.strip()]
    for s in sentences:
        lower = s.lower()
        if any(k.lower() in lower for k in keywords) and s in text:
            return s[:220].strip() if len(s) > 240 else s
    first = sentences[0] if sentences else text.strip()
    candidate = first[:200].strip() if len(first) > 240 else first
    return candidate if candidate and candidate in text else text[:min(len(text), 120)]


def generate_local_deterministic(mode, entries, feedback, question=''):
    """Deterministic local evidence and counterexample inspector using exact-quote validation."""
    if mode == 'chat':
        q = question.strip()
        lower_q = q.lower()
        stop_words = {
            'what', 'when', 'where', 'which', 'who', 'why', 'how', 'does', 'did', 'do',
            'is', 'are', 'was', 'were', 'have', 'has', 'had', 'my', 'me', 'i', 'you',
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
            'with', 'about', 'from', 'seem', 'seems', 'connected', 'pattern', 'entries',
            'entry', 'journal', 'feel', 'felt', 'help', 'helped', 'helps',
        }
        tokens = [
            t for t in re.sub(r'[^a-z0-9\s-]', ' ', lower_q).split()
            if len(t) >= 3 and t not in stop_words
        ]
        search_terms = set(tokens)
        if re.search(r'\b(calm|calmer|ease|settle|settled|help|helped|helps|better|good|energy)\b', lower_q):
            search_terms.update(['walk', 'helped', 'settle', 'settled', 'calmer', 'calm', 'good', 'energy', 'rest', 'break'])
        if re.search(r'\b(frustrat|stress|tense|hard|drain|tired|low|off|conflict)\b', lower_q):
            search_terms.update(['frustrated', 'tired', 'conflict', 'unclear', 'expectations', 'poor', 'sleep'])

        evidence = []
        for entry in entries:
            lower_text = entry['text'].lower()
            lower_tags = [t.lower() for t in entry.get('tags', [])]
            matched_terms = [
                term for term in search_terms
                if term in lower_text or any(term in tag for tag in lower_tags)
            ]
            if matched_terms:
                quote = _extract_exact_quote(entry['text'], matched_terms)
                if quote and quote in entry['text']:
                    evidence.append({'entry_id': entry['id'], 'quote': quote})

        if not evidence:
            result = {
                'answer': (
                    f'Your journal has no evidence addressing "{q}" across the {len(entries)} '
                    'reflection(s) in the selected context. PatternSight does not guess beyond your verbatim text.'
                ),
                'evidence': [],
                'has_evidence': False,
                'source': 'local-deterministic',
            }
            return validate_result(result, 'chat', entries)

        bounded = evidence[:6]
        result = {
            'answer': (
                f'Found {len(bounded)} exact quote(s) in your {len(entries)} bounded reflection(s) related '
                'to your question (local deterministic quote search). Review the linked evidence below; '
                'co-occurrence is a starting point to explore, not a proven cause.'
            ),
            'evidence': bounded,
            'has_evidence': True,
            'source': 'local-deterministic',
        }
        return validate_result(result, 'chat', entries)

    if len(entries) < 2:
        return validate_result(
            {
                'summary': (
                    f'Only {len(entries)} reflection is in the selected context. At least two entries '
                    'are preferred before proposing a recurring hypothesis.'
                ),
                'insights': [],
                'source': 'local-deterministic',
            },
            'analyze',
            entries,
        )

    themes = [
        (
            'Stepping away, walks, and physical breaks',
            ['walk', 'walked', 'walking', 'outside', 'break', 'stretch', 'movement'],
            'Stepping away from demands may explain the shift more than movement alone, and high-conflict situations can override a short break.',
            'When a break helps versus when tension stays, what happened right before you stepped away?',
            'Take two 10-minute unscheduled breaks this week and jot one sentence about whether the transition felt different.',
        ),
        (
            'Work structure, expectations, and friction',
            ['work', 'unclear', 'expectations', 'conflict', 'frustrated', 'meeting', 'deadline'],
            'Time of day or cumulative fatigue may co-occur with work frustration without a single root cause.',
            'Which moments of frustration came from workload volume versus unclear expectations?',
            'Before starting one ambiguous task, write down a single concrete definition of "done for today".',
        ),
        (
            'Sleep quality, rest, and energy carry-over',
            ['sleep', 'slept', 'tired', 'rest', 'exhausted', 'fatigue'],
            'Daytime pressures or unclear expectations often shape energy just as strongly as hours slept.',
            'On days when you feel drained despite decent sleep, what else is asking for your attention?',
            'Note your rough morning energy alongside one phrase about daytime clarity for three days.',
        ),
    ]

    rejected = ' '.join(
        f"{f.get('note', '')} {f.get('insight', '')}".lower()
        for f in feedback
        if f.get('rating') == 'doesnt-fit'
    )

    insights = []
    for title, keywords, alt, question_txt, exp_txt in themes:
        if 'sleep' in title.lower() and 'sleep' in rejected:
            continue
        matching = [
            e for e in entries
            if any(k in e['text'].lower() for k in keywords)
            or any(k in [t.lower() for t in e.get('tags', [])] for k in keywords)
        ]
        if len(matching) >= 2:
            ev = [
                {'entry_id': e['id'], 'quote': _extract_exact_quote(e['text'], keywords)}
                for e in matching[:3]
            ]
            counter = [
                e for e in matching
                if (e.get('mood') is not None and e.get('mood') <= 2)
                or re.search(r'\b(but|stayed frustrated|conflict|frustrated|tired)\b', e['text'].lower())
            ]
            ce_note = (
                f'Counterexample in entries: "{_extract_exact_quote(counter[0]["text"], keywords)}"'
                if counter
                else 'No direct counterexample recorded yet in this small sample.'
            )
            insights.append({
                'title': title,
                'observation': f'Appears across {len(matching)} of {len(entries)} recent entries as a cautious hypothesis to test.',
                'strength': 'medium' if len(matching) >= 3 else 'low',
                'evidence': ev,
                'alternative': f'{alt} {ce_note}',
                'counterexample': ce_note,
                'question': question_txt,
                'experiment': exp_txt,
            })
        if len(insights) >= 3:
            break

    return validate_result(
        {
            'summary': f'Inspected {len(entries)} entries locally (deterministic exact-quote mode). Found {len(insights)} hypothesis/hypotheses.',
            'insights': insights[:3],
            'source': 'local-deterministic',
        },
        'analyze',
        entries,
    )
