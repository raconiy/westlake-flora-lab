import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureSkyColour, captureSunDirection} from './capture-atmosphere.ts';

const luminance = c => .2126*c.r + .7152*c.g + .0722*c.b;
const toward = (azimuth, elevation) => new THREE.Vector3(
  Math.cos(elevation)*Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation)*Math.sin(azimuth));
// Directly opposite the sun in azimuth, where the aureole does not reach.
const antisolar = Math.atan2(-captureSunDirection.z, -captureSunDirection.x);

test('sky darkens and turns bluer from horizon to zenith away from the sun', () => {
  let previous = captureSkyColour(toward(antisolar, .01));
  // Stop at 60 degrees: beyond it the ray swings back toward the sun over the zenith.
  for (let degrees = 5; degrees <= 60; degrees += 5) {
    const colour = captureSkyColour(toward(antisolar, degrees*Math.PI/180));
    assert.ok(luminance(colour) < luminance(previous), `luminance falls at ${degrees} degrees`);
    assert.ok(colour.b/colour.r > previous.b/previous.r, `blue fraction rises at ${degrees} degrees`);
    previous = colour.clone();
  }
});

test('photographed elevations reproduce the photographed display colours', () => {
  // Open-sky fit of photograph 01, display sRGB: about (200,228,250) at 4 degrees
  // and (140,176,234) at 26 degrees.
  for (const [degrees, expected] of [[4, [200,228,250]], [26, [140,176,234]]]) {
    const colour = captureSkyColour(toward(antisolar, degrees*Math.PI/180));
    const display = colour.clone().convertLinearToSRGB();
    for (const [k, channel] of ['r','g','b'].entries()) {
      assert.ok(Math.abs(display[channel]*255 - expected[k]) < 22, `${channel} at ${degrees} degrees: ${display[channel]*255}`);
    }
  }
});

test('the ambient sky excludes the solar disc and stays finite at the sun', () => {
  const atSun = captureSkyColour(captureSunDirection.clone());
  for (const v of [atSun.r, atSun.g, atSun.b]) assert.ok(Number.isFinite(v) && v < 2.5);
  const sameElevation = captureSkyColour(toward(antisolar, Math.asin(captureSunDirection.y)));
  assert.ok(luminance(atSun) > luminance(sameElevation), 'aureole brightens toward the sun');
});

test('the sun is above the horizon and unit length', () => {
  assert.ok(Math.abs(captureSunDirection.length() - 1) < 1e-12);
  assert.ok(captureSunDirection.y > .3);
});
