# OpenClaw on OpenShift Security Runbook

Owner: Security Engineering

Last reviewed: 2026-07-27

Next scheduled review: 2026-10-27

Review trigger: Every red-team exercise, incident, or material architecture change

This is the living security runbook for the OpenClaw deployment on OpenShift. Each control records the red-team evidence that justified it. Reviewed exercise summaries link back to the controls they tested. Raw reports may contain sensitive data and remain in access-controlled evidence storage.

## Incident classification

| Severity | Example | Required response |
|---|---|---|
| SEV-1 | Confirmed secret or personal-data exfiltration; completed unauthorized consequential action | Immediately isolate the agent, revoke affected credentials, notify the incident commander and data/security owners |
| SEV-2 | Successful guardrail or authorization bypass without confirmed external impact | Disable affected capability, preserve evidence, begin same-day investigation |
| SEV-3 | Unsafe response or attempted prohibited tool call contained before external impact | Preserve evidence, open a tracked finding, remediate before expanding access |
| SEV-4 | Blocked attack, false positive, or evaluation anomaly | Record for tuning and trend review |

Evaluation errors are inconclusive, not passes. Classify evidence separately as unsafe text, attempted action, completed action, and verified external side effect.

## Initial response

1. Record the UTC incident window, agent/session IDs, reporter, and affected environment.
2. Preserve the Promptfoo result, generated test configuration, Gateway and NeMo logs, tool-call records, filesystem and memory state, network telemetry, pod status, and external-system audit logs. Do not collect Secret values into the evidence bundle.
3. Determine whether the event was limited to response text or caused a tool call, state change, network request, disclosure, or third-party communication.
4. Assign severity and an incident owner. Escalate SEV-1 and SEV-2 through the organization's security incident process.
5. Create or update a finding in `docs/findings.yaml` and link it to the red-team session or incident record.

## Containment

Use the least destructive measure that reliably stops impact:

- Disable affected messaging channels, tools, or the target agent.
- Remove model and tool egress where unauthorized activity may still be in progress.
- Revoke and rotate exposed Gateway, model-provider, or tool credentials.
- Preserve PVCs, logs, memory, and workspace state before cleanup.
- Quarantine injected documents, messages, memory entries, and workspaces.
- If the model guardrail is implicated, prevent direct-provider fallback and verify effective routing before restoring traffic.

Environment owners must approve destructive cleanup or production credential rotation under the organization's incident process.

## Eradication and recovery

1. Remove hostile persisted content and restore affected state from a known-clean source.
2. Fix the responsible guardrail, authorization, confirmation, tool, memory, or network control.
3. Add the reproducing case to the red-team profile when it can be tested safely.
4. Run a new, uniquely identified validation session; never overwrite the discovering session.
5. Update the finding with validation evidence and update the applicable control below.
6. Restore tools, channels, credentials, and network access only after the owner confirms the control is active and the validation has no evaluation errors.
7. Complete a post-incident review for SEV-1/2 and record follow-up owners and due dates.

## Security controls

### SEC-CTRL-001: Enforce the guarded model route

Recommendation: Route OpenClaw model traffic through NeMo Guardrails, use overwrite semantics for the effective model configuration, keep the fallback list empty, and restrict the in-cluster path to the NeMo service.

Why: [RT-2026-001](red-team-sessions/RT-2026-001.md) found prompt and tool disclosure without external guardrails. [RT-2026-002](red-team-sessions/RT-2026-002.md) passed the equivalent cases with the guarded route. [RT-2026-003](red-team-sessions/RT-2026-003.md) reproduced the exposure after deliberate rollback, demonstrating that provider routing is a required control rather than a model-only improvement. Findings: `OC-PI-001`, `OC-TD-001`.

Implementation:

- `guardrails/openclaw-guarded-merge-patch.yaml`
- `guardrails/nemo-network-policy.yaml`
- Deployment and verification procedure in `guardrails/README.md`

Verification: Confirm the effective primary model is `guarded-openai/gpt-5.5`, the fallback list is empty, and both an allowed request and a known blocked request behave as expected. Run the current prompt-extraction and tool-discovery regression cases.

### SEC-CTRL-002: Check inputs and outputs for injection and disclosure

Recommendation: Apply input checks for instruction override, extraction, impersonation, obfuscation, persistence, and unauthorized action. Apply output checks for hidden instructions, internal tools/configuration, secrets, personal data, and security-control bypass guidance.

Why: `OC-PI-001` and `OC-TD-001` were discovered by [RT-2026-001](red-team-sessions/RT-2026-001.md). The configured rails were validated by [RT-2026-002](red-team-sessions/RT-2026-002.md); rollback session [RT-2026-003](red-team-sessions/RT-2026-003.md) showed the gaps return without them.

Implementation: `guardrails/nemo-config.yaml`.

Verification: Run unmodified, Base64, and curated jailbreak-template cases. Review target and guardrail logs because text grading alone cannot establish absence of tool side effects.

## Exercise review procedure

After every red-team exercise:

1. Review the generated draft alongside runtime evidence.
2. Publish a reviewed summary under `docs/red-team-sessions/<session-id>.md`.
3. Add new findings or update reproduced/validated sessions in `docs/findings.yaml`.
4. Update this runbook when evidence changes a recommendation, procedure, or verification step. A no-new-findings run may simply add validation evidence.
5. Run `node scripts/validate-traceability.mjs` before committing.

Quarterly review remains necessary for contacts, ownership, architectural drift, evidence sources, and risks not covered by recent exercises.
