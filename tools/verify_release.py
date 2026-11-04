import hashlib, json, pathlib, zipfile
root = pathlib.Path(__file__).resolve().parent.parent
release = json.loads((root / 'release-manifest.json').read_text(encoding='utf-8'))
archive = root / 'releases' / release['name']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == release['sha256']
with zipfile.ZipFile(archive) as package:
    assert sorted(package.namelist()) == sorted(f['name'] for f in release['files'])
    for item in release['files']:
        name = item['name']
        assert '..' not in pathlib.PurePosixPath(name).parts and not name.startswith('/')
        expected = item['sha256']
        assert hashlib.sha256(package.read(name)).hexdigest() == expected, name
        assert hashlib.sha256((root / 'extension' / name).read_bytes()).hexdigest() == expected, name
print('PASS: version ' + release['version'] + ', ' + str(len(release['files'])) + ' extension files, ZIP and source hashes verified')
