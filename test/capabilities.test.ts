import assert from 'node:assert/strict';
import test from 'node:test';
import { platformCapabilities } from '../src/capabilities.js';

test('capabilities expose both supported browsers without hiding surfaces', () => {
  assert.deepEqual(platformCapabilities.x.browsers, [
    { id: 'ego', label: 'ego lite' },
    { id: 'chrome', label: 'Chrome' },
  ]);
  assert.equal(platformCapabilities.x.supportsAccountVerification, true);
  assert.deepEqual(platformCapabilities.x.surfaces.map(surface => [surface.key, surface.supported]), [
    ['bookmarks', true],
    ['likes', true],
  ]);

  assert.equal(platformCapabilities.threads.supportsScheduledCollection, true);
  assert.deepEqual(platformCapabilities.threads.surfaces.map(surface => [surface.key, surface.supported]), [
    ['saved', true],
    ['reposts', true],
    ['likes', true],
  ]);
});
