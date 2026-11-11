import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AnalysisResult, FeedbackItem, JournalEntry } from './engine.ts';

export function nowIso(): string {
  return new Date().toISOString();
}

export class Store {
  public readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = this.open();
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          mood INTEGER,
          tags TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS analyses (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS feedback (
          insight_id TEXT PRIMARY KEY,
          rating TEXT NOT NULL,
          note TEXT NOT NULL,
          insight TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        PRAGMA user_version=1;
      `);
    } finally {
      db.close();
    }
  }

  private open(): DatabaseSync {
    const db = new DatabaseSync(this.dbPath);
    db.exec('PRAGMA busy_timeout = 10000;');
    return db;
  }

  public entries(): JournalEntry[] {
    const db = this.open();
    try {
      const rows = db
        .prepare('SELECT id, text, mood, tags, created_at FROM entries ORDER BY created_at DESC, id DESC')
        .all() as Array<{
        id: string;
        text: string;
        mood: number | null;
        tags: string;
        created_at: string;
      }>;
      return rows.map((r) => ({
        id: r.id,
        text: r.text,
        mood: r.mood === null || r.mood === undefined ? null : Number(r.mood),
        tags: JSON.parse(r.tags || '[]'),
        created_at: r.created_at,
      }));
    } finally {
      db.close();
    }
  }

  public getEntry(id: string): JournalEntry | null {
    const db = this.open();
    try {
      const row = db
        .prepare('SELECT id, text, mood, tags, created_at FROM entries WHERE id = ?')
        .get(id) as
        | {
            id: string;
            text: string;
            mood: number | null;
            tags: string;
            created_at: string;
          }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        text: row.text,
        mood: row.mood === null || row.mood === undefined ? null : Number(row.mood),
        tags: JSON.parse(row.tags || '[]'),
        created_at: row.created_at,
      };
    } finally {
      db.close();
    }
  }

  public addEntry(id: string, text: string, mood: number | null, tags: string[], createdAt = nowIso()): JournalEntry {
    const db = this.open();
    try {
      db.prepare('INSERT INTO entries (id, text, mood, tags, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        text,
        mood,
        JSON.stringify(tags),
        createdAt
      );
      return { id, text, mood, tags, created_at: createdAt };
    } finally {
      db.close();
    }
  }

  public updateEntry(
    id: string,
    text: string,
    mood: number | null,
    tags: string[],
    createdAt?: string
  ): { updated: boolean; analysisCleared: boolean } {
    const existing = this.getEntry(id);
    if (!existing) {
      throw new Error('Entry not found.');
    }
    const textChanged = existing.text !== text;
    const finalCreatedAt = createdAt && createdAt.trim() ? createdAt.trim() : existing.created_at;
    const db = this.open();
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE entries SET text = ?, mood = ?, tags = ?, created_at = ? WHERE id = ?').run(
        text,
        mood,
        JSON.stringify(tags),
        finalCreatedAt,
        id
      );
      if (textChanged) {
        // Clear derived analyses & feedback if source text was edited so stored quotes never become invalid
        db.prepare('DELETE FROM analyses').run();
        db.prepare('DELETE FROM feedback').run();
      }
      db.exec('COMMIT');
      return { updated: true, analysisCleared: textChanged };
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    } finally {
      db.close();
    }
  }

  public deleteEntry(id: string): void {
    const db = this.open();
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('DELETE FROM entries WHERE id = ?').run(id);
      // Remove derived text and corrections that could quote deleted entries
      db.prepare('DELETE FROM analyses').run();
      db.prepare('DELETE FROM feedback').run();
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    } finally {
      db.close();
    }
  }

  public feedback(): FeedbackItem[] {
    const db = this.open();
    try {
      const rows = db
        .prepare('SELECT insight_id, rating, note, insight, created_at FROM feedback ORDER BY created_at DESC')
        .all() as unknown as FeedbackItem[];
      return rows.map((r) => ({ ...r }));
    } finally {
      db.close();
    }
  }

  public saveFeedback(
    insightId: string,
    rating: 'fits' | 'partly' | 'doesnt-fit',
    note: string,
    insight: unknown,
    createdAt = nowIso()
  ): void {
    const db = this.open();
    try {
      db.prepare(
        'INSERT OR REPLACE INTO feedback (insight_id, rating, note, insight, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(insightId, rating, note, JSON.stringify(insight), createdAt);
    } finally {
      db.close();
    }
  }

  public latest(): AnalysisResult | null {
    const db = this.open();
    try {
      const row = db
        .prepare('SELECT payload FROM analyses ORDER BY created_at DESC LIMIT 1')
        .get() as { payload: string } | undefined;
      return row ? (JSON.parse(row.payload) as AnalysisResult) : null;
    } finally {
      db.close();
    }
  }

  public saveAnalysis(id: string, payload: AnalysisResult, createdAt = nowIso()): void {
    const db = this.open();
    try {
      db.prepare('INSERT INTO analyses (id, payload, created_at) VALUES (?, ?, ?)').run(
        id,
        JSON.stringify(payload),
        createdAt
      );
    } finally {
      db.close();
    }
  }

  public context(filterIds?: string[]): JournalEntry[] {
    // Honest bounded context, shared by analysis and chat. Up to 60 newest entries and 60,000 text characters.
    const all = this.entries();
    const pool =
      Array.isArray(filterIds) && filterIds.length > 0
        ? all.filter((e) => filterIds.includes(e.id))
        : all;

    const selected: JournalEntry[] = [];
    let chars = 0;
    for (const entry of pool.slice(0, 60)) {
      const size = entry.text.length;
      if (chars + size > 60000) {
        break;
      }
      selected.push(entry);
      chars += size;
    }
    return selected.reverse();
  }
}
