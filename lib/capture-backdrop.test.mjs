import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {backdropGeometry} from './capture-backdrop.ts';

const placement = JSON.parse(fs.readFileSync(new URL('../public/capture17/backdrop/backdrop.json', import.meta.url)));

test('every backdrop vertex lies on the stated cylinder and spans its height', () => {
  const g = backdropGeometry(placement, 48), p = g.getAttribute('position');
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i) - placement.centre[0], p.getZ(i) - placement.centre[2]);
    assert.ok(Math.abs(r - placement.radius) < 1e-3);
    low = Math.min(low, p.getY(i)); high = Math.max(high, p.getY(i));
  }
  assert.equal(low, placement.y[0]); assert.equal(high, placement.y[1]);
});

test('texture u follows azimuth from -Z toward +X, as the panorama was written', () => {
  const g = backdropGeometry(placement, 48), p = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getX(i) - placement.centre[0], -(p.getZ(i) - placement.centre[2]));
    const expected = (a - placement.azimuth[0]) / (placement.azimuth[1] - placement.azimuth[0]);
    assert.ok(Math.abs(uv.getX(i) - expected) < 1e-4);
  }
});

test('the backdrop stands beyond the modelled lawn core and below the far plane', () => {
  assert.ok(placement.radius > 60 && placement.radius < 200);
  assert.ok(placement.y[0] < 0, 'foot is hidden below the lawn datum');
});

test('degenerate placements are rejected', () => {
  assert.throws(() => backdropGeometry({...placement, radius: 0}));
  assert.throws(() => backdropGeometry({...placement, azimuth: [1, 1]}));
});
