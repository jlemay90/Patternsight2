"""Export committed tracked source plus complete Git history, excluding local data."""
import hashlib
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)


if git('status', '--porcelain').strip():
    raise SystemExit('Commit or preserve working changes first; export requires a clean working tree.')
files = git('ls-files', '-z').decode().strip('\0').split('\0')
for path in files:
    if path == '.env' or path.startswith(('data/', 'artifacts/')) or path.endswith(('.sqlite3', '.db')):
        raise SystemExit(f'Private/generated path is tracked; export stopped: {path}')
manifest = {'revision': git('rev-parse', 'HEAD').decode().strip(),
            'branch': git('branch', '--show-current').decode().strip(),
            'tags': git('tag', '--list').decode().splitlines(),
            'files': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in files}}
destination = root / 'artifacts/patternsight-handoff.zip'
destination.parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as temp:
    bundle = Path(temp) / 'patternsight.bundle'
    subprocess.run(['git', 'bundle', 'create', str(bundle), '--all'], cwd=root, check=True)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(root / path, path)
        archive.write(bundle, 'patternsight.bundle')
        archive.writestr('EXPORT-MANIFEST.json', json.dumps(manifest, indent=2))
print(f'Exported {len(files)} source files + Git bundle: {destination}')
