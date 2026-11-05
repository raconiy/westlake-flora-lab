import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Archived sources are .txt so changed-tests discovery cannot execute archived
// tests, and TypeScript cannot include old engines in the application build.
// Only these two pinned engine controls are executable, in memory, for audits.
async function control(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const javascript = stripTypeScriptTypes(source).replace(
    /from\s+(['"])([^'"]+)\1/g,
    (_, quote, specifier) => `from ${quote}${import.meta.resolve(specifier.replace('../../lib/', './'))}${quote}`,
  );
  return (await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)).buildPlant;
}

export const buildMain = await control('../evidence/osmanthus-recovery/snapshots/plant-engine.ts.29f02d6.txt');
export const buildRecovered = await control('../evidence/osmanthus-recovery/inherited-7a541058/osmanthus-refinement/recovered-curved.ts.txt');
