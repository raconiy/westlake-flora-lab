import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {ncStateSource, referenceAssetUrl, selectReferencePhotos, specimenEvidence, specimenMaterialPriors, unsolvedProcesses} from './specimen-evidence.ts';
import {physicalPriors} from './physical-priors.ts';

const catalog = JSON.parse(readFileSync(new URL('../public/references/photo-attribution.json', import.meta.url), 'utf8'));
test('all seven species have distinct morphology, establishment and NC State sources', () => {
  assert.deepEqual(Object.keys(specimenEvidence).sort(), ['acer','camphor','ginkgo','iris','ophiopogon','osmanthus','oxalis']);
  for (const [id, evidence] of Object.entries(specimenEvidence)) {
    assert.equal(evidence.organs.length, 3);
    assert.equal(evidence.establishment.length, 4);
    assert.match(ncStateSource(id), /^https:\/\/plants.ces.ncsu.edu\/plants\/[a-z-]+\/$/);
    assert.ok(evidence.implemented && evidence.remaining);
  }
  assert.equal(unsolvedProcesses.length, 5);
});

test('manifest selects only the requested species, including legacy ginkgo filenames', () => {
  const expected = {ginkgo:3,osmanthus:1,iris:1,oxalis:1,camphor:1,acer:1,ophiopogon:1};
  for (const [id, count] of Object.entries(expected)) {
    const photos = selectReferencePhotos(catalog, id);
    assert.equal(photos.length, count, id);
    for (const photo of photos) {
      assert.ok(existsSync(new URL(`../public/references/${photo.file}`, import.meta.url)));
      assert.ok(photo.author && photo.license && photo.original && photo.source && photo.licenseUrl);
      assert.equal(photo.species ?? 'ginkgo', id);
    }
  }
});

test('explicit species overrides filename; malformed and unsafe attribution never renders', () => {
  const ginkgo = catalog[0];
  const invalid = [null, {}, {...ginkgo,species:'iris'}, {...ginkgo,file:'../ginkgo-habit.jpg'},
    {...ginkgo,author:''}, {...ginkgo,original:'javascript:alert(1)'}, {...ginkgo,licenseUrl:'bad-url'}];
  assert.deepEqual(selectReferencePhotos(invalid, 'ginkgo'), []);
  assert.deepEqual(selectReferencePhotos(null, 'ginkgo'), []);
  assert.equal(selectReferencePhotos([ginkgo,ginkgo], 'ginkgo').length, 1);
  assert.deepEqual(selectReferencePhotos([ginkgo], 'camphor'), []);
});

test('reference URLs preserve root, nested and absolute deployment bases', () => {
  assert.equal(referenceAssetUrl('/', 'ginkgo-habit.jpg'), '/references/ginkgo-habit.jpg');
  assert.equal(referenceAssetUrl('/westlake-flora-lab/', 'photo-attribution.json'), '/westlake-flora-lab/references/photo-attribution.json');
  assert.equal(referenceAssetUrl('/nested', 'iris-form.jpg'), '/nested/references/iris-form.jpg');
  assert.equal(referenceAssetUrl('https://example.org/lab/', 'acer-autumn.jpg'), 'https://example.org/lab/references/acer-autumn.jpg');
});

test('displayed material priors match the renderer baseline and reject invalid ages', () => {
  for (const id of Object.keys(specimenEvidence)) for (const age of [0,.5,3,45]) {
    assert.deepEqual(specimenMaterialPriors(id, age), physicalPriors(id, age));
    assert.equal(specimenMaterialPriors(id, age).sourceLevel, 'engineering-assumption');
  }
  for (const age of [-1,NaN,Infinity,-Infinity]) assert.equal(specimenMaterialPriors('ginkgo', age), null);
  assert.notEqual(specimenMaterialPriors('ginkgo', 0).youngModulusPa, specimenMaterialPriors('ginkgo', 3).youngModulusPa);
});
