"""Round-5 release audit BLOCKER fix: the engine version is declared on FIVE
surfaces (root package.json, src/index.ts LOOM_ENGINE_VERSION, the pure-python
pyproject + __version__, and the native wheel's pyproject/Cargo pair). The
3.1.0 release shipped with three of them stale - the native lane rebuilt 3.0.0
wheels and PyPI rejected the duplicate upload, and the runtime constants
disagreed with their own packaging. This test pins EVERY surface to the same
string so the drift class is dead: any future bump that misses a file fails
pytest before it can reach a tag.

(The TS side already pins LOOM_ENGINE_VERSION == package.json in
tests/smoke.test.ts; reading index.ts here too would be a fragile regex over
TS source, so this test covers the json/toml/python surfaces and trusts the
TS suite for the TS constant.)
"""
import io
import json
import os
import re

import loom_engine

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _read(path):
    return io.open(os.path.join(ROOT, path), encoding="utf-8").read()


def _toml_version(path):
    m = re.search(r'^version\s*=\s*"([^"]+)"', _read(path), re.M)
    assert m, "no version field in " + path
    return m.group(1)


def test_every_version_surface_agrees():
    pkg = json.loads(_read("package.json"))["version"]
    assert loom_engine.__version__ == pkg, (
        "loom_engine.__version__ (%s) != package.json (%s)"
        % (loom_engine.__version__, pkg))
    assert _toml_version("python/pyproject.toml") == pkg, (
        "python/pyproject.toml drifted from package.json")
    assert _toml_version("rust/loom_py/pyproject.toml") == pkg, (
        "rust/loom_py/pyproject.toml (the native wheel maturin builds) "
        "drifted from package.json - this exact drift burned the 3.1.0 "
        "native publish")
    assert _toml_version("rust/loom_py/Cargo.toml") == pkg, (
        "rust/loom_py/Cargo.toml drifted from package.json")
    # Round-6 audit LOW: the LOCKFILES are packaging artifacts too - the
    # 3.1.0 round left rust/loom_py/Cargo.lock at the old version even after
    # the manifests moved. Pin both lockfiles' root-package entries.
    lock = _read("rust/loom_py/Cargo.lock")
    m = re.search(r'name = "loom_py"\nversion = "([^"]+)"', lock)
    assert m and m.group(1) == pkg, (
        "rust/loom_py/Cargo.lock root entry (%s) drifted from package.json (%s)"
        % (m.group(1) if m else "missing", pkg))
    npm_lock = json.loads(_read("package-lock.json"))
    assert npm_lock.get("version") == pkg, (
        "package-lock.json root version drifted from package.json")


def test_native_runtime_constant_is_not_a_literal():
    # The 0.1.0 bug: loom_py's version() hardcoded a string. It must read
    # CARGO_PKG_VERSION so the runtime tracks the packaging by construction.
    src = _read("rust/loom_py/src/lib.rs")
    assert 'env!("CARGO_PKG_VERSION")' in src, (
        "loom_py version() must track Cargo.toml via env!, never a literal")
    assert re.search(r'fn version\(\) -> String \{[^}]*"\d+\.\d+\.\d+"', src) is None, (
        "a hardcoded semver literal crept back into loom_py version()")
