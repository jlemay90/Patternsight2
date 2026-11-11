'use strict';
const $ = (selector) => document.querySelector(selector);
let state = { entries: [], feedback: [] }, mood = null, searchQuery = '';
const moodNames = ['Low', 'Off', 'Okay', 'Good', 'Great'];

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function notice(text, error = false) {
  $('#notice').textContent = text;
  $('#notice').hidden = false;
  $('#notice').className = error ? 'error' : '';
}

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}

async function busy(button, action) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = 'Working…';
  try { await action(); }
  catch (error) { notice(error.message, true); }
  finally { button.disabled = false; button.textContent = old; }
}

function page(name) {
  document.querySelectorAll('.page').forEach(p => p.hidden = p.id !== `page-${name}`);
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  if (name === 'continuity') loadContinuity().catch(e => notice(e.message, true));
}

document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => page(b.dataset.page)));
$('#today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

document.querySelectorAll('[data-mood]').forEach(b => b.addEventListener('click', () => {
  mood = mood === Number(b.dataset.mood) ? null : Number(b.dataset.mood);
  document.querySelectorAll('[data-mood]').forEach(x => x.setAttribute('aria-pressed', String(Number(x.dataset.mood) === mood)));
}));

$('#search-entries')?.addEventListener('input', event => {
  searchQuery = event.target.value.trim().toLowerCase();
  renderEntries();
});

function startEdit(entry) {
  $('#edit-entry-id').value = entry.id;
  $('#entry-text').value = entry.text;
  $('#tags').value = entry.tags.join(', ');
  mood = entry.mood;
  document.querySelectorAll('[data-mood]').forEach(x => x.setAttribute('aria-pressed', String(Number(x.dataset.mood) === mood)));
  $('#composer-title').textContent = 'Edit reflection';
  $('#cancel-edit').hidden = false;
  $('#entry-text').focus();
}

function resetComposer() {
  $('#entry-form').reset();
  $('#edit-entry-id').value = '';
  $('#composer-title').textContent = 'What’s on your mind?';
  $('#cancel-edit').hidden = true;
  mood = null;
  document.querySelectorAll('[data-mood]').forEach(b => b.setAttribute('aria-pressed', 'false'));
}

$('#cancel-edit')?.addEventListener('click', resetComposer);

function renderEntries() {
  const target = $('#entries');
  target.replaceChildren();
  const filtered = state.entries.filter(entry => {
    if (!searchQuery) return true;
    return entry.text.toLowerCase().includes(searchQuery) ||
      entry.tags.some(t => t.toLowerCase().includes(searchQuery));
  });
  $('#entry-count').textContent = state.entries.length;
  if (!filtered.length) {
    const empty = el('div', undefined, 'empty');
    empty.append(
      el('strong', state.entries.length ? 'No matching reflections.' : 'Every pattern starts somewhere.'),
      el('span', state.entries.length ? 'Try clearing or changing your search filter.' : 'Save your first reflection. There’s no right way to begin.')
    );
    target.append(empty);
  }
  filtered.forEach(entry => {
    const card = el('article', undefined, 'card entry');
    card.id = `entry-${entry.id}`;
    const meta = el('div', undefined, 'entry-meta');
    meta.append(el('time', new Date(entry.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })));
    if (entry.mood) meta.append(el('span', `${moodNames[entry.mood - 1]} · ${entry.mood}/5`, 'pill'));

    const editBtn = el('button', 'Edit', 'delete-entry');
    editBtn.setAttribute('aria-label', 'Edit reflection');
    editBtn.addEventListener('click', () => startEdit(entry));

    const remove = el('button', 'Delete', 'delete-entry');
    remove.setAttribute('aria-label', 'Delete reflection');
    remove.addEventListener('click', () => {
      if (confirm('Delete this reflection? Saved analyses and corrections will also be cleared because they may quote it.')) {
        busy(remove, async () => {
          await api('/api/delete', { id: entry.id });
          $('#messages').replaceChildren();
          await refresh();
          notice('Reflection and derived analysis deleted.');
        });
      }
    });
    meta.append(editBtn, remove);
    card.append(meta, el('p', entry.text));
    entry.tags.forEach(tag => card.append(el('span', tag, 'tag')));
    target.append(card);
  });

  const chart = $('#mood-chart');
  chart.replaceChildren();
  const rated = state.entries.filter(e => e.mood).slice(0, 14).reverse();
  if (!rated.length) chart.append(el('p', 'Your rhythm will take shape as you check in.', 'muted'));
  else {
    const bars = el('div', undefined, 'chart-bars');
    bars.setAttribute('role', 'img');
    bars.setAttribute('aria-label', rated.map(e => `${new Date(e.created_at).toLocaleDateString()}: ${e.mood} of 5`).join('; '));
    rated.forEach(e => {
      const wrap = el('div', undefined, 'chart-bar-wrap');
      const bar = el('span', undefined, `chart-bar mood-height-${e.mood}`);
      bar.title = `${new Date(e.created_at).toLocaleString()}: ${e.mood}/5`;
      wrap.append(bar, el('small', new Date(e.created_at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })));
      bars.append(wrap);
    });
    chart.append(bars);
  }
}

