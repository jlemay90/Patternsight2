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
  id: string;
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
  created_at: string;
  entry_ids: string[];
  prompt_version: string;
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

export interface ChatExchange {
  id: string;
  question: string;
  result: ChatResult;
  timestamp: string;
}

export interface AppState {
  entries: JournalEntry[];
  analysis: AnalysisResult | null;
  feedback: FeedbackItem[];
  ai_connected: boolean;
  model: string;
  context_count: number;
  context_chars: number;
  context_max_entries: number;
  context_max_chars: number;
  prompt_version: string;
}

export interface FixtureCase {
  name: string;
  entries: string[];
  feedback?: string;
  expect: string;
}

export interface FixturesPayload {
  purpose: string;
  cases: FixtureCase[];
  contract_checks: Array<{
    name: string;
    passed: boolean;
    detail: string;
  }>;
}

export const MOOD_LABELS: Record<number, { label: string; symbol: string; description: string }> = {
  1: { label: 'Low', symbol: '☁', description: 'Heavy, drained, or difficult' },
  2: { label: 'Off', symbol: '◔', description: 'Unsettled, tense, or low energy' },
  3: { label: 'Okay', symbol: '◑', description: 'Steady, neutral, or mixed' },
  4: { label: 'Good', symbol: '◕', description: 'Grounded, clear, or settled' },
  5: { label: 'Great', symbol: '☀', description: 'Energized, connected, or at ease' },
};

export async function apiRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? { headers: { Accept: 'application/json' } }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data as T;
}
