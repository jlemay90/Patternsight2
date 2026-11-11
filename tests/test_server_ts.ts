import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/server/store.ts';
import {
  ProviderError,
  validateResult,
  generateLocalDeterministic,
  JournalEntry,
} from '../src/server/engine.ts';
import { createApiApp } from '../src/server/app.ts';

async function jsonRequest(
  baseUrl: string,
  routePath: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${routePath}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

async function runTests() {
  console.log('Running TypeScript server & evidence contract tests...');

  // 1. Contract validation tests
  const sampleEntries: JournalEntry[] = [
    {
      id: 'entry-1',
      text: 'Monday: A walk helped me settle after work.',
      mood: 4,
      tags: ['walk', 'work'],
      created_at: new Date().toISOString(),
    },
    {
      id: 'entry-2',
      text: 'Wednesday: I walked but stayed frustrated after a conflict.',
      mood: 2,
      tags: ['walk', 'conflict'],
      created_at: new Date().toISOString(),
    },
  ];

  // Exact quote succeeds
  validateResult(
    {
      answer: 'You mentioned a walk helped you settle.',
      evidence: [{ entry_id: 'entry-1', quote: 'A walk helped me settle' }],
    },
    'chat',
    sampleEntries
  );

  // Fabricated quote is rejected
  assert.throws(() => {
    validateResult(
      {
        answer: 'Fabricated quote test',
        evidence: [{ entry_id: 'entry-1', quote: 'I never wrote this sentence' }],
      },
      'chat',
      sampleEntries
    );
  }, /Evidence quote does not match source/);

  // Unknown entry ID is rejected
  assert.throws(() => {
    validateResult(
      {
        answer: 'Unknown ID test',
        evidence: [{ entry_id: 'missing-id', quote: 'A walk' }],
      },
      'chat',
      sampleEntries
    );
  }, /Unknown evidence entry/);

  // Sparse zero-insight analysis is accepted
  const sparse = validateResult(
    { summary: 'Sparse history; no recurring pattern yet.', insights: [] },
    'analyze',
    sampleEntries
  );
  assert.equal((sparse as { insights: unknown[] }).insights.length, 0);

  // Local deterministic analysis produces exact quotes and counterexample
  const localAnalysis = generateLocalDeterministic('analyze', sampleEntries, []) as {
    insights: Array<{ alternative: string; counterexample?: string }>;
  };
  assert.ok(localAnalysis.insights.length >= 1 && localAnalysis.insights.length <= 3);
  assert.match(localAnalysis.insights[0].alternative, /Counterexample/i);

  // Local deterministic chat clearly states when journal has no evidence
  const noEvidenceChat = generateLocalDeterministic(
    'chat',
    sampleEntries,
    [],
    'What does my journal say about learning astrophysics in Geneva?'
  );
  assert.equal((noEvidenceChat as { evidence: unknown[] }).evidence.length, 0);
  assert.match((noEvidenceChat as { answer: string }).answer, /do not contain direct evidence/i);

  // 2. Express API + SQLite Store integration tests
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patternsight-ts-test-'));
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const store = new Store(dbPath);

  let mockGenerateCalls = 0;
  let observedFeedbackNotes: string[] = [];

  const app = createApiApp(store, {
    rootDir: process.cwd(),
    generateFn: async (mode, entries, feedback) => {
      mockGenerateCalls++;
      observedFeedbackNotes = feedback.map((f) => f.note);
      if (mode === 'chat') {
        return validateResult(
          {
            answer: 'Grounded answer from mocked Gemini.',
            evidence: [{ entry_id: entries[0].id, quote: entries[0].text.slice(0, 10) }],
          },
          'chat',
          entries
        );
      }
      return validateResult(
        {
          summary: 'Mocked Gemini analysis summary.',
          insights: [
            {
              title: 'Tested pattern',
              observation: 'Cautious observation.',
              alternative: 'Alternative explanation and counterexample.',
              question: 'Question to sit with?',
              experiment: 'Small optional experiment.',
              strength: 'low',
              evidence: [{ entry_id: entries[0].id, quote: entries[0].text.slice(0, 10) }],
            },
          ],
        },
        'analyze',
        entries
      );
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Reject cross-origin requests from evil origin
    const evilRes = await jsonRequest(
      baseUrl,
      '/api/entries',
      { text: 'Should fail' },
      { Origin: 'https://evil.example' }
    );
    assert.equal(evilRes.status, 403);

    // Create entry
    const createRes = await jsonRequest(baseUrl, '/api/entries', {
      text: 'Monday: A walk outside helped me settle after work.',
      mood: 4,
      tags: ['walk', 'work'],
    });
    assert.equal(createRes.status, 201);
    const entryId = createRes.data.id as string;
    assert.ok(entryId);

    // Edit entry
    const editRes = await jsonRequest(baseUrl, '/api/edit', {
      id: entryId,
      text: 'Monday: A brisk walk outside helped me settle after work.',
      mood: 5,
      tags: ['walk', 'work', 'energy'],
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.data.updated, true);

    // Verify state
    const stateRes = await jsonRequest(baseUrl, '/api/state');
    assert.equal(stateRes.status, 200);
    const entries = stateRes.data.entries as JournalEntry[];
    assert.equal(entries.length, 1);
    assert.equal(entries[0].mood, 5);
    assert.deepEqual(entries[0].tags, ['walk', 'work', 'energy']);

    // Consent required before /api/analyze
    const noConsentRes = await jsonRequest(baseUrl, '/api/analyze', {});
    assert.equal(noConsentRes.status, 400);

    // Run mocked Gemini analysis
    const analyzeRes = await jsonRequest(baseUrl, '/api/analyze', { consent: true });
    assert.equal(analyzeRes.status, 200);
    const insights = (analyzeRes.data.insights as Array<{ id: string }>) || [];
    assert.equal(insights.length, 1);

    // Save user correction feedback
    const fbRes = await jsonRequest(baseUrl, '/api/feedback', {
      insight_id: insights[0].id,
      rating: 'partly',
      note: 'Stepping away from screens mattered most.',
    });
    assert.equal(fbRes.status, 200);

    // Verify feedback is passed to subsequent chat request
    const chatRes = await jsonRequest(baseUrl, '/api/chat', {
      consent: true,
      question: 'What helped me settle?',
    });
    assert.equal(chatRes.status, 200);
    assert.ok(observedFeedbackNotes.includes('Stepping away from screens mattered most.'));
    assert.ok(mockGenerateCalls >= 2);

    // Verify local deterministic chat no-evidence response
    const localNoEv = await jsonRequest(baseUrl, '/api/local-chat', {
      question: 'What does my journal say about quantum computing?',
    });
    assert.equal(localNoEv.status, 200);
    assert.equal(localNoEv.data.has_evidence, false);
    assert.equal((localNoEv.data.evidence as unknown[]).length, 0);

    // Delete entry clears analyses and feedback
    const delRes = await jsonRequest(baseUrl, '/api/delete', { id: entryId });
    assert.equal(delRes.status, 200);
    const afterDelState = await jsonRequest(baseUrl, '/api/state');
    assert.equal((afterDelState.data.entries as unknown[]).length, 0);
    assert.equal(afterDelState.data.analysis, null);
    assert.equal((afterDelState.data.feedback as unknown[]).length, 0);

    console.log('PASS: All TypeScript server, SQLite store, and evidence contract tests passed.');
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
