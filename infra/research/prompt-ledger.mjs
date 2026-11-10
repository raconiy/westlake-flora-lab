import {createHash, randomUUID} from 'node:crypto';
import {open, rename} from 'node:fs/promises';
import {join} from 'node:path';

async function persist(path, record) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(record) + '\n', 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

// Only the model request body is archived. Transport headers stay in the caller.
export function privatePromptLedger(directory) {
  return async function start(task, wireBody) {
    const attemptId = randomUUID();
    const base = join(directory, attemptId);
    await persist(base + '.request.json', {
      version: 1, attemptId, taskId: task.id, role: task.role, purpose: task.title,
      parents: task.priorDeliveries.map(d => d.id), startedAtMs: Date.now(),
      bodySha256: createHash('sha256').update(wireBody, 'utf8').digest('hex'), wireBody
    });
    return async outcome => {
      await persist(base + '.result.json', {attemptId, endedAtMs: Date.now(), ...outcome});
      return attemptId;
    };
  };
}
