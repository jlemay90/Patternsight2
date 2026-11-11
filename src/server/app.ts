import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Request, Response, NextFunction } from 'express';
import { Store, nowIso } from './store.ts';
import {
  PROMPT_VERSION,
  ProviderError,
  AnalysisResult,
  ChatResult,
  JournalEntry,
  FeedbackItem,
  generate,
  generateLocalDeterministic,
  getConfiguredModel,
  isApiKeyConfigured,
  validateResult,
} from './engine.ts';

export interface AppOptions {
  rootDir?: string;
  generateFn?: (
    mode: 'analyze' | 'chat',
    entries: JournalEntry[],
    feedback: FeedbackItem[],
    question?: string,
    rootDir?: string
  ) => Promise<AnalysisResult | ChatResult>;
}

function validateEntryInput(data: Record<string, unknown>): {
  text: string;
  mood: number | null;
  tags: string[];
  created_at?: string;
} {
  const rawText = data.text;
  if (typeof rawText !== 'string' || rawText.trim().length < 1 || rawText.trim().length > 10000) {
    throw new Error('Write between 1 and 10,000 characters.');
  }
  const rawMood = data.mood ?? null;
  if (
    rawMood !== null &&
    (typeof rawMood !== 'number' || !Number.isInteger(rawMood) || rawMood < 1 || rawMood > 5)
  ) {
    throw new Error('Mood must be 1–5 or empty.');
  }
  const rawTags = data.tags ?? [];
  if (
    !Array.isArray(rawTags) ||
    rawTags.length > 8 ||
    rawTags.some((t) => typeof t !== 'string' || t.trim().length < 1 || t.trim().length > 30)
  ) {
    throw new Error('Use up to eight tags of 1–30 characters.');
  }
  let createdAt: string | undefined;
  if (data.created_at !== undefined && data.created_at !== null && data.created_at !== '') {
    if (typeof data.created_at !== 'string' || Number.isNaN(Date.parse(data.created_at))) {
      throw new Error('Provide a valid ISO timestamp.');
    }
    createdAt = new Date(data.created_at).toISOString();
  }
  return {
    text: rawText.trim(),
    mood: rawMood,
    tags: rawTags.map((t: string) => t.trim()),
    created_at: createdAt,
  };
}

