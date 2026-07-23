# OpenClaw external guardrails

This directory deploys an operator-managed NeMo Guardrails service and routes
an operator-managed OpenClaw instance through it. The manifests currently use
the `redteam` namespace and a `Claw` resource named `instance`; change those
values if your deployment uses different names.

## How it works

```text
User -> OpenClaw -> NeMo Guardrails -> OpenAI
                         |
                         +-- input and output policy checks
```

OpenClaw uses the internal NeMo service as a custom OpenAI-compatible provider.
NeMo checks the input, calls the protected model when the input is allowed, and
checks the model output before returning it. It applies:

- Presidio-based detection of configured personal-data types.
- An LLM-based input check for instruction override, prompt extraction,
  unauthorized access, obfuscation, and similar behavior.
- An LLM-based output check for hidden instructions, secrets, personal data,
  internal configuration, and security-control bypasses.

These controls protect model inputs and outputs. They do not intercept tool
calls and are not a replacement for tool authorization, confirmation, or
network isolation.

The protected model is `gpt-5.5`. The input and output classifiers use
`gpt-4.1-mini`, which reliably returns the short `yes` or `no` response NeMo
expects. A reasoning model can consume NeMo's small classification allowance
without emitting a visible answer.

## Files

- `nemo-config.yaml` defines models, policies, and enabled rails.
- `nemo-guardrails.yaml` creates the TrustyAI-managed NeMo service.
- `nemo-network-policy.yaml` permits only the selected OpenClaw gateway to
  connect to NeMo.
- `openclaw-guarded-merge-patch.yaml` routes OpenClaw through NeMo.
- `openclaw-direct-merge-patch.yaml` restores direct OpenAI routing.
- `kustomization.yaml` deploys the NeMo resources and NetworkPolicy. The Claw
  patches are deliberately applied separately.

## Prerequisites

- The OpenShift AI `trustyai` component is set to `Managed`.
- The `NemoGuardrails` CRD is installed.
- `Claw/instance` exists in the target namespace.
- Secret `openclaw-instance-openai-api-key` contains an OpenAI key under
  `api-key`.

Confirm the TrustyAI API is available:

```bash
oc api-resources | grep -i nemoguardrails
```

## Enable the guardrails

Deploy NeMo first and wait for it to become ready:

```bash
oc apply -k guardrails/
oc get nemoguardrails openclaw-nemo -n redteam -w
```

Validate the NeMo endpoint, then route OpenClaw through it:

```bash
oc patch claw instance -n redteam --type=merge \
  --patch-file guardrails/openclaw-guarded-merge-patch.yaml
oc rollout status deployment/instance -n redteam
```

The patch makes `guarded-openai/gpt-5.5` the only available model, enables the
narrow in-cluster network path to NeMo, and removes direct provider fallbacks.
It uses `config.mergeMode: overwrite` so model choices retained in OpenClaw's
persistent configuration cannot override the guarded model.

## Verify the active model

Check the effective configuration inside the gateway:

```bash
oc exec -n redteam deployment/instance -c gateway -- \
  sed -n '1,80p' /home/node/.openclaw/openclaw.json
```

The primary model should be `guarded-openai/gpt-5.5`, the fallback list should
be empty, and no direct OpenAI models should be listed. Also test one harmless
request and one request expected to be blocked before relying on the setup.

## Credentials and resource usage

The current configuration gives the NeMo pod access to the existing OpenAI
Secret. The raw key is not placed in the OpenClaw gateway, but it is present in
the NeMo workload. Restrict access to both the Secret and NeMo pod. A production
deployment should preferably use a dedicated limited credential or an approved
in-cluster model.

An allowed request can require three model calls: input classification, main
generation, and output classification. Account for the additional latency,
token usage, concurrency, and NeMo memory requirements.

## Restore direct OpenAI access

Restore OpenClaw routing before deleting NeMo:

```bash
oc patch claw instance -n redteam --type=merge \
  --patch-file guardrails/openclaw-direct-merge-patch.yaml
oc rollout status deployment/instance -n redteam
```

The rollback patch restores the OpenAI credential, original primary and
fallback models, and the default network path. It initially retains `overwrite`
mode so guarded settings in the persistent configuration cannot survive the
rollback. Verify that the effective primary is `openai/gpt-5.5` and that
OpenClaw can answer a normal request. If the original `merge` behavior is
required, restore it only after that verification:

```bash
oc patch claw instance -n redteam --type=merge \
  -p '{"spec":{"config":{"mergeMode":"merge"}}}'
oc rollout status deployment/instance -n redteam
```

NeMo can remain deployed but unused. To remove it after direct routing works:

```bash
oc delete -k guardrails/
```

Deleting NeMo before restoring direct routing interrupts model access.
