# OpenClaw red teaming on OpenShift

This bundle runs Promptfoo 0.121.19 as a one-shot OpenShift Job in the existing
`redteam` namespace against the OpenClaw agent named `default`. It uses Promptfoo's native OpenClaw
provider, saves results to a PVC, disables Promptfoo telemetry and hosted red
team generation, and does not deploy Promptfoo's unauthenticated community UI.

## What it tests

The local-generation baseline covers excessive agency, tool discovery, PII
leakage, authorization failures, prompt extraction, Base64 transformations, and
known jailbreak templates. These tests can cause real agent actions. They are
not safe against a production agent or production data. See [COVERAGE.md](COVERAGE.md)
for the coverage model, available expansion options, and their cost and safety
tradeoffs.

## How it works

This is an LLM-assisted red-team evaluation, not a static manifest or network
scanner. Promptfoo coordinates two different systems:

1. The attacker/grader LLM (`openai:chat:gpt-4.1-mini` by default) helps create
   adversarial prompts from the configured purpose, plugins, and strategies.
2. Promptfoo sends each generated prompt to the OpenClaw `default` agent through
   the Gateway's OpenAI-compatible Chat Completions endpoint.
3. OpenClaw handles the prompt normally. It may read memory or files and invoke
   any tools that the test agent is permitted to use.
4. The attacker/grader LLM evaluates OpenClaw's response against the relevant
   security policy. Promptfoo records the response, grade, and explanation.
5. The Job saves machine-readable JSON and a generated Markdown report on the
   results PVC. `scripts/collect-results.sh` copies those artifacts locally.

```text
test configuration
       |
       v
Promptfoo <----> attacker/grader LLM
       |
       | adversarial prompt
       v
OpenClaw Gateway --> default agent --> permitted tools, files, and memory
       |
       | response
       v
Promptfoo --> JSON + Markdown report on the PVC
```

The attacker/grader is involved before and after the target call: it generates
tests and judges responses. It is not the system being tested; OpenClaw is the
target. A passing grade describes the observed response and does not prove that
OpenClaw avoided a hidden tool call or side effect, so results must be correlated
with logs, traces, filesystem changes, network telemetry, and agent memory.

### Data flow and safety boundary

`PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true` disables Promptfoo's hosted
red-team generation service. It does **not** make this bundle fully local. With
the default configuration, test-generation inputs, OpenClaw responses, and
grading context are sent to OpenAI because OpenAI is the configured
attacker/grader provider. They are also retained in the results PVC.

OpenClaw may execute real tools while processing an adversarial prompt. Run this
only against a disposable agent with synthetic data, isolated memory and files,
restricted tools and network access, and no production messaging channels.
Replace the attacker/grader provider with an approved internal model if prompts
and responses must remain inside your environment.

## Prerequisites

This guide assumes that the OpenClaw resource is named `instance`, the test
agent is named `default`, and both OpenClaw and the test Job run in the existing
`redteam` namespace. Run all commands from the root of this repository.

You need:

- The `oc` command-line tool, logged in to the correct OpenShift cluster.
- Permission to create a Job, Pods, ConfigMaps, a Secret, a PVC, and a
  NetworkPolicy in `redteam`.
- An OpenClaw Gateway exposed through a cluster Service.
- The OpenClaw Gateway/operator bearer token.
- An API key for the attacker/grader model (`openai:chat:gpt-4.1-mini` by
  default), plus cluster egress to that model's API.

Check that you are using the intended cluster and namespace:

```bash
oc whoami --show-server
oc project redteam
oc get claw instance -n redteam
```

If your namespace, resource name, agent name, Service name, or port differs,
update `kustomization.yaml`, `manifests/runtime-config.yaml`,
`manifests/networkpolicy.yaml`, and the `openclaw:default` target in
`config/promptfooconfig.yaml` as applicable before continuing.

The target agent should be disposable. Give it synthetic data, isolated memory
and files, no production messaging channels, restricted tools and network
access, and request/spend limits. The tests may cause real agent actions.

## 1. Check the OpenClaw Gateway

Promptfoo uses the Gateway's OpenAI-compatible Chat Completions endpoint.
OpenClaw disables this endpoint by default. Check the current configuration:

```bash
oc get claw instance -n redteam -o yaml
```

Under the Gateway configuration, confirm that `chatCompletions.enabled` is
`true`. If it is not, enable it:

```bash
oc patch claw instance -n redteam --type=merge -p '{
  "spec":{"config":{"raw":{"gateway":{"http":{"endpoints":{
    "chatCompletions":{"enabled":true}
  }}}}}}}
}'
```

List the Services and confirm the Gateway Service and port:

```bash
oc get svc -n redteam
```

`manifests/runtime-config.yaml` must contain the Gateway origin without `/v1`.
For the default names, it is:

