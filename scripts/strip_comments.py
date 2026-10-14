#!/usr/bin/env python3
"""Strip # comments from tracked Python sources (one-off cleanup tool).

Character-precise via tokenize: never touches string literals, docstrings,
shebangs, or keep-directives (# noqa, # type: ignore, ...).
"""
import io
import json
import pathlib
import re
import subprocess
import sys
import tokenize

REPO = pathlib.Path(__file__).resolve().parent.parent
SCAN_DIRS = ('src', 'scripts', 'tools', 'tests')
SKIP_DIRS = {'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__',
             '.git', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'examples'}
KEEP_PATTERNS = ('noqa', 'type: ignore', 'pragma', 'pylint', 'fmt:', 'nosec', 'coverage:')

def collect_files():
    out = []
    for d in SCAN_DIRS:
        p = REPO / d
        if not p.exists():
            continue
        for f in p.rglob('*.py'):
            if any(s in SKIP_DIRS for s in f.parts):
                continue
            out.append(f)
    return sorted(out)

def is_keep_comment(text):
    lower = text.lower()
    return any(k in lower for k in KEEP_PATTERNS)

def strip_comments(text):
    """Return (new_text, removed_count). Character-precise; never raises on tokenize."""
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except tokenize.TokenError:
        return text, 0

    removed = 0
    drop = []  # (start_char, end_char) into original text
    for tok in tokens:
        if tok.type != tokenize.COMMENT:
            continue
        comment = tok.string
        if is_keep_comment(comment):
            continue
        # line bounds in characters
        line_start = text.rfind('\n', 0, tok.start[1]) + 1
        line_end = text.find('\n', tok.end[1])
        if line_end == -1:
            line_end = len(text)
        prefix = text[line_start:tok.start[1]]
        if prefix.strip() == '':
            # full-line comment: remove whole line including its newline
            drop.append((line_start, line_end + 1))
            removed += 1
        else:
            # trailing comment: remove from last code char to end of comment,
            # keep the newline; also eat whitespace between code and #
            j = tok.start[1]
            while j > line_start and text[j-1] in ' \t':
                j -= 1
            drop.append((j, tok.end[1]))
            removed += 1

    if not drop:
        return text, 0

    # delete from end to start so earlier offsets stay valid
    chars = list(text)
    for start, end in sorted(set(drop), reverse=True):
        del chars[start:end]
    new_text = ''.join(chars)

    # collapse runs of >3 blank lines (created by removing whole comment lines)
    # down to the PEP8 two-blank-line separator; never touch 1-2 blank lines
    new_text = re.sub(r'\n{4,}', '\n\n\n', new_text)
    if new_text and not new_text.endswith('\n'):
        new_text += '\n'
    return new_text, removed

def py_compile_all(files):
    failures = []
    for f in files:
        r = subprocess.run([sys.executable, '-c',
                            f"import py_compile; py_compile.compile('{f}', doraise=True)"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            err = (r.stderr.strip().splitlines() or ['unknown'])[-1]
            failures.append({'file': str(f.relative_to(REPO)), 'error': err})
    return failures

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    files = collect_files()
    print(f"Scanning {len(files)} .py files under {SCAN_DIRS}...")

    per_file = {}
    changed_files = []
    total = 0
    errors = []
    compile_failures = []

    for f in files:
        try:
            original = f.read_text()
        except Exception as e:
            errors.append({'file': str(f), 'error': f'read: {e}'})
            continue
        # only strip files that compile cleanly right now — never risk breaking
        # a file that already has latent syntax issues
        r = subprocess.run([sys.executable, '-c',
                            f"import py_compile; py_compile.compile('{f}', doraise=True)"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            compile_failures.append({'file': str(f.relative_to(REPO)),
                                     'error': (r.stderr.strip().splitlines() or ['unknown'])[-1]})
            continue
        try:
            new_text, n = strip_comments(original)
        except Exception as e:
            errors.append({'file': str(f.relative_to(REPO)), 'error': str(e)})
            continue
        if n:
            per_file[str(f.relative_to(REPO))] = n
            total += n
            changed_files.append(f)
            if args.apply:
                f.write_text(new_text)

    mode = 'APPLY' if args.apply else 'DRY RUN'
    print(f"\n{mode}: {total} comment lines removable from {len(changed_files)} files")
    print("\nTop 15 files:")
    for f, n in sorted(per_file.items(), key=lambda x: -x[1])[:15]:
        print(f"  {n:4d}  {f}")
    if errors:
        print(f"\n{len(errors)} files skipped (read errors):")
        for e in errors[:10]:
            print(f"  {e['file']}: {e['error']}")
    if compile_failures:
        print(f"\n{len(compile_failures)} files SKIPPED — did not compile before stripping:")
        for x in compile_failures[:10]:
            print(f"  {x['file']}: {x['error']}")

    if not args.apply:
        (REPO / 'strip-comments-report.json').write_text(json.dumps(
            {'dry_run': True, 'total_removable': total, 'per_file': per_file,
             'changed_files': [str(f.relative_to(REPO)) for f in changed_files],
             'errors': errors, 'compile_failures': compile_failures}, indent=2))
        print("\nRe-run with --apply to write changes.")
        return

    print("\nVerifying py_compile on all files...")
    failures = py_compile_all(files)
    if failures:
        print(f"\n!!! {len(failures)} compile failures — DO NOT COMMIT:")
        for x in failures[:10]:
            print(f"  {x['file']}: {x['error']}")
        sys.exit(1)
    print("py_compile OK.")
    (REPO / 'strip-comments-report.json').write_text(json.dumps(
        {'dry_run': False, 'total_removed': total, 'per_file': per_file,
         'changed_files': [str(f.relative_to(REPO)) for f in changed_files],
         'errors': errors, 'compile_failures': compile_failures,
         'post_compile_failures': len(failures)}, indent=2))

if __name__ == '__main__':
    main()
