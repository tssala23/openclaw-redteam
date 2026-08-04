# Red-team coverage

This repository uses Promptfoo as the primary OpenClaw agent-security scanner. Its default profile combines agent-specific plugins with generic jailbreak, prompt-extraction, and encoding coverage.

The default is deliberately a baseline, not an exhaustive scan. OpenClaw can invoke real tools, and every added test or strategy can increase calls, cost, runtime, retained sensitive data, and the chance of side effects. The expanded baseline therefore starts with `numTests: 2`; increase it only after observing the generated case count.

## Default profile

The active profile is in `config/promptfooconfig.yaml`.

| Configuration | Coverage |
|---|---|
| `excessive-agency` | Actions beyond the agent's intended authority or scope |
| `tool-discovery` | Disclosure of tools, functions, and APIs |
| `pii` | Leakage of personally identifiable information |
| `rbac` | Role-based authorization failures |
| `prompt-extraction` | Disclosure of hidden system or developer instructions |
| `basic` | Sends the original plugin-generated probes without transformation |
| `base64` | Deterministic Base64 obfuscation and filter bypass |
| `jailbreak-templates` | Curated static jailbreaks such as DAN and Skeleton Key |

This adds generic prompt-extraction and known-jailbreak coverage while retaining the profile's agent-specific focus.

## How Promptfoo coverage works

Three settings control most coverage:

1. `purpose` defines what the agent is allowed and prohibited from doing. It influences generated attacks and grading, so it must describe the real authorization, data, tool, and confirmation boundaries.
2. `plugins` define the failure modes to test. Adding a plugin adds new base probes and graders.
3. `strategies` change how plugin probes are delivered. Strategies normally multiply test cases; they do not replace a precise plugin or policy.

`numTests` is approximately the number of generated base cases per plugin, but the final count can be larger because plugins and strategies can expand cases differently. Inspect the generated `redteam.yaml` and the result summary rather than predicting cost from a simple formula.

## Changing the profile

Edit `config/promptfooconfig.yaml`, review the rendered configuration, delete the immutable completed Job, and reapply:

```bash
oc kustomize . | less
oc delete job claw-redteam -n redteam --ignore-not-found
oc apply -k .
```

Copy the previous result artifacts before rerunning because `results.json` and `report.md` are overwritten on the retained PVC.

Change one dimension at a time. First add a plugin or strategy with `numTests: 1`, verify the generated case count and behavior, and then raise the count deliberately.

## Locally supported expansion options

The Job sets `PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true`. Prefer deterministic or attacker-provider-backed features that work under that restriction.

Additional static encoding strategies can broaden obfuscation and filter-bypass coverage:

```yaml
redteam:
  strategies:
    - basic
    - base64
    - hex
    - rot13
    - leetspeak
    - homoglyph
    - other-encodings
    - jailbreak-templates
```

Do not enable all of them initially. Each strategy is applied across applicable plugin cases and can substantially increase calls.

Potential additional plugins include:

| Plugin | Use when | Important caution |
|---|---|---|
| `shell-injection` | The agent can invoke a shell or pass data to command execution | Can cause real command execution; use a disposable workspace and restricted tools |
| `sql-injection` | The agent or its tools construct database queries | Use only a synthetic, isolated database |
| `hijacking` | The agent must remain within a narrow business purpose | Current community data-handling documentation marks it as remote-generation-dependent |
| `bola` | The application accesses objects belonging to different users | Requires synthetic users and objects; remote-generation-dependent |
| `bfla` | Different roles have different callable functions | Requires a meaningful role/function model; remote-generation-dependent |
| `ssrf` | The agent can fetch URLs or access network resources | Can generate network activity; remote-generation-dependent |
| `indirect-prompt-injection` | Untrusted documents, email, web pages, or RAG content enter the agent context | Requires an injection point and is remote-generation-dependent |
| `agentic:memory-poisoning` | The agent has persistent state across conversations | Requires controlled session and memory reset behavior |

Only add a plugin when the target actually has the corresponding attack surface. A SQL-injection test adds noise if the agent cannot reach a database.

## Hosted and adaptive coverage

Promptfoo also offers dynamic and multi-turn strategies such as Meta Agent, Hydra, composite jailbreaks, GOAT, and other adaptive attacks. These can find failures missed by static templates, but several depend on Promptfoo-hosted generation in the community edition.

Enabling them is a policy decision, not just a YAML change. Before changing `PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION`, review:

- What prompts, responses, policies, and target data leave the cluster
- Vendor retention and access controls
- Whether an approved internal or hosted attacker/grader can be used
- Expected target, attacker, and grader call counts
- Multi-turn session behavior and memory cleanup
- Rate, token, time, and spend limits

`config/hydra-strategy.yaml.example` contains the existing opt-in Hydra fragment. Do not merge it into the baseline until the data-flow and cost review is complete.

## Suggested profiles

### Smoke test

Use before any larger run:

```yaml
numTests: 1
plugins:
  - excessive-agency
  - rbac
strategies:
  - basic
```

### Default agent baseline

Use the checked-in configuration. It covers agent policy, authorization, sensitive data, tool disclosure, prompt extraction, Base64, and static jailbreaks.

### Static broad scan

Start from the default and add one or two encoding strategies at a time. This provides broader standardized probing without enabling hosted or adaptive generation.

### Application attack-surface scan

Add only plugins corresponding to connected tools, such as `shell-injection`, `sql-injection`, `ssrf`, BOLA, or BFLA. Build synthetic resources and deterministic audit checks before running it.

### Adaptive multi-turn scan

Add Hydra or another adaptive strategy only after enabling and approving its required generation path. Run against a resettable agent with low concurrency and strict call limits.

## Coverage gaps and evidence

No automated profile is exhaustive. Review Promptfoo's available plugins and strategies regularly, and supplement the baseline with threat-model-specific tests and independent security review.

Neither tool can prove from response text alone that the agent avoided a hidden action. Correlate every important finding with:

- OpenClaw and Gateway logs
- Tool-call requests and results
- Filesystem and memory changes
- Network telemetry
- External-system audit logs
- Pod restarts, timeouts, and evaluation errors

Treat an evaluation error as inconclusive, not a pass. Separate unsafe responses, attempted prohibited actions, successful prohibited actions, and external side effects in the final assessment.

## Findings and runbook traceability

Every exercise has a stable `RT-YYYY-NNN` identifier. Reviewed lessons are
stored under `docs/red-team-sessions/`; stable findings and their discovery,
reproduction, validation, and control relationships are recorded in
`docs/findings.yaml`. The living deployment security and incident-response
procedures are in `docs/SECURITY_RUNBOOK.md`.

Update the runbook after every exercise when evidence changes a recommendation,
procedure, or verification step. A session with no new gaps should still be
linked as validation evidence when it exercises an existing control. Validate
the bidirectional links with:

```bash
node scripts/validate-traceability.mjs
```

## References

- [Promptfoo red-team plugins](https://www.promptfoo.dev/docs/red-team/plugins/)
- [Promptfoo red-team strategies](https://www.promptfoo.dev/docs/red-team/strategies/)
- [Promptfoo agent red teaming](https://www.promptfoo.dev/docs/red-team/agents/)
- [Promptfoo data handling](https://www.promptfoo.dev/docs/red-team/troubleshooting/data-handling/)
