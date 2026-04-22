AUTO_TOOL_CHOICE_CONFIGURATION_ERROR = '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set'


def normalize_provider_case_error(message: str) -> str:
  normalized = message.strip()
  if AUTO_TOOL_CHOICE_CONFIGURATION_ERROR in normalized:
    return (
      f"{normalized} "
      "Upstream vLLM currently is not configured for auto tool calling; enable those flags on the model server to benchmark tool agents."
    )
  return normalized
