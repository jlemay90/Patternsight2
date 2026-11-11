import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Sparkles,
  MessageSquareQuote,
  GitBranch,
  Download,
  Upload,
  Search,
  Edit3,
  Trash2,
  Check,
  AlertCircle,
  ArrowUpRight,
  Copy,
  ShieldCheck,
  SlidersHorizontal,
  X,
  FileCheck2,
  HelpCircle,
  Beaker,
  Scale,
} from 'lucide-react';
import {
  AppState,
  ChatExchange,
  ChatResult,
  EvidenceQuote,
  FixturesPayload,
  JournalEntry,
  MOOD_LABELS,
  apiRequest,
} from './types.ts';

type PageTab = 'journal' | 'insights' | 'chat' | 'continuity';

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'numeric',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function renderTextWithHighlight(text: string, highlightQuote: string | null) {
  if (!highlightQuote || !highlightQuote.trim()) {
    return <>{text}</>;
  }
  const idx = text.indexOf(highlightQuote);
  if (idx === -1) {
    return <>{text}</>;
  }
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + highlightQuote.length);
  const after = text.slice(idx + highlightQuote.length);
  return (
    <>
      {before}
      <mark className="bg-[#DCE8D4] text-[#183026] px-1 py-0.5 rounded font-medium">
        {match}
      </mark>
      {after}
    </>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState<PageTab>('journal');
  const [state, setState] = useState<AppState>({
    entries: [],
    analysis: null,
    feedback: [],
    ai_connected: false,
    model: 'gemini-3.8-flash',
    context_count: 0,
    context_chars: 0,
    context_max_entries: 60,
    context_max_chars: 60000,
    prompt_version: 'reflect-v1',
  });
  const [loadingState, setLoadingState] = useState<boolean>(true);
  const [notice, setNotice] = useState<{ text: string; isError?: boolean } | null>(null);

  // Composer state (create + edit)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryText, setEntryText] = useState<string>('');
  const [selectedMood, setSelectedMood] = useState<number | null>(null);
  const [tagsInput, setTagsInput] = useState<string>('');
  const [customDateInput, setCustomDateInput] = useState<string>('');
  const [isSavingEntry, setIsSavingEntry] = useState<boolean>(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [moodFilter, setMoodFilter] = useState<'all' | 'high' | 'mid' | 'low' | 'unrated'>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showImportPanel, setShowImportPanel] = useState<boolean>(false);
  const [importJsonText, setImportJsonText] = useState<string>('');

  // Highlighted quote navigation state
  const [highlightedTarget, setHighlightedTarget] = useState<{
    entryId: string;
    quote: string;
  } | null>(null);

  // AI & Insights state
  const [aiConsent, setAiConsent] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [correctionNotes, setCorrectionNotes] = useState<Record<string, string>>({});
  const [savingFeedbackId, setSavingFeedbackId] = useState<string | null>(null);

  // Chat state
  const [questionInput, setQuestionInput] = useState<string>('');
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [chatExchanges, setChatExchanges] = useState<ChatExchange[]>([]);

  // Continuity & Fixtures state
  const [continuityDocs, setContinuityDocs] = useState<Record<string, string>>({});
  const [fixturesData, setFixturesData] = useState<FixturesPayload | null>(null);

  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const showNotice = (text: string, isError = false) => {
    setNotice({ text, isError });
  };

  const refreshState = async () => {
    try {
      const data = await apiRequest<AppState>('/api/state');
      setState(data);
      const notesMap: Record<string, string> = {};
      for (const fb of data.feedback) {
        notesMap[fb.insight_id] = fb.note || '';
      }
      setCorrectionNotes((prev) => ({ ...prev, ...notesMap }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to load journal state.';
      showNotice(msg, true);
    } finally {
      setLoadingState(false);
    }
  };

  const loadContinuityAndFixtures = async () => {
    try {
      const [docs, fixtures] = await Promise.all([
        apiRequest<Record<string, string>>('/api/continuity'),
        apiRequest<FixturesPayload>('/api/fixtures'),
      ]);
      setContinuityDocs(docs);
      setFixturesData(fixtures);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load continuity documents.';
      showNotice(msg, true);
    }
  };

  useEffect(() => {
    refreshState();
    loadContinuityAndFixtures();
  }, []);

  // Scroll to highlighted entry when jumping from an evidence citation
  useEffect(() => {
    if (activePage === 'journal' && highlightedTarget) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`entry-${highlightedTarget.entryId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [activePage, highlightedTarget]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of state.entries) {
      for (const tag of entry.tags) {
        const normalized = tag.trim();
        if (normalized) {
          counts.set(normalized, (counts.get(normalized) || 0) + 1);
        }
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [state.entries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = state.entries.filter((entry) => {
      if (q) {
        const inText = entry.text.toLowerCase().includes(q);
        const inTags = entry.tags.some((t) => t.toLowerCase().includes(q));
        if (!inText && !inTags) return false;
      }
      if (moodFilter === 'high' && (entry.mood === null || entry.mood < 4)) return false;
      if (moodFilter === 'mid' && entry.mood !== 3) return false;
      if (moodFilter === 'low' && (entry.mood === null || entry.mood > 2)) return false;
      if (moodFilter === 'unrated' && entry.mood !== null) return false;
      if (tagFilter !== 'all' && !entry.tags.includes(tagFilter)) return false;
      return true;
    });
    if (sortOrder === 'oldest') {
      return [...list].reverse();
    }
    return list;
  }, [state.entries, searchQuery, moodFilter, tagFilter, sortOrder]);

  const ratedEntriesForChart = useMemo(() => {
    return state.entries
      .filter((e): e is JournalEntry & { mood: number } => e.mood !== null)
      .slice(0, 14)
      .reverse();
  }, [state.entries]);

  const resetComposer = () => {
    setEditingEntryId(null);
    setEntryText('');
    setSelectedMood(null);
    setTagsInput('');
    setCustomDateInput('');
  };

  const handleStartEdit = (entry: JournalEntry) => {
    setEditingEntryId(entry.id);
    setEntryText(entry.text);
    setSelectedMood(entry.mood);
    setTagsInput(entry.tags.join(', '));
    try {
      const d = new Date(entry.created_at);
      const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setCustomDateInput(localIso);
    } catch {
      setCustomDateInput('');
    }
    setActivePage('journal');
    setTimeout(() => {
      composerTextareaRef.current?.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingEntry) return;
    setIsSavingEntry(true);
    try {
      const parsedTags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const createdAtIso = customDateInput ? new Date(customDateInput).toISOString() : undefined;

      if (editingEntryId) {
        const res = await apiRequest<{ updated: boolean; analysis_cleared: boolean }>('/api/edit', {
          id: editingEntryId,
          text: entryText,
          mood: selectedMood,
          tags: parsedTags,
          created_at: createdAtIso,
        });
        resetComposer();
        await refreshState();
        showNotice(
          res.analysis_cleared
            ? 'Reflection updated. Previous analyses were cleared because entry text changed.'
            : 'Reflection metadata updated.'
        );
      } else {
        await apiRequest('/api/entries', {
          text: entryText,
          mood: selectedMood,
          tags: parsedTags,
          created_at: createdAtIso,
        });
        resetComposer();
        await refreshState();
        showNotice('Reflection saved to local storage.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not save reflection.';
      showNotice(msg, true);
    } finally {
      setIsSavingEntry(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      await apiRequest('/api/delete', { id });
      setConfirmDeleteId(null);
      if (editingEntryId === id) {
        resetComposer();
      }
      setChatExchanges([]);
      await refreshState();
      showNotice('Reflection and derived analyses deleted.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed.';
      showNotice(msg, true);
    }
  };

  const handleExportJournal = async () => {
    try {
      const data = await apiRequest<Record<string, unknown>>('/api/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `patternsight-journal-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showNotice(
        'Journal JSON backup downloaded. Keep personal exports separate from code handoffs.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed.';
      showNotice(msg, true);
    }
  };

  const handleImportJson = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(importJsonText);
      const entriesToImport = Array.isArray(parsed) ? parsed : parsed.entries;
      if (!Array.isArray(entriesToImport) || entriesToImport.length === 0) {
        throw new Error('JSON must contain a non-empty "entries" array.');
      }
      const res = await apiRequest<{ imported: number }>('/api/import', {
        entries: entriesToImport,
      });
      setImportJsonText('');
      setShowImportPanel(false);
      await refreshState();
      showNotice(`Imported ${res.imported} reflection(s) into local journal.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON backup format.';
      showNotice(msg, true);
    }
  };

  const handleLoadFixtureSample = async (caseName?: string) => {
    try {
      const sampleEntries =
        caseName === 'correction'
          ? [
              {
                text: 'Poor sleep and unclear expectations left me frustrated during the morning planning block.',
                mood: 2,
                tags: ['sleep', 'work', 'expectations'],
                created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
              },
              {
                text: 'I slept well for eight hours, but unclear expectations on the project scope frustrated me again.',
                mood: 2,
                tags: ['sleep', 'work', 'expectations'],
                created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
              },
            ]
          : [
              {
                text: 'Monday: A 20-minute walk outside after work helped me settle and clear my head.',
                mood: 4,
                tags: ['walk', 'work', 'reset'],
                created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
              },
              {
                text: 'Tuesday: Taking a midday walk helped me feel calmer before the afternoon review.',
                mood: 4,
                tags: ['walk', 'focus'],
                created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
              },
              {
                text: 'Wednesday: I walked after the meeting, but stayed frustrated after an unresolved conflict about unclear expectations.',
                mood: 2,
                tags: ['walk', 'work', 'conflict'],
                created_at: new Date(Date.now() - 86400000).toISOString(),
              },
            ];

      await apiRequest('/api/import', { entries: sampleEntries });
      await refreshState();
      setActivePage('journal');
      showNotice(
        'Loaded synthetic fixture reflections. You can now inspect exact quotes, counterexamples, and grounded Q&A.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not load synthetic sample.';
      showNotice(msg, true);
    }
  };

  const handleRunAnalysis = async (mode: 'gemini' | 'local') => {
    if (isAnalyzing) return;
    if (mode === 'gemini' && !aiConsent) {
      showNotice('Check the Google sharing consent box before requesting Gemini analysis.', true);
      return;
    }
    setIsAnalyzing(true);
    try {
      if (mode === 'gemini') {
        await apiRequest('/api/analyze', { consent: true });
        await refreshState();
        showNotice('Gemini analysis ready. Inspect the exact citations and rate what fits.');
      } else {
        await apiRequest('/api/local-analyze', {});
        await refreshState();
        showNotice(
          'Local deterministic inspection complete. Every quote is verified against your entries.'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Analysis failed.';
      showNotice(msg, true);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveFeedback = async (
    insightId: string,
    rating: 'fits' | 'partly' | 'doesnt-fit'
  ) => {
    setSavingFeedbackId(insightId);
    try {
      const note = correctionNotes[insightId] || '';
      await apiRequest('/api/feedback', {
        insight_id: insightId,
        rating,
        note,
      });
      await refreshState();
      showNotice('Your correction is saved and will be included in subsequent reflection requests.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not save feedback.';
      showNotice(msg, true);
    } finally {
      setSavingFeedbackId(null);
    }
  };

  const handleAskQuestion = async (mode: 'gemini' | 'local', presetQuestion?: string) => {
    const q = (presetQuestion ?? questionInput).trim();
    if (!q) {
      showNotice('Enter a question between 1 and 2,000 characters.', true);
      return;
    }
    if (mode === 'gemini' && !aiConsent) {
      showNotice(
        'Enable the Google sharing consent checkbox before sending a question to Gemini, or use Local Evidence Search.',
        true
      );
      return;
    }
    setIsAsking(true);
    try {
      const result =
        mode === 'gemini'
          ? await apiRequest<ChatResult>('/api/chat', { consent: true, question: q })
          : await apiRequest<ChatResult>('/api/local-chat', { question: q });

      setChatExchanges((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random()}`,
          question: q,
          result,
          timestamp: new Date().toISOString(),
        },
      ]);
      if (!presetQuestion) {
        setQuestionInput('');
      }
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Question request failed.';
      showNotice(msg, true);
    } finally {
      setIsAsking(false);
    }
  };

  const handleJumpToEvidence = (ev: EvidenceQuote) => {
    setSearchQuery('');
    setMoodFilter('all');
    setTagFilter('all');
    setHighlightedTarget({ entryId: ev.entry_id, quote: ev.quote });
    setActivePage('journal');
  };

  const analysisIsStale = useMemo(() => {
    if (!state.analysis) return false;
    const analyzedIds = new Set(state.analysis.entry_ids || []);
    return state.entries.some((e) => !analyzedIds.has(e.id));
  }, [state.analysis, state.entries]);

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F7F2] text-[#243E35]">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-[#F6F7F2]/95 backdrop-blur-sm border-b border-[#E4E8DF]">
        <div className="max-w-[1320px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#journal"
            onClick={(e) => {
              e.preventDefault();
              setActivePage('journal');
            }}
            className="text-xl font-semibold tracking-tight text-[#243E35] whitespace-nowrap shrink-0 font-serif-editorial"
          >
            PatternSight
          </a>

          {/* Zone 2: 4 concise single-line navigation links */}
          <nav
            aria-label="Main navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-[#5C6B61]"
          >
            <button
              type="button"
              data-page="journal"
              onClick={() => setActivePage('journal')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activePage === 'journal'
                  ? 'border-[#345D48] text-[#243E35] font-semibold'
                  : 'border-transparent hover:text-[#243E35]'
              }`}
            >
              My Journal
            </button>
            <button
              type="button"
              data-page="insights"
              onClick={() => setActivePage('insights')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activePage === 'insights'
                  ? 'border-[#345D48] text-[#243E35] font-semibold'
                  : 'border-transparent hover:text-[#243E35]'
              }`}
            >
              Hidden Layers
            </button>
            <button
              type="button"
              data-page="chat"
              onClick={() => setActivePage('chat')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activePage === 'chat'
                  ? 'border-[#345D48] text-[#243E35] font-semibold'
                  : 'border-transparent hover:text-[#243E35]'
              }`}
            >
              Reflection Partner
            </button>
            <button
              type="button"
              data-page="continuity"
              onClick={() => setActivePage('continuity')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activePage === 'continuity'
                  ? 'border-[#345D48] text-[#243E35] font-semibold'
                  : 'border-transparent hover:text-[#243E35]'
              }`}
            >
              Continuity
            </button>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <button
              id="export"
              type="button"
              onClick={handleExportJournal}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#243E35] bg-white border border-[#D5DDD0] rounded-lg hover:bg-[#EEF3EA] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-[#345D48]" />
              Export Journal
            </button>
          </div>
        </div>

        {/* Mobile navigation row */}
        <div className="md:hidden flex items-center justify-around border-t border-[#E4E8DF] bg-white px-2 py-1.5">
          {[
            { id: 'journal', label: 'Journal', icon: BookOpen },
            { id: 'insights', label: 'Insights', icon: Sparkles },
            { id: 'chat', label: 'Partner', icon: MessageSquareQuote },
            { id: 'continuity', label: 'Continuity', icon: GitBranch },
          ].map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivePage(item.id as PageTab)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
                  active ? 'bg-[#EEF3EA] text-[#345D48] font-semibold' : 'text-[#5C6B61]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1320px] w-full mx-auto px-6 py-8">
        {/* Accessible Status / Error Notice Banner */}
        {notice && (
          <div
            id="notice"
            role="status"
            aria-live="polite"
            className={`mb-6 px-4 py-3 rounded-lg border flex items-center justify-between gap-4 text-sm ${
              notice.isError
                ? 'bg-[#FDF2EC] border-[#E6C5B4] text-[#7D3C23]'
                : 'bg-[#EBF2E6] border-[#C9D8C0] text-[#243E35]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{notice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notification"
              className="p-1 rounded hover:bg-black/5 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ==================== PAGE 1: MY JOURNAL ==================== */}
        {activePage === 'journal' && (
          <section id="page-journal" aria-labelledby="journal-heading">
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E4E8DF] pb-6">
              <div>
                <p className="text-xs font-medium text-[#5C6B61] mb-1.5">
                  Your everyday, seen a little clearer ·{' '}
                  <span className="tabular-nums">
                    {new Date().toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </p>
                <h1
                  id="journal-heading"
                  className="text-3xl md:text-4xl font-normal text-[#243E35] tracking-tight"
                  style={{ textWrap: 'balance' }}
                >
                  Make room for reflection.
                </h1>
              </div>
              <p className="text-xs text-[#5C6B61] max-w-md">
                Entries stay in your local SQLite database by default. Notice what helps, inspect
                exact quotes, and keep interpretations open to revision.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left 7 Columns: Entry Composer + Search/Filter + Dated Entry History */}
              <div className="lg:col-span-7 space-y-8">
                {/* Composer Form */}
                <form
                  id="entry-form"
                  onSubmit={handleSaveEntry}
                  className="bg-white border border-[#E4E8DF] rounded-xl p-6"
                >
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <h2 className="text-lg font-semibold text-[#243E35]">
                      {editingEntryId ? 'Edit reflection' : 'What’s on your mind?'}
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-[#5C6B61] tabular-nums">
                      <span>{entryText.length.toLocaleString()} / 10,000 chars</span>
                      <span aria-hidden="true">·</span>
                      <span>Local storage</span>
                    </div>
                  </div>

                  {editingEntryId && (
                    <div className="mb-4 px-3.5 py-2.5 rounded-lg bg-[#FAFBF8] border border-[#E4E8DF] flex items-center justify-between gap-3 text-xs text-[#5C6B61]">
                      <span>
                        Editing existing reflection. Changing the entry text clears stored analyses
                        so quotes never go out of sync.
                      </span>
                      <button
                        type="button"
                        onClick={resetComposer}
                        className="font-semibold text-[#345D48] hover:underline whitespace-nowrap shrink-0"
                      >
                        Cancel edit
                      </button>
                    </div>
                  )}

                  <label htmlFor="entry-text" className="sr-only">
                    Journal entry text
                  </label>
                  <textarea
                    id="entry-text"
                    ref={composerTextareaRef}
                    value={entryText}
                    onChange={(e) => setEntryText(e.target.value)}
                    placeholder="Start anywhere. What happened, what stayed with you, or what felt different today?"
                    maxLength={10000}
                    required
                    rows={5}
                    className="w-full bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg p-4 text-[15px] leading-relaxed text-[#243E35] placeholder:text-[#88968C] focus:outline-none focus:border-[#345D48] resize-y"
                  />

                  {/* Self-Reported Mood Selector */}
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[#243E35]">
                        How are you feeling?
                      </span>
                      <span className="text-xs text-[#5C6B61]">
                        Optional · your own rating (1–5), never AI-inferred
                      </span>
                    </div>
                    <div
                      id="moods"
                      role="group"
                      aria-label="Self-reported mood rating"
                      className="grid grid-cols-5 gap-2"
                    >
                      {[1, 2, 3, 4, 5].map((m) => {
                        const info = MOOD_LABELS[m];
                        const isPressed = selectedMood === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            data-mood={m}
                            aria-pressed={isPressed}
                            onClick={() => setSelectedMood(isPressed ? null : m)}
                            className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg border text-center transition-colors whitespace-nowrap shrink-0 ${
                              isPressed
                                ? 'bg-[#EEF3EA] border-[#345D48] text-[#243E35] font-semibold'
                                : 'bg-white border-[#E4E8DF] text-[#5C6B61] hover:border-[#B8C7B0]'
                            }`}
                          >
                            <span className="text-lg leading-none mb-1" aria-hidden="true">
                              {info.symbol}
                            </span>
                            <span className="text-xs tabular-nums">
                              {m} · {info.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tags & Optional Date Row */}
                  <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label htmlFor="tags" className="block text-xs font-semibold text-[#243E35] mb-1.5">
                        Context tags <span className="font-normal text-[#5C6B61]">· optional, comma-separated</span>
                      </label>
                      <input
                        id="tags"
                        type="text"
                        value={tagsInput}
                        onChange={(e) => setTagsInput(e.target.value)}
                        placeholder="walk, work, sleep, expectations…"
                        maxLength={247}
                        className="w-full px-3.5 py-2 text-sm bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg text-[#243E35] placeholder:text-[#88968C] focus:outline-none focus:border-[#345D48]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="entry-date"
                        className="block text-xs font-semibold text-[#243E35] mb-1.5"
                      >
                        Entry date <span className="font-normal text-[#5C6B61]">· optional</span>
                      </label>
                      <input
                        id="entry-date"
                        type="datetime-local"
                        value={customDateInput}
                        onChange={(e) => setCustomDateInput(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono-tabular bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg text-[#243E35] focus:outline-none focus:border-[#345D48]"
                      />
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-[#E4E8DF] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#5C6B61]">
                      <span>Prompt starters:</span>
                      <button
                        type="button"
                        id="use-prompt"
                        onClick={() => {
                          setEntryText((prev) =>
                            prev
                              ? prev
                              : 'What gave me a little more energy today, and what drained it?\n\n'
                          );
                          composerTextareaRef.current?.focus();
                        }}
                        className="text-[#345D48] hover:underline whitespace-nowrap shrink-0"
                      >
                        + Energy & friction
                      </button>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() => {
                          setEntryText((prev) =>
                            prev
                              ? prev
                              : 'What expectation felt unclear today, and how did I respond?\n\n'
                          );
                          composerTextareaRef.current?.focus();
                        }}
                        className="text-[#345D48] hover:underline whitespace-nowrap shrink-0"
                      >
                        + Unclear expectations
                      </button>
                    </div>

                    <div className="flex items-center gap-2.5">
                      {editingEntryId && (
                        <button
                          type="button"
                          onClick={resetComposer}
                          className="px-3.5 py-2 text-xs font-medium text-[#5C6B61] hover:text-[#243E35] whitespace-nowrap shrink-0"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={isSavingEntry}
                        className="px-5 py-2.5 text-xs font-semibold text-white bg-[#345D48] rounded-lg hover:bg-[#284938] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        {isSavingEntry
                          ? 'Saving…'
                          : editingEntryId
                          ? 'Update reflection'
                          : 'Save reflection'}
                      </button>
                    </div>
                  </div>
                </form>

                {/* Dated Entry History Header + Search & Filter Controls */}
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-baseline gap-2.5">
                      <h2 className="text-xl font-normal text-[#243E35]">Recent reflections</h2>
                      <span id="entry-count" className="text-xs text-[#5C6B61] font-mono-tabular">
                        {filteredEntries.length} of {state.entries.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {highlightedTarget && (
                        <button
                          type="button"
                          onClick={() => setHighlightedTarget(null)}
                          className="text-xs text-[#345D48] hover:underline whitespace-nowrap shrink-0"
                        >
                          Clear quote highlight
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowImportPanel((v) => !v)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#345D48] hover:underline whitespace-nowrap shrink-0"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {showImportPanel ? 'Close import' : 'Import JSON backup'}
                      </button>
                    </div>
                  </div>

                  {/* Optional Import Backup Drawer */}
                  {showImportPanel && (
                    <form
                      onSubmit={handleImportJson}
                      className="bg-white border border-[#E4E8DF] rounded-xl p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#243E35]">
                          Restore from exported PatternSight JSON
                        </span>
                        <span className="text-xs text-[#5C6B61]">
                          Merges entries into your local SQLite database
                        </span>
                      </div>
                      <textarea
                        value={importJsonText}
                        onChange={(e) => setImportJsonText(e.target.value)}
                        placeholder='Paste exported JSON ({"entries": [...]}) here…'
                        rows={3}
                        className="w-full p-3 text-xs font-mono-tabular bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg"
                        required
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowImportPanel(false)}
                          className="px-3 py-1.5 text-xs text-[#5C6B61]"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-1.5 text-xs font-semibold text-white bg-[#345D48] rounded-lg"
                        >
                          Import Entries
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Search & Filter Toolbar */}
                  <div className="bg-white border border-[#E4E8DF] rounded-xl p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 text-[#5C6B61] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="search"
                          aria-label="Search entries by text or tag"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search reflections by phrase, exact quote, or tag…"
                          className="w-full pl-9 pr-3.5 py-2 text-sm bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg text-[#243E35] placeholder:text-[#88968C] focus:outline-none focus:border-[#345D48]"
                        />
                      </div>

                      <div className="flex items-center gap-1 p-1 bg-[#F2F5EE] rounded-lg shrink-0">
                        <button
                          type="button"
                          onClick={() => setSortOrder('newest')}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            sortOrder === 'newest'
                              ? 'bg-white text-[#243E35] shadow-xs'
                              : 'text-[#5C6B61] hover:text-[#243E35]'
                          }`}
                        >
                          Newest
                        </button>
                        <button
                          type="button"
                          onClick={() => setSortOrder('oldest')}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            sortOrder === 'oldest'
                              ? 'bg-white text-[#243E35] shadow-xs'
                              : 'text-[#5C6B61] hover:text-[#243E35]'
                          }`}
                        >
                          Oldest
                        </button>
                      </div>
                    </div>

                    {/* Interactive Mood & Tag Filter Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-xs text-[#5C6B61] mr-1 inline-flex items-center gap-1">
                          <SlidersHorizontal className="w-3 h-3" /> Mood:
                        </span>
                        {[
                          { id: 'all', label: 'All' },
                          { id: 'high', label: '4–5 Good/Great' },
                          { id: 'mid', label: '3 Okay' },
                          { id: 'low', label: '1–2 Low/Off' },
                          { id: 'unrated', label: 'Unrated' },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setMoodFilter(item.id as typeof moodFilter)}
                            className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 ${
                              moodFilter === item.id
                                ? 'bg-[#345D48] text-white font-medium'
                                : 'bg-[#F2F5EE] text-[#5C6B61] hover:text-[#243E35]'
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>

                      {allTags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-xs text-[#5C6B61] mr-1">Tag:</span>
                          <button
                            type="button"
                            onClick={() => setTagFilter('all')}
                            className={`px-2 py-0.5 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 ${
                              tagFilter === 'all'
                                ? 'bg-[#243E35] text-white font-medium'
                                : 'bg-[#F2F5EE] text-[#5C6B61] hover:text-[#243E35]'
                            }`}
                          >
                            All
                          </button>
                          {allTags.slice(0, 6).map(([tag, count]) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setTagFilter(tagFilter === tag ? 'all' : tag)}
                              className={`px-2 py-0.5 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                                tagFilter === tag
                                  ? 'bg-[#243E35] text-white font-medium'
                                  : 'bg-[#F2F5EE] text-[#5C6B61] hover:text-[#243E35]'
                              }`}
                            >
                              {tag} ({count})
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Entries List */}
                  <div id="entries" className="space-y-4">
                    {loadingState ? (
                      <div className="bg-white border border-[#E4E8DF] rounded-xl p-8 text-center text-sm text-[#5C6B61]">
                        Loading your local journal…
                      </div>
                    ) : filteredEntries.length === 0 ? (
                      <div className="bg-white border border-dashed border-[#CBD5C3] rounded-xl p-8 text-center space-y-3">
                        <h3 className="text-lg font-normal text-[#243E35]">
                          {state.entries.length === 0
                            ? 'Every pattern starts somewhere.'
                            : 'No reflections match your current filter.'}
                        </h3>
                        <p className="text-xs text-[#5C6B61] max-w-md mx-auto">
                          {state.entries.length === 0
                            ? 'Your personal database starts honestly blank—no fake diary entries are pre-seeded. Write your first reflection above, or load a synthetic test fixture to explore how evidence citations and counterexamples work.'
                            : 'Try clearing the search query or switching the mood/tag filter above.'}
                        </p>
                        {state.entries.length === 0 ? (
                          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                            <button
                              type="button"
                              onClick={() => handleLoadFixtureSample('walk')}
                              className="px-4 py-2 text-xs font-medium text-[#243E35] bg-[#EEF3EA] border border-[#C9D8C0] rounded-lg hover:bg-[#E1EBDA] transition-colors whitespace-nowrap shrink-0"
                            >
                              Load synthetic walk + counterexample fixture (3 entries)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLoadFixtureSample('correction')}
                              className="px-4 py-2 text-xs font-medium text-[#5C6B61] bg-white border border-[#E4E8DF] rounded-lg hover:bg-[#FAFBF8] transition-colors whitespace-nowrap shrink-0"
                            >
                              Load sleep vs. expectations fixture (2 entries)
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              setMoodFilter('all');
                              setTagFilter('all');
                            }}
                            className="px-4 py-2 text-xs font-medium text-[#345D48] hover:underline"
                          >
                            Reset all filters
                          </button>
                        )}
                      </div>
                    ) : (
                      filteredEntries.map((entry) => {
                        const isHighlighted = highlightedTarget?.entryId === entry.id;
                        const moodInfo = entry.mood ? MOOD_LABELS[entry.mood] : null;
                        return (
                          <article
                            key={entry.id}
                            id={`entry-${entry.id}`}
                            className={`entry bg-white border rounded-xl p-5 transition-colors ${
                              isHighlighted
                                ? 'border-[#345D48] ring-2 ring-[#345D48]/20'
                                : 'border-[#E4E8DF]'
                            }`}
                          >
                            {/* Clean Unboxed Metadata Row (Zero-Pill Discipline) */}
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C6B61]">
                              <div className="flex flex-wrap items-center gap-2">
                                <time
                                  dateTime={entry.created_at}
                                  className="font-mono-tabular text-[#243E35] font-medium"
                                >
                                  {formatDateTime(entry.created_at)}
                                </time>
                                {moodInfo && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="tabular-nums text-[#345D48] font-medium">
                                      {moodInfo.symbol} Mood {entry.mood}/5 ({moodInfo.label})
                                    </span>
                                  </>
                                )}
                                {entry.tags.length > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{entry.tags.join(' · ')}</span>
                                  </>
                                )}
                              </div>

                              {/* Entry Actions (Edit & Accessible Inline Delete Confirmation) */}
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(entry)}
                                  aria-label="Edit reflection"
                                  className="inline-flex items-center gap-1 text-xs text-[#5C6B61] hover:text-[#243E35] transition-colors whitespace-nowrap shrink-0"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  Edit
                                </button>

                                {confirmDeleteId === entry.id ? (
                                  <div className="flex items-center gap-2 bg-[#FDF2EC] px-2 py-0.5 rounded border border-[#E6C5B4]">
                                    <span className="text-[11px] text-[#7D3C23]">
                                      Delete & clear analyses?
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteEntry(entry.id)}
                                      className="text-[11px] font-semibold text-[#9E2A2B] hover:underline whitespace-nowrap shrink-0"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="text-[11px] text-[#5C6B61] hover:underline whitespace-nowrap shrink-0"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(entry.id)}
                                    aria-label="Delete reflection"
                                    className="delete-entry inline-flex items-center gap-1 text-xs text-[#5C6B61] hover:text-[#9E2A2B] transition-colors whitespace-nowrap shrink-0"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Delete
                                  </button>
                                )}
                              </div>
                            </div>

                            {isHighlighted && highlightedTarget && (
                              <div className="mt-3 px-3 py-1.5 rounded bg-[#EEF3EA] text-xs text-[#243E35] flex items-center justify-between">
                                <span>
                                  Showing exact source quote cited in your reflection insight / Q&A
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setHighlightedTarget(null)}
                                  className="text-[#345D48] font-medium hover:underline"
                                >
                                  Dismiss
                                </button>
                              </div>
                            )}

                            <p className="mt-3 text-[15px] leading-relaxed text-[#243E35] whitespace-pre-wrap break-words">
                              {renderTextWithHighlight(
                                entry.text,
                                isHighlighted ? highlightedTarget?.quote ?? null : null
                              )}
                            </p>
                          </article>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Right 5 Columns: Emotional Rhythm + Local Tag Context + Privacy Note */}
              <div className="lg:col-span-5 space-y-6">
                {/* Self-Reported Mood Trajectory */}
                <section className="bg-white border border-[#E4E8DF] rounded-xl p-6">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-base font-semibold text-[#243E35]">
                      Your emotional rhythm
                    </h2>
                    <span className="text-xs text-[#5C6B61] font-mono-tabular">
                      Last {ratedEntriesForChart.length} rated
                    </span>
                  </div>
                  <p className="text-xs text-[#5C6B61] mb-5">
                    Your self-reported mood check-ins (1–5), never AI-inferred sentiment velocity.
                  </p>

                  <div id="mood-chart" className="min-h-[144px] flex items-end">
                    {ratedEntriesForChart.length === 0 ? (
                      <div className="w-full py-10 text-center text-xs text-[#5C6B61] bg-[#FAFBF8] rounded-lg border border-dashed border-[#E4E8DF]">
                        Your rhythm will take shape as you record optional mood check-ins.
                      </div>
                    ) : (
                      <div
                        role="img"
                        aria-label={ratedEntriesForChart
                          .map((e) => `${formatShortDate(e.created_at)}: ${e.mood} of 5`)
                          .join('; ')}
                        className="w-full h-36 flex items-end justify-around gap-2 pt-4 px-2 bg-[#FAFBF8] rounded-lg border border-[#E4E8DF]"
                      >
                        {ratedEntriesForChart.map((e) => {
                          const heightPct =
                            e.mood === 1
                              ? '22%'
                              : e.mood === 2
                              ? '38%'
                              : e.mood === 3
                              ? '54%'
                              : e.mood === 4
                              ? '72%'
                              : '90%';
                          return (
                            <div
                              key={e.id}
                              className="flex-1 h-full flex flex-col justify-end items-center gap-1.5 group"
                            >
                              <span className="text-[10px] font-mono-tabular text-[#5C6B61] opacity-0 group-hover:opacity-100 transition-opacity">
                                {e.mood}/5
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setHighlightedTarget({
                                    entryId: e.id,
                                    quote: e.text.slice(0, 80),
                                  })
                                }
                                title={`${formatDateTime(e.created_at)}: Mood ${e.mood}/5`}
                                style={{ height: heightPct }}
                                className="chart-bar w-full max-w-[24px] bg-[#9BB48E] hover:bg-[#345D48] rounded-t transition-colors"
                              />
                              <small className="text-[10px] font-mono-tabular text-[#5C6B61]">
                                {formatShortDate(e.created_at)}
                              </small>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>

                {/* Local Context & Recurring Themes Overview */}
                <section className="bg-white border border-[#E4E8DF] rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-[#243E35]">
                      Bounded context & tags
                    </h2>
                    <span className="text-xs text-[#5C6B61] font-mono-tabular">
                      {state.context_count}/{state.context_max_entries} entries
                    </span>
                  </div>
                  <p className="text-xs text-[#5C6B61]">
                    PatternSight bounds AI requests to your {state.context_max_entries} newest
                    entries ({state.context_chars.toLocaleString()} /{' '}
                    {state.context_max_chars.toLocaleString()} chars currently selected) plus up to
                    30 saved user corrections ({state.feedback.length} saved).
                  </p>

                  {allTags.length > 0 && (
                    <div className="pt-3 border-t border-[#E4E8DF] space-y-2">
                      <span className="block text-xs font-semibold text-[#243E35]">
                        Tags across your entries
                      </span>
                      <div className="divide-y divide-[#E4E8DF] text-xs">
                        {allTags.slice(0, 5).map(([tag, count]) => {
                          const tagMoods = state.entries
                            .filter((e) => e.tags.includes(tag) && e.mood !== null)
                            .map((e) => e.mood as number);
                          const rangeText =
                            tagMoods.length > 0
                              ? `Mood ${Math.min(...tagMoods)}–${Math.max(...tagMoods)}/5`
                              : 'No mood ratings';
                          return (
                            <div
                              key={tag}
                              className="py-2 flex items-center justify-between text-[#5C6B61]"
                            >
                              <button
                                type="button"
                                onClick={() => setTagFilter(tagFilter === tag ? 'all' : tag)}
                                className="font-medium text-[#243E35] hover:text-[#345D48] hover:underline"
                              >
                                {tag}
                              </button>
                              <span className="font-mono-tabular">
                                {count} {count === 1 ? 'entry' : 'entries'} · {rangeText}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t border-[#E4E8DF] flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setActivePage('insights')}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#345D48] hover:underline"
                    >
                      Explore patterns & counterexamples
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivePage('chat')}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#345D48] hover:underline"
                    >
                      Ask reflection partner
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </section>

                {/* Privacy & Non-Clinical Contract Card */}
                <section className="bg-[#EEF3EA] border border-[#D8E2D1] rounded-xl p-6 space-y-2.5">
                  <div className="flex items-center gap-2 text-[#243E35] font-semibold text-sm">
                    <ShieldCheck className="w-4 h-4 text-[#345D48]" />
                    <span>Your story stays yours.</span>
                  </div>
                  <p className="text-xs text-[#425449] leading-relaxed">
                    PatternSight never diagnoses, never assigns clinical labels, and never infers
                    withdrawal from missing days. Every substantive observation must cite an exact,
                    verified substring from your entries. API keys remain strictly on the server.
                  </p>
                </section>
              </div>
            </div>
          </section>
        )}

        {/* ==================== PAGE 2: HIDDEN LAYERS (INSIGHTS) ==================== */}
        {activePage === 'insights' && (
          <section id="page-insights" aria-labelledby="insights-heading" className="space-y-8">
            <div className="border-b border-[#E4E8DF] pb-6">
              <p className="text-xs font-medium text-[#5C6B61] mb-1.5">
                Patterns to explore, not conclusions · Prompt {state.prompt_version}
              </p>
              <h1
                id="insights-heading"
                className="text-3xl md:text-4xl font-normal text-[#243E35] tracking-tight"
                style={{ textWrap: 'balance' }}
              >
                A little beneath the surface.
              </h1>
              <p className="text-sm text-[#5C6B61] mt-1">
                Inspect the exact evidence, weigh counterexamples and uncertainty, and correct what
                doesn’t fit your experience.
              </p>
            </div>

            {/* AI Controls & Consent Card */}
            <div className="bg-white border border-[#E4E8DF] rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[#243E35]">
                  Look across your reflections
                </h2>
                <div className="text-xs text-[#5C6B61] font-mono-tabular">
                  {state.ai_connected
                    ? `Server Gemini configured · ${state.model}`
                    : `Local-first · Server Gemini key not set (${state.model})`}
                </div>
              </div>

              <p id="context-description" className="text-xs text-[#5C6B61]">
                AI context: {state.context_count} most recent entries (up to{' '}
                {state.context_max_entries} entries / {state.context_max_chars.toLocaleString()}{' '}
                text characters), plus up to 30 saved insight corrections ({state.feedback.length}{' '}
                saved). Model: {state.model}.
              </p>

              <label className="flex items-start gap-3 text-xs text-[#243E35] cursor-pointer select-none py-1">
                <input
                  id="ai-consent"
                  type="checkbox"
                  checked={aiConsent}
                  onChange={(e) => setAiConsent(e.target.checked)}
                  className="mt-0.5 rounded border-[#B8C7B0] text-[#345D48] focus:ring-[#345D48]"
                />
                <span>
                  Allow analysis and reflection questions to send the selected bounded entries (
                  {state.context_count}) and up to 30 saved insight corrections to Google Gemini on
                  the server. Review Google’s data-use terms for your API tier.
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  id="analyze"
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => handleRunAnalysis('gemini')}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-[#345D48] rounded-lg hover:bg-[#284938] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  {isAnalyzing ? 'Working…' : 'Explore patterns (Gemini)'}
                </button>

                <button
                  id="local-analyze"
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => handleRunAnalysis('local')}
                  className="px-4 py-2.5 text-xs font-semibold text-[#243E35] bg-[#EEF3EA] border border-[#C9D8C0] rounded-lg hover:bg-[#E2ECDC] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  Inspect local evidence & counterexamples (Offline)
                </button>
              </div>

              <p id="ai-setup" className="text-xs text-[#5C6B61] pt-1">
                {state.ai_connected
                  ? 'Gemini is configured on the server. All outputs are validated against exact source quotes before saving.'
                  : 'Server-side Gemini key is not currently set. Configure GEMINI_API_KEY in AI Studio Settings > Secrets (or local .env), or use "Inspect local evidence & counterexamples (Offline)" above to run deterministic exact-quote analysis right now.'}
              </p>
            </div>

            {/* Analysis Summary & Stale Notice */}
            {state.analysis && (
              <div className="bg-[#FAFBF8] border border-[#E4E8DF] rounded-xl p-5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C6B61]">
                  <span>
                    Source:{' '}
                    <strong className="text-[#243E35]">
                      {state.analysis.source === 'local-deterministic'
                        ? 'Local Deterministic Inspector (Offline · Exact-Quote Verified)'
                        : `Google Gemini Server-Side (${state.analysis.model || state.model})`}
                    </strong>
                  </span>
                  <span className="font-mono-tabular">
                    Generated {formatDateTime(state.analysis.created_at)} ·{' '}
                    {state.analysis.entry_ids?.length || 0} entries in scope
                  </span>
                </div>
                <p id="analysis-summary" className="text-sm text-[#243E35] leading-relaxed">
                  {state.analysis.summary}
                </p>
                {analysisIsStale && (
                  <p className="text-xs text-[#9A6B32] font-medium">
                    Note: You have added or modified reflections since this analysis was generated.
                    Run analysis again to include your newest entries.
                  </p>
                )}
              </div>
            )}

            {/* Insights Grid */}
            <div id="insights">
              {!state.analysis ? (
                <div className="bg-white border border-dashed border-[#CBD5C3] rounded-xl p-10 text-center space-y-3">
                  <h3 className="text-xl font-normal text-[#243E35]">Let the evidence lead.</h3>
                  <p className="text-xs text-[#5C6B61] max-w-lg mx-auto">
                    Run Gemini pattern exploration or the offline local evidence inspector above.
                    PatternSight returns zero to three hypotheses—and never invents quotes or forces
                    patterns when your journal is sparse.
                  </p>
                </div>
              ) : state.analysis.insights.length === 0 ? (
                <div className="bg-white border border-[#E4E8DF] rounded-xl p-8 text-center space-y-2">
                  <h3 className="text-lg font-normal text-[#243E35]">
                    No established recurring patterns yet (0 insights)
                  </h3>
                  <p className="text-xs text-[#5C6B61] max-w-lg mx-auto">
                    Insufficient evidence is a valid, honest result. PatternSight requires supporting
                    entries across distinct moments rather than turning a single entry into a trend.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {state.analysis.insights.map((insight) => {
                    const priorFeedback = state.feedback.find((f) => f.insight_id === insight.id);
                    const noteValue = correctionNotes[insight.id] ?? priorFeedback?.note ?? '';
                    return (
                      <article
                        key={insight.id}
                        className="insight bg-white border border-[#E4E8DF] rounded-xl p-6 flex flex-col justify-between space-y-6"
                      >
                        <div className="space-y-4">
                          {/* Unboxed Metadata Kicker */}
                          <div className="flex items-center justify-between text-xs text-[#5C6B61]">
                            <span className="font-semibold text-[#345D48]">
                              {insight.strength === 'medium'
                                ? 'Medium evidence · Hypothesis'
                                : 'Low evidence · Hypothesis'}
                            </span>
                            <span className="font-mono-tabular">
                              {insight.evidence.length}{' '}
                              {insight.evidence.length === 1 ? 'citation' : 'citations'}
                            </span>
                          </div>

                          <h3 className="text-xl font-normal text-[#243E35] leading-snug">
                            {insight.title}
                          </h3>

                          <p className="text-sm text-[#243E35] leading-relaxed">
                            {insight.observation}
                          </p>

                          {/* Exact Verbatim Citations */}
                          <div className="space-y-2 pt-1">
                            <h4 className="text-xs font-semibold text-[#243E35] flex items-center gap-1.5">
                              <FileCheck2 className="w-3.5 h-3.5 text-[#345D48]" />
                              Exact cited evidence from your entries
                            </h4>
                            <div className="space-y-2">
                              {insight.evidence.map((ev, idx) => {
                                const sourceEntry = state.entries.find(
                                  (e) => e.id === ev.entry_id
                                );
                                return (
                                  <button
                                    key={`${ev.entry_id}-${idx}`}
                                    type="button"
                                    onClick={() => handleJumpToEvidence(ev)}
                                    className="evidence w-full text-left p-3 rounded-lg bg-[#FAFBF8] border border-[#E4E8DF] hover:border-[#345D48] transition-colors group"
                                  >
                                    <p className="text-xs text-[#243E35] italic leading-relaxed">
                                      “{ev.quote}”
                                    </p>
                                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#5C6B61] font-mono-tabular">
                                      <span>
                                        {sourceEntry
                                          ? formatDateTime(sourceEntry.created_at)
                                          : 'Source entry'}
                                        {sourceEntry?.mood ? ` · Mood ${sourceEntry.mood}/5` : ''}
                                      </span>
                                      <span className="text-[#345D48] group-hover:underline">
                                        Inspect in journal ›
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Counterexamples, Alternative Explanation & Uncertainty */}
                          <div className="pt-3 border-t border-[#E4E8DF] space-y-3">
                            <div>
                              <h4 className="text-xs font-semibold text-[#243E35] flex items-center gap-1.5 mb-1">
                                <Scale className="w-3.5 h-3.5 text-[#9A6B32]" />
                                Counterexamples, alternative explanations & uncertainty
                              </h4>
                              <p className="text-xs text-[#5C6B61] leading-relaxed">
                                {insight.alternative}
                              </p>
                              {insight.uncertainty && (
                                <p className="text-[11px] text-[#5C6B61] mt-1">
                                  {insight.uncertainty}
                                </p>
                              )}
                            </div>

                            <div>
                              <h4 className="text-xs font-semibold text-[#243E35] flex items-center gap-1.5 mb-1">
                                <HelpCircle className="w-3.5 h-3.5 text-[#345D48]" />A question to
                                sit with
                              </h4>
                              <p className="text-xs text-[#243E35] leading-relaxed">
                                {insight.question}
                              </p>
                            </div>

                            <div>
                              <h4 className="text-xs font-semibold text-[#243E35] flex items-center gap-1.5 mb-1">
                                <Beaker className="w-3.5 h-3.5 text-[#345D48]" />A small optional
                                experiment
                              </h4>
                              <p className="text-xs text-[#5C6B61] leading-relaxed">
                                {insight.experiment}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* User Corrections & Feedback */}
                        <div className="pt-4 border-t border-[#E4E8DF] space-y-2.5">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-semibold text-[#243E35]">
                              Does this fit your experience?
                            </h4>
                            {priorFeedback && (
                              <span className="text-[11px] text-[#345D48] font-medium">
                                Saved ({priorFeedback.rating})
                              </span>
                            )}
                          </div>
                          <input
                            type="text"
                            aria-label={`Correction for ${insight.title}`}
                            value={noteValue}
                            onChange={(e) =>
                              setCorrectionNotes((prev) => ({
                                ...prev,
                                [insight.id]: e.target.value,
                              }))
                            }
                            maxLength={2000}
                            placeholder="Add a correction, nuance, or alternative cause (optional)…"
                            className="correction w-full px-3 py-2 text-xs bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg text-[#243E35] placeholder:text-[#88968C] focus:outline-none focus:border-[#345D48]"
                          />
                          <div className="feedback flex items-center gap-2">
                            {(
                              [
                                ['fits', 'Fits'],
                                ['partly', 'Partly fits'],
                                ['doesnt-fit', 'Doesn’t fit'],
                              ] as const
                            ).map(([ratingKey, label]) => {
                              const isSelected = priorFeedback?.rating === ratingKey;
                              return (
                                <button
                                  key={ratingKey}
                                  type="button"
                                  disabled={savingFeedbackId === insight.id}
                                  onClick={() => handleSaveFeedback(insight.id, ratingKey)}
                                  className={`flex-1 py-1.5 px-2.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                                    isSelected
                                      ? 'selected bg-[#EEF3EA] border-[#345D48] text-[#243E35] font-semibold'
                                      : 'bg-white border-[#E4E8DF] text-[#5C6B61] hover:text-[#243E35]'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ==================== PAGE 3: REFLECTION PARTNER (GROUNDED CHAT) ==================== */}
        {activePage === 'chat' && (
          <section id="page-chat" aria-labelledby="chat-heading" className="space-y-6">
            <div className="border-b border-[#E4E8DF] pb-6">
              <p className="text-xs font-medium text-[#5C6B61] mb-1.5">
                A conversation with bounded context · Session-only
              </p>
              <h1
                id="chat-heading"
                className="text-3xl md:text-4xl font-normal text-[#243E35] tracking-tight"
                style={{ textWrap: 'balance' }}
              >
                Let’s make sense of it.
              </h1>
              <p className="text-sm text-[#5C6B61] mt-1">
                Ask about your reflections. Every answer cites exact source text—and explicitly
                tells you when your journal has no evidence.
              </p>
            </div>

            <div className="bg-white border border-[#E4E8DF] rounded-xl p-6 max-w-4xl space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#E4E8DF]">
                <p id="chat-context" className="text-xs text-[#5C6B61]">
                  Bounded context: {state.context_count} recent entries (
                  {state.context_chars.toLocaleString()} chars) + {state.feedback.length} saved
                  correction(s).
                </p>
                <label className="flex items-center gap-2 text-xs text-[#243E35] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aiConsent}
                    onChange={(e) => setAiConsent(e.target.checked)}
                    className="rounded border-[#B8C7B0] text-[#345D48]"
                  />
                  <span>Google sharing consent</span>
                </label>
              </div>

              {/* Starter Question Chips */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[#5C6B61]">Try asking:</span>
                <button
                  type="button"
                  onClick={() =>
                    handleAskQuestion(
                      state.ai_connected && aiConsent ? 'gemini' : 'local',
                      'When have I felt more settled or calm, and what counterexamples exist?'
                    )
                  }
                  className="px-3 py-1 text-xs bg-[#F2F5EE] hover:bg-[#E4ECE0] text-[#243E35] rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  “When have I felt more settled, and what counterexamples exist?”
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleAskQuestion(
                      state.ai_connected && aiConsent ? 'gemini' : 'local',
                      'What seems connected to my frustration?'
                    )
                  }
                  className="px-3 py-1 text-xs bg-[#F2F5EE] hover:bg-[#E4ECE0] text-[#243E35] rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  “What seems connected to my frustration?”
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleAskQuestion(
                      state.ai_connected && aiConsent ? 'gemini' : 'local',
                      'What does my journal say about marathon training in Tokyo?'
                    )
                  }
                  className="px-3 py-1 text-xs bg-[#FAFBF8] border border-[#E4E8DF] hover:bg-[#F2F5EE] text-[#5C6B61] rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  Test unrecorded topic (“marathon training in Tokyo”)
                </button>
              </div>

              {/* Messages Log */}
              <div
                id="messages"
                role="log"
                aria-live="polite"
                className="min-h-[280px] max-h-[520px] overflow-y-auto space-y-4 py-2"
              >
                {chatExchanges.length === 0 ? (
                  <div className="chat-welcome py-12 text-center space-y-2 text-[#5C6B61]">
                    <MessageSquareQuote className="w-7 h-7 text-[#345D48] mx-auto mb-2 opacity-80" />
                    <h2 className="text-xl font-normal text-[#243E35]">
                      Start with something you’ve noticed.
                    </h2>
                    <p className="text-xs max-w-md mx-auto">
                      Ask a question using Gemini (when connected) or Local Evidence Search. If your
                      entries don’t contain evidence for a question, PatternSight will clearly say
                      so rather than guessing.
                    </p>
                  </div>
                ) : (
                  chatExchanges.map((ex) => {
                    const hasEvidence =
                      ex.result.evidence && ex.result.evidence.length > 0;
                    return (
                      <div key={ex.id} className="space-y-3">
                        {/* User Question */}
                        <div className="message user ml-auto max-w-[82%] bg-[#E7EEE1] border border-[#D2DFC8] rounded-xl p-4">
                          <div className="text-[11px] font-semibold text-[#345D48] mb-1">You</div>
                          <p className="text-sm text-[#243E35] whitespace-pre-wrap">{ex.question}</p>
                        </div>

                        {/* Grounded Answer */}
                        <div className="message bg-[#FAFBF8] border border-[#E4E8DF] rounded-xl p-5 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C6B61]">
                            <strong className="text-[#243E35]">
                              PatternSight · Reflection, not diagnosis
                            </strong>
                            <span>
                              {ex.result.source === 'local-deterministic'
                                ? 'Local Evidence Search'
                                : 'Gemini Server-Side'}{' '}
                              · {hasEvidence ? `${ex.result.evidence.length} exact quote(s)` : '0 matching quotes'}
                            </span>
                          </div>

                          <p className="text-sm text-[#243E35] leading-relaxed whitespace-pre-wrap">
                            {ex.result.answer}
                          </p>

                          {/* Explicit No-Evidence Safeguard Banner */}
                          {!hasEvidence ? (
                            <div className="p-3.5 rounded-lg bg-[#FDF8F2] border border-[#E6D5B8] text-xs text-[#6E4E24] space-y-1">
                              <div className="font-semibold">
                                No supporting evidence found in your journal
                              </div>
                              <p>
                                PatternSight checked {state.context_count} bounded entry/entries and
                                found 0 verbatim passages matching this question. No quotes or
                                unsupported conclusions were fabricated.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-2 pt-1">
                              <div className="text-xs font-semibold text-[#243E35]">
                                Cited source text (click to inspect in journal):
                              </div>
                              {ex.result.evidence.map((ev, i) => {
                                const entry = state.entries.find((e) => e.id === ev.entry_id);
                                return (
                                  <button
                                    key={`${ev.entry_id}-${i}`}
                                    type="button"
                                    onClick={() => handleJumpToEvidence(ev)}
                                    className="evidence block w-full text-left p-3 rounded-lg bg-white border border-[#E4E8DF] hover:border-[#345D48] transition-colors"
                                  >
                                    <p className="text-xs text-[#243E35] italic">“{ev.quote}”</p>
                                    <small className="block mt-1 text-[11px] text-[#5C6B61] font-mono-tabular">
                                      {entry
                                        ? `${formatDateTime(entry.created_at)} · View reflection ›`
                                        : 'View reflection ›'}
                                    </small>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input Form */}
              <form
                id="chat-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAskQuestion('gemini');
                }}
                className="pt-4 border-t border-[#E4E8DF] flex flex-col sm:flex-row gap-2.5"
              >
                <label htmlFor="question" className="sr-only">
                  Reflection question
                </label>
                <input
                  id="question"
                  type="text"
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  maxLength={2000}
                  placeholder="What would you like to check against your journal entries?"
                  required
                  className="flex-1 px-4 py-2.5 text-sm bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg text-[#243E35] placeholder:text-[#88968C] focus:outline-none focus:border-[#345D48]"
                />
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="submit"
                    disabled={isAsking}
                    className="px-4 py-2.5 text-xs font-semibold text-white bg-[#345D48] rounded-lg hover:bg-[#284938] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    {isAsking ? 'Asking…' : 'Ask (Gemini) ›'}
                  </button>
                  <button
                    type="button"
                    disabled={isAsking}
                    onClick={() => handleAskQuestion('local')}
                    className="px-4 py-2.5 text-xs font-semibold text-[#243E35] bg-[#EEF3EA] border border-[#C9D8C0] rounded-lg hover:bg-[#E2ECDC] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    Search Local Evidence
                  </button>
                </div>
              </form>
            </div>
          </section>
        )}

        {/* ==================== PAGE 4: PROJECT CONTINUITY & VERIFICATION ==================== */}
        {activePage === 'continuity' && (
          <section
            id="page-continuity"
            aria-labelledby="continuity-heading"
            className="space-y-8"
          >
            <div className="border-b border-[#E4E8DF] pb-6">
              <p className="text-xs font-medium text-[#5C6B61] mb-1.5">
                Built to keep going · Portable multi-agent handoff protocol
              </p>
              <h1
                id="continuity-heading"
                className="text-3xl md:text-4xl font-normal text-[#243E35] tracking-tight"
                style={{ textWrap: 'balance' }}
              >
                One project. Many collaborators.
              </h1>
              <p className="text-sm text-[#5C6B61] mt-1">
                Imported from canonical repository{' '}
                <code className="font-mono-tabular text-xs bg-white px-1.5 py-0.5 rounded border border-[#E4E8DF]">
                  https://github.com/jlemay90/patternsight
                </code>{' '}
                with deterministic contract checks, synthetic fixtures, and full handoff docs.
              </p>
            </div>

            {/* Contract Verification & Synthetic Fixtures Card */}
            {fixturesData && (
              <div className="bg-white border border-[#E4E8DF] rounded-xl p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-[#243E35]">
                      Evidence-grounding contract & synthetic fixtures
                    </h2>
                    <p className="text-xs text-[#5C6B61]">{fixturesData.purpose}</p>
                  </div>
                  <span className="text-xs font-mono-tabular text-[#345D48] font-medium">
                    {fixturesData.contract_checks?.filter((c) => c.passed).length || 0}/
                    {fixturesData.contract_checks?.length || 0} deterministic checks passing
                  </span>
                </div>

                {/* Live Server Contract Self-Checks */}
                {fixturesData.contract_checks && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {fixturesData.contract_checks.map((chk) => (
                      <div
                        key={chk.name}
                        className="p-4 rounded-lg bg-[#FAFBF8] border border-[#E4E8DF] space-y-1"
                      >
                        <div className="flex items-center justify-between text-xs font-semibold text-[#243E35]">
                          <span>{chk.name}</span>
                          <span className="text-[#345D48] inline-flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            PASS
                          </span>
                        </div>
                        <p className="text-xs text-[#5C6B61]">{chk.detail}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Synthetic Fixture Cases from fixtures/reflection-cases.json */}
                <div className="space-y-2.5">
                  <h3 className="text-sm font-semibold text-[#243E35]">
                    Repository synthetic evaluation cases (fixtures/reflection-cases.json)
                  </h3>
                  <div className="divide-y divide-[#E4E8DF] border border-[#E4E8DF] rounded-lg">
                    {fixturesData.cases.map((c) => (
                      <div
                        key={c.name}
                        className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white"
                      >
                        <div className="space-y-1">
                          <div className="text-xs font-mono-tabular font-semibold text-[#243E35]">
                            Case: {c.name} · {c.entries.length}{' '}
                            {c.entries.length === 1 ? 'entry' : 'entries'}
                          </div>
                          <p className="text-xs text-[#5C6B61]">Expected contract: {c.expect}</p>
                          <div className="text-[11px] text-[#5C6B61] italic">
                            {c.entries.map((txt, idx) => (
                              <span key={idx} className="block">
                                “{txt}”
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiRequest('/api/import', {
                              entries: c.entries.map((txt, i) => ({
                                text: txt,
                                mood: null,
                                tags: [c.name],
                                created_at: new Date(
                                  Date.now() - (c.entries.length - i) * 3600000
                                ).toISOString(),
                              })),
                            });
                            await refreshState();
                            setActivePage('journal');
                            showNotice(
                              `Imported "${c.name}" synthetic fixture entries into your journal.`
                            );
                          }}
                          className="px-3.5 py-2 text-xs font-medium text-[#243E35] bg-[#EEF3EA] border border-[#C9D8C0] rounded-lg hover:bg-[#E2ECDC] whitespace-nowrap shrink-0 self-start md:self-center"
                        >
                          Load case into journal
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Next-Agent Prompt Card */}
            <div className="bg-white border border-[#E4E8DF] rounded-xl p-6 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-[#243E35]">Give this to the next agent</h2>
                <button
                  id="copy-handoff"
                  type="button"
                  onClick={async () => {
                    const text = continuityDocs['NEXT-AGENT-PROMPT.txt'] || '';
                    try {
                      await navigator.clipboard.writeText(text);
                      showNotice('Next-agent prompt copied to clipboard.');
                    } catch {
                      showNotice('Select the prompt text below and copy with your keyboard.');
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-[#243E35] bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg hover:bg-[#EEF3EA] whitespace-nowrap shrink-0"
                >
                  <Copy className="w-3.5 h-3.5 text-[#345D48]" />
                  Copy prompt
                </button>
              </div>
              <label htmlFor="handoff-prompt" className="sr-only">
                Next agent prompt
              </label>
              <textarea
                id="handoff-prompt"
                readOnly
                rows={12}
                value={continuityDocs['NEXT-AGENT-PROMPT.txt'] || 'Loading continuity prompt…'}
                className="w-full p-4 text-xs font-mono-tabular bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg text-[#243E35] leading-relaxed"
              />
            </div>

            {/* Current Handoff & Verification Report */}
            <div className="bg-white border border-[#E4E8DF] rounded-xl p-6 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-[#243E35] mb-3">
                  Current handoff (AGENT-HANDOFF.md)
                </h2>
                <pre
                  id="handoff-state"
                  className="p-4 text-xs font-mono-tabular bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg whitespace-pre-wrap break-words text-[#243E35] leading-relaxed max-h-96 overflow-y-auto"
                >
                  {continuityDocs['AGENT-HANDOFF.md'] || 'Loading…'}
                </pre>
              </div>

              <details className="pt-4 border-t border-[#E4E8DF]">
                <summary className="text-sm font-semibold text-[#243E35] cursor-pointer">
                  Verification report (TEST-REPORT.md)
                </summary>
                <pre
                  id="test-report"
                  className="mt-3 p-4 text-xs font-mono-tabular bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg whitespace-pre-wrap break-words text-[#243E35] leading-relaxed"
                >
                  {continuityDocs['TEST-REPORT.md'] || 'Loading…'}
                </pre>
              </details>

              <details className="pt-4 border-t border-[#E4E8DF]">
                <summary className="text-sm font-semibold text-[#243E35] cursor-pointer">
                  Architecture & Known Issues (ARCHITECTURE.md · KNOWN-ISSUES.md)
                </summary>
                <pre className="mt-3 p-4 text-xs font-mono-tabular bg-[#FAFBF8] border border-[#E4E8DF] rounded-lg whitespace-pre-wrap break-words text-[#243E35] leading-relaxed">
                  {`${continuityDocs['ARCHITECTURE.md'] || ''}\n\n${
                    continuityDocs['KNOWN-ISSUES.md'] || ''
                  }`}
                </pre>
              </details>
            </div>
          </section>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-[#E4E8DF] py-6 mt-12">
        <div className="max-w-[1320px] mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-[#5C6B61]">
          <div>PatternSight · Notice. Reflect. Discover what helps.</div>
          <div>Local-first reflective journal · Evidence-grounded · No clinical diagnosis</div>
        </div>
      </footer>
    </div>
  );
}
