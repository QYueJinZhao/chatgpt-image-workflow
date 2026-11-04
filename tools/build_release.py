"""Build the installable extension bundle and its exact file inventory."""
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    source = ROOT / "extension"
    version = json.loads((source / "manifest.json").read_text(encoding="utf-8"))["version"]
    name = f"chatgpt-automation-workbench-{version}.zip"
    archive = ROOT / "releases" / name
    files, text_count = [], 0
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise RuntimeError("Symlinks are not release inputs")
        if not path.is_file():
            continue
        relative = path.relative_to(source).as_posix()
        if path.name.startswith(".env") or path.suffix.lower() in {".pem", ".key", ".pfx", ".p12"} or "pairing" in path.name.lower():
            raise RuntimeError(f"Private file type cannot be packaged: {relative}")
        data = path.read_bytes()
        if path.suffix.lower() in {".js", ".json", ".css", ".html", ".md"}:
            text_count += 1
            text = data.decode("utf-8")
            if re.search(r"(?i)[a-z]:[/\\](?:users|work|ugit|temp)[/\\]", text):
                raise RuntimeError(f"Machine-specific path found in {relative}")
            if re.search(r"(?:from\s*['\"]node:|require\(['\"](?:node:|fs['\"]|child_process['\"]))", text):
                raise RuntimeError(f"Runtime Node import found in {relative}")
        files.append({"name": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for item in files:
            entry = zipfile.ZipInfo(item["name"], date_time=(2026, 11, 4, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            bundle.writestr(entry, (source / item["name"]).read_bytes(), compresslevel=9)
    data = archive.read_bytes()
    manifest = {"name": name, "version": version, "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "audit": {"status": "PASS", "scope": "static release inputs only", "version": version,
                          "files": len(files), "scannedTextFiles": text_count, "machinePaths": 0,
                          "privateFiles": 0, "runtimeNodeImports": 0}, "files": files}
    (ROOT / "release-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({key: manifest[key] for key in ("name", "version", "bytes", "sha256")}, ensure_ascii=False))

if __name__ == "__main__":
    main()