function evidenceNodes(evidence) {
  return evidence.map(item => {
    const entry = state.entries.find(e => e.id === item.entry_id);
    const a = el('a', `“${item.quote}”`, 'evidence');
    a.href = `#entry-${item.entry_id}`;
    a.append(el('small', entry ? new Date(entry.created_at).toLocaleString() + ' · View reflection ›' : 'View reflection ›'));
    a.addEventListener('click', () => page('journal'));
    return a;
  });
}

function renderInsights() {
  const target = $('#insights');
  target.replaceChildren();
  const analysis = state.analysis;
  if (!analysis) {
    $('#analysis-summary').textContent = '';
    const empty = el('div', undefined, 'empty');
    empty.append(el('strong', 'Let the evidence lead.'), el('span', 'Connect Gemini or inspect local evidence. No patterns are invented to fill this space.'));
    target.append(empty);
    return;
  }
  const stale = state.entries.some(e => !analysis.entry_ids.includes(e.id));
  $('#analysis-summary').textContent = `${analysis.summary} · ${new Date(analysis.created_at).toLocaleString()}${stale ? ' · New entries are not included. Run analysis again to update.' : ''}`;
  if (!analysis.insights.length) target.append(el('p', 'No supported patterns yet. Keep reflecting; sparse evidence is a valid result.', 'empty'));
  analysis.insights.forEach(insight => {
    const card = el('article', undefined, 'card insight');
    card.append(
      el('span', `${insight.strength.toUpperCase()} EVIDENCE · HYPOTHESIS`, 'eyebrow'),
      el('h3', insight.title),
      el('p', insight.observation),
      ...evidenceNodes(insight.evidence)
    );
    [['Another explanation & counterexamples', insight.alternative], ['A question to sit with', insight.question], ['A small experiment', insight.experiment]].forEach(([title, text]) =>
      card.append(el('h4', title), el('p', text))
    );
    card.append(el('h4', 'Does this fit your experience?'));
    const prior = state.feedback.find(f => f.insight_id === insight.id);
    const note = el('input', undefined, 'correction');
    note.placeholder = 'Add a correction or context (optional)';
    note.maxLength = 2000;
    note.setAttribute('aria-label', `Correction for ${insight.title}`);
    note.value = prior?.note || '';
    const buttons = el('div', undefined, 'feedback');
    [['fits', 'Fits'], ['partly', 'Partly fits'], ['doesnt-fit', 'Doesn’t fit']].forEach(([rating, label]) => {
      const b = el('button', label, prior?.rating === rating ? 'selected' : '');
      b.addEventListener('click', () => busy(b, async () => {
        await api('/api/feedback', { insight_id: insight.id, rating, note: note.value });
        await refresh();
        notice('Your feedback is saved and will accompany future AI requests.');
      }));
      buttons.append(b);
    });
    card.append(note, buttons);
    target.append(card);
  });
}