```text
http://instance.redteam.svc.cluster.local:18789
```

The included NetworkPolicy expects the Gateway pods to have the labels
`app=claw` and `claw.sandbox.redhat.com/instance=instance`. Confirm them with:

```bash
oc get pods -n redteam --show-labels
```

This example uses HTTP over the cluster-internal network, so the bearer token is
not encrypted on that path. Environments that do not trust the cluster overlay
must configure Gateway TLS and change the URL to `https`.

## 2. Review what will be tested

Open `config/promptfooconfig.yaml` and review it before the first run in each
environment:

- Change `purpose` so it accurately describes what the agent is allowed and
  prohibited from doing. Promptfoo uses this text when generating and grading
  tests.
- Remove plugins that are not relevant to the agent.
- Keep `numTests: 2` for the first run. Increasing it can significantly increase
  model calls, cost, runtime, and possible side effects.
- Keep the target as `openclaw:default` when the agent is named `default`.

The checked-in profile includes original probes, Base64 variants, and known
jailbreak templates. Read [COVERAGE.md](COVERAGE.md) before expanding it.

Hosted Promptfoo red-team generation is disabled, but this is not a fully local
test. With the default configuration, test-generation inputs, OpenClaw
responses, and grading context are sent to OpenAI. Use an approved internal
provider instead if those data must remain inside your environment.

## 3. Create the runtime Secret

Place each credential in a temporary local file without a trailing newline.
This avoids putting the credentials directly in Kubernetes object metadata:

```bash
mkdir -p secrets
printf %s 'OPENCLAW_OPERATOR_TOKEN' > secrets/openclaw-token
printf %s 'ATTACKER_MODEL_API_KEY' > secrets/attacker-api-key
```

Replace the two placeholder values above, then create or update the Secret:

```bash
oc create secret generic claw-redteam-secrets \
  -n redteam \
  --from-file=OPENCLAW_GATEWAY_TOKEN=secrets/openclaw-token \
  --from-file=ATTACKER_API_KEY=secrets/attacker-api-key \
  --dry-run=client -o yaml | oc apply -f -
```

Confirm that the Secret exists, then delete the local credential files:

```bash
oc get secret claw-redteam-secrets -n redteam
rm -f secrets/openclaw-token secrets/attacker-api-key
rmdir secrets
```

Do not apply `manifests/secret.example.yaml`; it is documentation only.

## 4. Create a session record

Every run needs a unique ID so that one run cannot overwrite another run's
local evidence. Use the next unused ID and describe the architecture being
tested. For a direct OpenClaw route without external guardrails, for example:

```bash
./scripts/create-session.sh RT-2026-004 direct
```

Before starting the scan, edit
`results/sessions/RT-2026-004/session.yaml`. Replace
`RECORD-BEFORE-RUN`, `REVIEW-BEFORE-RUN`, and `UNASSIGNED`, and verify the model
versions and architecture details. Use your actual session ID in all later
commands.

## 5. Verify connectivity before scanning

First apply only the runtime configuration and NetworkPolicy needed by the
temporary check Pod:

```bash
oc apply -n redteam -f manifests/runtime-config.yaml
oc apply -n redteam -f manifests/networkpolicy.yaml
```

Do not use `oc apply -k .` yet: the main kustomization also creates the red-team
Job and would start the scan before this check completes.

Run the temporary check Pod. It sends a benign request to the same endpoint and
agent that Promptfoo will use:

```bash
oc delete pod claw-api-check -n redteam --ignore-not-found
oc apply -n redteam -f manifests/target-check.yaml
oc logs -n redteam -f pod/claw-api-check
oc delete pod claw-api-check -n redteam --ignore-not-found
```

A successful JSON response should contain the answer `READY`. If the check
fails, do not start the scan. Check the Gateway URL and port, Chat Completions
setting, bearer token, `default` agent, Gateway pod labels, NetworkPolicy, and
Gateway logs.

## 6. Deploy and run the scan

Delete an old Job with the same name, if one exists, then apply the complete
bundle. Deleting the Job does not delete the results PVC:

```bash
oc delete job claw-redteam -n redteam --ignore-not-found
oc apply -k .
```

Check the created resources and follow the scan log:

```bash
oc get pods,jobs,pvc -n redteam
oc logs -n redteam -f job/claw-redteam
```

The Job has `backoffLimit: 0`, so OpenShift will not automatically repeat a
failed scan. Promptfoo exits with status 100 when it finds security failures;
therefore, the OpenShift Job may say `Failed` even though it successfully
created results. A missing `results.json`, evaluation errors, or a Gateway
restart indicates an incomplete or inconclusive run.

## 7. Collect and review the results

Use the session ID created in step 4. Set the architecture mode to the value
recorded in that session:

