import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCaptureQuality} from './capture-quality.ts';

test('discrete desktop graphics get the full budget', () => {
  const q = chooseCaptureQuality({renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)', devicePixelRatio: 2, maxTextureSize: 16384});
  assert.equal(q.tier, 'high'); assert.equal(q.shadowMapSize, 4096); assert.equal(q.pixelRatio, 1.5);
});

test('phones, software rasterisers and unknown hardware never start at the full budget', () => {
  assert.equal(chooseCaptureQuality({renderer: 'Adreno (TM) 740', mobile: true}).tier, 'low');
  assert.equal(chooseCaptureQuality({renderer: 'Google SwiftShader'}).tier, 'low');
  assert.equal(chooseCaptureQuality({renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620)'}).tier, 'medium');
  assert.equal(chooseCaptureQuality({}).tier, 'medium');
  // A phone reporting a desktop-class name is still a phone.
  assert.equal(chooseCaptureQuality({renderer: 'NVIDIA Tegra', mobile: true}).tier, 'low');
});

test('budgets fall monotonically with tier', () => {
  const [h, m, l] = ['high', 'medium', 'low'].map(override => chooseCaptureQuality({override, devicePixelRatio: 3, maxTextureSize: 8192}));
  assert.ok(h.laminaePerTree > m.laminaePerTree && m.laminaePerTree > l.laminaePerTree);
  assert.ok(h.shadowMapSize > m.shadowMapSize && m.shadowMapSize > l.shadowMapSize);
  assert.ok(h.pixelRatio >= m.pixelRatio && m.pixelRatio >= l.pixelRatio);
});

test('an explicit request wins, an unknown one is ignored, and limits are respected', () => {
  assert.equal(chooseCaptureQuality({renderer: 'Google SwiftShader', override: 'high'}).tier, 'high');
  assert.equal(chooseCaptureQuality({renderer: 'NVIDIA GeForce RTX 5090', override: 'ultra'}).tier, 'high');
  assert.equal(chooseCaptureQuality({override: 'high', maxTextureSize: 2048}).shadowMapSize, 2048);
  assert.equal(chooseCaptureQuality({override: 'high', devicePixelRatio: NaN}).pixelRatio, 1);
});