async function refresh() {
  state = await api('/api/state');
  renderEntries();
  renderInsights();
  $('#connection-text').textContent = state.ai_connected ? 'Gemini configured · server-side' : 'Local journal · AI not connected';
  $('#connection-dot').classList.toggle('connected', state.ai_connected);
  const context = `AI context: ${state.context_count} most recent entries, up to 60 entries / 60,000 text characters, plus up to 30 saved corrections. Model: ${state.model}.`;
  $('#context-description').textContent = context;
  $('#chat-context').textContent = context;
  $('#ai-setup').textContent = state.ai_connected
    ? 'Configured server-side. AI interpretations remain hypotheses.'
    : 'To connect: configure GEMINI_API_KEY in .env or AI Studio Secrets, then restart the server.';
}

$('#entry-form').addEventListener('submit', event => {
  event.preventDefault();
  busy(event.submitter, async () => {
    const editId = $('#edit-entry-id').value;
    const payload = {
      text: $('#entry-text').value,
      mood,
      tags: $('#tags').value.split(',').map(t => t.trim()).filter(Boolean)
    };
    if (editId) {
      await api('/api/edit', { id: editId, ...payload });
      resetComposer();
      await refresh();
      notice('Reflection updated.');
    } else {
      await api('/api/entries', payload);
      resetComposer();
      await refresh();
      notice('Reflection saved. A little more room to see clearly.');
    }
  });
});

$('#use-prompt').addEventListener('click', () => {
  $('#entry-text').value = 'What gave me a little more energy today?\n\n' + $('#entry-text').value;
  $('#entry-text').focus();
});

$('#analyze').addEventListener('click', event => busy(event.currentTarget, async () => {
  if (!$('#ai-consent').checked) throw new Error('Check the Google sharing box before requesting analysis.');
  await api('/api/analyze', { consent: true });
  await refresh();
  notice('Analysis ready. Explore the evidence and tell us what fits.');
}));

$('#local-analyze')?.addEventListener('click', event => busy(event.currentTarget, async () => {
  await api('/api/local-analyze', {});
  await refresh();
  notice('Local deterministic evidence inspection complete.');
}));

function appendChatExchange(question, result) {
  $('#messages .chat-welcome')?.remove();
  const user = el('div', undefined, 'message user');
  user.append(el('strong', 'You'), el('span', question));
  const answer = el('div', undefined, 'message');
  answer.append(el('strong', 'PatternSight · reflection, not diagnosis'), el('span', result.answer), ...evidenceNodes(result.evidence || []));
  if (!result.evidence || !result.evidence.length) {
    answer.append(el('small', 'No matching evidence quotes in the selected journal entries.', 'muted'));
  }
  $('#messages').append(user, answer);
  $('#question').value = '';
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

$('#chat-form').addEventListener('submit', event => {
  event.preventDefault();
  busy(event.submitter, async () => {
    if (!$('#ai-consent').checked) throw new Error('Enable Google sharing in Hidden layers before asking a reflection question.');
    const question = $('#question').value;
    const result = await api('/api/chat', { consent: true, question });
    appendChatExchange(question, result);
  });
});

$('#local-ask')?.addEventListener('click', event => busy(event.currentTarget, async () => {
  const question = $('#question').value.trim();
  if (!question) throw new Error('Ask a question of 1–2,000 characters.');
  const result = await api('/api/local-chat', { question });
  appendChatExchange(question, result);
}));

$('#export').addEventListener('click', event => busy(event.currentTarget, async () => {
  const result = await api('/api/export');
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = `patternsight-journal-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice('Journal export downloaded. It contains personal text; keep it separate from code handoffs.');
}));

async function loadContinuity() {
  const docs = await api('/api/continuity');
  $('#handoff-prompt').value = docs['NEXT-AGENT-PROMPT.txt'];
  $('#handoff-state').textContent = docs['AGENT-HANDOFF.md'];
  $('#test-report').textContent = docs['TEST-REPORT.md'];
}

$('#copy-handoff').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#handoff-prompt').value);
    notice('Next-agent prompt copied. Attach the source package too.');
  } catch {
    $('#handoff-prompt').select();
    notice('Prompt selected. Copy it with your keyboard or selection menu.');
  }
});

refresh().catch(error => notice(error.message, true));
