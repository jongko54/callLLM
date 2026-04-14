# app-b qwen3-8b-int4 vLLM Tool Calling Notes

## Current behavior

- Remote benchmark calls to the shared `qwen3-8b-int4` server succeed for direct chat and RAG.
- Tool-using profiles fail with:

```text
"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set
```

That means the upstream vLLM server is healthy, but it is not currently started with the flags required for automatic tool selection.

## Current deployment gap

The live deployment already sets:

- `--reasoning-parser qwen3`

But it does not set:

- `--enable-auto-tool-choice`
- `--tool-call-parser <parser>`

## Safe rollout recommendation

1. Do not change the shared deployment blindly in production.
2. First pin the image instead of using `vllm/vllm-openai:latest`.
3. Add tool-calling flags in a staging rollout.
4. Validate one direct prompt and one tool prompt before scaling traffic.

## Suggested manifest change

Local staging patch artifact:

- `/Users/jongho/workspace/callLLM/ops/app-b/qwen3-8b-int4-tool-calling-patch.yaml`
- `/Users/jongho/workspace/callLLM/ops/app-b/qwen3-8b-int4-tool-calling/`

The directory version is safer for a real rollout because it keeps the change patch-only and avoids reapplying unrelated manifest drift such as the current `replicas` field.

Add these args to the `qwen3-8b-int4-vllm` container:

```yaml
args:
  - --host
  - 0.0.0.0
  - --port
  - $(VLLM_PORT)
  - --model
  - $(MODEL_ID)
  - --tokenizer
  - $(TOKENIZER_ID)
  - --served-model-name
  - $(SERVED_MODEL_NAME)
  - --dtype
  - auto
  - --api-key
  - $(API_KEY)
  - --gpu-memory-utilization
  - $(GPU_MEMORY_UTILIZATION)
  - --max-model-len
  - $(MAX_MODEL_LEN)
  - --max-num-seqs
  - $(MAX_NUM_SEQS)
  - --max-num-batched-tokens
  - $(MAX_NUM_BATCHED_TOKENS)
  - --tensor-parallel-size
  - "1"
  - --enable-prefix-caching
  - --enable-chunked-prefill
  - --reasoning-parser
  - qwen3
  - --enable-auto-tool-choice
  - --tool-call-parser
  - $(TOOL_CALL_PARSER)
  - --quantization
  - compressed-tensors
  - --download-dir
  - /var/lib/huggingface
```

And add to the ConfigMap:

```yaml
data:
  TOOL_CALL_PARSER: hermes
```

## Important caveat

`TOOL_CALL_PARSER=hermes` is a starting point, not a guaranteed final answer.

Why:

- The current deployment uses `vllm/vllm-openai:latest`, so supported parser names can drift.
- The current vLLM CLI docs list parser choices, but generic `qwen3` is not clearly listed as a dedicated tool-call parser in the same way the reasoning parser is.
- Because of that, parser choice should be validated against the exact image version running in `app-b`.

## Validation checklist

After rollout, verify:

1. `GET /v1/models` still returns `qwen3-8b-int4`
2. A plain `chat.completions` request still succeeds
3. A tool-enabled request with `tool_choice=auto` no longer returns 400
4. One benchmark run from `callLLM` succeeds for:
   - `tool-agent`
   - `langchain-tool`
   - `langgraph-agent`

## callLLM-side expectation

Once the upstream server supports auto tool calling, the local benchmark harness should be able to compare:

- `custom` tool loop
- `LangChain` tool runner
- `LangGraph` tool runner

without any additional backend changes in `callLLM`.
