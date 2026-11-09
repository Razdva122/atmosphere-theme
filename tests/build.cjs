const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');

const runtime = process.env.CYTV_RUNTIME;
assert(runtime, 'Set CYTV_RUNTIME to the trusted Clean Your TV webOS checkout');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atmosphere-theme-test-'));
function git(...args) {
  return execFileSync('git', ['-C', fixture, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
function build(selectedRuntime = runtime) {
  return spawnSync(process.execPath, ['--max-old-space-size=256', path.join(fixture, 'build.cjs'), '--runtime', selectedRuntime], {encoding: 'utf8', timeout: 30000});
}
function commit() {
  git('add', '-A');
  git('-c', 'user.name=Theme test', '-c', 'user.email=theme-test@example.invalid', 'commit', '-qm', 'Test source');
}
try {
  execFileSync('git', ['clone', '--quiet', '--shared', root, fixture], {stdio: 'pipe'});
  let result = build();
  assert.equal(result.status, 0, result.stderr);
  const packagePath = path.join(fixture, 'dist/atmosphere.theme.json');
  const first = fs.readFileSync(packagePath);
  result = build();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(packagePath), first, 'identical committed source produces identical bytes');
  const envelope = JSON.parse(first);
  const data = require(path.join(path.resolve(runtime), 'launcher/theme-data.js'));
  const homeVersion=require(path.join(path.resolve(runtime),'launcher/appinfo.json')).version;
  const manifest = data.verify(data.unpackEnvelope(envelope, homeVersion), homeVersion).manifest;
  assert.equal(manifest.source.commit, git('rev-parse', 'HEAD'), 'source provenance is the actual theme commit');
  assert.equal(manifest.id, JSON.parse(fs.readFileSync(path.join(root,'theme.json'))).id);
  assert.deepEqual(manifest.layout.weather.formats, []);
  assert(manifest.requires.capabilities.includes('weather-v1')); 

  fs.appendFileSync(path.join(fixture, 'theme.css'), '\n.ctv-home { color: red; }\n');
  result = build();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Commit source changes/);
  assert.deepEqual(fs.readFileSync(packagePath), first, 'rejected source cannot overwrite the last package');
  git('restore', 'theme.css');

  const ignoredSource = JSON.parse(fs.readFileSync(path.join(fixture, 'theme.json')));
  fs.mkdirSync(path.join(fixture, 'dist/inputs'), {recursive: true});
  fs.copyFileSync(path.join(fixture, 'assets/wallpaper.png'), path.join(fixture, 'dist/inputs/wallpaper.png'));
  ignoredSource.assets[0].path = 'dist/inputs/wallpaper.png';
  fs.writeFileSync(path.join(fixture, 'theme.json'), JSON.stringify(ignoredSource));
  commit();
  assert.equal(git('status', '--porcelain'), '', 'ignored input does not dirty the source tree');
  result = build();
  assert.notEqual(result.status, 0, 'an ignored asset absent from the source commit must be rejected');
  assert.match(result.stderr, /Input must match committed source/);
  assert.deepEqual(fs.readFileSync(packagePath), first, 'uncommitted input cannot overwrite the last package');
  git('restore', '--source', 'HEAD~1', 'theme.json');
  commit();

  const source = JSON.parse(fs.readFileSync(path.join(fixture, 'theme.json')));
  source.assets[0].path = '../outside.png';
  fs.writeFileSync(path.join(fixture, 'theme.json'), JSON.stringify(source));
  commit();
  result = build();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsafe local path/);

  git('restore', '--source', 'HEAD~1', 'theme.json');
  fs.unlinkSync(path.join(fixture, 'assets/wallpaper.png'));
  fs.symlinkSync(path.join(root, 'assets/wallpaper.png'), path.join(fixture, 'assets/wallpaper.png'));
  commit();
  result = build();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Symlink/);

  result = build(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Runtime must descend from/);
  console.log('Passed: deterministic verified build, committed provenance, ignored-input rejection, dirty-source preservation, path/symlink rejection, runtime ancestry.');
} finally {
  fs.rmSync(fixture, {recursive: true, force: true});
}
