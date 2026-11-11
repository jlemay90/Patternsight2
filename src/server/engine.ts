import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type, Schema } from '@google/genai';

export const PROMPT_VERSION = 'reflect-v1';

export interface JournalEntry {
  id: string;
  text: string;
  mood: number | null;
  tags: string[];
  created_at: string;
}

export interface FeedbackItem {
  insight_id: string;
  rating: 'fits' | 'partly' | 'doesnt-fit';
  note: string;
  insight: string;
  created_at: string;
}

export interface EvidenceQuote {
  entry_id: string;
  quote: string;
  role?: 'supporting' | 'counterexample';
}

export interface ReflectionInsight {
  id?: string;
  title: string;
  observation: string;
  alternative: string;
  counterexample?: string;
  uncertainty?: string;
  question: string;
  experiment: string;
  strength: 'low' | 'medium';
  evidence: EvidenceQuote[];
}

export interface AnalysisResult {
  summary: string;
  insights: ReflectionInsight[];
  created_at?: string;
  entry_ids?: string[];
  prompt_version?: string;
  source?: 'gemini' | 'local-deterministic';
  model?: string;
}

export interface ChatResult {
  answer: string;
  evidence: EvidenceQuote[];
  has_evidence?: boolean;
  coverage_note?: string;
  created_at?: string;
  entry_ids?: string[];
  prompt_version?: string;
  source?: 'gemini' | 'local-deterministic';
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

const EVIDENCE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    entry_id: { type: Type.STRING, description: 'Exact ID of the supplied journal entry.' },
    quote: { type: Type.STRING, description: 'Exact verbatim nonempty substring from that entry text.' },
  },
  required: ['entry_id', 'quote'],
};

const INSIGHT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    observation: { type: Type.STRING },
    alternative: {
      type: Type.STRING,
      description: 'Alternative explanation, counterexamples in the entries, and explicit uncertainty.',
    },
    counterexample: {
      type: Type.STRING,
      description: 'Specific counterexample or exception noticed in the entries, or note when none appear.',
    },
    question: { type: Type.STRING },
    experiment: { type: Type.STRING },
    strength: { type: Type.STRING, enum: ['low', 'medium'] },
    evidence: { type: Type.ARRAY, items: EVIDENCE_SCHEMA },
  },
  required: ['title', 'observation', 'alternative', 'question', 'experiment', 'strength', 'evidence'],
};

export const SCHEMAS: Record<'analyze' | 'chat', Schema> = {
  analyze: {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING },
      insights: { type: Type.ARRAY, items: INSIGHT_SCHEMA },
    },
    required: ['summary', 'insights'],
  },
  chat: {
    type: Type.OBJECT,
    properties: {
      answer: { type: Type.STRING },
      evidence: { type: Type.ARRAY, items: EVIDENCE_SCHEMA },
    },
    required: ['answer', 'evidence'],
  },
};