export function createApiApp(store: Store, options: AppOptions = {}) {
  const rootDir = options.rootDir || process.cwd();
  const generateImpl = options.generateFn || generate;
  const app = express();
  let aiBusy = false;

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    // Reject cross-origin requests from untrusted origins
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const hostHeader = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
        const expectedHost = hostHeader.split(',')[0].trim().split(':')[0];
        const allowedOrigin =
          originUrl.hostname === expectedHost ||
          originUrl.hostname === 'localhost' ||
          originUrl.hostname === '127.0.0.1' ||
          originUrl.hostname.endsWith('.run.app') ||
          originUrl.hostname.endsWith('.google.com');
        if (!allowedOrigin) {
          res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
        return;
      }
    }
    next();
  });

  app.use(
    express.json({
      limit: '100kb',
      strict: false,
    })
  );

  app.get('/api/state', (_req: Request, res: Response) => {
    const entries = store.entries();
    const context = store.context();
    const contextChars = context.reduce((sum, e) => sum + e.text.length, 0);
    res.status(200).json({
      entries,
      analysis: store.latest(),
      feedback: store.feedback(),
      ai_connected: isApiKeyConfigured(),
      model: getConfiguredModel(),
      context_count: context.length,
      context_chars: contextChars,
      context_max_entries: 60,
      context_max_chars: 60000,
      prompt_version: PROMPT_VERSION,
    });
  });

  app.get('/api/export', (_req: Request, res: Response) => {
    res.status(200).json({
      format_version: 1,
      exported_at: nowIso(),
      entries: store.entries(),
      analysis: store.latest(),
      feedback: store.feedback(),
    });
  });

  app.get('/api/continuity', (_req: Request, res: Response) => {
    const names = [
      'AGENT-HANDOFF.md',
      'NEXT-AGENT-PROMPT.txt',
      'TEST-REPORT.md',
      'ARCHITECTURE.md',
      'PROJECT-OVERVIEW.md',
      'KNOWN-ISSUES.md',
      'REPOSITORY.md',
    ];
    const docs: Record<string, string> = {};
    for (const name of names) {
      const filePath = path.join(rootDir, name);
      docs[name] = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, 'utf-8')
        : 'Document not found.';
    }
    res.status(200).json(docs);
  });

  app.get('/api/fixtures', (_req: Request, res: Response) => {
    const fixturePath = path.join(rootDir, 'fixtures', 'reflection-cases.json');
    const raw = fs.existsSync(fixturePath)
      ? JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))
      : { purpose: 'Synthetic qualitative cases', cases: [] };

    // Run deterministic contract self-checks on the server
    const sampleEntries: JournalEntry[] = [
      {
        id: 'check-1',
        text: 'Monday: A walk helped me settle after work.',
        mood: 4,
        tags: ['walk', 'work'],
        created_at: nowIso(),
      },
      {
        id: 'check-2',
        text: 'Wednesday: I walked but stayed frustrated after a conflict.',
        mood: 2,
        tags: ['walk', 'conflict'],
        created_at: nowIso(),
      },
    ];

    const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
    try {
      validateResult(
        {
          answer: 'Grounded response citing exact substring.',
          evidence: [{ entry_id: 'check-1', quote: 'A walk helped me settle' }],
        },
        'chat',
        sampleEntries
      );
      checks.push({
        name: 'Exact quote acceptance',
        passed: true,
        detail: 'Exact verbatim substring with matching entry_id is accepted.',
      });
    } catch (e) {
      checks.push({ name: 'Exact quote acceptance', passed: false, detail: String(e) });
    }

    try {
      validateResult(
        {
          answer: 'Fabricated quote test',
          evidence: [{ entry_id: 'check-1', quote: 'This quote was never written' }],
        },
        'chat',
        sampleEntries
      );
      checks.push({ name: 'Fabricated quote rejection', passed: false, detail: 'Did not throw' });
    } catch {
      checks.push({
        name: 'Fabricated quote rejection',
        passed: true,
        detail: 'Non-matching quote is deterministically rejected before reaching storage or UI.',
      });
    }

    try {
      validateResult({ summary: 'Sparse history is valid.', insights: [] }, 'analyze', sampleEntries);
      checks.push({
        name: 'Sparse zero-insight allowance',
        passed: true,
        detail: 'Zero insights are accepted when evidence is sparse (no forced quota).',
      });
    } catch (e) {
      checks.push({ name: 'Sparse zero-insight allowance', passed: false, detail: String(e) });
    }

    res.status(200).json({
      ...raw,
      contract_checks: checks,
    });
  });

  app.post('/api/entries', (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new Error('Expected a JSON object.');
      }
      const validated = validateEntryInput(req.body as Record<string, unknown>);
      const id = crypto.randomUUID();
      store.addEntry(id, validated.text, validated.mood, validated.tags, validated.created_at);
      res.status(201).json({ saved: true, id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid request.';
      res.status(400).json({ error: msg.slice(0, 200) });
    }
  });

  app.post('/api/edit', (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new Error('Expected a JSON object.');
      }
      const body = req.body as Record<string, unknown>;
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) {
        throw new Error('Entry ID is required.');
      }
      const validated = validateEntryInput(body);
      const outcome = store.updateEntry(
        id,
        validated.text,
        validated.mood,
        validated.tags,
        validated.created_at
      );
      res.status(200).json({
        updated: outcome.updated,
        id,
        analysis_cleared: outcome.analysisCleared,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid request.';
      res.status(400).json({ error: msg.slice(0, 200) });
    }
  });

  app.post('/api/delete', (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new Error('Expected a JSON object.');
      }
      const id = String((req.body as Record<string, unknown>).id ?? '');
      store.deleteEntry(id);
      res.status(200).json({ deleted: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid request.';
      res.status(400).json({ error: msg.slice(0, 200) });
    }
  });

  app.post('/api/import', (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new Error('Expected a JSON object.');
      }
      const body = req.body as Record<string, unknown>;
      const rawEntries = body.entries;
      if (!Array.isArray(rawEntries) || rawEntries.length === 0 || rawEntries.length > 200) {
        throw new Error('Provide between 1 and 200 entries to import.');
      }
      const existingIds = new Set(store.entries().map((e) => e.id));
      let importedCount = 0;
      for (const item of rawEntries) {
        if (!item || typeof item !== 'object') {
          throw new Error('Invalid entry in import.');
        }
        const rec = item as Record<string, unknown>;
        const validated = validateEntryInput(rec);
        const id =
          typeof rec.id === 'string' && rec.id.trim() && !existingIds.has(rec.id.trim())
            ? rec.id.trim()
            : crypto.randomUUID();
        store.addEntry(id, validated.text, validated.mood, validated.tags, validated.created_at);
        existingIds.add(id);
        importedCount++;
      }
      res.status(200).json({ imported: importedCount });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Import failed.';
      res.status(400).json({ error: msg.slice(0, 200) });
    }
  });

  app.post('/api/feedback', (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new Error('Expected a JSON object.');
      }
      const body = req.body as Record<string, unknown>;
      const analysis = store.latest() || { summary: '', insights: [] };
      const insight = analysis.insights.find((i) => i.id === body.insight_id);
      const rating = body.rating;
      if (
        !insight ||
        !insight.id ||
        (rating !== 'fits' && rating !== 'partly' && rating !== 'doesnt-fit')
      ) {
        throw new Error('Choose a current insight and valid rating.');
      }
      const note = body.note ?? '';
      if (typeof note !== 'string' || note.length > 2000) {
        throw new Error('Correction must be at most 2,000 characters.');
      }
      store.saveFeedback(insight.id, rating, note, insight);
      res.status(200).json({ saved: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid feedback.';
      res.status(400).json({ error: msg.slice(0, 200) });
    }
  });

  app.post('/api/analyze', async (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new Error('Expected a JSON object.');
      }
      const body = req.body as Record<string, unknown>;
      if (body.consent !== true) {
        throw new Error('Confirm sending the selected entries and saved corrections to Google.');
      }
      const filterIds = Array.isArray(body.entry_ids)
        ? body.entry_ids.filter((id): id is string => typeof id === 'string')
        : undefined;
      const entries = store.context(filterIds);
      const feedback = store.feedback().slice(0, 30);
      if (entries.length === 0) {
        throw new Error('Save an entry first.');
      }
      if (aiBusy) {
        res.status(429).json({ error: 'An AI request is already running. Please wait.' });
        return;
      }
      aiBusy = true;
      try {
        const result = (await generateImpl(
          'analyze',
          entries,
          feedback,
          '',
          rootDir
        )) as AnalysisResult;

        // Verify concurrent deletion or edit did not happen during generation
        const currentEntries = store.context(filterIds);
        const currentFeedback = store.feedback().slice(0, 30);
        const beforeIds = entries.map((e) => `${e.id}:${e.text}`).join('|');
        const afterIds = currentEntries.map((e) => `${e.id}:${e.text}`).join('|');
        if (
          beforeIds !== afterIds ||
          JSON.stringify(feedback) !== JSON.stringify(currentFeedback)
        ) {
          res.status(409).json({
            error: 'Journal or feedback changed during analysis. Please try again.',
          });
          return;
        }

        result.created_at = nowIso();
        result.entry_ids = entries.map((e) => e.id);
        result.prompt_version = PROMPT_VERSION;
        result.source = 'gemini';
        for (const item of result.insights) {
          item.id = crypto.randomUUID();
        }
        store.saveAnalysis(crypto.randomUUID(), result, result.created_at);
        res.status(200).json(result);
      } finally {
        aiBusy = false;
      }
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        res.status(502).json({ error: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Request failed.';
      res.status(400).json({ error: msg.slice(0, 200) });
    }
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new Error('Expected a JSON object.');
      }
      const body = req.body as Record<string, unknown>;
      if (body.consent !== true) {
        throw new Error('Confirm sending the selected entries and saved corrections to Google.');
      }
      const filterIds = Array.isArray(body.entry_ids)
        ? body.entry_ids.filter((id): id is string => typeof id === 'string')
        : undefined;
      const entries = store.context(filterIds);
      const feedback = store.feedback().slice(0, 30);
      if (entries.length === 0) {
        throw new Error('Save an entry first.');
      }
      const question = body.question;
      if (
        typeof question !== 'string' ||
        question.trim().length < 1 ||
        question.trim().length > 2000
      ) {
        throw new Error('Ask a question of 1–2,000 characters.');
      }
      if (aiBusy) {
        res.status(429).json({ error: 'An AI request is already running. Please wait.' });
        return;
      }
      aiBusy = true;
      try {
        const result = (await generateImpl(
          'chat',
          entries,
          feedback,
          question.trim(),
          rootDir
        )) as ChatResult;

        const currentEntries = store.context(filterIds);
        const currentFeedback = store.feedback().slice(0, 30);
        const beforeIds = entries.map((e) => `${e.id}:${e.text}`).join('|');
        const afterIds = currentEntries.map((e) => `${e.id}:${e.text}`).join('|');
        if (
          beforeIds !== afterIds ||
          JSON.stringify(feedback) !== JSON.stringify(currentFeedback)
        ) {
          res.status(409).json({
            error: 'Journal or feedback changed during analysis. Please try again.',
          });
          return;
        }

        result.created_at = nowIso();
        result.entry_ids = entries.map((e) => e.id);
        result.prompt_version = PROMPT_VERSION;
        result.has_evidence = result.evidence.length > 0;
        result.source = 'gemini';
        res.status(200).json(result);
      } finally {
        aiBusy = false;
      }
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        res.status(502).json({ error: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Request failed.';
      res.status(400).json({ error: msg.slice(0, 200) });
    }
  });

  app.post('/api/local-analyze', (req: Request, res: Response) => {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<
        string,
        unknown
      >;
      const filterIds = Array.isArray(body.entry_ids)
        ? body.entry_ids.filter((id): id is string => typeof id === 'string')
        : undefined;
      const entries = store.context(filterIds);
      const feedback = store.feedback().slice(0, 30);
      if (entries.length === 0) {
        throw new Error('Save an entry first.');
      }
      const result = generateLocalDeterministic('analyze', entries, feedback) as AnalysisResult;
      result.created_at = nowIso();
      result.entry_ids = entries.map((e) => e.id);
      result.prompt_version = PROMPT_VERSION;
      result.source = 'local-deterministic';
      for (const item of result.insights) {
        item.id = crypto.randomUUID();
      }
      store.saveAnalysis(crypto.randomUUID(), result, result.created_at);
      res.status(200).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Local inspection failed.';
      res.status(400).json({ error: msg.slice(0, 200) });
    }
  });

  app.post('/api/local-chat', (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new Error('Expected a JSON object.');
      }
      const body = req.body as Record<string, unknown>;
      const filterIds = Array.isArray(body.entry_ids)
        ? body.entry_ids.filter((id): id is string => typeof id === 'string')
        : undefined;
      const entries = store.context(filterIds);
      const feedback = store.feedback().slice(0, 30);
      if (entries.length === 0) {
        throw new Error('Save an entry first.');
      }
      const question = body.question;
      if (
        typeof question !== 'string' ||
        question.trim().length < 1 ||
        question.trim().length > 2000
      ) {
        throw new Error('Ask a question of 1–2,000 characters.');
      }
      const result = generateLocalDeterministic(
        'chat',
        entries,
        feedback,
        question.trim()
      ) as ChatResult;
      result.created_at = nowIso();
      result.entry_ids = entries.map((e) => e.id);
      result.prompt_version = PROMPT_VERSION;
      result.has_evidence = result.evidence.length > 0;
      result.source = 'local-deterministic';
      res.status(200).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Local question search failed.';
      res.status(400).json({ error: msg.slice(0, 200) });
    }
  });

  // Error handler for oversized JSON or malformed payloads
  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err.type === 'entity.too.large') {
      res.status(400).json({ error: 'Request must be between 1 and 100,000 bytes.' });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Invalid JSON payload.' });
      return;
    }
    res.status(500).json({ error: 'Local storage operation failed.' });
  });

  return app;
}
