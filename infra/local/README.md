# Local execution layer

Requires Node.js 24, Git, official Codex CLI, and an already authorized GPT-Load gateway on loopback port 3001. This repository does not contain account authorization or keys.

Private runtime paths relative to the repository root:

- work/gpt-load-runtime/data/auth.key: local GPT-Load management key
- work/gpt-load-runtime/data/westlake-client.key: least-privilege gateway client AccessKey
- work/community-runtime/relay.key: the server-side community relay secret

These paths are ignored by Git. Store each key through the relevant local/hosted configuration flow, never by editing tracked source. For a new gateway, follow the upstream GPT-Load README; passwords and TOTP lists are not OAuth credential files.

Start: `node infra/local/start-gpt-load-cluster.mjs`. It launches the coordinator and three workers, with GPT-Load / gpt-6.1-sol / high and automatic checks. Set CODEX_BIN if the CLI is not on PATH.

Start outbound community bridge: `NODE_USE_ENV_PROXY=1 node infra/local/community-relay.mjs`. This respects the current environment network proxy; the gateway/coordinator remain loopback services. Include localhost and 127.0.0.1 in NO_PROXY.

Operator flow:

1. `NODE_USE_ENV_PROXY=1 node infra/local/community-operator.mjs review` reads structured suggestions.
2. The lead checks source, scope and acceptance criteria, then writes a reviewed task JSON with title, prompt and kind (code or research).
3. `NODE_USE_ENV_PROXY=1 node infra/local/community-operator.mjs assign SUGGESTION_ID reviewed-task.json` queues it and links the public record.
4. Workers use isolated Git worktrees. Validation failure and partial changes remain explicit. Public suggestions never directly execute arbitrary shell commands or automatically merge source.
5. Lead review, integration, tests and GitHub push precede Pages publication. The relay synchronizes actual task states to the public board.

The bridge must remain running for live model replies; D1 stores suggestions and queued questions independently while it is offline. This is not a cloud-hosted model gateway. Test: `node --test infra/local/test/*.test.mjs`.

Worker readiness defaults to `changed-tests`: typecheck, staged/unstaged diff checks, and changed/new or exact-stem sibling `.test.mjs` files selected from Git status. A result of `passed_scoped` is ready for lead review; `passed_checks_only` means no tests were selected. Receipts include the selection and coverage limits. Neither status grants merge or release approval.

The lead must still validate the complete combined change and pass the full GitHub Actions suite before publication. Set `SWARM_VALIDATION_SCOPE=operator-defined` or `full` to restore the launcher’s full command list. Replace workers only while the cluster is idle; changing source or environment does not update running workers.
