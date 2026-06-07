"""Gate for the NFC-rejection hardening (Codex audit / Gemini blueprint).

Rejecting non-NFC strings at the canonical boundary is non-breaking ONLY IF every
existing golden fixture is already NFC (so no published hash changes). This walks
the repo's JSON (test vectors + any data fixtures), skipping build/vendor dirs,
and fails if any file contains non-NFC text.

Run: python tools/check_fixtures_nfc.py
"""
import os
import sys
import unicodedata

SKIP_DIRS = ('.git', 'node_modules', 'target', 'dist', 'pkg', '__pycache__')


def main():
    bad = []
    checked = 0
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if not f.endswith('.json'):
                continue
            p = os.path.join(root, f)
            try:
                c = open(p, encoding='utf-8').read()
            except Exception:
                continue
            checked += 1
            if c != unicodedata.normalize('NFC', c):
                bad.append(p)
    print('checked ' + str(checked) + ' json files')
    if bad:
        print('NON-NFC FIXTURES (rejection WOULD break these hashes):')
        for b in bad:
            print('  ' + b)
        return 1
    print('ALL JSON (incl. test_vectors) ARE NFC-CLEAN -> NFC rejection is non-breaking')
    return 0


if __name__ == '__main__':
    sys.exit(main())
