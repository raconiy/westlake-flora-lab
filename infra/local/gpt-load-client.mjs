import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local gateway credentials stay outside the published website and this source tree.
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.join(workspace, 'work/gpt-load-runtime/data');
const base = 'http://127.0.0.1:3001';

async function call(route, keyFile, body) {
  const key = (await fs.readFile(path.join(dataDir, keyFile), 'utf8')).trim();
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(body === undefined ? 15000 : 120000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Gateway HTTP ${response.status}: ${result.code ?? result.error?.code ?? 'request_failed'}`);
  return result;
}

export async function status() {
  const result = await call('/api/groups/1/credentials', 'auth.key');
  if (result.code !== 0) throw new Error('Gateway rejected status request');
  const items = result.data.items;
  // This project is configured for five distinct GPT-Load credentials. Keep
  // the override for staging and recovery, but make the production default
  // match the verified account pool instead of reporting a three-account
  // requirement.
  const required = Number(process.env.SWARM_REQUIRED_ACCOUNTS || 5);
  if (!Number.isInteger(required) || required < 1 || required > 5) throw new Error("Required account count must be 1–5");
  return {
    group: 'westlake-codex-local',
    requiredDistinctAccounts: required,
    accountRequirementMet: items.length >= required,
    connectedDistinctAccounts: items.length,
    fiveAccountRequirementMet: items.length >= 5,
    credentials: items.map(item => ({
      id: item.credential_id,
      status: item.effective_status,
      successes: item.recent_success_count,
      failures: item.recent_failure_count,
    })),
  };
}

export async function run(prompt) {
  if (!prompt?.trim()) throw new Error('Provide a nonempty prompt on stdin');
  return call('/v1/responses', 'westlake-client.key', {
    model: 'gpt-6.1-sol', reasoning: { effort: 'high' }, input: prompt, stream: false,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--status')) {
      console.log(JSON.stringify(await status(), null, 2));
    } else {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const result = await run(Buffer.concat(chunks).toString('utf8'));
      const text = (result.output ?? []).flatMap(item => item.content ?? [])
        .filter(item => item.type === 'output_text').map(item => item.text).join('\n');
      console.log(text);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
