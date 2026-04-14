# app-b qwen3-8b-int4 tool-calling overlay snippet

This directory is a safe staging artifact for the shared `app-b` deployment.

It is intentionally provided as a kustomize patch snippet, not as a full standalone base, so it can be merged into the real `app-b` overlay without reapplying unrelated fields such as `replicas`.

## Files

- `kustomization.snippet.yaml`
- `deployment.patch.yaml`
- `configmap.patch.yaml`

## How to use

1. Copy the `patches:` entries from `kustomization.snippet.yaml` into the real `app-b` kustomization that already includes the live deployment resources.
2. Place or reference `deployment.patch.yaml` and `configmap.patch.yaml` from that overlay.
3. Roll out in staging first.

## Why this is safer

- The live repository manifest currently shows `replicas: 0`, while the running cluster has an active pod.
- Reapplying a stale full Deployment would risk undoing live operational changes.
- A patch-only snippet keeps the change narrowly focused on tool-calling flags and parser config.

## Validation

After rollout, confirm:

1. `GET /v1/models` still works.
2. Plain chat completion still works.
3. Tool-enabled completion with `tool_choice=auto` no longer returns `400`.
4. `tool-agent`, `langchain-tool`, and `langgraph-agent` succeed from `callLLM`.
