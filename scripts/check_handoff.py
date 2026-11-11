"""Portable document/secret-boundary checks. Does not certify semantic accuracy."""
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
required = ['AGENTS.md', 'README.md', 'PROJECT-OVERVIEW.md', 'ARCHITECTURE.md',
            'CHANGELOG.md', 'DECISIONS.md', 'KNOWN-ISSUES.md', 'TEST-REPORT.md',
            'AGENT-HANDOFF.md', 'NEXT-AGENT-PROMPT.txt', 'skills/app-continuity/SKILL.md',
            '.env.example', 'requirements.txt', 'prompts/reflect-v1.txt', 'REPOSITORY.md']
missing = [p for p in required if not (root / p).is_file() or not (root / p).read_text().strip()]
assert not missing, f'Missing handoff files: {missing}'
tracked = subprocess.check_output(['git', 'ls-files'], cwd=root, text=True).splitlines()
assert not any(p == '.env' or p.startswith('data/') or p.endswith('.sqlite3') for p in tracked), 'Private files tracked'
print(f'PASS: {len(required)} continuity files present; tracked private paths excluded.')