```bash
SESSION_ID=RT-2026-004 \
ARCHITECTURE_MODE=direct \
NAMESPACE=redteam \
./scripts/collect-results.sh
```

This temporarily mounts the results PVC, copies the evidence into
`results/sessions/RT-2026-004/`, generates a draft lessons report and checksums,
and deletes the temporary reader Pod. It refuses to overwrite evidence already
collected for that session.

Review these files:

- `report.md`: readable summary and failed cases.
- `results.json`: complete machine-readable Promptfoo result.
- `redteam.yaml`: exact generated test configuration.
- `lessons-learned.draft.md`: prompts for the human security review.
- `session.yaml`: the scope and component record created before the run.
- `SHA256SUMS`: hashes for checking evidence integrity.

Review every failure with Gateway logs, tool-call records, filesystem and memory
changes, network telemetry, and external-system audit logs. A text-only pass
does not prove that no hidden tool call or side effect occurred. Treat every
evaluation error as inconclusive, not as a pass.

The local `results/` directory is gitignored because evidence can contain
sensitive prompts, responses, PII, secrets, or agent side effects. Store raw
artifacts in an access-controlled evidence system. Commit only a reviewed and
appropriately redacted summary.

## 8. Update findings and the security runbook

Raw results are evidence, not an approved security conclusion. After every run:

1. Review `lessons-learned.draft.md` and the runtime evidence. A security
   reviewer must decide root cause, severity, impact, and remediation.
2. Publish the reviewed and redacted summary as
   `docs/red-team-sessions/<session-id>.md`.
3. Add a new stable finding or update an existing one in `docs/findings.yaml`.
   Record whether this session discovered, reproduced, or validated it.
4. Update the affected recommendation, response procedure, or verification step
   in `docs/SECURITY_RUNBOOK.md`. A run with no new gaps may add validation
   evidence to an existing control instead.
5. Validate all links between sessions, findings, and runbook controls:

   ```bash
   node scripts/validate-traceability.mjs
   ```

The validator expects every published session to reference a finding ID such as
`OC-PI-001` and a runbook control such as `SEC-CTRL-002`. It also checks that the
finding and runbook link back to the session. Use a new session ID for every
remediation test; never replace the discovering run.

## Run again

Kubernetes Jobs are immutable and the name is intentionally stable. Delete only
the completed Job, update configuration if needed, then reapply:

```bash
oc delete job claw-redteam -n redteam --ignore-not-found
oc apply -k .
```

The PVC is retained, but `results.json` is overwritten. Copy or rename important
results before rerunning. Promptfoo's evaluation database remains on the PVC.

## Memory and resource tuning

Red teaming can create long contexts and concurrent gateway sessions. In the
observed 70-case run, a 4 GiB OpenClaw gateway limit caused OOM kills; an 8 GiB
limit completed successfully with a sampled peak near 3.3 GiB. Treat those as
starting observations, not universal requirements.

- Promptfoo Job memory is set under `resources` in `manifests/job.yaml` (default
  request 512 MiB, limit 2 GiB).
- Results capacity is set in `manifests/pvc.yaml` (default 2 GiB).
- OpenClaw gateway memory is configured on the installed `Claw` resource, not
  in this bundle. Inspect it with `oc get claw instance -n redteam -o yaml`, then
  update the operator-supported resource request/limit fields for your OpenClaw
  version.

Monitor both workloads during a baseline:

```bash
oc adm top pods -n redteam
oc get pods -n redteam -o custom-columns=NAME:.metadata.name,RESTARTS:.status.containerStatuses[*].restartCount
oc describe pod -n redteam <gateway-pod>
```

If the gateway reports `OOMKilled`, increase its memory limit, reduce Promptfoo
concurrency/test count, or both. Do not infer success from the Job alone: verify
that the result summary has zero evaluation errors and that the gateway did not
restart.

Hosted-only plugins and adaptive jailbreak strategies are omitted because
`PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true`. Enable them only after
reviewing Promptfoo's data handling and configuring an approved hosted or
self-hosted remote-generation endpoint.

## Cleanup

Remove the Job but retain results:

```bash
oc delete job claw-redteam -n redteam --ignore-not-found
```

Delete the red-team resources while retaining the OpenClaw instance and its
namespace:

```bash
oc delete -k .
oc delete secret claw-redteam-secrets -n redteam --ignore-not-found
```

## References

- Promptfoo OpenClaw provider: https://www.promptfoo.dev/docs/providers/openclaw/
- Promptfoo agent red teaming: https://www.promptfoo.dev/docs/red-team/agents/
- Promptfoo data handling: https://www.promptfoo.dev/docs/red-team/troubleshooting/data-handling/
- OpenClaw Chat Completions API: https://docs.openclaw.ai/gateway/openai-http-api
