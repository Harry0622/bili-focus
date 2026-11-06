import test from 'node:test';
import assert from 'node:assert/strict';
import { appearancePalette, contrastRatio, normalizeAccentColor, DEFAULT_ACCENT } from '../shared/appearance.js';
import { normalizeSettings, validCover, coverThumbnail } from '../shared/model.js';
import { needsCleanupWarning, STORAGE_WARNING_BYTES } from '../shared/limits.js';

test('legacy settings receive the teal accent and cannot enable automatic cleanup', () => {
  assert.equal(normalizeSettings({}).accentColor, DEFAULT_ACCENT);
  assert.equal(normalizeSettings({autoCleanup:true}).autoCleanup, false);
  assert.equal(normalizeSettings({accentColor:'#AABBCC'}).accentColor, '#aabbcc');
});
test('custom colors reject malformed values and CSS injection', () => {
  for (const value of ['red', '#abc', '#zzzzzz', '#123456; background:url(https://evil.test)', '', null]) assert.equal(normalizeAccentColor(value), DEFAULT_ACCENT);
});
test('custom palettes keep small text and primary labels readable for extreme colors', () => {
  for (const color of ['#000000','#ffffff','#ffff00','#00ff00','#ff0000','#0000ff','#777777','#0f766e','#be3f64','#c0643a']) for (const dark of [false,true]) {
    const p = appearancePalette(color,dark);
    assert.ok(contrastRatio(p['--primary'],p['--on-primary']) >= 4.5, `${color}/${dark}: primary`);
    for (const foreground of ['--text','--muted','--accent']) for (const background of ['--bg','--surface','--raised','--selection']) assert.ok(contrastRatio(p[foreground],p[background]) >= 4.5, `${color}/${dark}: ${foreground}/${background}`);
  }
});
test('HTTP CDN covers are upgraded to HTTPS, while unrelated origins and credentials are rejected', () => {
  assert.equal(validCover('http://i1.hdslb.com/bfs/archive/test.jpg'),'https://i1.hdslb.com/bfs/archive/test.jpg');
  assert.equal(validCover('//i1.hdslb.com/a.png'),'https://i1.hdslb.com/a.png');
  assert.equal(coverThumbnail('http://i1.hdslb.com/bfs/archive/test.jpg'),'https://i1.hdslb.com/bfs/archive/test.jpg@160w.webp');
  assert.equal(coverThumbnail('https://i1.hdslb.com/bfs/archive/test.jpg?sign=x'),'https://i1.hdslb.com/bfs/archive/test.jpg?sign=x');
  for (const url of ['http://hdslb.com.evil.test/a.jpg','http://user:pass@i0.hdslb.com/a.jpg','http://i0.hdslb.com:8080/a.jpg','https://evil.test/cover.jpg']) assert.equal(validCover(url),'');
});
test('cleanup reminders use the exact greater-than-1GiB boundary', () => {
  for (const size of [0, 10*1024*1024, STORAGE_WARNING_BYTES, NaN, Infinity]) assert.equal(needsCleanupWarning(size),false);
  assert.equal(needsCleanupWarning(STORAGE_WARNING_BYTES+1),true);
});