export function checkText(obj: Record<string, unknown>, key: string, maximum = 8000): string {
  const value = obj[key];
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Invalid ${key}`);
  }
  return value;
}

export function validateEvidence(
  evidence: unknown,
  entries: JournalEntry[],
  required = false
): EvidenceQuote[] {
  if (!Array.isArray(evidence) || evidence.length > 30 || (required && evidence.length === 0)) {
    throw new Error('Invalid evidence list');
  }
  const lookup = new Map<string, string>(entries.map((e) => [e.id, e.text]));
  for (const item of evidence) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid evidence');
    }
    const rec = item as Record<string, unknown>;
    const entryId = rec.entry_id;
    const quote = rec.quote;
    if (typeof entryId !== 'string' || !lookup.has(entryId)) {
      throw new Error('Unknown evidence entry');
    }
    const sourceText = lookup.get(entryId)!;
    if (typeof quote !== 'string' || !quote.trim() || !sourceText.includes(quote)) {
      throw new Error('Evidence quote does not match source');
    }
  }
  return evidence as EvidenceQuote[];
}

export function validateResult(
  result: unknown,
  mode: 'analyze' | 'chat',
  entries: JournalEntry[]
): AnalysisResult | ChatResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Expected an object');
  }
  const obj = result as Record<string, unknown>;
  if (mode === 'chat') {
    checkText(obj, 'answer');
    validateEvidence(obj.evidence, entries, false);
    return obj as unknown as ChatResult;
  } else {
    checkText(obj, 'summary');
    const insights = obj.insights;
    if (!Array.isArray(insights) || insights.length > 3) {
      throw new Error('Expected zero to three insights');
    }
    for (const item of insights) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Invalid insight');
      }
      const ins = item as Record<string, unknown>;
      for (const key of ['title', 'observation', 'alternative', 'question', 'experiment']) {
        checkText(ins, key, 3000);
      }
      if (ins.counterexample !== undefined && ins.counterexample !== null) {
        if (typeof ins.counterexample !== 'string' || ins.counterexample.length > 3000) {
          throw new Error('Invalid counterexample');
        }
      }
      if (ins.strength !== 'low' && ins.strength !== 'medium') {
        throw new Error('Invalid strength');
      }
      validateEvidence(ins.evidence, entries, true);
    }
    return obj as unknown as AnalysisResult;
  }
}

export function isApiKeyConfigured(): boolean {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key !== 'YOUR_API_KEY');
}

export function getConfiguredModel(): string {
  const raw = (process.env.GEMINI_MODEL || '').trim();
  if (!raw) return 'gemini-3.8-flash';
  // Upgrade deprecated Gemini 1.5/2.0 model names automatically while preserving valid custom models
  if (
    raw === 'gemini-1.5-flash' ||
    raw === 'gemini-1.5-pro' ||
    raw === 'gemini-pro' ||
    raw === 'gemini-2.0-flash' ||
    raw === 'gemini-2.0-pro'
  ) {
    return 'gemini-3.8-flash';
  }
  return raw;
}

export function getSystemPrompt(rootDir = process.cwd()): string {
  const promptPath = path.join(rootDir, 'prompts', 'reflect-v1.txt');
  return fs.readFileSync(promptPath, 'utf-8');
}

export async function generate(
  mode: 'analyze' | 'chat',
  entries: JournalEntry[],
  feedback: FeedbackItem[],
  question = '',
  rootDir = process.cwd()
): Promise<AnalysisResult | ChatResult> {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!isApiKeyConfigured()) {
    throw new ProviderError(
      'AI is not connected. Set GEMINI_API_KEY in .env (or AI Studio Settings > Secrets) and restart the server.'
    );
  }
  const model = getConfiguredModel();
  if (!/^[a-zA-Z0-9_.-]+$/.test(model)) {
    throw new ProviderError('Invalid GEMINI_MODEL configuration.');
  }

  const systemInstruction = getSystemPrompt(rootDir);
  const contextPayload = {
    task: mode,
    entries,
    owner_feedback: feedback,
    question,
  };

  const ai = new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const candidateModels = Array.from(
    new Set([model, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'])
  );

  let lastErr: unknown = null;
  for (const activeModel of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: JSON.stringify(contextPayload),
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: SCHEMAS[mode],
        },
      });

      const rawText = response.text;
      if (!rawText || !rawText.trim()) {
        throw new ProviderError(
          'The model did not finish its response. Try a smaller context or another model.'
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText.trim());
      } catch {
        throw new Error('Malformed JSON output');
      }

      const validated = validateResult(parsed, mode, entries);
      if (mode === 'chat') {
        const chatRes = validated as ChatResult;
        chatRes.has_evidence = chatRes.evidence.length > 0;
        chatRes.source = 'gemini';
        return chatRes;
      } else {
        const analysisRes = validated as AnalysisResult;
        analysisRes.source = 'gemini';
        analysisRes.model = activeModel;
        return analysisRes;
      }
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Only try next candidate model on 503, 502, 500, or 404
      if (!/\b(404|500|502|503)\b/.test(msg)) {
        break;
      }
    }
  }

  try {
    throw lastErr;
  } catch (err: unknown) {
    if (err instanceof ProviderError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg === 'Expected an object' ||
      msg.startsWith('Invalid ') ||
      msg === 'Unknown evidence entry' ||
      msg === 'Evidence quote does not match source' ||
      msg === 'Expected zero to three insights' ||
      msg === 'Malformed JSON output'
    ) {
      throw new ProviderError(
        'The model response failed structure or exact-quote checks. No new analysis was saved.'
      );
    }
    const statusMatch = msg.match(/\b(400|401|403|404|429|500|502|503)\b/);
    if (statusMatch) {
      throw new ProviderError(
        `Google returned HTTP ${statusMatch[1]}. Check the model, API key and quota; your entries remain saved.`
      );
    }
    throw new ProviderError(
      'Google could not be reached or rejected the request. Your entries remain saved; try again later.'
    );
  }
}

/**
 * Deterministic local evidence & counterexample inspector.
 * Never claims to be Gemini; uses the exact same validateResult quote-provenance contract.
 */
interface ThemeDef {
  id: string;
  label: string;
  keywords: string[];
  question: string;
  experiment: string;
  alternative: string;
}

const THEMES: ThemeDef[] = [
  {
    id: 'movement-breaks',
    label: 'Stepping away, walks, and physical breaks',
    keywords: ['walk', 'walked', 'walking', 'outside', 'fresh air', 'stretch', 'run', 'exercise', 'movement', 'break'],
    question: 'When a walk or break helps versus when tension stays, what happened right before you stepped away?',
    experiment: 'On two upcoming days, take a 10-minute unscheduled walk after demanding blocks and jot one sentence about whether the transition felt different.',
    alternative: 'Stepping away from screens or demands may account for the shift rather than physical movement alone, and high-conflict situations can override a brief break.',
  },
  {
    id: 'sleep-rest',
    label: 'Sleep quality, rest, and energy carry-over',
    keywords: ['sleep', 'slept', 'tired', 'exhausted', 'rest', 'rested', 'insomnia', 'nap', 'awake', 'fatigue', 'morning'],
    question: 'On days when you feel drained despite decent sleep (or steady despite short sleep), what else is asking for your attention?',
    experiment: 'Note your rough energy level alongside one sentence about daytime clarity for three mornings without trying to force a routine change.',
    alternative: 'Daytime workload, ambiguous expectations, or emotional friction often shape energy just as strongly as hours slept.',
  },
  {
    id: 'clarity-expectations',
    label: 'Work structure, expectations, and friction',
    keywords: ['work', 'meeting', 'meetings', 'deadline', 'unclear', 'expectations', 'focus', 'focused', 'project', 'conflict', 'frustrated', 'overwhelmed', 'task'],
    question: 'Which moments of frustration came from volume of work versus uncertainty about what "done" looked like?',
    experiment: 'Before starting one ambiguous task this week, write down a single concrete definition of "good enough for today" and notice if friction changes.',
    alternative: 'Time of day, cumulative fatigue, or external interruptions may co-occur with work frustration without a single root cause.',
  },
  {
    id: 'connection-solitude',
    label: 'Social connection, conversation, and quiet time',
    keywords: ['talked', 'friend', 'friends', 'family', 'partner', 'alone', 'quiet', 'call', 'dinner', 'coffee', 'supported', 'connected'],
    question: 'What kind of company or solitude felt restorative recently, and what kind felt draining?',
    experiment: 'After your next meaningful conversation or quiet evening, record one specific detail that made it feel grounding or tiring.',
    alternative: 'Your baseline energy entering the interaction may explain how restorative it felt more than the activity itself.',
  },
];

function extractExactSentence(text: string, keywords: string[]): string {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (keywords.some((k) => lower.includes(k.toLowerCase())) && text.includes(s)) {
      return s.length <= 240 ? s : s.slice(0, 220).trim();
    }
  }
  const first = sentences[0] || text.trim();
  const candidate = first.length <= 240 ? first : text.slice(0, 200).trim();
  return text.includes(candidate) && candidate.length > 0 ? candidate : text.slice(0, Math.min(text.length, 120));
}

function hasContrastOrNegativeSignal(entry: JournalEntry): boolean {
  if (entry.mood !== null && entry.mood <= 2) return true;
  const lower = entry.text.toLowerCase();
  return /\b(but|however|stayed frustrated|still frustrated|didn't help|did not help|anxious|overwhelmed|conflict|drained|exhausted|tense)\b/.test(
    lower
  );
}

function hasPositiveSignal(entry: JournalEntry): boolean {
  if (entry.mood !== null && entry.mood >= 4) return true;
  const lower = entry.text.toLowerCase();
  return /\b(helped|calmer|settled|settle|good|great|better|relief|clearer|energy|grounded|ease)\b/.test(lower);
}

export function generateLocalDeterministic(
  mode: 'analyze' | 'chat',
  entries: JournalEntry[],
  feedback: FeedbackItem[],
  question = ''
): AnalysisResult | ChatResult {
  if (mode === 'chat') {
    const q = question.trim();
    const lowerQ = q.toLowerCase();

    // Safety check for acute crisis language
    if (/\b(suicide|kill myself|end my life|self-harm|hurt myself|want to die)\b/.test(lowerQ)) {
      const safeResult: ChatResult = {
        answer:
          'It sounds like you may be going through a very difficult moment. Please pause reflection analysis and reach out for immediate human support right now—contact a trusted person, a local emergency service, or call/text 988 (Suicide & Crisis Lifeline in the US/Canada) or your local crisis line.',
        evidence: [],
        has_evidence: false,
        coverage_note: 'Safety support message; pattern analysis paused.',
        source: 'local-deterministic',
      };
      return validateResult(safeResult, 'chat', entries) as ChatResult;
    }

    const stopWords = new Set([
      'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
      'does', 'did', 'do', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'having', 'can', 'could', 'would', 'should', 'will',
      'my', 'me', 'i', 'you', 'your', 'the', 'a', 'an', 'and', 'or', 'but', 'in',
      'on', 'at', 'to', 'for', 'of', 'with', 'about', 'from', 'into', 'during',
      'after', 'before', 'above', 'below', 'between', 'under', 'again', 'further',
      'then', 'once', 'here', 'there', 'all', 'any', 'both', 'each', 'few', 'more',
      'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
      'so', 'than', 'too', 'very', 'just', 'seem', 'seems', 'seemed', 'connected',
      'pattern', 'patterns', 'entries', 'entry', 'journal', 'reflect', 'reflection',
      'reflections', 'tell', 'show', 'notice', 'noticed', 'feel', 'feeling', 'felt',
      'help', 'helps', 'helped', 'make', 'makes', 'made',
    ]);

    const queryTokens = lowerQ
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !stopWords.has(t));

    // Also expand common semantic synonyms for natural questions like "when have I felt calmer / frustrated / energetic?"
    const expandedTokens = new Set<string>(queryTokens);
    if (/\b(calm|calmer|ease|settle|settled|peace|help|helps|helped|better|good|energy)\b/.test(lowerQ)) {
      ['walk', 'helped', 'settle', 'settled', 'calmer', 'calm', 'good', 'energy', 'rest', 'break', 'slept'].forEach((t) =>
        expandedTokens.add(t)
      );
    }
    if (/\b(frustrat|stress|tense|hard|difficult|drain|tired|low|off|upset|bother)\b/.test(lowerQ)) {
      ['frustrated', 'tired', 'conflict', 'unclear', 'expectations', 'poor', 'sleep', 'overwhelmed', 'drained'].forEach((t) =>
        expandedTokens.add(t)
      );
    }

    const searchTerms = Array.from(expandedTokens);
    const matchedEvidence: EvidenceQuote[] = [];
    const matchedEntries: JournalEntry[] = [];

    for (const entry of entries) {
      const lowerText = entry.text.toLowerCase();
      const lowerTags = entry.tags.map((t) => t.toLowerCase());
      const matchingTerms = searchTerms.filter(
        (term) => lowerText.includes(term) || lowerTags.some((tag) => tag.includes(term))
      );
      if (matchingTerms.length > 0) {
        const quote = extractExactSentence(entry.text, matchingTerms);
        if (quote && entry.text.includes(quote)) {
          matchedEntries.push(entry);
          matchedEvidence.push({ entry_id: entry.id, quote });
        }
      }
    }

    const rejectedNotes = feedback
      .filter((f) => f.rating === 'doesnt-fit' || f.rating === 'partly')
      .map((f) => f.note.trim())
      .filter(Boolean);

    if (matchedEvidence.length === 0) {
      const availableTags = Array.from(new Set(entries.flatMap((e) => e.tags))).slice(0, 6);
      const tagHint =
        availableTags.length > 0
          ? `Your current entries include tags such as ${availableTags.map((t) => `"${t}"`).join(', ')}.`
          : `You currently have ${entries.length} entry/entries in the selected context.`;

      const noEvidenceChat: ChatResult = {
        answer: `Your journal entries do not contain direct evidence to answer "${q}". Rather than guessing or inventing an interpretation, PatternSight only cites verbatim text present in your bounded context (${entries.length} entry/entries). ${tagHint}`,
        evidence: [],
        has_evidence: false,
        coverage_note: `Searched ${entries.length} bounded entry/entries; 0 verbatim quote matches found.`,
        source: 'local-deterministic',
      };
      return validateResult(noEvidenceChat, 'chat', entries) as ChatResult;
    }

    const boundedEvidence = matchedEvidence.slice(0, 6);
    const positiveMatches = matchedEntries.filter(hasPositiveSignal);
    const contrastMatches = matchedEntries.filter(hasContrastOrNegativeSignal);

    let answerParts: string[] = [
      `Across ${entries.length} entry/entries in your selected context, ${matchedEntries.length} reflection(s) contain direct text related to your question (local deterministic quote search):`,
    ];

    if (positiveMatches.length > 0 && contrastMatches.length > 0) {
      answerParts.push(
        `Your entries show both helpful moments and important counterexamples. In ${positiveMatches.length} entry/entries you noted a settling or positive shift, while in ${contrastMatches.length} entry/entries tension or frustration persisted—suggesting context and surrounding stressors matter alongside any single factor.`
      );
    } else if (positiveMatches.length > 0) {
      answerParts.push(
        `In the matching reflection(s), you described things that seemed to help or bring a steadier mood, though co-occurrence in ${matchedEntries.length} entry/entries is a hypothesis rather than a proven cause.`
      );
    } else if (contrastMatches.length > 0) {
      answerParts.push(
        `In the matching reflection(s), you noted friction, fatigue, or unclear circumstances. Treat this as a situational observation to test rather than a fixed personal pattern.`
      );
    } else {
      answerParts.push(
        `Review the exact cited passages below to see how you described these moments in your own words.`
      );
    }

    if (rejectedNotes.length > 0) {
      answerParts.push(
        `Keeping your saved correction in mind ("${rejectedNotes[0]}"), this summary avoids treating rejected explanations as established causes.`
      );
    }

    const chatResult: ChatResult = {
      answer: answerParts.join(' '),
      evidence: boundedEvidence,
      has_evidence: true,
      coverage_note: `Grounded in ${boundedEvidence.length} exact quote(s) across ${entries.length} bounded entries.`,
      source: 'local-deterministic',
    };
    return validateResult(chatResult, 'chat', entries) as ChatResult;
  }

  // mode === 'analyze'
  if (entries.length < 2) {
    const sparseResult: AnalysisResult = {
      summary: `Only ${entries.length} reflection is available in the selected context (${entries.length}/60 entries). A single entry can spark a reflection question, but at least two entries across distinct moments are needed before proposing a recurring pattern. No patterns were forced to fill a quota.`,
      insights: [],
      source: 'local-deterministic',
      model: 'local-deterministic-v1',
    };
    return validateResult(sparseResult, 'analyze', entries) as AnalysisResult;
  }

  const rejectedText = feedback
    .filter((f) => f.rating === 'doesnt-fit')
    .map((f) => `${f.note} ${f.insight}`.toLowerCase())
    .join(' ');

  const candidateInsights: ReflectionInsight[] = [];

  for (const theme of THEMES) {
    const matching = entries.filter((e) => {
      const lower = e.text.toLowerCase();
      const tagMatch = e.tags.some((t) => theme.keywords.includes(t.toLowerCase()));
      const wordMatch = theme.keywords.some((k) => lower.includes(k));
      return tagMatch || wordMatch;
    });

    if (matching.length >= 2) {
      // Check if user explicitly rejected sleep as main cause
      if (theme.id === 'sleep-rest' && rejectedText.includes('sleep')) {
        continue;
      }

      const supporting = matching.filter((e) => !hasContrastOrNegativeSignal(e) || hasPositiveSignal(e));
      const counterexamples = matching.filter((e) => hasContrastOrNegativeSignal(e));

      const evidence: EvidenceQuote[] = matching.slice(0, 4).map((e) => ({
        entry_id: e.id,
        quote: extractExactSentence(e.text, theme.keywords),
        role: hasContrastOrNegativeSignal(e) && supporting.length > 0 ? 'counterexample' : 'supporting',
      }));

      let counterexampleNote =
        'No direct counterexample entry was recorded yet in this small sample; absence of a counterexample in recent notes does not prove the pattern always holds.';
      if (counterexamples.length > 0 && supporting.length > 0) {
        const ceQuote = extractExactSentence(counterexamples[0].text, theme.keywords);
        counterexampleNote = `Counterexample present in your entries: "${ceQuote}" — showing that this theme does not always produce the same outcome when other pressures or conflicts are active.`;
      } else if (counterexamples.length > 0) {
        counterexampleNote = `Several entries mention ${theme.label.toLowerCase()} alongside friction or fatigue, though other unrecorded factors on those days may also explain how you felt.`;
      }

      const correctionReminder =
        feedback.length > 0 && feedback[0].note
          ? ` Incorporates your saved perspective ("${feedback[0].note}").`
          : '';

      candidateInsights.push({
        title: theme.label,
        observation: `Appears across ${matching.length} of your ${entries.length} recent reflections. ${
          supporting.length > 0 && counterexamples.length > 0
            ? 'Your notes include both times this coincided with feeling more settled and at least one counterexample where tension remained.'
            : 'These entries share situational overlap, which is an observation to explore rather than a proven cause.'
        }${correctionReminder}`,
        strength: matching.length >= 3 ? 'medium' : 'low',
        evidence,
        alternative: `${theme.alternative} ${counterexampleNote}`,
        counterexample: counterexampleNote,
        uncertainty: `Based on ${matching.length} matching entries out of ${entries.length} bounded entries; unrecorded days are not assumed to be good or bad.`,
        question: theme.question,
        experiment: theme.experiment,
      });
    }
  }

  // Also check user-defined tags that recur >= 2 times and weren't already covered
  if (candidateInsights.length < 3) {
    const tagMap = new Map<string, JournalEntry[]>();
    for (const e of entries) {
      for (const rawTag of e.tags) {
        const tag = rawTag.trim().toLowerCase();
        if (!tag) continue;
        const list = tagMap.get(tag) || [];
        list.push(e);
        tagMap.set(tag, list);
      }
    }
    for (const [tag, tagEntries] of tagMap.entries()) {
      if (candidateInsights.length >= 3) break;
      if (tagEntries.length < 2) continue;
      const alreadyCovered = candidateInsights.some((ins) => ins.title.toLowerCase().includes(tag));
      if (alreadyCovered) continue;

      const evidence: EvidenceQuote[] = tagEntries.slice(0, 3).map((e) => ({
        entry_id: e.id,
        quote: extractExactSentence(e.text, [tag]),
      }));

      const moods = tagEntries.map((e) => e.mood).filter((m): m is number => m !== null);
      const moodSpread =
        moods.length >= 2
          ? `Self-reported mood ratings on these entries ranged from ${Math.min(...moods)}/5 to ${Math.max(...moods)}/5.`
          : 'Self-reported mood ratings were optional or sparse across these entries.';

      const counterNote =
        moods.length >= 2 && Math.max(...moods) !== Math.min(...moods)
          ? `Mood varied (${Math.min(...moods)}/5 vs ${Math.max(...moods)}/5) across entries tagged "${tag}", providing a natural counterexample against a single fixed outcome.`
          : `Only ${tagEntries.length} entries share the "${tag}" tag so far; keep watching for exceptions where "${tag}" feels different.`;

      candidateInsights.push({
        title: `Recurring context tag: "${tag}"`,
        observation: `You tagged "${tag}" in ${tagEntries.length} separate entries. ${moodSpread} Co-occurrence highlights a recurring topic you chose to mark, not a clinical or causal conclusion.`,
        strength: tagEntries.length >= 3 ? 'medium' : 'low',
        evidence,
        alternative: `You may be more likely to tag "${tag}" on days that already stand out. ${counterNote}`,
        counterexample: counterNote,
        question: `When you tag an entry with "${tag}", what specific part of that situation feels most within your control?`,
        experiment: `Next time you use the "${tag}" tag, add one phrase noting what helped or what you needed in that moment.`,
      });
    }
  }

  const finalInsights = candidateInsights.slice(0, 3);
  const summary =
    finalInsights.length > 0
      ? `Inspected ${entries.length} recent reflection(s) (local deterministic mode · exact quote verification active). Found ${finalInsights.length} cautious hypothesis/hypotheses with supporting quotes, counterexamples, and alternative explanations.`
      : `Inspected ${entries.length} recent reflection(s) (local deterministic mode). No recurring multi-entry theme met the threshold yet—insufficient evidence is an honest outcome rather than inventing patterns.`;

  const result: AnalysisResult = {
    summary,
    insights: finalInsights,
    source: 'local-deterministic',
    model: 'local-deterministic-v1',
  };

  return validateResult(result, 'analyze', entries) as AnalysisResult;
}
