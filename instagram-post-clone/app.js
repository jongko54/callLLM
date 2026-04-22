const API_CONFIG = {
  backendCandidates: [
    "http://127.0.0.1:8000/api",
    "http://localhost:8000/api",
  ],
  defaultPrompt:
    "같은 질문을 여러 모델과 전략에 보내고, 응답의 품질과 속도를 비교할 수 있게 정리해줘.",
  defaultExpected:
    "비교",
  defaultTemperature: 0.7,
};

const CURRENT_PAGE = (() => {
  const page = document.body?.dataset?.page;
  if (page === "workflow" || page === "results" || page === "response" || page === "explain") {
    return page;
  }
  return "browse";
})();

const STORAGE_KEYS = {
  selectedModels: "callllm:selected-models:v2",
  selectedLibrary: "callllm:selected-library:v2",
  selectedLibraryMode: "callllm:selected-library-mode:v1",
  selectedApp: "callllm:selected-app:v2",
  selectedAppMode: "callllm:selected-app-mode:v1",
  selectedProfile: "callllm:selected-profile:v2",
  selectedProfiles: "callllm:selected-profiles:v3",
  promptDraft: "callllm:prompt-draft:v1",
  contextDraft: "callllm:context-draft:v1",
  expectedDraft: "callllm:expected-draft:v1",
  temperatureDraft: "callllm:temperature-draft:v2",
  caseMode: "callllm:case-mode:v1",
  responseDraft: "callllm:response-draft:v1",
  responseMessages: "callllm:response-messages:v1",
  responseSessions: "callllm:response-sessions:v1",
  responseCurrentSession: "callllm:response-current-session:v1",
  responseModel: "callllm:response-model:v1",
  responseProfile: "callllm:response-profile:v1",
  responseGroundingMode: "callllm:response-grounding-mode:v1",
  responseSeed: "callllm:response-seed:v1",
  explainCategory: "callllm:explain-category:v1",
  explainComponent: "callllm:explain-component:v1",
  theme: "callllm:theme:v1",
};

const THEMES = ["red", "blue", "yellow"];
const RESPONSE_GROUNDING_MODES = [
  { id: "raw", name: "Raw" },
  { id: "auto", name: "Auto" },
  { id: "grounded", name: "Grounded" },
];

const EXPLAIN_CATEGORIES = [
  { id: "strategy", name: "Strategies" },
  { id: "library", name: "Libraries" },
  { id: "service", name: "Services" },
  { id: "runner", name: "Runners" },
];

const EXPLAIN_ITEMS = [
  {
    id: "direct-chat",
    category: "strategy",
    title: "Direct Chat",
    subtitle: "문맥 검색이나 도구 없이 모델에 바로 요청하는 baseline",
    badges: ["direct", "baseline", "single call"],
    summary: "가장 단순한 실행 방식입니다. 사용자의 메시지와 선택된 system prompt를 OpenAI-compatible chat completion payload로 만들고 바로 모델에 보냅니다.",
    logic: ["User message", "System prompt", "LLM call", "Final text"],
    responsibilities: [
      "모델별 기본 응답 품질과 말투를 빠르게 확인합니다.",
      "RAG나 tool 실행을 붙이기 전 기준선을 잡습니다.",
      "워크플로가 Prompt -> LLM 형태일 때 자동으로 direct 전략으로 해석됩니다.",
    ],
    whenToUse: "일반 답변, 요약, 문장 생성처럼 외부 근거나 함수 호출이 필요 없는 요청에 적합합니다.",
    codePath: "ProfileResponseService -> CustomBenchmarkRunner -> OpenAI-compatible provider",
  },
  {
    id: "rag-context",
    category: "strategy",
    title: "RAG Context",
    subtitle: "질문과 참고 문맥을 함께 넣어 근거 중심 답변을 만드는 전략",
    badges: ["rag", "grounded", "context"],
    summary: "현재 구현은 벡터 검색 인덱스보다 사용자가 입력한 context documents를 system prompt에 안전하게 합치는 RAG lane에 가깝습니다.",
    logic: ["Question", "Context docs", "Grounded prompt", "LLM answer"],
    responsibilities: [
      "프롬프트 옆 Context 입력값을 case metadata에 저장합니다.",
      "runner가 context를 system prompt의 Grounded context 섹션으로 조립합니다.",
      "모델이 모르는 내용을 추측하지 않고 부족한 근거를 말하도록 유도합니다.",
    ],
    whenToUse: "제품 스펙, 문서 조각, 내부 메모처럼 답변이 특정 근거에 묶여야 할 때 선택합니다.",
    codePath: "buildCaseMetadata -> BenchmarkRunner.build_system_prompt -> profile rag-context",
  },
  {
    id: "tool-agent",
    category: "strategy",
    title: "Tool Agent",
    subtitle: "모델이 함수 호출을 선택하면 서버가 도구를 실행하는 multi-step 전략",
    badges: ["tool", "agent", "multi-step"],
    summary: "모델 응답에 tool_calls가 있으면 ToolRegistry가 해당 도구를 실행하고, tool 결과 메시지를 다시 모델에게 넣어 최종 답변을 받습니다.",
    logic: ["Prompt", "Tool decision", "Tool execution", "Final answer"],
    responsibilities: [
      "모델이 직접 답할지 도구를 부를지 판단하게 합니다.",
      "서버가 등록된 도구만 실행하고 결과를 tool message로 추가합니다.",
      "max_steps 안에서 assistant/tool loop를 반복합니다.",
    ],
    whenToUse: "현재 시간 조회, 내부 API 호출, 계산, 외부 데이터 조회처럼 모델 혼자 답하면 안 되는 작업에 적합합니다.",
    codePath: "AgentProfileService.ensure_model_supports_profile -> ToolRegistry -> CustomBenchmarkRunner._run_tool_strategy",
  },
  {
    id: "custom-runtime",
    category: "library",
    title: "Custom Runtime",
    subtitle: "callLLM 내부 구현으로 직접 provider payload를 만드는 기본 런타임",
    badges: ["custom", "native", "fast path"],
    summary: "프레임워크 의존성 없이 callLLM 코드가 직접 payload를 만들고 OpenAI-compatible endpoint를 호출합니다.",
    logic: ["Profile", "Payload builder", "Provider client", "Trace"],
    responsibilities: [
      "direct, rag, tool 전략의 기본 실행 경로를 제공합니다.",
      "벤치마크에서 외부 프레임워크 대비 기준 성능을 제공합니다.",
      "프레임워크 설치가 없어도 항상 동작하는 fallback 역할을 합니다.",
    ],
    whenToUse: "가장 예측 가능한 로컬 실행 경로가 필요하거나 프레임워크별 overhead를 비교하고 싶을 때 씁니다.",
    codePath: "CustomBenchmarkRunner in application/benchmark_runners.py",
  },
  {
    id: "langchain-runtime",
    category: "library",
    title: "LangChain",
    subtitle: "모델 호출과 tool binding을 표준 인터페이스로 감싸는 실행 레이어",
    badges: ["langchain", "adapter", "tools"],
    summary: "LangChain ChatOpenAI를 사용해 같은 profile을 LangChain 방식으로 실행합니다. custom runner와 결과/trace를 비교하기 위한 adapter 역할도 합니다.",
    logic: ["Messages", "ChatOpenAI", "Optional tools", "AI message"],
    responsibilities: [
      "모델 제공자 교체 시 호출 코드를 표준화합니다.",
      "LangChain tool 실행 패턴을 benchmark 안에서 비교합니다.",
      "프레임워크 의존성이 없으면 profile이 비활성화됩니다.",
    ],
    whenToUse: "LangChain 기반 앱으로 옮길 계획이 있거나 LangChain runner의 tool 처리 방식을 검증할 때 선택합니다.",
    codePath: "LangChainBenchmarkRunner",
  },
  {
    id: "langgraph-runtime",
    category: "library",
    title: "LangGraph",
    subtitle: "에이전트 흐름을 상태 머신처럼 구성하는 런타임",
    badges: ["langgraph", "state graph", "agent"],
    summary: "계획, 도구 실행, 모델 재호출, 종료 조건을 그래프 흐름으로 표현하는 데 적합한 런타임입니다.",
    logic: ["State", "Graph node", "Tool branch", "Stop condition"],
    responsibilities: [
      "복잡한 multi-step agent를 명시적인 노드와 엣지로 관리합니다.",
      "tool agent 흐름을 더 통제 가능한 구조로 비교합니다.",
      "장기적으로 retry, approval, checkpoint 같은 제어 지점을 넣기 좋습니다.",
    ],
    whenToUse: "도구 호출이 여러 번 오가거나 상태 기반 분기가 필요한 agent 실험에 적합합니다.",
    codePath: "LangGraphBenchmarkRunner",
  },
  {
    id: "llamaindex-runtime",
    category: "library",
    title: "LlamaIndex",
    subtitle: "문서 기반 질의응답과 RAG 구성을 다루는 데이터 중심 레이어",
    badges: ["llamaindex", "rag", "docs"],
    summary: "문서, 노트, context를 답변 입력으로 조립하는 데 강한 런타임입니다. 현재는 OpenAI-compatible endpoint에 붙는 baseline runner로 사용합니다.",
    logic: ["Prompt", "Context text", "OpenAILike", "Completion"],
    responsibilities: [
      "RAG profile과 함께 문맥 주입 방식의 차이를 비교합니다.",
      "문서 중심 앱으로 확장할 때 자연스러운 실행 경로를 제공합니다.",
      "context 부족 시 추측을 줄이는 프롬프트 조립에 사용됩니다.",
    ],
    whenToUse: "문서/지식 기반 응답 실험이나 RAG 품질 비교가 주 관심사일 때 선택합니다.",
    codePath: "LlamaIndexBenchmarkRunner",
  },
  {
    id: "model-registry-service",
    category: "service",
    title: "ModelRegistryService",
    subtitle: "모델 등록 정보, base URL, capability, health probe를 담당",
    badges: ["service", "models", "capability"],
    summary: "실행 가능한 모델 목록을 제공하고, profile 실행 전에 모델이 chat/tool 기능을 지원하는지 판단할 데이터를 제공합니다.",
    logic: ["Model record", "Capabilities", "Probe", "Client config"],
    responsibilities: [
      "모델 이름, provider, served model name, base URL을 저장합니다.",
      "모델 health와 upstream model 목록을 probe합니다.",
      "모델별 OpenAI-compatible client 설정을 만들 수 있게 데이터를 제공합니다.",
    ],
    whenToUse: "새 모델을 등록하거나 특정 endpoint가 tool calling을 지원하는지 확인해야 할 때 관여합니다.",
    codePath: "application/services/model_registry_service.py",
  },
  {
    id: "agent-profile-service",
    category: "service",
    title: "AgentProfileService",
    subtitle: "전략, 프레임워크, system prompt, tool 요구사항을 관리",
    badges: ["service", "profiles", "validation"],
    summary: "Direct/RAG/Tool 같은 profile을 만들고, 선택한 모델이 해당 profile을 실행할 수 있는지 검증합니다.",
    logic: ["Profile", "Strategy", "Framework", "Validation"],
    responsibilities: [
      "profile의 strategy_kind와 framework를 저장합니다.",
      "tool profile이 tool_calling 미지원 모델에서 실행되지 않도록 막습니다.",
      "Browse와 Response 화면에서 선택 가능한 profile 목록의 기반이 됩니다.",
    ],
    whenToUse: "새 agent 전략을 추가하거나 모델 capability에 따라 profile을 걸러야 할 때 중심이 됩니다.",
    codePath: "application/services/agent_profile_service.py",
  },
  {
    id: "profile-response-service",
    category: "service",
    title: "ProfileResponseService",
    subtitle: "Response 화면의 profile 기반 응답 실행과 streaming을 담당",
    badges: ["service", "response", "stream"],
    summary: "선택된 model_id와 profile_id로 즉시 답변을 실행합니다. grounding override, streaming fallback, runner 호출을 이 서비스에서 묶습니다.",
    logic: ["Resolve model", "Resolve profile", "Build case", "Stream response"],
    responsibilities: [
      "Response 페이지의 profile-responses API를 처리합니다.",
      "response-page source일 때 위치 grounding이나 identity override를 적용합니다.",
      "custom direct profile은 streaming하고, 불가능한 profile은 JSON 응답으로 fallback합니다.",
    ],
    whenToUse: "사용자와 실시간 채팅하는 화면에서 선택 profile을 그대로 적용해야 할 때 사용됩니다.",
    codePath: "application/services/profile_response_service.py",
  },
  {
    id: "benchmark-service",
    category: "service",
    title: "BenchmarkService",
    subtitle: "suite, case, run, result, history 집계를 담당",
    badges: ["service", "benchmark", "history"],
    summary: "비교 실행 자체보다 벤치마크 도메인 데이터를 만들고 저장하고 집계하는 역할에 집중합니다.",
    logic: ["Suite", "Case", "Run", "Result history"],
    responsibilities: [
      "benchmark suite와 case를 생성합니다.",
      "모델과 profile 조합별 run을 실행하고 result를 저장합니다.",
      "latency, pass rate, trace preview를 Results 화면에서 볼 수 있게 집계합니다.",
    ],
    whenToUse: "여러 모델/프로필 조합을 같은 prompt로 비교하고 결과 이력을 남길 때 중심이 됩니다.",
    codePath: "application/services/benchmark_service.py",
  },
  {
    id: "benchmark-runner",
    category: "runner",
    title: "BenchmarkRunner",
    subtitle: "framework별 실제 호출 방식을 캡슐화하는 실행기",
    badges: ["runner", "framework", "trace"],
    summary: "Custom, LangChain, LangGraph, LlamaIndex별 실행 차이를 BenchmarkRunner 인터페이스 아래로 숨깁니다.",
    logic: ["Runner context", "Framework call", "Raw output", "Trace"],
    responsibilities: [
      "profile.framework 값에 맞는 runner를 선택합니다.",
      "프레임워크별 request preview와 trace를 남깁니다.",
      "output_text, raw_output, usage를 공통 결과 형식으로 돌려줍니다.",
    ],
    whenToUse: "새 프레임워크를 붙이거나 같은 prompt를 여러 runtime에서 비교하고 싶을 때 확장 지점입니다.",
    codePath: "application/benchmark_runners.py",
  },
];

const EXPLAIN_DETAILS = {
  "direct-chat": {
    mechanics: [
      "선택한 profile의 system_prompt와 사용자의 메시지를 순서대로 provider messages에 넣습니다.",
      "retriever, context filter, tool loop 같은 중간 단계가 없어서 latency와 출력 품질을 가장 순수하게 비교할 수 있습니다.",
      "Benchmark에서는 case.input_messages를 그대로 사용하고, Response에서는 현재 대화 이력을 user/assistant 메시지로 이어 붙입니다.",
    ],
    requestEffects: [
      "payload에는 model, messages, temperature, max_tokens 같은 기본 필드만 들어갑니다.",
      "context_documents가 있어도 direct profile에서는 일반적으로 grounded context로 강하게 묶이지 않습니다.",
      "trace에는 request.built와 assistant.message 정도만 남기 때문에 디버깅이 단순합니다.",
    ],
    watchOut: [
      "모델이 모르는 사실도 그럴듯하게 답할 수 있으므로 사실 검증이 중요한 질문에는 RAG가 더 적합합니다.",
      "도구 호출이 필요한 질문을 direct로 보내면 모델이 실제 조회 없이 추측할 가능성이 있습니다.",
    ],
  },
  "rag-context": {
    mechanics: [
      "Browse의 Context 입력값은 줄 단위로 정리되어 context_documents에 저장됩니다.",
      "runner가 profile.system_prompt, response mode prompt, context_documents를 하나의 system prompt로 조립합니다.",
      "질문은 user message로 유지하고, 근거 문서는 system 영역에 넣어서 모델이 답변 전에 참고하도록 만듭니다.",
    ],
    requestEffects: [
      "request preview의 첫 system message에 Grounded context 섹션이 생깁니다.",
      "context가 많아질수록 prompt token이 증가하고 latency가 늘 수 있습니다.",
      "Results 화면에서는 context notes와 request preview를 통해 어떤 근거가 실제 요청에 들어갔는지 확인할 수 있습니다.",
    ],
    watchOut: [
      "현재는 벡터 검색으로 문서를 찾아오는 완전한 검색형 RAG가 아니라, 입력된 문맥을 주입하는 방식입니다.",
      "잘못된 context를 넣으면 모델은 그 잘못된 근거를 우선할 수 있습니다.",
      "문맥이 길면 핵심 근거만 남기고 압축하는 편이 더 안정적입니다.",
    ],
  },
  "tool-agent": {
    mechanics: [
      "모델 호출 payload에 tools와 tool_choice:auto를 붙여 모델이 함수 호출을 선택할 수 있게 합니다.",
      "assistant message에 tool_calls가 있으면 ToolRegistry가 이름과 JSON arguments를 검증한 뒤 도구를 실행합니다.",
      "도구 결과는 role:tool 메시지로 대화에 추가되고, 모델을 다시 호출해서 최종 답변을 받습니다.",
    ],
    requestEffects: [
      "한 번의 사용자 요청이 여러 provider calls로 이어질 수 있습니다.",
      "trace에는 assistant.message, tool.completed, 다음 request.built가 순서대로 쌓입니다.",
      "max_steps에 도달할 때까지 최종 답변이 없으면 실패 처리됩니다.",
    ],
    watchOut: [
      "upstream 모델 서버가 tool calling을 지원하지 않으면 실행 전에 차단하거나 provider 오류가 납니다.",
      "도구 arguments가 JSON으로 파싱되지 않으면 ToolExecutionError가 발생합니다.",
      "외부 도구를 추가할 때는 권한, 입력 검증, 실행 시간 제한을 같이 설계해야 합니다.",
    ],
  },
  "custom-runtime": {
    mechanics: [
      "callLLM 코드가 직접 OpenAI-compatible payload를 만들고 http client로 upstream에 보냅니다.",
      "프레임워크 adapter 없이 동작해서 가장 예측 가능한 기준 실행 경로입니다.",
      "direct, rag, tool 전략의 공통 baseline runner로 쓰입니다.",
    ],
    requestEffects: [
      "payload shape와 trace format이 callLLM 내부 코드에 의해 고정됩니다.",
      "extra_body, temperature, max_steps 같은 generation params가 model/profile/run 순서로 병합됩니다.",
      "framework 의존성이 없어 runtime_status와 관계없이 활성화할 수 있습니다.",
    ],
    watchOut: [
      "LangChain이나 LlamaIndex 생태계 기능을 자동으로 얻지는 못합니다.",
      "복잡한 agent orchestration은 직접 구현해야 하므로 LangGraph보다 확장 비용이 커질 수 있습니다.",
    ],
  },
  "langchain-runtime": {
    mechanics: [
      "LangChain ChatOpenAI 객체를 OpenAI-compatible endpoint에 연결합니다.",
      "profile이 tool 전략이면 LangChain tool binding 방식으로 도구 호출 흐름을 구성합니다.",
      "LangChain 응답 객체를 callLLM 공통 BenchmarkRunnerResult 형식으로 변환합니다.",
    ],
    requestEffects: [
      "raw_output에는 LangChain message, usage, response_metadata가 들어갈 수 있습니다.",
      "request preview는 LangChain 호출 전 만들어진 messages와 모델 설정을 보여줍니다.",
      "optional dependency가 없으면 해당 profile은 seeded 상태여도 enabled=false가 됩니다.",
    ],
    watchOut: [
      "custom runtime과 완전히 같은 payload를 보내지 않을 수 있어 결과 차이가 생길 수 있습니다.",
      "LangChain 버전 변화에 따라 tool call 표현이나 usage metadata가 달라질 수 있습니다.",
      "단순 direct 호출만 비교한다면 custom runtime보다 얻는 이점은 주로 adapter 호환성입니다.",
    ],
  },
  "langgraph-runtime": {
    mechanics: [
      "프롬프트, 모델 호출, 도구 실행, 종료 조건을 그래프의 상태 전이로 표현하는 방식입니다.",
      "각 노드는 현재 상태를 읽고 다음 상태를 반환하며, 엣지가 다음 실행 경로를 결정합니다.",
      "tool agent처럼 반복이 필요한 흐름을 명시적인 구조로 관리하기 좋습니다.",
    ],
    requestEffects: [
      "trace는 단일 호출보다 agent 단계 중심으로 읽는 것이 중요합니다.",
      "상태가 커질수록 어떤 메시지가 다음 노드로 전달되는지 확인해야 합니다.",
      "future extension으로 checkpoint, human approval, retry branch를 넣기 쉽습니다.",
    ],
    watchOut: [
      "간단한 direct 답변에는 구조가 과할 수 있습니다.",
      "그래프 종료 조건이 부정확하면 불필요한 반복이나 max_steps 실패가 생길 수 있습니다.",
      "디버깅할 때는 최종 답변뿐 아니라 노드별 state 변화를 같이 봐야 합니다.",
    ],
  },
  "llamaindex-runtime": {
    mechanics: [
      "LlamaIndex의 OpenAILike 연결을 통해 등록된 OpenAI-compatible endpoint를 호출합니다.",
      "RAG 성격의 profile에서는 context documents를 prompt에 녹여 문서 기반 답변처럼 실행합니다.",
      "completion 결과를 callLLM 공통 output_text/raw_output/trace 구조로 변환합니다.",
    ],
    requestEffects: [
      "prompt 기반 request preview가 남아 실제로 어떤 문맥이 들어갔는지 확인할 수 있습니다.",
      "문서 중심 앱으로 확장하면 index, retriever, node parser 같은 LlamaIndex 구성 요소를 붙일 수 있습니다.",
      "현재 구현은 완전한 index query engine보다 baseline OpenAILike runner에 가깝습니다.",
    ],
    watchOut: [
      "진짜 검색형 RAG를 원하면 문서 ingest와 index 저장소 설계가 추가로 필요합니다.",
      "문맥 조립 방식이 custom RAG와 다를 수 있어 비교 시 prompt preview를 확인해야 합니다.",
    ],
  },
  "model-registry-service": {
    mechanics: [
      "모델 record는 UI에서 선택 가능한 model card의 원천 데이터입니다.",
      "base_url, served_model_name, api_key, capabilities를 저장해서 실행 시 provider client 설정에 사용합니다.",
      "probe_model은 upstream /v1/models를 호출해 served model이 실제로 노출되는지 확인합니다.",
    ],
    requestEffects: [
      "capabilities.chat_completions가 false이면 Response와 Benchmark 후보에서 제외됩니다.",
      "capabilities.tool_calling이 true가 아니면 tool profile 실행이 차단됩니다.",
      "default_params는 profile generation_defaults와 run params보다 낮은 우선순위로 병합됩니다.",
    ],
    watchOut: [
      "served_model_name은 UI 표시 이름이 아니라 upstream에 실제 전달되는 model 값입니다.",
      "등록된 base_url이 잘못되면 해당 모델을 선택한 모든 profile 실행이 실패합니다.",
      "api_key는 model_dump에서 제외되지만 저장소 보안은 별도로 고려해야 합니다.",
    ],
  },
  "agent-profile-service": {
    mechanics: [
      "profile은 전략(strategy_kind), 프레임워크(framework), system prompt, tool_names, generation_defaults를 묶은 실행 preset입니다.",
      "UI는 선택한 library와 app strategy에 맞는 profile만 필터링해서 보여줍니다.",
      "ensure_model_supports_profile은 tool 요구 profile이 tool 미지원 모델에서 실행되지 않게 막습니다.",
    ],
    requestEffects: [
      "profile.framework 값이 runner 선택의 기준이 됩니다.",
      "profile.strategy_kind는 direct/rag/tool 중 어떤 실행 로직을 탈지 결정합니다.",
      "profile.metadata.library_ids가 있으면 특정 library 카드에 profile을 묶을 수 있습니다.",
    ],
    watchOut: [
      "tool_names가 비어 있지 않으면 strategy_kind가 direct여도 tool calling 요구 profile로 판단됩니다.",
      "profile.enabled=false이면 UI에서 실행 후보로 보이지 않습니다.",
      "system_prompt가 너무 강하면 앱별 workflow prompt보다 우선적으로 모델 행동을 지배할 수 있습니다.",
    ],
  },
  "profile-response-service": {
    mechanics: [
      "Response 페이지에서 model_id와 profile_id를 받아 해당 모델과 profile을 먼저 resolve합니다.",
      "response-page source일 때 identity 질문이나 위치 질문은 grounding override로 빠르게 처리할 수 있습니다.",
      "stream 가능한 custom direct profile은 SSE로 delta를 보내고, 불가능하면 JSON 응답으로 fallback합니다.",
    ],
    requestEffects: [
      "metadata.source, grounding_mode, selected_app_id, selected_library_id가 응답 로직에 영향을 줍니다.",
      "context_documents는 response mode에서 grounded context로 들어가 live chat 답변에 반영됩니다.",
      "stream 응답은 run.started, message.delta, run.completed 이벤트로 UI에 전달됩니다.",
    ],
    watchOut: [
      "tool profile streaming은 아직 지원하지 않아 일반 profile response 호출로 fallback합니다.",
      "grounding_mode=raw이면 위치 grounding override를 건너뜁니다.",
      "Response 화면은 사용자 대화 품질을 우선하므로 benchmark scoring과는 목적이 다릅니다.",
    ],
  },
  "benchmark-service": {
    mechanics: [
      "suite는 하나의 비교 실험 묶음이고, case는 그 안의 prompt/context/expected check입니다.",
      "run은 특정 model/profile 조합의 실행 단위이며, result는 case별 출력, latency, score, trace입니다.",
      "execute_benchmark_run은 enabled case들을 순회하며 runner를 호출하고 summary를 갱신합니다.",
    ],
    requestEffects: [
      "Results 화면은 benchmark-history API에서 suite, cases, runs, results snapshot을 받아 구성됩니다.",
      "contains expected나 keywords가 있으면 간단한 pass/fail score가 기록됩니다.",
      "runner.exception이나 provider 오류도 result로 저장되어 비교 행렬에서 실패 케이스로 보입니다.",
    ],
    watchOut: [
      "현재 scoring은 간단한 문자열 기반 점검이라 품질 평가 전체를 대표하지는 않습니다.",
      "여러 모델/프로필 조합을 실행하면 upstream 비용과 시간이 조합 수만큼 늘어납니다.",
      "벤치마크 실행 중 생성되는 trace에는 요청 preview가 포함되므로 민감한 prompt/context를 주의해야 합니다.",
    ],
  },
  "benchmark-runner": {
    mechanics: [
      "BenchmarkRunnerRegistry가 profile.framework 값을 보고 custom/langchain/langgraph/llamaindex runner를 선택합니다.",
      "각 runner는 자기 방식으로 모델을 호출하지만 결과는 BenchmarkRunnerResult로 통일합니다.",
      "trace에는 request.built, assistant.message, tool.completed 같은 실행 이벤트를 남깁니다.",
    ],
    requestEffects: [
      "새 프레임워크를 추가해도 BenchmarkService는 runner interface만 알면 됩니다.",
      "동일 prompt라도 runner가 조립하는 message format이 다르면 결과가 달라질 수 있습니다.",
      "Results의 request preview는 runner별 차이를 확인하는 가장 중요한 디버깅 정보입니다.",
    ],
    watchOut: [
      "framework dependency가 설치되지 않으면 runner가 실행 실패를 반환하거나 profile이 비활성화됩니다.",
      "runner별 raw_output 구조가 다르므로 UI에서는 공통 필드와 debug JSON을 함께 보여줍니다.",
      "프레임워크 비교를 할 때는 prompt, model, temperature, context를 최대한 동일하게 맞춰야 합니다.",
    ],
  },
};

const EXPLAIN_PURPOSE_DETAILS = {
  "direct-chat": {
    whyNeeded: [
      "새 모델을 붙였을 때 가장 먼저 확인해야 하는 기준선입니다. 검색, 도구, 프레임워크 adapter가 섞이면 모델 자체의 답변 품질과 호출 안정성을 분리해서 보기 어렵습니다.",
      "프롬프트만 바꿨을 때 결과가 어떻게 변하는지 빠르게 검증할 수 있습니다. 같은 모델에서 system prompt, temperature, expected check의 영향을 확인하기 좋습니다.",
      "RAG나 Tool Agent가 실패했을 때 문제 원인이 모델 호출인지, 문맥 조립인지, 도구 실행인지 좁히는 비교군으로 필요합니다.",
      "짧은 답변, 요약, 일반 생성처럼 외부 근거가 필요 없는 흐름에서는 복잡한 orchestration보다 낮은 지연 시간과 단순한 trace가 더 중요합니다.",
    ],
    features: [
      "사용자 메시지와 profile system prompt를 provider messages로 변환합니다.",
      "선택한 모델의 base URL, served model name, generation params를 반영해 OpenAI-compatible chat completion 요청을 만듭니다.",
      "응답 텍스트, usage, latency, request preview를 공통 결과 형식으로 저장합니다.",
      "Benchmark와 Response 화면 양쪽에서 가장 단순한 실행 경로로 동작합니다.",
      "다른 전략과 비교할 수 있도록 trace를 최소 이벤트 중심으로 남깁니다.",
    ],
  },
  "rag-context": {
    whyNeeded: [
      "모델이 학습하지 않았거나 최신이 아닌 정보를 답해야 할 때, 답변을 사용자가 제공한 근거에 묶기 위해 필요합니다.",
      "내부 문서, 제품 스펙, 회의 메모처럼 모델이 임의로 추측하면 안 되는 지식은 prompt 옆에 별도 context로 관리해야 합니다.",
      "Direct Chat만 쓰면 그럴듯하지만 근거 없는 답변이 나올 수 있으므로, 사실 기반 답변의 재현성과 검토 가능성을 높입니다.",
      "나중에 벡터 검색, 문서 ingest, reranker를 붙이더라도 UI와 runner가 context_documents를 다루는 기본 흐름이 먼저 필요합니다.",
    ],
    features: [
      "Browse/Response 화면의 Context 입력값을 context_documents metadata로 저장합니다.",
      "runner가 context를 Grounded context 섹션으로 조립해 system prompt에 주입합니다.",
      "근거가 부족하면 모른다고 말하도록 response mode prompt와 함께 모델 행동을 제한합니다.",
      "Results 화면에서 실제 요청에 들어간 문맥을 request preview로 확인할 수 있게 합니다.",
      "문서 기반 답변 품질, latency, token 증가 영향을 Direct Chat과 비교할 수 있게 합니다.",
    ],
  },
  "tool-agent": {
    whyNeeded: [
      "현재 시간, 계산, 외부 API 조회처럼 모델 내부 지식만으로 답하면 안 되는 작업을 처리하기 위해 필요합니다.",
      "모델이 모든 일을 직접 생성하게 두면 실제 상태와 다른 답을 만들 수 있으므로, 서버가 검증된 도구만 실행하는 경계가 필요합니다.",
      "한 번의 질문 안에서 판단, 도구 호출, 결과 해석, 최종 답변이 이어지는 agent 흐름을 실험할 수 있습니다.",
      "도구 호출 가능 모델과 불가능 모델을 분리해 capability 차이를 명확히 보여줍니다.",
    ],
    features: [
      "모델 요청에 tools schema와 tool_choice:auto를 포함합니다.",
      "assistant의 tool_calls를 읽고 JSON arguments를 검증한 뒤 ToolRegistry에 등록된 도구만 실행합니다.",
      "도구 실행 결과를 role:tool 메시지로 다시 대화에 넣고 모델을 재호출합니다.",
      "max_steps 안에서 assistant/tool loop를 관리하고 실패 조건을 trace에 남깁니다.",
      "도구명, 입력값, 실행 결과, 최종 답변을 Results 화면에서 추적 가능하게 만듭니다.",
    ],
  },
  "custom-runtime": {
    whyNeeded: [
      "프레임워크 의존성 없이 항상 동작하는 내부 실행 경로가 있어야 서비스가 기본 기능을 잃지 않습니다.",
      "LangChain, LangGraph, LlamaIndex 같은 adapter가 만든 차이를 비교하려면 callLLM 자체 기준 runtime이 필요합니다.",
      "payload shape, trace format, error handling을 직접 통제할 수 있어 디버깅과 운영 예측성이 높습니다.",
      "단순 호출이나 가벼운 RAG 주입은 큰 프레임워크를 거치지 않는 편이 latency와 이해 비용 면에서 유리합니다.",
    ],
    features: [
      "profile과 model 설정을 합쳐 provider payload를 직접 생성합니다.",
      "direct, rag, tool 전략을 하나의 내부 runner에서 처리합니다.",
      "OpenAI-compatible endpoint 호출, provider 오류 변환, usage/latency 기록을 담당합니다.",
      "tool strategy에서는 ToolRegistry 기반 loop를 직접 수행합니다.",
      "다른 framework runner와 같은 BenchmarkRunnerResult 형식으로 결과를 반환합니다.",
    ],
  },
  "langchain-runtime": {
    whyNeeded: [
      "LangChain 기반 앱으로 확장하거나 이관할 때 동일한 모델/profile을 LangChain 방식으로 검증하기 위해 필요합니다.",
      "모델 provider 교체, tool binding, message abstraction을 프레임워크 표준 인터페이스로 다룰 수 있습니다.",
      "Custom Runtime과 LangChain adapter의 응답 차이, metadata 차이, overhead를 벤치마크로 비교할 수 있습니다.",
      "이미 LangChain 생태계의 retriever, tool, chain을 쓰는 코드와 연결할 확장 지점을 제공합니다.",
    ],
    features: [
      "ChatOpenAI를 OpenAI-compatible endpoint에 연결합니다.",
      "callLLM profile messages를 LangChain message 형식으로 변환해 실행합니다.",
      "tool profile에서는 LangChain tool binding 흐름을 사용해 도구 호출을 비교합니다.",
      "AIMessage, usage metadata, response metadata를 raw_output에 보존합니다.",
      "LangChain dependency가 없거나 사용할 수 없으면 profile을 비활성 상태로 표시할 수 있습니다.",
    ],
  },
  "langgraph-runtime": {
    whyNeeded: [
      "단순한 한 번의 모델 호출을 넘어 상태 기반 agent 흐름을 안정적으로 표현하기 위해 필요합니다.",
      "도구 호출, 재시도, 승인, 종료 조건처럼 단계가 늘어나는 순간 if문 중심 구현은 흐름을 추적하기 어려워집니다.",
      "각 단계를 노드와 엣지로 나누면 어디서 멈췄는지, 어떤 상태가 다음 단계로 넘어갔는지 검토하기 쉽습니다.",
      "장기적으로 checkpoint, human-in-the-loop, branch retry 같은 운영 제어를 붙이기 좋은 구조를 제공합니다.",
    ],
    features: [
      "agent 상태를 그래프 state로 관리합니다.",
      "모델 호출, 도구 실행, 조건 분기, 종료 판단을 노드 단위로 표현합니다.",
      "tool agent와 비슷한 multi-step 흐름을 더 명시적인 구조로 실행합니다.",
      "노드별 실행 결과와 상태 변화를 trace 관점에서 확인할 수 있게 합니다.",
      "복잡한 agent 실험을 Custom Runtime과 같은 결과 형식으로 비교합니다.",
    ],
  },
  "llamaindex-runtime": {
    whyNeeded: [
      "문서와 지식 베이스 중심의 질의응답을 실험하려면 RAG에 특화된 데이터 레이어가 필요합니다.",
      "현재는 context 주입 baseline이지만, 이후 index, node parser, retriever를 붙이는 자연스러운 확장 경로가 됩니다.",
      "LlamaIndex 방식의 문맥 조립과 Custom RAG 방식의 차이를 같은 화면에서 비교할 수 있습니다.",
      "문서 기반 앱에서 모델 호출보다 문서 ingest와 검색 품질이 더 중요해질 때 사용할 기준점을 만듭니다.",
    ],
    features: [
      "OpenAILike 연결로 등록된 OpenAI-compatible 모델을 호출합니다.",
      "context documents를 prompt에 반영해 문서 기반 답변처럼 실행합니다.",
      "completion 결과를 output_text, raw_output, trace로 정규화합니다.",
      "RAG profile과 함께 문맥 주입 방식의 차이를 확인할 수 있게 합니다.",
      "향후 index 저장소, retriever, query engine을 붙일 수 있는 실행 lane을 제공합니다.",
    ],
  },
  "model-registry-service": {
    whyNeeded: [
      "UI와 실행 코드가 모델 정보를 제각각 들고 있으면 base URL, served model name, capability가 쉽게 어긋납니다.",
      "모델마다 chat 지원 여부, tool calling 지원 여부가 다르므로 실행 전에 capability를 확인할 중앙 지점이 필요합니다.",
      "새 모델을 추가하거나 endpoint를 바꿀 때 서비스 전체를 수정하지 않고 registry 데이터만 갱신할 수 있어야 합니다.",
      "health probe가 있어야 모델 서버가 살아 있는지, 실제 served model이 노출되는지 빠르게 판단할 수 있습니다.",
    ],
    features: [
      "모델 id, 표시 이름, provider, base_url, served_model_name을 관리합니다.",
      "chat_completions, tool_calling 같은 capability 정보를 제공합니다.",
      "upstream /v1/models probe로 모델 서버 상태와 노출 모델을 확인합니다.",
      "provider client를 만들 때 필요한 설정 데이터를 공급합니다.",
      "Browse, Response, Benchmark에서 공통으로 사용할 모델 목록의 원천이 됩니다.",
    ],
  },
  "agent-profile-service": {
    whyNeeded: [
      "모델만 선택해서는 어떤 방식으로 답변할지 알 수 없으므로 전략, 프레임워크, system prompt를 묶은 profile이 필요합니다.",
      "Direct, RAG, Tool Agent의 실행 조건과 요구 capability가 다르기 때문에 profile 단위 검증이 필요합니다.",
      "UI에서 library/app 선택에 따라 실행 가능한 profile만 보여주려면 profile metadata가 중앙에서 관리되어야 합니다.",
      "새 agent 전략을 추가할 때 route나 runner 전체를 바꾸지 않고 profile 정의를 늘리는 구조가 필요합니다.",
    ],
    features: [
      "strategy_kind, framework, system_prompt, tool_names, generation_defaults를 하나의 profile로 관리합니다.",
      "모델이 profile 요구사항을 만족하는지 실행 전에 검증합니다.",
      "library_ids 같은 metadata로 UI 카드와 profile을 연결합니다.",
      "enabled 상태를 통해 아직 사용할 수 없는 profile을 실행 후보에서 제외합니다.",
      "Browse와 Response 화면의 profile 선택 목록을 구성하는 기준 데이터를 제공합니다.",
    ],
  },
  "profile-response-service": {
    whyNeeded: [
      "Response 화면은 벤치마크가 아니라 실제 대화에 가까운 빠른 응답 흐름이므로 별도 서비스 경계가 필요합니다.",
      "선택한 model/profile, grounding mode, 대화 이력, context를 한 번에 해석하는 orchestration 지점이 필요합니다.",
      "streaming이 가능한 경우와 불가능한 경우를 같은 UI에서 처리하려면 fallback 정책이 중앙에 있어야 합니다.",
      "사용자 대화에서는 identity, 위치, context override처럼 benchmark와 다른 UX 보정이 필요할 수 있습니다.",
    ],
    features: [
      "model_id와 profile_id를 resolve하고 실행 가능한 조합인지 확인합니다.",
      "response-page metadata와 grounding_mode를 읽어 prompt/context 조립을 결정합니다.",
      "custom direct profile은 SSE streaming으로 delta 이벤트를 보냅니다.",
      "streaming이 맞지 않는 profile은 일반 profile response JSON 호출로 fallback합니다.",
      "대화 이력, context documents, 선택 library/app 정보를 runner 입력으로 연결합니다.",
    ],
  },
  "benchmark-service": {
    whyNeeded: [
      "여러 모델과 profile을 같은 prompt로 비교하려면 suite, case, run, result를 일관된 도메인 구조로 관리해야 합니다.",
      "실행 로직과 결과 저장/집계를 분리해야 runner가 늘어나도 history와 Results 화면이 흔들리지 않습니다.",
      "latency, pass/fail, output, trace를 남겨야 모델 품질과 운영 비용을 나중에 다시 검토할 수 있습니다.",
      "단발성 채팅이 아니라 반복 가능한 비교 실험을 만들기 위해 필요합니다.",
    ],
    features: [
      "benchmark suite와 case를 생성하고 저장합니다.",
      "선택된 model/profile 조합별 run을 만들고 runner 실행을 호출합니다.",
      "case별 result, latency, score, raw output, trace preview를 기록합니다.",
      "run summary와 benchmark history를 Results 화면에 제공할 형태로 집계합니다.",
      "provider 오류나 runner 예외도 result로 저장해 실패 원인을 비교할 수 있게 합니다.",
    ],
  },
  "benchmark-runner": {
    whyNeeded: [
      "프레임워크마다 호출 방식은 다르지만 BenchmarkService가 그 차이를 모두 알면 서비스가 빠르게 복잡해집니다.",
      "Custom, LangChain, LangGraph, LlamaIndex를 같은 prompt로 비교하려면 공통 runner 인터페이스가 필요합니다.",
      "새 framework를 추가할 때 benchmark 도메인 로직을 건드리지 않고 실행기만 추가할 수 있어야 합니다.",
      "request preview와 trace를 runner가 직접 남겨야 프레임워크별 message 조립 차이를 디버깅할 수 있습니다.",
    ],
    features: [
      "profile.framework 값에 맞는 runner를 선택합니다.",
      "각 framework 방식으로 provider 호출, tool loop, context 조립을 수행합니다.",
      "출력 텍스트, raw output, usage, latency, trace를 BenchmarkRunnerResult로 통일합니다.",
      "request.built, assistant.message, tool.completed 같은 실행 이벤트를 기록합니다.",
      "framework dependency 오류나 provider 실패를 공통 오류 형식으로 반환합니다.",
    ],
  },
};

const EXPLAIN_PROCESS_DETAILS = {
  "direct-chat": {
    scenario: "사용자가 “이 제품 설명을 세 문장으로 요약해줘”라고 묻는 경우",
    input: "입력: 사용자 질문 + direct-chat profile system prompt + 선택 모델",
    steps: [
      {
        title: "요청 수집",
        body: "Browse 또는 Response 화면에서 사용자의 질문과 선택된 모델, profile을 읽습니다.",
      },
      {
        title: "메시지 생성",
        body: "system prompt와 user message를 OpenAI-compatible messages 배열로 만듭니다.",
      },
      {
        title: "모델 호출",
        body: "검색 문맥이나 도구 없이 선택 모델의 chat completions endpoint로 바로 보냅니다.",
      },
      {
        title: "응답 정리",
        body: "assistant 답변, latency, usage, request preview를 공통 결과 형식으로 변환합니다.",
      },
      {
        title: "화면 반영",
        body: "Response에는 답변을 표시하고, Benchmark에서는 Results 비교 행에 저장합니다.",
      },
    ],
    result: "모델 자체의 기본 답변 품질과 속도를 가장 단순한 기준선으로 확인할 수 있습니다.",
  },
  "rag-context": {
    scenario: "사용자가 “우리 환불 정책 기준으로 답해줘”라고 묻고 정책 문서를 Context에 붙이는 경우",
    input: "입력: 질문 + Context 문서 조각 + rag-context profile",
    steps: [
      {
        title: "문맥 저장",
        body: "Context 입력값을 줄 단위 문서 조각으로 정리해 context_documents metadata에 넣습니다.",
      },
      {
        title: "근거 프롬프트 생성",
        body: "runner가 system prompt 안에 Grounded context 섹션을 만들고 문서 조각을 합칩니다.",
      },
      {
        title: "질문 결합",
        body: "사용자 질문은 user message로 유지하고, 근거는 system 영역에 배치합니다.",
      },
      {
        title: "모델 답변",
        body: "모델은 주어진 근거를 우선해서 답하고, 근거가 부족하면 추측을 줄이도록 유도됩니다.",
      },
      {
        title: "근거 확인",
        body: "Results의 request preview에서 어떤 context가 실제 요청에 들어갔는지 검토합니다.",
      },
    ],
    result: "답변이 모델 기억이 아니라 사용자가 넣은 문서 근거에 묶여 재현성과 검토 가능성이 올라갑니다.",
  },
  "tool-agent": {
    scenario: "사용자가 “현재 시간을 확인해서 마감까지 몇 시간 남았는지 알려줘”라고 묻는 경우",
    input: "입력: 사용자 질문 + tool-agent profile + 등록된 tool schema",
    steps: [
      {
        title: "도구 목록 전달",
        body: "모델 요청 payload에 서버가 허용한 tools schema와 tool_choice:auto를 붙입니다.",
      },
      {
        title: "도구 호출 결정",
        body: "모델이 직접 답하기 어렵다고 판단하면 assistant message에 tool_calls를 반환합니다.",
      },
      {
        title: "도구 실행",
        body: "ToolRegistry가 tool 이름과 JSON arguments를 검증하고 서버에서 실제 도구를 실행합니다.",
      },
      {
        title: "결과 재주입",
        body: "도구 결과를 role:tool 메시지로 대화에 추가한 뒤 모델을 다시 호출합니다.",
      },
      {
        title: "최종 답변",
        body: "모델이 도구 결과를 읽고 사용자가 이해할 수 있는 최종 문장으로 정리합니다.",
      },
    ],
    result: "모델이 추측하지 않고 서버가 실행한 실제 도구 결과를 바탕으로 답변합니다.",
  },
  "custom-runtime": {
    scenario: "같은 prompt를 Custom Runtime으로 먼저 실행해 프레임워크 없는 기준 성능을 보는 경우",
    input: "입력: model 설정 + profile 설정 + benchmark case",
    steps: [
      {
        title: "설정 병합",
        body: "모델 default params, profile generation defaults, run params를 우선순위에 맞게 합칩니다.",
      },
      {
        title: "전략 선택",
        body: "profile.strategy_kind에 따라 direct, rag, tool 중 필요한 내부 실행 로직을 고릅니다.",
      },
      {
        title: "payload 작성",
        body: "callLLM 코드가 직접 messages, model, temperature, tools 등을 포함한 요청을 만듭니다.",
      },
      {
        title: "provider 호출",
        body: "OpenAI-compatible endpoint로 HTTP 요청을 보내고 provider 오류를 공통 오류로 변환합니다.",
      },
      {
        title: "trace 반환",
        body: "응답, usage, latency, request preview, 실행 이벤트를 BenchmarkRunnerResult로 반환합니다.",
      },
    ],
    result: "외부 framework 영향 없이 callLLM 내부 로직만으로 모델 호출 결과를 확인합니다.",
  },
  "langchain-runtime": {
    scenario: "기존 LangChain 앱으로 옮기기 전에 같은 profile이 LangChain 방식에서도 잘 도는지 보는 경우",
    input: "입력: callLLM messages + LangChain ChatOpenAI adapter + optional tools",
    steps: [
      {
        title: "메시지 변환",
        body: "callLLM의 system/user/tool 메시지를 LangChain message 객체로 맞춥니다.",
      },
      {
        title: "ChatOpenAI 구성",
        body: "등록된 base URL, served model name, api key로 ChatOpenAI client를 만듭니다.",
      },
      {
        title: "도구 연결",
        body: "tool profile이면 LangChain tool binding 방식으로 사용 가능한 도구를 붙입니다.",
      },
      {
        title: "invoke 실행",
        body: "LangChain runtime이 모델을 호출하고 AIMessage와 response metadata를 반환합니다.",
      },
      {
        title: "결과 정규화",
        body: "LangChain 응답을 callLLM 공통 output_text/raw_output/trace 구조로 바꿉니다.",
      },
    ],
    result: "같은 모델과 profile을 LangChain adapter 경로에서 실행했을 때 차이와 호환성을 비교할 수 있습니다.",
  },
  "langgraph-runtime": {
    scenario: "질문에 따라 도구를 부를지, 다시 물어볼지, 답변할지 상태 기반으로 나눠야 하는 경우",
    input: "입력: 초기 agent state + graph node 정의 + 종료 조건",
    steps: [
      {
        title: "상태 시작",
        body: "사용자 질문, 대화 이력, context, 실행 횟수를 graph state에 넣습니다.",
      },
      {
        title: "노드 실행",
        body: "planner 또는 model node가 현재 state를 읽고 다음 상태를 반환합니다.",
      },
      {
        title: "분기 판단",
        body: "도구 호출이 필요하면 tool node로, 충분하면 answer node로 이동합니다.",
      },
      {
        title: "상태 갱신",
        body: "도구 결과나 모델 응답을 state에 추가하고 다음 노드가 이어서 읽게 합니다.",
      },
      {
        title: "종료",
        body: "최종 답변이 만들어지거나 max_steps에 도달하면 그래프 실행을 멈춥니다.",
      },
    ],
    result: "복잡한 agent 흐름을 노드와 엣지 단위로 추적하면서 재시도, 승인, 분기 확장을 준비할 수 있습니다.",
  },
  "llamaindex-runtime": {
    scenario: "제품 FAQ나 문서 조각을 기반으로 질문에 답하는 문서 중심 앱을 실험하는 경우",
    input: "입력: 질문 + 문서 context + LlamaIndex OpenAILike client",
    steps: [
      {
        title: "문서 준비",
        body: "현재는 사용자가 넣은 context documents를 문서 기반 입력으로 사용합니다.",
      },
      {
        title: "프롬프트 구성",
        body: "질문과 문맥을 LlamaIndex runner가 사용할 prompt 형태로 정리합니다.",
      },
      {
        title: "OpenAILike 호출",
        body: "등록된 OpenAI-compatible endpoint를 LlamaIndex OpenAILike 연결로 호출합니다.",
      },
      {
        title: "응답 변환",
        body: "completion 결과를 callLLM의 output_text, raw_output, trace 형식으로 맞춥니다.",
      },
      {
        title: "확장 지점 확인",
        body: "나중에 index, retriever, node parser를 붙일 위치를 같은 runtime lane에서 확인합니다.",
      },
    ],
    result: "문서 기반 RAG 앱으로 확장하기 전, LlamaIndex 경로의 기본 호출과 문맥 조립 흐름을 비교합니다.",
  },
  "model-registry-service": {
    scenario: "새 Qwen endpoint를 추가하고 Browse 화면에서 선택 가능하게 만드는 경우",
    input: "입력: 모델 이름 + base URL + served model name + capability 정보",
    steps: [
      {
        title: "모델 등록",
        body: "표시 이름, provider, base_url, served_model_name, default params를 record로 저장합니다.",
      },
      {
        title: "상태 확인",
        body: "probe가 upstream /v1/models를 호출해 실제 served model이 노출되는지 확인합니다.",
      },
      {
        title: "기능 판단",
        body: "chat_completions, tool_calling 같은 capability 값을 모델 실행 조건에 사용합니다.",
      },
      {
        title: "client 설정 공급",
        body: "실행 서비스가 provider client를 만들 수 있도록 base URL과 model 값을 제공합니다.",
      },
      {
        title: "UI 반영",
        body: "Browse, Response, Benchmark 화면의 모델 카드와 선택 목록에 같은 데이터를 사용합니다.",
      },
    ],
    result: "모델 정보가 한곳에서 관리되어 endpoint 변경과 capability 검증이 일관되게 동작합니다.",
  },
  "agent-profile-service": {
    scenario: "사용자가 Tool Agent profile을 골랐는데 선택 모델이 tool calling을 지원하는지 확인하는 경우",
    input: "입력: profile_id + model_id + library/app 선택값",
    steps: [
      {
        title: "profile 조회",
        body: "strategy_kind, framework, system_prompt, tool_names, generation_defaults를 읽습니다.",
      },
      {
        title: "UI 필터링",
        body: "선택된 library와 app strategy에 맞는 enabled profile만 목록에 보여줍니다.",
      },
      {
        title: "모델 검증",
        body: "tool_names가 있거나 tool strategy이면 모델 capability.tool_calling을 확인합니다.",
      },
      {
        title: "실행 허용",
        body: "조건을 만족하면 BenchmarkRunner 또는 ProfileResponseService로 profile을 넘깁니다.",
      },
      {
        title: "실패 차단",
        body: "지원하지 않는 조합은 실행 전에 막아 provider 오류나 잘못된 결과를 줄입니다.",
      },
    ],
    result: "사용자가 고른 전략이 실제 모델 능력과 맞는지 실행 전에 검증됩니다.",
  },
  "profile-response-service": {
    scenario: "Response 화면에서 context를 넣고 선택 profile로 실시간 답변을 받는 경우",
    input: "입력: 대화 이력 + selected model/profile + grounding mode + context",
    steps: [
      {
        title: "선택값 해석",
        body: "model_id와 profile_id를 resolve하고 현재 세션의 대화 이력을 읽습니다.",
      },
      {
        title: "grounding 결정",
        body: "grounding_mode와 metadata.source에 따라 context 주입 또는 override 여부를 판단합니다.",
      },
      {
        title: "runner 입력 생성",
        body: "대화 메시지, context_documents, profile 설정을 runner가 실행할 case 형태로 만듭니다.",
      },
      {
        title: "응답 방식 선택",
        body: "custom direct profile이면 SSE streaming을 사용하고, 아니면 일반 JSON 응답으로 fallback합니다.",
      },
      {
        title: "UI 업데이트",
        body: "stream delta 또는 최종 JSON 결과를 Response thread에 assistant 메시지로 반영합니다.",
      },
    ],
    result: "벤치마크가 아닌 실제 대화 화면에서도 선택한 모델과 profile 흐름이 그대로 적용됩니다.",
  },
  "benchmark-service": {
    scenario: "두 개 모델과 세 개 profile을 같은 질문으로 비교 실행하는 경우",
    input: "입력: suite + case + selected models + selected profiles",
    steps: [
      {
        title: "suite 생성",
        body: "하나의 비교 실험 묶음과 그 안의 prompt/context/expected case를 만듭니다.",
      },
      {
        title: "run 구성",
        body: "모델과 profile 조합마다 run을 만들고 실행 대상 case를 연결합니다.",
      },
      {
        title: "runner 호출",
        body: "각 조합에 맞는 BenchmarkRunner를 찾아 case를 실행합니다.",
      },
      {
        title: "result 저장",
        body: "출력, latency, score, trace, provider 오류를 case별 result로 저장합니다.",
      },
      {
        title: "history 집계",
        body: "Results 화면이 읽을 수 있도록 run summary와 비교 snapshot을 구성합니다.",
      },
    ],
    result: "같은 조건에서 모델/profile 조합별 품질, 속도, 실패 원인을 다시 볼 수 있는 기록이 남습니다.",
  },
  "benchmark-runner": {
    scenario: "같은 질문을 Custom Runtime과 LangChain Runtime에서 각각 실행해 차이를 보는 경우",
    input: "입력: runner context + profile.framework + benchmark case",
    steps: [
      {
        title: "runner 선택",
        body: "BenchmarkRunnerRegistry가 profile.framework 값을 보고 custom/langchain/langgraph/llamaindex 중 하나를 고릅니다.",
      },
      {
        title: "요청 구성",
        body: "선택된 runner가 자기 방식으로 messages, context, tools, generation params를 조립합니다.",
      },
      {
        title: "runtime 실행",
        body: "framework별 client나 graph를 통해 실제 모델 호출 또는 tool loop를 수행합니다.",
      },
      {
        title: "trace 기록",
        body: "request.built, assistant.message, tool.completed 같은 단계 이벤트를 남깁니다.",
      },
      {
        title: "공통 결과 반환",
        body: "서로 다른 raw output을 output_text, usage, latency, trace가 있는 결과 객체로 통일합니다.",
      },
    ],
    result: "프레임워크가 달라도 BenchmarkService와 UI는 같은 결과 구조로 비교할 수 있습니다.",
  },
};

const EXPLAIN_DATA_FLOW_DETAILS = {
  "direct-chat": {
    receives: [
      "model_id: 사용자가 선택한 모델 id",
      "profile_id: direct-chat",
      "messages: 현재 user 질문 또는 대화 이력",
      "generation params: temperature, max_tokens 같은 생성 옵션",
    ],
    transforms: [
      "AgentProfileService가 profile의 system_prompt를 가져옵니다.",
      "ModelRegistryService가 served_model_name과 base_url을 제공합니다.",
      "CustomBenchmarkRunner가 system/user 메시지를 provider payload로 바꿉니다.",
      "provider 응답을 output_text, usage, latency, trace로 정규화합니다.",
    ],
    returns: [
      "Response 화면: assistant message",
      "Benchmark 결과: case result",
      "Results 화면: output, latency, request preview",
    ],
    beforeLabel: "UI에서 들어오는 값",
    before: `{
  "model_id": "qwen-local",
  "profile_id": "direct-chat",
  "messages": [
    { "role": "user", "content": "이 제품 설명을 세 문장으로 요약해줘" }
  ],
  "temperature": 0.7
}`,
    afterLabel: "모델 호출 후 공통 결과",
    after: `{
  "provider_request": {
    "model": "qwen3:8b",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant..." },
      { "role": "user", "content": "이 제품 설명을 세 문장으로 요약해줘" }
    ],
    "temperature": 0.7
  },
  "result": {
    "output_text": "제품의 핵심 기능은 ...",
    "latency_ms": 842,
    "trace": ["request.built", "assistant.message"]
  }
}`,
  },
  "rag-context": {
    receives: [
      "question: 사용자의 질문",
      "context_documents: 사용자가 붙인 문서/메모 조각",
      "profile_id: rag-context",
      "expected 또는 keywords: 벤치마크 검증 기준",
    ],
    transforms: [
      "Context 입력을 빈 줄과 불필요한 공백 기준으로 정리합니다.",
      "정리된 context_documents를 Grounded context system 섹션으로 합칩니다.",
      "질문은 user message로 유지하고 근거는 system message에 넣습니다.",
      "결과에는 어떤 문맥이 들어갔는지 request preview를 남깁니다.",
    ],
    returns: [
      "근거 기반 assistant answer",
      "context가 포함된 request preview",
      "pass/fail score에 사용할 output_text",
    ],
    beforeLabel: "질문과 문맥",
    before: `{
  "prompt": "환불 가능 기간이 어떻게 돼?",
  "context_documents": [
    "환불은 결제일로부터 7일 이내 가능하다.",
    "사용 이력이 있으면 환불 검토가 필요하다."
  ],
  "profile_id": "rag-context"
}`,
    afterLabel: "Grounded prompt로 바뀐 요청",
    after: `{
  "messages": [
    {
      "role": "system",
      "content": "Answer using only the grounded context.\\n\\nGrounded context:\\n1. 환불은 결제일로부터 7일 이내 가능하다.\\n2. 사용 이력이 있으면 환불 검토가 필요하다."
    },
    { "role": "user", "content": "환불 가능 기간이 어떻게 돼?" }
  ],
  "result": {
    "output_text": "결제일로부터 7일 이내 환불 가능합니다. 사용 이력이 있으면 검토가 필요합니다.",
    "trace": ["request.built", "assistant.message"]
  }
}`,
  },
  "tool-agent": {
    receives: [
      "user prompt: 도구가 필요할 수 있는 질문",
      "tool_names: profile이 허용한 도구 목록",
      "tools schema: 도구 이름, 설명, JSON arguments 구조",
      "max_steps: 도구 loop 제한",
    ],
    transforms: [
      "첫 모델 요청에 tools와 tool_choice:auto를 붙입니다.",
      "모델이 tool_calls를 반환하면 arguments JSON을 파싱하고 검증합니다.",
      "ToolRegistry가 허용된 도구만 실행하고 결과를 role:tool 메시지로 추가합니다.",
      "tool 결과가 들어간 대화를 다시 모델에 보내 최종 답변을 받습니다.",
    ],
    returns: [
      "final assistant answer",
      "tool input/output trace",
      "실패 시 ToolExecutionError 또는 provider error result",
    ],
    beforeLabel: "도구 실행 전 요청",
    before: `{
  "profile_id": "tool-agent",
  "messages": [
    { "role": "user", "content": "서울 현재 시간 기준으로 마감까지 몇 시간 남았어?" }
  ],
  "tools": ["get_current_time"],
  "max_steps": 4
}`,
    afterLabel: "도구 호출과 최종 답변",
    after: `{
  "step_1_model_output": {
    "tool_calls": [
      {
        "name": "get_current_time",
        "arguments": { "timezone": "Asia/Seoul" }
      }
    ]
  },
  "tool_message": {
    "role": "tool",
    "content": "{ \\"now\\": \\"2026-04-22T15:00:00+09:00\\" }"
  },
  "final_result": {
    "output_text": "현재 서울 시간은 15:00입니다. 마감이 18:00이면 3시간 남았습니다.",
    "trace": ["request.built", "tool.completed", "assistant.message"]
  }
}`,
  },
  "custom-runtime": {
    receives: [
      "Runner context: model, profile, case, params",
      "strategy_kind: direct, rag, tool 중 하나",
      "model default_params와 profile generation_defaults",
      "provider client 설정",
    ],
    transforms: [
      "model 기본값, profile 기본값, 실행 params를 병합합니다.",
      "strategy_kind에 맞춰 direct/rag/tool payload를 직접 조립합니다.",
      "OpenAI-compatible provider 호출 결과를 공통 result 객체로 변환합니다.",
      "provider 오류는 ProviderRequestError 같은 내부 오류 형식으로 감쌉니다.",
    ],
    returns: [
      "BenchmarkRunnerResult",
      "output_text, raw_output, usage",
      "request preview와 실행 trace",
    ],
    beforeLabel: "runner에 들어온 context",
    before: `{
  "framework": "custom",
  "strategy_kind": "rag",
  "model": { "served_model_name": "gemma-4" },
  "case": {
    "input_messages": [{ "role": "user", "content": "정책 요약" }],
    "metadata": { "context_documents": ["정책 문서 조각"] }
  },
  "params": { "temperature": 0.3 }
}`,
    afterLabel: "공통 runner 결과",
    after: `{
  "output_text": "정책의 핵심은 ...",
  "raw_output": { "provider": "openai-compatible", "finish_reason": "stop" },
  "usage": { "prompt_tokens": 312, "completion_tokens": 96 },
  "trace": [
    { "event": "request.built", "framework": "custom" },
    { "event": "assistant.message" }
  ]
}`,
  },
  "langchain-runtime": {
    receives: [
      "callLLM message list",
      "model connection data: base_url, api_key, served_model_name",
      "profile framework: langchain",
      "optional tools for tool profile",
    ],
    transforms: [
      "plain message objects를 LangChain message 객체로 바꿉니다.",
      "ChatOpenAI client를 OpenAI-compatible endpoint에 연결합니다.",
      "tool profile이면 bind_tools 또는 유사 흐름으로 tool schema를 연결합니다.",
      "AIMessage와 response_metadata를 callLLM raw_output으로 보존합니다.",
    ],
    returns: [
      "BenchmarkRunnerResult",
      "LangChain raw message metadata",
      "custom runtime과 비교 가능한 output_text",
    ],
    beforeLabel: "callLLM 메시지",
    before: `{
  "framework": "langchain",
  "messages": [
    { "role": "system", "content": "Use concise answers." },
    { "role": "user", "content": "요약해줘" }
  ],
  "model_config": {
    "base_url": "http://127.0.0.1:11434/v1",
    "model": "qwen3:8b"
  }
}`,
    afterLabel: "LangChain 실행 결과",
    after: `{
  "langchain_input": [
    "SystemMessage(content='Use concise answers.')",
    "HumanMessage(content='요약해줘')"
  ],
  "raw_output": {
    "type": "AIMessage",
    "content": "핵심은 ...",
    "response_metadata": { "finish_reason": "stop" }
  },
  "output_text": "핵심은 ..."
}`,
  },
  "langgraph-runtime": {
    receives: [
      "initial state: messages, context, steps",
      "graph nodes: model, tool, answer 같은 단계",
      "conditional edges: 다음 노드 선택 규칙",
      "stop condition 또는 max_steps",
    ],
    transforms: [
      "사용자 요청을 graph state에 넣고 첫 노드로 전달합니다.",
      "각 노드가 state를 읽고 messages/tool_results/decision 값을 갱신합니다.",
      "조건 엣지가 state를 보고 tool node 또는 answer node로 분기합니다.",
      "마지막 state에서 final answer를 추출해 공통 result로 변환합니다.",
    ],
    returns: [
      "최종 graph state",
      "node 단위 trace",
      "BenchmarkRunnerResult",
    ],
    beforeLabel: "초기 graph state",
    before: `{
  "state": {
    "messages": [
      { "role": "user", "content": "필요하면 도구를 써서 답해줘" }
    ],
    "tool_results": [],
    "steps": 0
  },
  "entry_node": "planner"
}`,
    afterLabel: "노드를 지난 뒤 state",
    after: `{
  "state_after": {
    "messages": [
      { "role": "user", "content": "필요하면 도구를 써서 답해줘" },
      { "role": "assistant", "content": "도구 결과를 보면 ..." }
    ],
    "tool_results": [{ "name": "lookup", "content": "검색 결과" }],
    "steps": 3,
    "final": true
  },
  "trace": ["planner", "tool", "answer"]
}`,
  },
  "llamaindex-runtime": {
    receives: [
      "question: 사용자 질문",
      "context documents 또는 향후 index query 결과",
      "LlamaIndex OpenAILike 설정",
      "profile generation defaults",
    ],
    transforms: [
      "문서 조각을 LlamaIndex runner가 사용할 prompt context로 정리합니다.",
      "OpenAILike client가 OpenAI-compatible endpoint로 completion을 요청합니다.",
      "completion response를 callLLM output_text/raw_output 형식으로 맞춥니다.",
      "향후 index/retriever가 붙으면 context_documents 자리에 검색 결과 node가 들어갑니다.",
    ],
    returns: [
      "문서 기반 answer text",
      "LlamaIndex raw completion metadata",
      "request preview와 trace",
    ],
    beforeLabel: "문서 기반 질문",
    before: `{
  "framework": "llamaindex",
  "question": "설치 요구사항은?",
  "context_documents": [
    "Node 20 이상이 필요하다.",
    "환경 변수 API_BASE_URL을 설정한다."
  ]
}`,
    afterLabel: "LlamaIndex prompt와 응답",
    after: `{
  "prompt": "Context:\\n- Node 20 이상이 필요하다.\\n- 환경 변수 API_BASE_URL을 설정한다.\\n\\nQuestion: 설치 요구사항은?",
  "completion": "Node 20 이상과 API_BASE_URL 환경 변수 설정이 필요합니다.",
  "output_text": "Node 20 이상과 API_BASE_URL 환경 변수 설정이 필요합니다."
}`,
  },
  "model-registry-service": {
    receives: [
      "모델 등록 요청: name, provider, base_url",
      "served_model_name: provider에 실제 전달할 모델명",
      "capabilities: chat/tool 지원 여부",
      "health probe 요청",
    ],
    transforms: [
      "UI 표시용 name과 provider 호출용 served_model_name을 분리해 저장합니다.",
      "api_key 같은 민감값은 외부 응답 dump에서 제외합니다.",
      "probe_model이 upstream /v1/models 응답과 registry record를 비교합니다.",
      "실행 서비스가 쓸 수 있게 provider client config를 구성합니다.",
    ],
    returns: [
      "모델 카드 목록",
      "capability 기반 실행 가능 여부",
      "provider client 설정",
      "probe health 상태",
    ],
    beforeLabel: "모델 등록 입력",
    before: `{
  "id": "qwen-local",
  "name": "Qwen Local",
  "provider": "ollama",
  "base_url": "http://127.0.0.1:11434/v1",
  "served_model_name": "qwen3:8b",
  "capabilities": {
    "chat_completions": true,
    "tool_calling": false
  }
}`,
    afterLabel: "서비스가 제공하는 모델 정보",
    after: `{
  "model_card": {
    "id": "qwen-local",
    "name": "Qwen Local",
    "health": "healthy",
    "can_run_chat": true,
    "can_run_tool_agent": false
  },
  "client_config": {
    "base_url": "http://127.0.0.1:11434/v1",
    "model": "qwen3:8b"
  }
}`,
  },
  "agent-profile-service": {
    receives: [
      "profile definition: strategy_kind, framework, system_prompt",
      "tool_names: profile이 요구하는 도구",
      "model capabilities",
      "library/app filter metadata",
    ],
    transforms: [
      "UI에서 선택 가능한 profile 목록을 enabled, library, app 조건으로 필터링합니다.",
      "tool_names 또는 tool strategy가 있으면 tool_calling capability를 요구합니다.",
      "profile.framework 값으로 runner 선택 키를 제공합니다.",
      "profile.system_prompt와 generation_defaults를 실행 preset으로 묶습니다.",
    ],
    returns: [
      "실행 가능한 profile 목록",
      "선택 profile의 runner 조건",
      "모델/profile 조합 검증 결과",
    ],
    beforeLabel: "profile과 모델 capability",
    before: `{
  "profile": {
    "id": "tool-agent",
    "strategy_kind": "tool",
    "framework": "custom",
    "tool_names": ["get_current_time"]
  },
  "model_capabilities": {
    "chat_completions": true,
    "tool_calling": false
  }
}`,
    afterLabel: "검증 결과",
    after: `{
  "visible_in_ui": true,
  "runnable": false,
  "reason": "tool-agent profile requires tool_calling support",
  "runner_key": "custom"
}`,
  },
  "profile-response-service": {
    receives: [
      "session messages: 현재 대화 이력",
      "selected model_id/profile_id",
      "grounding_mode: raw, auto, grounded",
      "context_documents와 response metadata",
    ],
    transforms: [
      "model과 profile을 resolve하고 실행 가능 여부를 확인합니다.",
      "grounding_mode에 따라 context를 넣거나 override를 건너뜁니다.",
      "stream 가능한 custom direct 요청은 SSE 이벤트로 쪼갭니다.",
      "stream이 맞지 않는 profile은 일반 JSON 응답으로 fallback합니다.",
    ],
    returns: [
      "message.delta stream events",
      "run.completed event",
      "또는 final JSON response",
      "Response thread에 붙일 assistant message",
    ],
    beforeLabel: "Response 화면 요청",
    before: `{
  "model_id": "gemma-local",
  "profile_id": "rag-context",
  "grounding_mode": "grounded",
  "messages": [
    { "role": "user", "content": "이 문서 기준으로 답해줘" }
  ],
  "context_documents": ["문서 조각 A", "문서 조각 B"]
}`,
    afterLabel: "화면으로 나가는 응답",
    after: `{
  "events_or_json": [
    { "event": "run.started" },
    { "event": "message.delta", "delta": "문서 기준으로는" },
    { "event": "message.delta", "delta": " ..." },
    { "event": "run.completed" }
  ],
  "thread_message": {
    "role": "assistant",
    "content": "문서 기준으로는 ..."
  }
}`,
  },
  "benchmark-service": {
    receives: [
      "suite request: 비교 실험 이름",
      "case input: prompt, context, expected",
      "selected model ids",
      "selected profile ids",
    ],
    transforms: [
      "suite와 case를 저장 가능한 도메인 객체로 만듭니다.",
      "model/profile 조합마다 run을 생성합니다.",
      "각 run에서 BenchmarkRunner를 호출하고 case result를 저장합니다.",
      "expected check 또는 keyword check로 간단한 score를 계산합니다.",
      "history snapshot으로 Results 화면 데이터를 구성합니다.",
    ],
    returns: [
      "benchmark run summary",
      "case results",
      "latency/pass rate/history",
      "비교 테이블에 필요한 snapshot",
    ],
    beforeLabel: "비교 실행 입력",
    before: `{
  "suite": "Refund policy comparison",
  "case": {
    "prompt": "환불 기간은?",
    "context_documents": ["환불은 7일 이내 가능"],
    "expected": "7일"
  },
  "models": ["qwen-local", "gemma-local"],
  "profiles": ["direct-chat", "rag-context"]
}`,
    afterLabel: "Results가 읽는 history",
    after: `{
  "runs": [
    {
      "model_id": "qwen-local",
      "profile_id": "rag-context",
      "status": "completed",
      "summary": { "pass_rate": 1, "avg_latency_ms": 920 }
    }
  ],
  "results": [
    {
      "output_text": "환불은 7일 이내 가능합니다.",
      "score": 1,
      "trace_preview": ["request.built", "assistant.message"]
    }
  ]
}`,
  },
  "benchmark-runner": {
    receives: [
      "BenchmarkRunnerContext",
      "profile.framework: custom/langchain/langgraph/llamaindex",
      "case input messages와 metadata",
      "model provider client 설정",
    ],
    transforms: [
      "framework 값으로 실제 runner를 선택합니다.",
      "runner별 방식으로 messages, context, tools를 조립합니다.",
      "provider 또는 framework client를 호출합니다.",
      "runner마다 다른 raw output을 공통 result 구조로 맞춥니다.",
    ],
    returns: [
      "BenchmarkRunnerResult",
      "output_text와 raw_output",
      "usage, latency, trace",
      "실패 시 runner error result",
    ],
    beforeLabel: "runner 선택 전",
    before: `{
  "context": {
    "profile": { "framework": "langchain", "strategy_kind": "direct" },
    "case": { "input_messages": [{ "role": "user", "content": "비교해줘" }] },
    "model": { "served_model_name": "qwen3:8b" }
  }
}`,
    afterLabel: "runner 실행 후",
    after: `{
  "selected_runner": "LangChainBenchmarkRunner",
  "result": {
    "output_text": "비교 결과는 ...",
    "raw_output": { "framework": "langchain", "message_type": "AIMessage" },
    "usage": { "prompt_tokens": 128, "completion_tokens": 64 },
    "trace": ["request.built", "assistant.message"]
  }
}`,
  },
};

const SELECTION_MODES = {
  auto: "auto",
  manual: "manual",
};

function normalizeTheme(value) {
  if (value === "dark") {
    return "yellow";
  }
  return THEMES.includes(value) ? value : "blue";
}

function normalizeSelectionMode(value) {
  return value === SELECTION_MODES.manual ? SELECTION_MODES.manual : SELECTION_MODES.auto;
}

const LIBRARIES = [
  {
    id: "custom-runtime",
    name: "Custom Runtime",
    frameworks: ["custom"],
    tags: ["direct", "rag", "tool"],
  },
  {
    id: "opencode-runtime",
    name: "OpenCode",
    frameworks: ["custom"],
    tags: ["plan", "build", "agent"],
  },
  {
    id: "langchain-runtime",
    name: "LangChain",
    frameworks: ["langchain"],
    tags: ["direct", "tool"],
  },
  {
    id: "langgraph-runtime",
    name: "LangGraph",
    frameworks: ["langgraph"],
    tags: ["tool"],
  },
  {
    id: "llamaindex-runtime",
    name: "LlamaIndex",
    frameworks: ["llamaindex"],
    tags: ["direct", "rag"],
  },
];

const LEGACY_LIBRARY_LABELS = {
  "vllm-runtime": "Custom Runtime",
  "langchain-adapters": "LangChain",
  "langgraph-control": "LangGraph",
  "retrieval-pack": "RAG Pack",
};

const APP_TEMPLATES = [
  {
    id: "compare-studio",
    name: "Benchmark Studio",
    profileId: "direct-chat",
    badge: "Baseline",
    description: "Neutral single-lane compare flow for quick baseline checks.",
    supportedStrategies: ["direct"],
    nodes: [
      { id: "prompt", kind: "prompt", title: "Prompt", body: "Single shared user prompt for the active model.", x: 48, y: 224 },
      { id: "router", kind: "router", title: "Model Router", body: "Route the case into the chosen model card in the catalog.", x: 318, y: 224 },
      { id: "llm", kind: "llm", title: "LLM Runtime", body: "Benchmark the payload against the selected runtime.", x: 588, y: 224 },
      { id: "judge", kind: "evaluator", title: "Evaluator", body: "Aggregate latency, pass rate, and output snapshots.", x: 858, y: 224 },
    ],
    edges: [
      { from: "prompt", to: "router" },
      { from: "router", to: "llm" },
      { from: "llm", to: "judge" },
    ],
  },
  {
    id: "qwen-reasoning-desk",
    name: "Qwen Reasoning Desk",
    profileId: "opencode-plan",
    preferredLibraryId: "opencode-runtime",
    badge: "Qwen fit",
    description: "Planner-first answer lane tuned for Qwen-style decomposition before the final response.",
    supportedStrategies: ["direct"],
    modelFamilies: ["qwen"],
    autoRecommend: true,
    nodes: [
      { id: "prompt", kind: "prompt", title: "Prompt", body: "User request plus the output target for the final answer.", x: 44, y: 224 },
      { id: "planner", kind: "planner", title: "Reasoning Frame", body: "Break the request into a compact internal plan before response generation.", x: 352, y: 224 },
      { id: "llm", kind: "llm", title: "Qwen Final Answer", body: "Generate the final user-facing answer from the reasoning frame.", x: 660, y: 224 },
    ],
    edges: [
      { from: "prompt", to: "planner" },
      { from: "planner", to: "llm" },
    ],
  },
  {
    id: "rag-lab",
    name: "RAG Lab",
    profileId: "rag-context",
    badge: "Grounded",
    description: "Context-first retrieval lane for grounded comparison runs.",
    supportedStrategies: ["rag"],
    nodes: [
      { id: "prompt", kind: "prompt", title: "Prompt", body: "Question and evaluation target.", x: 48, y: 184 },
      { id: "docs", kind: "context", title: "Context Notes", body: "Short chunks pasted from docs or product knowledge.", x: 298, y: 72 },
      { id: "retriever", kind: "retriever", title: "Retriever", body: "Attach the selected context to the case metadata.", x: 328, y: 292 },
      { id: "llm", kind: "llm", title: "RAG Run", body: "Use the rag-context profile for the selected models.", x: 612, y: 224 },
      { id: "judge", kind: "evaluator", title: "Grounded Score", body: "Check if expected phrases appear in the result.", x: 884, y: 224 },
    ],
    edges: [
      { from: "docs", to: "retriever" },
      { from: "prompt", to: "retriever" },
      { from: "retriever", to: "llm" },
      { from: "llm", to: "judge" },
    ],
  },
  {
    id: "gemma-grounded-lane",
    name: "Gemma Grounded Lane",
    profileId: "rag-context",
    preferredLibraryId: "custom-runtime",
    badge: "Gemma fit",
    description: "Grounded answer lane that filters context first and keeps Gemma on a tight evidence path.",
    supportedStrategies: ["rag"],
    modelFamilies: ["gemma"],
    autoRecommend: true,
    nodes: [
      { id: "prompt", kind: "prompt", title: "Prompt", body: "Question plus the exact answer shape you want Gemma to produce.", x: 44, y: 184 },
      { id: "docs", kind: "context", title: "Grounding Notes", body: "Short evidence snippets, specs, or product facts to anchor the response.", x: 324, y: 72 },
      { id: "retriever", kind: "retriever", title: "Context Filter", body: "Keep only the evidence that should survive into the final response.", x: 352, y: 292 },
      { id: "llm", kind: "llm", title: "Gemma Final Answer", body: "Compose the final grounded answer from the filtered notes.", x: 660, y: 224 },
    ],
    edges: [
      { from: "docs", to: "retriever" },
      { from: "prompt", to: "retriever" },
      { from: "retriever", to: "llm" },
    ],
  },
  {
    id: "gemma-quick-lane",
    name: "Gemma Quick Lane",
    profileId: "direct-chat",
    preferredLibraryId: "custom-runtime",
    badge: "Gemma fast",
    description: "Compressed direct answer lane for short prompts and lower-latency responses.",
    supportedStrategies: ["direct"],
    modelFamilies: ["gemma"],
    nodes: [
      { id: "prompt", kind: "prompt", title: "Prompt", body: "Short user request with a clear target answer shape.", x: 88, y: 224 },
      { id: "llm", kind: "llm", title: "Gemma Quick Answer", body: "Return the final answer directly without retrieval or planning stages.", x: 452, y: 224 },
    ],
    edges: [
      { from: "prompt", to: "llm" },
    ],
  },
  {
    id: "tool-orchestrator",
    name: "Tool Agent",
    profileId: "tool-agent",
    badge: "Agent",
    description: "Planner-plus-tools lane for models that can call functions before answering.",
    supportedStrategies: ["tool"],
    nodes: [
      { id: "prompt", kind: "prompt", title: "Prompt", body: "Instruction that can trigger tools before final output.", x: 44, y: 220 },
      { id: "planner", kind: "planner", title: "Planner", body: "Decide whether to answer directly or call a tool.", x: 314, y: 220 },
      { id: "tool", kind: "tool", title: "Tool Executor", body: "Execute a selected tool before the final response.", x: 584, y: 96 },
      { id: "llm", kind: "llm", title: "Final Response", body: "Return the composed answer after tool execution.", x: 614, y: 340 },
      { id: "judge", kind: "evaluator", title: "Trace Review", body: "Show tool trace and final response side by side.", x: 892, y: 220 },
    ],
    edges: [
      { from: "prompt", to: "planner" },
      { from: "planner", to: "tool" },
      { from: "planner", to: "llm" },
      { from: "tool", to: "llm" },
      { from: "llm", to: "judge" },
    ],
  },
];

const NODE_PALETTE = [
  { kind: "prompt", title: "Prompt", body: "User instruction and success criteria." },
  { kind: "context", title: "Context", body: "Reference notes or retrieved chunks." },
  { kind: "retriever", title: "Retriever", body: "Turn context into a grounded input step." },
  { kind: "router", title: "Router", body: "Route one case into the active model runtime." },
  { kind: "planner", title: "Planner", body: "Choose tools or agent branches." },
  { kind: "tool", title: "Tool", body: "Builtin function or external capability." },
  { kind: "llm", title: "LLM", body: "Inference call to the selected runtime." },
  { kind: "evaluator", title: "Evaluator", body: "Score latency, pass rate, or output quality." },
];

const WORKFLOW_CONNECTIONS = {
  __start__: ["prompt", "context"],
  prompt: ["context", "router", "retriever", "planner", "llm"],
  context: ["retriever", "router", "llm"],
  retriever: ["llm"],
  router: ["llm", "evaluator"],
  planner: ["tool", "llm", "router"],
  tool: ["llm", "evaluator"],
  llm: ["evaluator", "__end__"],
  evaluator: ["__end__"],
};

const SLOT_DIMENSIONS = {
  width: 118,
  height: 40,
};

const WORKFLOW_LAYOUT = {
  nodeWidth: 196,
  nodeHeight: 92,
  startX: 36,
  startY: 92,
  columnGap: 286,
  rowGap: 138,
};

const NODE_KIND_ORDER = {
  prompt: 0,
  context: 1,
  retriever: 2,
  planner: 3,
  router: 4,
  tool: 5,
  llm: 6,
  evaluator: 7,
};

const elements = {
  pageShell: document.querySelector(".page-shell"),
  studioLayout: document.querySelector("#workspace"),
  statusText: document.querySelector("#status-text"),
  workspaceText: document.querySelector("#workspace-text"),
  modelCountText: document.querySelector("#model-count-text"),
  activeAppTitle: document.querySelector("#active-app-title"),
  activeAppDescription: document.querySelector("#active-app-description"),
  activeProfileTitle: document.querySelector("#active-profile-title"),
  activeProfileDescription: document.querySelector("#active-profile-description"),
  baseUrlText: document.querySelector("#base-url-text"),
  refreshButton: document.querySelector("#refresh-button"),
  runButton: document.querySelector("#run-button"),
  caseModeButton: document.querySelector("#case-mode-button"),
  openResponseButton: document.querySelector("#open-response-button"),
  modelsGrid: document.querySelector("#models-grid"),
  librariesGrid: document.querySelector("#libraries-grid"),
  appsGrid: document.querySelector("#apps-grid"),
  paletteList: document.querySelector("#palette-list"),
  canvasSurface: document.querySelector("#canvas-surface"),
  canvasLinks: document.querySelector("#canvas-links"),
  canvasInsertions: document.querySelector("#canvas-insertions"),
  canvasNodes: document.querySelector("#canvas-nodes"),
  autoLayoutButton: document.querySelector("#auto-layout-button"),
  resetWorkflowButton: document.querySelector("#reset-workflow-button"),
  selectedModels: document.querySelector("#selected-models"),
  selectionMeta: document.querySelector("#selection-meta"),
  profileList: document.querySelector("#profile-list"),
  promptInput: document.querySelector("#prompt-input"),
  contextInput: document.querySelector("#context-input"),
  expectedInput: document.querySelector("#expected-input"),
  temperatureInput: document.querySelector("#temperature-input"),
  workflowCaseBrief: document.querySelector("#workflow-case-brief"),
  runSummary: document.querySelector("#run-summary"),
  historyDetail: document.querySelector("#history-detail"),
  resultsFeed: document.querySelector("#results-feed"),
  responseProfileList: document.querySelector("#response-profile-list"),
  responseModelList: document.querySelector("#response-model-list"),
  responseConversationList: document.querySelector("#response-conversation-list"),
  responseModeList: document.querySelector("#response-mode-list"),
  responseSummaryGrid: document.querySelector("#response-summary-grid"),
  responseThread: document.querySelector("#response-thread"),
  responseInput: document.querySelector("#response-input"),
  responseSendButton: document.querySelector("#response-send-button"),
  responseClearButton: document.querySelector("#response-clear-button"),
  explainCategoryList: document.querySelector("#explain-category-list"),
  explainComponentList: document.querySelector("#explain-component-list"),
  explainDetail: document.querySelector("#explain-detail"),
  explainDetailKicker: document.querySelector("#explain-detail-kicker"),
  explainDetailTitle: document.querySelector("#explain-detail-title"),
  explainDetailBadges: document.querySelector("#explain-detail-badges"),
};

const state = {
  connection: {
    ready: false,
    baseUrl: "",
  },
  registryModels: [],
  agentProfiles: [],
  selectedModelIds: new Set(readStoredArray(STORAGE_KEYS.selectedModels).slice(-1)),
  selectedLibraryId: localStorage.getItem(STORAGE_KEYS.selectedLibrary) || LIBRARIES[0].id,
  selectedLibraryMode: normalizeSelectionMode(localStorage.getItem(STORAGE_KEYS.selectedLibraryMode)),
  selectedAppId: localStorage.getItem(STORAGE_KEYS.selectedApp) || APP_TEMPLATES[0].id,
  selectedAppMode: normalizeSelectionMode(localStorage.getItem(STORAGE_KEYS.selectedAppMode)),
  selectedProfileIds: new Set(
    uniqueValues([
      ...readStoredArray(STORAGE_KEYS.selectedProfiles),
      localStorage.getItem(STORAGE_KEYS.selectedProfile) || "",
    ])
  ),
  workflow: {
    nodes: [],
    edges: [],
  },
  pendingNodeKind: "",
  insertionSlots: [],
  selectedNodeId: "",
  runHistory: [],
  selectedHistoryId: "",
  selectedRunId: "",
  activeRun: false,
  activeView: CURRENT_PAGE,
  caseMode: localStorage.getItem(STORAGE_KEYS.caseMode) === "advanced" ? "advanced" : "basic",
  historySelectionNotice: "",
  responseDraft: localStorage.getItem(STORAGE_KEYS.responseDraft) || "",
  responseSessions: readStoredResponseSessions(),
  currentResponseSessionId: localStorage.getItem(STORAGE_KEYS.responseCurrentSession) || "",
  responseMessages: [],
  selectedResponseModelId: localStorage.getItem(STORAGE_KEYS.responseModel) || "",
  selectedResponseProfileId: localStorage.getItem(STORAGE_KEYS.responseProfile) || "",
  responseGroundingMode: normalizeResponseGroundingMode(localStorage.getItem(STORAGE_KEYS.responseGroundingMode) || ""),
  activeResponse: false,
  selectedExplainCategory: localStorage.getItem(STORAGE_KEYS.explainCategory) || EXPLAIN_CATEGORIES[0].id,
  selectedExplainId: localStorage.getItem(STORAGE_KEYS.explainComponent) || EXPLAIN_ITEMS[0].id,
  theme: normalizeTheme(localStorage.getItem(STORAGE_KEYS.theme)),
};

let pointerDrag = null;

function readStoredArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getPromptDraft() {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.promptDraft) || "";
  } catch {
    return "";
  }
}

function setPromptDraft(value) {
  try {
    sessionStorage.setItem(STORAGE_KEYS.promptDraft, String(value || ""));
  } catch {
    // Ignore storage write failures in restricted environments.
  }
}

function clearPromptDraft() {
  try {
    sessionStorage.removeItem(STORAGE_KEYS.promptDraft);
  } catch {
    // Ignore storage write failures in restricted environments.
  }
}

function isReloadNavigation() {
  try {
    const navigationEntries = performance.getEntriesByType("navigation");
    const navigationEntry = Array.isArray(navigationEntries) ? navigationEntries[0] : navigationEntries?.[0];
    return navigationEntry?.type === "reload";
  } catch {
    return false;
  }
}

function normalizeStoredResponseMessage(item) {
  if (!item || typeof item.role !== "string") {
    return null;
  }
  return {
    role: item.role,
    content: String(item.content || ""),
    createdAt: item.createdAt || new Date().toISOString(),
    state: item.state || "done",
    modelName: item.modelName || "",
    profileName: item.profileName || "",
  };
}

function normalizeResponseGroundingMode(value) {
  return RESPONSE_GROUNDING_MODES.some((mode) => mode.id === value) ? value : "auto";
}

function normalizeStoredResponseSession(item) {
  if (!item || typeof item.id !== "string") {
    return null;
  }
  const messages = Array.isArray(item.messages)
    ? item.messages.map(normalizeStoredResponseMessage).filter(Boolean)
    : [];
  return {
    id: item.id,
    title: String(item.title || "New chat"),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    modelId: String(item.modelId || ""),
    profileId: String(item.profileId || ""),
    groundingMode: normalizeResponseGroundingMode(item.groundingMode || ""),
    messages,
  };
}

function readStoredResponseSessions() {
  const storedSessions = readStoredArray(STORAGE_KEYS.responseSessions)
    .map(normalizeStoredResponseSession)
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  if (storedSessions.length > 0) {
    return storedSessions;
  }

  const legacyMessages = readStoredArray(STORAGE_KEYS.responseMessages)
    .map(normalizeStoredResponseMessage)
    .filter(Boolean);
  if (legacyMessages.length === 0) {
    return [];
  }
  return [
    {
      id: `chat-${Date.now()}`,
      title: buildResponseSessionTitle(legacyMessages),
      createdAt: legacyMessages[0]?.createdAt || new Date().toISOString(),
      updatedAt: legacyMessages[legacyMessages.length - 1]?.createdAt || new Date().toISOString(),
      modelId: localStorage.getItem(STORAGE_KEYS.responseModel) || "",
      profileId: localStorage.getItem(STORAGE_KEYS.responseProfile) || "",
      groundingMode: normalizeResponseGroundingMode(localStorage.getItem(STORAGE_KEYS.responseGroundingMode) || ""),
      messages: legacyMessages,
    },
  ];
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function getTemplateById(appId) {
  return APP_TEMPLATES.find((template) => template.id === appId) || null;
}

function getModelSearchText(model) {
  return [
    model?.id,
    model?.name,
    model?.served_model_name,
    model?.provider,
    model?.metadata?.reasoning_mode,
    model?.metadata?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getModelFamily(model) {
  const text = getModelSearchText(model);
  if (!text) {
    return "generic";
  }
  if (text.includes("gemma-4") || text.includes("gemma4")) {
    return "gemma";
  }
  if (text.includes("qwen3") || text.includes("qwen-3") || text.includes("qwen")) {
    return "qwen";
  }
  return "generic";
}

function getPrimarySelectedModel() {
  return getSelectedModels()[0]
    || state.registryModels.find((model) => state.selectedModelIds.has(model.id))
    || null;
}

function getCurrentModelFamily() {
  return getModelFamily(getPrimarySelectedModel());
}

function appTargetsModelFamily(app, family) {
  return Array.isArray(app?.modelFamilies) && app.modelFamilies.includes(family);
}

function appMatchesSelectedModelFamily(app, family = getCurrentModelFamily()) {
  if (!Array.isArray(app?.modelFamilies) || app.modelFamilies.length === 0) {
    return true;
  }
  if (!family || family === "generic") {
    return false;
  }
  return appTargetsModelFamily(app, family);
}

function appMatchesSelectedLibrary(app, selectedLibraryId = getSelectedLibrary().id) {
  if (!app?.preferredLibraryId) {
    return true;
  }
  return app.preferredLibraryId === selectedLibraryId;
}

function getVisibleProfilesForLibrary(libraryId = getSelectedLibrary().id) {
  return uniqueProfilesById(
    getEnabledProfiles().filter((profile) =>
      profileMatchesLibrary(profile, libraryId)
      && profileIsRunnableForModels(profile, getBenchmarkScopeModels())
    )
  );
}

function getRecommendedTemplateForModel(model) {
  const family = getModelFamily(model);
  const availableLibraries = getAvailableLibraries();
  return APP_TEMPLATES.find((template) =>
    template.autoRecommend === true
    && appTargetsModelFamily(template, family)
    && (() => {
      const targetLibraryId = state.selectedLibraryMode === SELECTION_MODES.manual
        ? state.selectedLibraryId
        : (template.preferredLibraryId || state.selectedLibraryId);
      if (template.preferredLibraryId && state.selectedLibraryMode === SELECTION_MODES.manual) {
        return template.preferredLibraryId === targetLibraryId;
      }
      if (!availableLibraries.some((library) => library.id === targetLibraryId)) {
        return false;
      }
      const supportedStrategies = new Set(
        getVisibleProfilesForLibrary(targetLibraryId).map((profile) => String(profile.strategy_kind || "direct"))
      );
      return (template.supportedStrategies || []).some((strategy) => supportedStrategies.has(strategy));
    })()
  )
    || getTemplateById("compare-studio")
    || APP_TEMPLATES[0]
    || null;
}

function getAppFitLabel(app, model = getPrimarySelectedModel()) {
  const family = getModelFamily(model);
  if (family === "generic" || !appTargetsModelFamily(app, family)) {
    return "";
  }
  return family === "gemma" ? "recommended for gemma" : "recommended for qwen";
}

function maybeApplyRecommendedStructure({ forceProfile = true, replaceDefault = false } = {}) {
  const model = getPrimarySelectedModel();
  const recommendedTemplate = getRecommendedTemplateForModel(model);
  if (!recommendedTemplate) {
    return false;
  }

  const currentTemplate = getTemplateById(state.selectedAppId);
  const family = getModelFamily(model);
  const shouldReplaceDefault = replaceDefault
    && state.selectedAppMode !== SELECTION_MODES.manual
    && currentTemplate?.id === "compare-studio"
    && recommendedTemplate.id !== currentTemplate.id;
  const shouldReplaceMismatchedAuto = currentTemplate?.autoRecommend === true
    && state.selectedAppMode !== SELECTION_MODES.manual
    && !appTargetsModelFamily(currentTemplate, family)
    && recommendedTemplate.id !== currentTemplate.id;

  if (!shouldReplaceDefault && !shouldReplaceMismatchedAuto) {
    return false;
  }

  applyTemplateById(recommendedTemplate.id, {
    forceProfile,
    selectionMode: SELECTION_MODES.auto,
  });
  return true;
}

function normalizeSingleModelSelection(preferredModelId = "") {
  const selectedModelIds = uniqueValues([...state.selectedModelIds]);
  const fallbackModelId = selectedModelIds[selectedModelIds.length - 1] || "";
  const nextModelId = preferredModelId && selectedModelIds.includes(preferredModelId)
    ? preferredModelId
    : fallbackModelId;

  state.selectedModelIds = nextModelId ? new Set([nextModelId]) : new Set();
}

function uniqueProfilesById(profiles) {
  const seen = new Set();
  return profiles.filter((profile) => {
    if (!profile?.id || seen.has(profile.id)) {
      return false;
    }
    seen.add(profile.id);
    return true;
  });
}

function canConnectKinds(sourceKind, targetKind) {
  return (WORKFLOW_CONNECTIONS[sourceKind] || []).includes(targetKind);
}

function collectReachableNodeIds(startIds, adjacency) {
  const visited = new Set();
  const queue = [...startIds];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    const nextIds = adjacency.get(currentId) || [];
    nextIds.forEach((nextId) => {
      if (!visited.has(nextId)) {
        queue.push(nextId);
      }
    });
  }
  return visited;
}

function findNodePath(startIds, targetIds, adjacency, allowedIds = null) {
  const queue = startIds
    .filter(Boolean)
    .map((nodeId) => ({
      nodeId,
      path: [nodeId],
    }));
  const visited = new Set(queue.map((item) => item.nodeId));
  const targetIdSet = new Set(targetIds.filter(Boolean));

  while (queue.length > 0) {
    const current = queue.shift();
    if (targetIdSet.has(current.nodeId)) {
      return current.path;
    }
    const nextIds = adjacency.get(current.nodeId) || [];
    nextIds.forEach((nextId) => {
      if (!nextId || visited.has(nextId)) {
        return;
      }
      if (allowedIds && !allowedIds.has(nextId) && !targetIdSet.has(nextId)) {
        return;
      }
      visited.add(nextId);
      queue.push({
        nodeId: nextId,
        path: [...current.path, nextId],
      });
    });
  }

  return [];
}

function relayoutWorkflowGraph({ preserveOrder = false } = {}) {
  if (!elements.canvasSurface || !Array.isArray(state.workflow?.nodes) || state.workflow.nodes.length === 0) {
    return;
  }

  const nodes = state.workflow.nodes;
  const edges = state.workflow.edges || [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));

  edges.forEach((edge) => {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) {
      return;
    }
    outgoing.get(edge.from)?.push(edge.to);
    incomingCount.set(edge.to, (incomingCount.get(edge.to) || 0) + 1);
  });

  const levels = new Map();
  const queue = [];

  nodes.forEach((node) => {
    if ((incomingCount.get(node.id) || 0) === 0) {
      levels.set(node.id, 0);
      queue.push(node.id);
    }
  });

  if (queue.length === 0 && nodes[0]) {
    levels.set(nodes[0].id, 0);
    queue.push(nodes[0].id);
  }

  while (queue.length > 0) {
    const currentId = queue.shift();
    const nextLevel = (levels.get(currentId) || 0) + 1;
    (outgoing.get(currentId) || []).forEach((nextId) => {
      const knownLevel = levels.get(nextId);
      if (knownLevel === undefined || nextLevel > knownLevel) {
        levels.set(nextId, nextLevel);
        queue.push(nextId);
      }
    });
  }

  let fallbackLevel = Math.max(0, ...levels.values());
  nodes.forEach((node) => {
    if (!levels.has(node.id)) {
      fallbackLevel += 1;
      levels.set(node.id, fallbackLevel);
    }
  });

  const groups = new Map();
  nodes.forEach((node) => {
    const level = levels.get(node.id) || 0;
    if (!groups.has(level)) {
      groups.set(level, []);
    }
    groups.get(level).push(node);
  });

  const maxX = Math.max(24, elements.canvasSurface.clientWidth - WORKFLOW_LAYOUT.nodeWidth - 24);
  const maxY = Math.max(24, elements.canvasSurface.clientHeight - WORKFLOW_LAYOUT.nodeHeight - 24);

  [...groups.keys()].sort((a, b) => a - b).forEach((level) => {
    const group = groups.get(level) || [];
    group.sort((left, right) => {
      const leftOrder = NODE_KIND_ORDER[left.kind] ?? 99;
      const rightOrder = NODE_KIND_ORDER[right.kind] ?? 99;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (preserveOrder) {
        if (left.x !== right.x) {
          return left.x - right.x;
        }
        if (left.y !== right.y) {
          return left.y - right.y;
        }
      } else if (left.y !== right.y) {
        return left.y - right.y;
      }
      return String(left.title || left.id).localeCompare(String(right.title || right.id));
    });

    const totalHeight = (group.length - 1) * WORKFLOW_LAYOUT.rowGap;
    const startY = clamp(
      Math.round((elements.canvasSurface.clientHeight - totalHeight - WORKFLOW_LAYOUT.nodeHeight) / 2),
      WORKFLOW_LAYOUT.startY,
      maxY
    );

    group.forEach((node, index) => {
      node.x = clamp(
        WORKFLOW_LAYOUT.startX + (level * WORKFLOW_LAYOUT.columnGap),
        24,
        maxX
      );
      node.y = clamp(
        startY + (index * WORKFLOW_LAYOUT.rowGap),
        24,
        maxY
      );
    });
  });
}

function analyzeWorkflow(workflow = state.workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const edges = Array.isArray(workflow?.edges) ? workflow.edges : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));

  edges.forEach((edge) => {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) {
      return;
    }
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  });

  const promptIds = nodes.filter((node) => node.kind === "prompt").map((node) => node.id);
  const llmIds = nodes.filter((node) => node.kind === "llm").map((node) => node.id);
  const evaluatorIds = nodes.filter((node) => node.kind === "evaluator").map((node) => node.id);

  const reachableFromPrompt = collectReachableNodeIds(promptIds, outgoing);
  const canReachLlm = collectReachableNodeIds(llmIds, incoming);
  const activeNodeIds = new Set(
    [...reachableFromPrompt].filter((nodeId) => canReachLlm.has(nodeId) || llmIds.includes(nodeId))
  );
  const activeNodes = nodes.filter((node) => activeNodeIds.has(node.id));
  const primaryPathNodeIds = findNodePath(promptIds, llmIds, outgoing, activeNodeIds);
  const primaryPathTitles = primaryPathNodeIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter(Boolean)
    .map((node) => node.title || node.kind);
  const activeKinds = new Set(activeNodes.map((node) => node.kind));
  const llmReachableFromPrompt = llmIds.some((nodeId) => reachableFromPrompt.has(nodeId));
  const evaluatorReachableFromPrompt = evaluatorIds.some((nodeId) => reachableFromPrompt.has(nodeId));
  const usesRetrieval = activeKinds.has("retriever") || (activeKinds.has("context") && llmReachableFromPrompt);
  const usesTooling = activeKinds.has("tool");
  const usesPlanner = activeKinds.has("planner");
  const usesRouter = activeKinds.has("router");
  const strategyKinds = usesTooling ? ["tool"] : usesRetrieval ? ["rag"] : ["direct"];
  const errors = [];

  if (promptIds.length === 0) {
    errors.push("Prompt node가 필요합니다.");
  }
  if (llmIds.length === 0) {
    errors.push("LLM node가 필요합니다.");
  }
  if (promptIds.length > 0 && llmIds.length > 0 && !llmReachableFromPrompt) {
    errors.push("Prompt에서 LLM으로 이어지는 경로가 필요합니다.");
  }

  return {
    isRunnable: errors.length === 0,
    errors,
    strategyKinds,
    usesRetrieval,
    usesTooling,
    usesPlanner,
    usesRouter,
    hasEvaluationPath: evaluatorReachableFromPrompt,
    activeNodeIds,
    activeNodeTitles: activeNodes.map((node) => node.title || node.kind),
    primaryPathTitles,
  };
}

function getWorkflowStrategyKinds() {
  const analysis = analyzeWorkflow();
  if (analysis.strategyKinds.length > 0) {
    return new Set(analysis.strategyKinds.map((strategy) => String(strategy)));
  }
  return new Set((getSelectedApp().supportedStrategies || []).map((strategy) => String(strategy)));
}

function createNodeRecord(kind, x, y) {
  const source = getCanvasPaletteNode(kind);
  if (!source) {
    return null;
  }

  const nodeId = `${kind}-${Math.random().toString(16).slice(2, 10)}`;
  return {
    id: nodeId,
    kind,
    title: source.title,
    body: source.body,
    x,
    y,
  };
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getConfiguredApiBase() {
  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get("apiBase") || params.get("llmApiBase") || "";
  const injectedValue = normalizeBaseUrl(window.__CALL_LLM_CONFIG__?.apiBase);
  return normalizeBaseUrl(queryValue) || injectedValue;
}

function expandExplicitBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return [];
  }

  return uniqueValues([
    normalized,
    normalized.endsWith("/api") ? normalized.slice(0, -4) : `${normalized}/api`,
  ]);
}

function getCandidateBaseUrls() {
  const configuredBase = getConfiguredApiBase();
  const currentOrigin =
    window.location.origin && window.location.origin.startsWith("http")
      ? window.location.origin
      : "";

  return uniqueValues([
    ...expandExplicitBaseUrl(configuredBase),
    ...(currentOrigin ? [`${currentOrigin}/api`] : []),
    ...API_CONFIG.backendCandidates,
  ]).map(normalizeBaseUrl);
}

function buildRequestHeaders(extraHeaders = {}, { includeJson = false } = {}) {
  const headers = {};
  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }
  return {
    ...headers,
    ...extraHeaders,
  };
}

async function fetchWithBase(baseUrl, path, options = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error("API base URL이 설정되지 않았습니다.");
  }

  return fetch(`${normalizedBaseUrl}${path}`, {
    ...options,
    headers: buildRequestHeaders(options.headers, {
      includeJson: false,
    }),
  });
}

async function apiFetch(path, options = {}) {
  return fetchWithBase(state.connection.baseUrl, path, options);
}

async function readError(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.detail || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function probeBackend(baseUrl) {
  try {
    const [modelResponse, profileResponse] = await Promise.all([
      fetchWithBase(baseUrl, "/v1/registry/models"),
      fetchWithBase(baseUrl, "/v1/agent-profiles"),
    ]);

    if (!modelResponse.ok) {
      return {
        ok: false,
        error: await readError(modelResponse),
      };
    }

    if (!profileResponse.ok) {
      return {
        ok: false,
        error: await readError(profileResponse),
      };
    }

    return {
      ok: true,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

async function resolveConnection() {
  for (const baseUrl of getCandidateBaseUrls()) {
    const probe = await probeBackend(baseUrl);
    if (probe.ok) {
      state.connection.ready = true;
      state.connection.baseUrl = baseUrl;
      return true;
    }
  }

  state.connection.ready = false;
  state.connection.baseUrl = "";
  return false;
}

async function loadRegistryModels() {
  const response = await apiFetch("/v1/registry/models");
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

async function loadAgentProfiles() {
  const response = await apiFetch("/v1/agent-profiles");
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

async function createBenchmarkSuite(payload) {
  const response = await apiFetch("/v1/benchmark-suites", {
    method: "POST",
    headers: buildRequestHeaders({}, { includeJson: true }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

async function createBenchmarkCase(suiteId, payload) {
  const response = await apiFetch(`/v1/benchmark-suites/${suiteId}/cases`, {
    method: "POST",
    headers: buildRequestHeaders({}, { includeJson: true }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

async function createBenchmarkRun(payload) {
  const response = await apiFetch("/v1/benchmark-runs", {
    method: "POST",
    headers: buildRequestHeaders({}, { includeJson: true }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

async function executeBenchmarkRun(runId) {
  const response = await apiFetch(`/v1/benchmark-runs/${runId}/execute`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

async function loadBenchmarkHistory(limit = 6) {
  const response = await apiFetch(`/v1/benchmark-history?limit=${encodeURIComponent(limit)}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

function getSelectedApp() {
  const availableApps = getAvailableApps();
  return availableApps.find((template) => template.id === state.selectedAppId) || availableApps[0] || APP_TEMPLATES[0];
}

function getSelectedLibrary() {
  const availableLibraries = getAvailableLibraries();
  return availableLibraries.find((library) => library.id === state.selectedLibraryId) || availableLibraries[0] || LIBRARIES[0];
}

function getAppLabel(appId) {
  return APP_TEMPLATES.find((template) => template.id === appId)?.name || "Custom Benchmark";
}

function getLibraryLabel(libraryId) {
  return LIBRARIES.find((library) => library.id === libraryId)?.name || LEGACY_LIBRARY_LABELS[libraryId] || "Custom Library";
}

function getSelectedProfiles() {
  const compatibleProfiles = getAppCompatibleProfiles();
  const selectedProfiles = compatibleProfiles.filter((profile) => state.selectedProfileIds.has(profile.id));
  if (selectedProfiles.length > 0) {
    return selectedProfiles;
  }

  return compatibleProfiles[0] ? [compatibleProfiles[0]] : [];
}

function getSelectedModels() {
  return state.registryModels.filter((model) => state.selectedModelIds.has(model.id));
}

function getHistoryEntryById(historyId) {
  return state.runHistory.find((entry) => entry.id === historyId) || null;
}

function getSelectedHistoryEntry() {
  return getHistoryEntryById(state.selectedHistoryId) || state.runHistory[0] || null;
}

function getSelectedHistoryRun(entry) {
  if (!entry) {
    return null;
  }
  return entry.runs.find((item) => item.run?.id === state.selectedRunId) || entry.runs[0] || null;
}

function getEnabledProfiles() {
  return uniqueProfilesById(state.agentProfiles.filter((profile) => profile.enabled !== false));
}

function normalizeFramework(value) {
  return String(value || "custom").toLowerCase();
}

function isModelReadyForChat(model) {
  return model && model.enabled !== false && model.health_status !== "unhealthy" && model.capabilities?.chat_completions !== false;
}

function modelSupportsToolCalling(model) {
  return model?.capabilities?.tool_calling === true;
}

function profileRequiresToolCalling(profile) {
  return (
    String(profile?.strategy_kind || "direct") === "tool"
    || (Array.isArray(profile?.tool_names) && profile.tool_names.length > 0)
    || profile?.metadata?.requires_tool_calling === true
  );
}

function profileMatchesLibrary(profile, libraryId) {
  const scopedLibraryIds = Array.isArray(profile?.metadata?.library_ids) ? profile.metadata.library_ids : [];
  if (scopedLibraryIds.length > 0) {
    return scopedLibraryIds.includes(libraryId);
  }
  const library = LIBRARIES.find((item) => item.id === libraryId);
  if (!library) {
    return true;
  }
  const allowedFrameworks = new Set((library.frameworks || []).map(normalizeFramework));
  return allowedFrameworks.has(normalizeFramework(profile.framework));
}

function getBenchmarkScopeModels() {
  const selectedReadyModels = getSelectedModels().filter(isModelReadyForChat);
  if (selectedReadyModels.length > 0) {
    return selectedReadyModels;
  }
  return state.registryModels.filter(isModelReadyForChat);
}

function profileIsRunnableForModels(profile, models) {
  if (profile?.enabled === false) {
    return false;
  }
  const scopeModels = Array.isArray(models) && models.length > 0 ? models : getBenchmarkScopeModels();
  if (scopeModels.length === 0) {
    return false;
  }
  if (!profileRequiresToolCalling(profile)) {
    return true;
  }
  return scopeModels.every(modelSupportsToolCalling);
}

function getAvailableLibraries() {
  const scopeModels = getBenchmarkScopeModels();
  return LIBRARIES.filter((library) =>
    getEnabledProfiles().some((profile) =>
      profileMatchesLibrary(profile, library.id)
      && profileIsRunnableForModels(profile, scopeModels)
    )
  );
}

function getVisibleProfiles() {
  return getVisibleProfilesForLibrary(getSelectedLibrary().id);
}

function getAppCompatibleProfiles() {
  const supportedStrategies = getWorkflowStrategyKinds();
  return uniqueProfilesById(
    getVisibleProfiles().filter((profile) => supportedStrategies.has(String(profile.strategy_kind || "direct")))
  );
}

function getAvailableApps() {
  const strategies = new Set(getVisibleProfiles().map((profile) => String(profile.strategy_kind || "direct")));
  return APP_TEMPLATES.filter((template) =>
    (template.supportedStrategies || []).some((strategy) => strategies.has(strategy))
    && appMatchesSelectedModelFamily(template)
    && appMatchesSelectedLibrary(template)
  );
}

function getCaseDraft() {
  return {
    prompt: elements.promptInput?.value ?? getPromptDraft(),
    context: elements.contextInput?.value ?? localStorage.getItem(STORAGE_KEYS.contextDraft) ?? "",
    expected: elements.expectedInput?.value ?? localStorage.getItem(STORAGE_KEYS.expectedDraft) ?? API_CONFIG.defaultExpected,
    temperature: elements.temperatureInput?.value ?? localStorage.getItem(STORAGE_KEYS.temperatureDraft) ?? String(API_CONFIG.defaultTemperature),
  };
}

function buildWorkflowSystemPrompt({
  model = getPrimarySelectedModel(),
  profile = getSelectedProfiles()[0] || null,
  responseMode = false,
  includeExpectedSignal = false,
} = {}) {
  const app = getSelectedApp();
  const workflowAnalysis = analyzeWorkflow();
  const caseDraft = getCaseDraft();
  const family = getModelFamily(model);
  const instructions = [
    "Answer the user's request directly.",
    "Do not mention internal workflow nodes, routing, benchmark scoring, profiles, or evaluation unless the user explicitly asks.",
    "Lead with the answer instead of a warm-up sentence whenever possible.",
  ];

  if (workflowAnalysis.usesPlanner) {
    instructions.push("Do any planning silently and keep the visible answer focused on the final result.");
    instructions.push("Compress the reasoning into the final answer instead of narrating your internal process.");
  }

  if (workflowAnalysis.usesRetrieval) {
    instructions.push("Use the provided context when it is relevant to the answer.");
    instructions.push("If the provided context is missing or insufficient, say what is missing instead of inventing details.");
    instructions.push("Treat unsupported claims as uncertain rather than filling gaps from intuition.");
  }

  if (app?.id === "compare-studio") {
    instructions.push("Give a clean baseline answer without self-critique or evaluation commentary.");
  } else if (app?.id === "qwen-reasoning-desk") {
    instructions.push("Decompose the task before answering, then return only the distilled final answer.");
  } else if (app?.id === "gemma-grounded-lane") {
    instructions.push("Filter the relevant evidence first, then synthesize one grounded answer.");
  } else if (app?.id === "gemma-quick-lane") {
    instructions.push("Answer directly without unnecessary setup, reflection, or filler.");
  } else if (app?.id === "rag-lab") {
    instructions.push("Keep grounded facts separate from uncertainty and avoid filling gaps with guesses.");
  }

  if (family === "qwen") {
    instructions.push("Prefer a structured answer with short sections or numbered steps when it improves clarity.");
    instructions.push("Separate assumptions, answer, and next action only when the task actually benefits from that structure.");
    instructions.push("Favor precise technical wording over conversational filler.");
  } else if (family === "gemma" && workflowAnalysis.usesRetrieval) {
    instructions.push("Keep the wording grounded, stable, and close to the supplied evidence.");
    instructions.push("Prefer one confident grounded answer over multiple speculative branches.");
    instructions.push("Use short paragraphs or tight bullets instead of sprawling explanations.");
  } else if (family === "gemma") {
    instructions.push("Prefer concise, natural wording and get to the answer quickly.");
    instructions.push("Keep the response compact unless the user explicitly asks for depth.");
    instructions.push("Avoid meta commentary, repetition, and self-review language.");
  }

  if (profile?.id === "opencode-plan") {
    instructions.push("Keep any hidden plan compact and do not expose chain-of-thought unless the user asks for it.");
    instructions.push("When the task has multiple parts, return the answer in a deliberate stepwise structure.");
  } else if (profile?.id === "direct-chat") {
    instructions.push("Answer in the simplest complete form that satisfies the request.");
  } else if (profile?.id === "rag-context") {
    instructions.push("Distinguish clearly between supported facts and missing context.");
  }

  if (responseMode) {
    instructions.push("This is a live user response, so optimize for helpfulness and final-answer quality.");
    instructions.push("Do not sound like an evaluator, benchmark runner, or system trace.");
  }

  const expectedSignal = caseDraft.expected.trim();
  const hasMeaningfulExpectedSignal = expectedSignal && expectedSignal !== API_CONFIG.defaultExpected;
  if (responseMode && includeExpectedSignal && hasMeaningfulExpectedSignal) {
    instructions.push(`If it fits naturally, make sure the answer covers this target signal: ${expectedSignal}`);
  }

  return `Follow these rules:\n- ${uniqueValues(instructions).join("\n- ")}`;
}

function getResponseModels() {
  const selectedReadyModels = getSelectedModels().filter(
    (model) => isModelReadyForChat(model)
  );
  if (selectedReadyModels.length > 0) {
    return selectedReadyModels;
  }
  return state.registryModels.filter(
    (model) => isModelReadyForChat(model)
  );
}

function getResponseProfiles() {
  const responseModels = getResponseModels();
  const activeModel = responseModels.find((model) => model.id === state.selectedResponseModelId) || responseModels[0] || null;
  const responseScope = activeModel ? [activeModel] : [];
  const selectedProfiles = getSelectedProfiles().filter((profile) =>
    profile.enabled !== false && profileIsRunnableForModels(profile, responseScope)
  );
  if (selectedProfiles.length > 0) {
    return selectedProfiles;
  }
  return getAppCompatibleProfiles().filter((profile) =>
    profile.enabled !== false && profileIsRunnableForModels(profile, responseScope)
  );
}

function getActiveResponseModel() {
  const models = getResponseModels();
  return models.find((model) => model.id === state.selectedResponseModelId) || models[0] || null;
}

function getActiveResponseProfile() {
  const profiles = getResponseProfiles();
  return profiles.find((profile) => profile.id === state.selectedResponseProfileId) || profiles[0] || null;
}

function getCurrentResponseSession() {
  return state.responseSessions.find((session) => session.id === state.currentResponseSessionId) || null;
}

function buildResponseSessionTitle(messages) {
  const firstUserMessage = (messages || []).find((message) => message.role === "user" && String(message.content || "").trim());
  if (!firstUserMessage) {
    return "New chat";
  }
  return shortenText(firstUserMessage.content, 36);
}

function persistResponseSessions() {
  localStorage.setItem(STORAGE_KEYS.responseSessions, JSON.stringify(state.responseSessions));
}

function persistCurrentResponseSession() {
  localStorage.setItem(STORAGE_KEYS.responseCurrentSession, state.currentResponseSessionId || "");
}

function applyResponseSessionById(sessionId) {
  const session = state.responseSessions.find((item) => item.id === sessionId) || null;
  state.currentResponseSessionId = session?.id || "";
  state.responseMessages = session
    ? session.messages.map((message) => ({ ...message }))
    : [];
  state.responseDraft = "";
  if (elements.responseInput) {
    elements.responseInput.value = "";
  }
  if (session?.modelId) {
    state.selectedResponseModelId = session.modelId;
  }
  if (session?.profileId) {
    state.selectedResponseProfileId = session.profileId;
  }
  state.responseGroundingMode = normalizeResponseGroundingMode(session?.groundingMode || state.responseGroundingMode);
  persistResponseGroundingMode();
  persistCurrentResponseSession();
}

function syncResponseSessions() {
  state.responseSessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  if (state.responseSessions.length === 0) {
    state.currentResponseSessionId = "";
    state.responseMessages = [];
    persistResponseSessions();
    persistCurrentResponseSession();
    return;
  }
  if (!state.currentResponseSessionId || !getCurrentResponseSession()) {
    applyResponseSessionById(state.responseSessions[0].id);
  } else {
    persistCurrentResponseSession();
  }
  persistResponseSessions();
}

function saveCurrentResponseSession({ modelId = "", profileId = "" } = {}) {
  if (state.responseMessages.length === 0) {
    persistResponseSessions();
    persistCurrentResponseSession();
    return null;
  }

  const now = new Date().toISOString();
  const sessionPayload = {
    id: state.currentResponseSessionId || `chat-${Date.now()}`,
    title: buildResponseSessionTitle(state.responseMessages),
    createdAt: getCurrentResponseSession()?.createdAt || now,
    updatedAt: now,
    modelId: modelId || state.selectedResponseModelId || getCurrentResponseSession()?.modelId || "",
    profileId: profileId || state.selectedResponseProfileId || getCurrentResponseSession()?.profileId || "",
    groundingMode: state.responseGroundingMode,
    messages: state.responseMessages.map((message) => ({ ...message })),
  };
  const existingIndex = state.responseSessions.findIndex((session) => session.id === sessionPayload.id);
  if (existingIndex === -1) {
    state.responseSessions.unshift(sessionPayload);
  } else {
    state.responseSessions.splice(existingIndex, 1, sessionPayload);
  }
  state.currentResponseSessionId = sessionPayload.id;
  syncResponseSessions();
  return sessionPayload;
}

function getProfileRuntimeNote(profile) {
  const runtimeStatus = profile.metadata?.runtime_status;
  if (!runtimeStatus || runtimeStatus.available !== false) {
    return "";
  }
  const missing = Array.isArray(runtimeStatus.missing_modules) ? runtimeStatus.missing_modules.join(", ") : "";
  const installHint = runtimeStatus.install_hint || "";
  return [missing && `누락: ${missing}`, installHint && `설치: ${installHint}`].filter(Boolean).join(" · ");
}

function persistSelections() {
  normalizeSingleModelSelection();
  localStorage.setItem(STORAGE_KEYS.selectedModels, JSON.stringify([...state.selectedModelIds]));
  localStorage.setItem(STORAGE_KEYS.selectedLibrary, state.selectedLibraryId);
  localStorage.setItem(STORAGE_KEYS.selectedApp, state.selectedAppId);
  localStorage.setItem(STORAGE_KEYS.selectedLibraryMode, normalizeSelectionMode(state.selectedLibraryMode));
  localStorage.setItem(STORAGE_KEYS.selectedAppMode, normalizeSelectionMode(state.selectedAppMode));
  localStorage.setItem(STORAGE_KEYS.selectedProfiles, JSON.stringify([...state.selectedProfileIds]));
  localStorage.setItem(STORAGE_KEYS.selectedProfile, [...state.selectedProfileIds][0] || "");
}

function restoreSelectionsFromStorage() {
  state.selectedModelIds = new Set(readStoredArray(STORAGE_KEYS.selectedModels).slice(-1));
  state.selectedLibraryId = localStorage.getItem(STORAGE_KEYS.selectedLibrary) || state.selectedLibraryId;
  state.selectedLibraryMode = normalizeSelectionMode(localStorage.getItem(STORAGE_KEYS.selectedLibraryMode));
  state.selectedAppId = localStorage.getItem(STORAGE_KEYS.selectedApp) || state.selectedAppId;
  state.selectedAppMode = normalizeSelectionMode(localStorage.getItem(STORAGE_KEYS.selectedAppMode));
  state.selectedProfileIds = new Set(
    uniqueValues([
      ...readStoredArray(STORAGE_KEYS.selectedProfiles),
      localStorage.getItem(STORAGE_KEYS.selectedProfile) || "",
    ])
  );
}

function syncViewFromStorage() {
  restoreSelectionsFromStorage();
  syncSelections();
  renderAll();
}

function persistCaseDraft() {
  if (elements.promptInput) {
    setPromptDraft(elements.promptInput.value);
  }
  if (elements.contextInput) {
    localStorage.setItem(STORAGE_KEYS.contextDraft, elements.contextInput.value);
  }
  if (elements.expectedInput) {
    localStorage.setItem(STORAGE_KEYS.expectedDraft, elements.expectedInput.value);
  }
  if (elements.temperatureInput) {
    localStorage.setItem(STORAGE_KEYS.temperatureDraft, elements.temperatureInput.value);
  }
}

function persistCaseMode() {
  localStorage.setItem(STORAGE_KEYS.caseMode, state.caseMode);
}

function persistResponseDraft() {
  localStorage.setItem(STORAGE_KEYS.responseDraft, state.responseDraft);
}

function persistResponseMessages() {
  localStorage.setItem(STORAGE_KEYS.responseMessages, JSON.stringify(state.responseMessages));
  saveCurrentResponseSession();
}

function persistResponseModel() {
  localStorage.setItem(STORAGE_KEYS.responseModel, state.selectedResponseModelId);
}

function persistResponseProfile() {
  localStorage.setItem(STORAGE_KEYS.responseProfile, state.selectedResponseProfileId);
}

function persistResponseGroundingMode() {
  localStorage.setItem(STORAGE_KEYS.responseGroundingMode, state.responseGroundingMode);
}

function persistTheme() {
  localStorage.setItem(STORAGE_KEYS.theme, state.theme);
}

function setStatus(text) {
  if (elements.statusText) {
    elements.statusText.textContent = text;
  }
}

function syncHistorySelection() {
  const selectedEntry = getSelectedHistoryEntry();
  if (!selectedEntry) {
    state.selectedHistoryId = "";
    state.selectedRunId = "";
    return;
  }

  state.selectedHistoryId = selectedEntry.id;
  if (!selectedEntry.runs.some((item) => item.run?.id === state.selectedRunId)) {
    state.selectedRunId = selectedEntry.runs[0]?.run?.id || "";
  }
}

function renderHeaderMeta() {
  const selectedApp = getSelectedApp();
  const selectedProfiles = getSelectedProfiles();
  const selectedModels = getSelectedModels();
  const selectedModel = selectedModels[0] || null;
  const baseLabel = state.connection.baseUrl
    ? state.connection.baseUrl.replace(/^https?:\/\//, "")
    : "오프라인";
  const profileTitle = selectedProfiles.length
    ? selectedProfiles.map((profile) => profile.name).join(", ")
    : "전략 선택 필요";
  const appFitLabel = getAppFitLabel(selectedApp, selectedModel);
  const appDescription = [selectedApp.description, appFitLabel].filter(Boolean).join(" · ");
  const profileDescription = selectedProfiles[0]?.description || "";

  if (elements.workspaceText) {
    elements.workspaceText.textContent = state.activeView === "workflow"
      ? `Workflow canvas · ${state.workflow.nodes.length} nodes`
      : state.activeView === "results"
        ? `Results review · ${state.runHistory.length} runs`
        : `${selectedApp.name} · browse mode`;
  }
  if (elements.modelCountText) {
    elements.modelCountText.textContent = `${selectedModels.length}개`;
  }
  if (elements.activeAppTitle) {
    elements.activeAppTitle.textContent = selectedApp.name;
  }
  if (elements.activeAppDescription) {
    elements.activeAppDescription.textContent = appDescription;
  }
  if (elements.activeProfileTitle) {
    elements.activeProfileTitle.textContent = profileTitle;
  }
  if (elements.activeProfileDescription) {
    elements.activeProfileDescription.textContent = profileDescription;
  }
  if (elements.baseUrlText) {
    elements.baseUrlText.textContent = baseLabel;
  }
}

function renderViewMode() {
  elements.pageShell?.setAttribute("data-view", state.activeView);
  elements.studioLayout?.setAttribute("data-view", state.activeView);
}

function renderTheme() {
  document.body?.setAttribute("data-theme", state.theme);
  document.querySelectorAll("[data-action='select-theme']").forEach((button) => {
    const isCurrent = button.dataset.theme === state.theme;
    button.classList.toggle("is-current", isCurrent);
    button.setAttribute("aria-pressed", isCurrent ? "true" : "false");
  });
}

function renderCaseMode() {
  document.body?.setAttribute("data-case-mode", state.caseMode);
  if (elements.caseModeButton) {
    elements.caseModeButton.textContent = state.caseMode === "advanced" ? "Basic" : "Advanced";
  }
}

function renderModels() {
  if (!elements.modelsGrid) {
    return;
  }
  if (state.registryModels.length === 0) {
    elements.modelsGrid.innerHTML = '<div class="empty-state">등록된 모델이 없습니다.</div>';
    return;
  }

  elements.modelsGrid.innerHTML = state.registryModels
    .map((model) => {
      const isSelected = state.selectedModelIds.has(model.id);
      const isSelectable = model.enabled !== false
        && model.health_status !== "unhealthy"
        && model.capabilities?.chat_completions !== false;
      const modelFamily = getModelFamily(model);
      const capabilities = Object.entries(model.capabilities || {})
        .filter(([, value]) => Boolean(value))
        .slice(0, 3)
        .map(([key]) => key.replace(/_/g, " "));
      const familyPill = modelFamily !== "generic" ? `<span class="meta-pill">${escapeHtml(modelFamily)}</span>` : "";

      return `
        <button
          class="catalog-card ${isSelected ? "is-selected" : ""} ${isSelectable ? "" : "is-disabled"}"
          type="button"
          data-action="toggle-model"
          data-model-id="${model.id}"
          aria-pressed="${isSelected ? "true" : "false"}"
          ${isSelectable ? "" : "disabled"}
        >
          <span class="card-kicker">
            <span class="health-dot" data-health="${model.health_status}"></span>
            ${model.provider}
          </span>
          <h3>${escapeHtml(model.name)}</h3>
          <div class="card-meta">
            <span class="meta-pill is-accent">${escapeHtml(model.served_model_name)}</span>
            <span class="meta-pill">${isSelectable ? "ready" : "blocked"}</span>
            ${familyPill}
            ${capabilities.map((capability) => `<span class="meta-pill">${escapeHtml(capability)}</span>`).join("")}
          </div>
        </button>
      `;
    })
    .join("");
}

function renderLibraries() {
  if (!elements.librariesGrid) {
    return;
  }
  const availableLibraries = getAvailableLibraries();
  if (availableLibraries.length === 0) {
    elements.librariesGrid.innerHTML = '<div class="empty-state">실행 가능한 라이브러리가 없습니다.</div>';
    return;
  }

  elements.librariesGrid.innerHTML = availableLibraries.map((library) => {
    const isSelected = library.id === state.selectedLibraryId;
    return `
      <button
        class="catalog-card ${isSelected ? "is-selected" : ""}"
        type="button"
        data-action="select-library"
        data-library-id="${library.id}"
      >
        <span class="card-kicker">Library</span>
        <h3>${escapeHtml(library.name)}</h3>
        <div class="card-meta">
          ${library.tags.map((tag) => `<span class="meta-pill">${escapeHtml(tag)}</span>`).join("")}
        </div>
      </button>
    `;
  }).join("");
}

function renderApps() {
  if (!elements.appsGrid) {
    return;
  }
  const availableApps = getAvailableApps();
  if (availableApps.length === 0) {
    elements.appsGrid.innerHTML = '<div class="empty-state">현재 선택한 라이브러리로 실행 가능한 앱이 없습니다.</div>';
    return;
  }

  elements.appsGrid.innerHTML = availableApps.map((app) => {
    const isSelected = app.id === state.selectedAppId;
    const fitLabel = getAppFitLabel(app);
    return `
      <button
        class="catalog-card ${isSelected ? "is-selected" : ""}"
        type="button"
        data-action="select-app"
        data-app-id="${app.id}"
      >
        <span class="card-kicker">App</span>
        <h3>${escapeHtml(app.name)}</h3>
        <div class="card-meta">
          <span class="meta-pill is-accent">${escapeHtml(app.badge)}</span>
          ${fitLabel ? `<span class="meta-pill">${escapeHtml(fitLabel)}</span>` : ""}
          <span class="meta-pill">${app.nodes.length} nodes</span>
        </div>
      </button>
    `;
  }).join("");
}

function renderPalette() {
  if (!elements.paletteList) {
    return;
  }
  elements.paletteList.innerHTML = NODE_PALETTE.map((node) => {
    const isPending = state.pendingNodeKind === node.kind;
    const slotCount = elements.canvasSurface ? buildInsertionSlots(node.kind).length : 0;
    const isDisabled = Boolean(elements.canvasSurface) && slotCount === 0;
    return `
      <button
        class="palette-item ${isPending ? "is-pending" : ""}"
        type="button"
        data-action="palette-add"
        data-node-kind="${node.kind}"
        ${isDisabled ? "disabled" : ""}
      >
        <div>
          <strong>${escapeHtml(node.title)}</strong>
          <span>${escapeHtml(node.body)}</span>
        </div>
        <span>${isDisabled ? "·" : "+"}</span>
      </button>
    `;
  }).join("");
}

function renderSelectedStack() {
  if (!elements.selectedModels || !elements.selectionMeta) {
    return;
  }
  const selectedModels = getSelectedModels();
  const selectedLibrary = getSelectedLibrary();
  const selectedProfiles = getSelectedProfiles();
  const selectedApp = getSelectedApp();
  const selectedFrameworks = uniqueValues(selectedProfiles.map((profile) => profile.framework || "custom"));

  elements.selectedModels.innerHTML = selectedModels.length
    ? selectedModels.map((model) => {
        return `
          <article class="selected-model-card">
            <strong>${escapeHtml(model.name)}</strong>
            <span class="metric-label">${escapeHtml(model.provider)} · ${escapeHtml(model.served_model_name)}</span>
          </article>
        `;
      }).join("")
    : '<div class="empty-state">모델 카드를 클릭해서 최소 한 개 이상 선택하세요.</div>';

  elements.selectionMeta.innerHTML = `
    <article class="meta-stat">
      <span>Library</span>
      <strong>${escapeHtml(selectedLibrary.name)}</strong>
    </article>
    <article class="meta-stat">
      <span>App</span>
      <strong>${escapeHtml(selectedApp.name)}</strong>
    </article>
    <article class="meta-stat">
      <span>Profiles</span>
      <strong>${escapeHtml(selectedProfiles.length ? selectedProfiles.map((profile) => profile.name).join(", ") : "없음")}</strong>
    </article>
    <article class="meta-stat">
      <span>Canvas nodes</span>
      <strong>${state.workflow.nodes.length} nodes</strong>
    </article>
  `;
}

function renderWorkflowCaseBrief() {
  if (!elements.workflowCaseBrief) {
    return;
  }
  const caseDraft = getCaseDraft();
  const workflowAnalysis = analyzeWorkflow();
  const contextCount = caseDraft.context
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean).length;
  const modeLabel = workflowAnalysis.usesTooling
    ? "Tool"
    : workflowAnalysis.usesRetrieval
      ? "RAG"
      : "Direct";
  const flowLabel = workflowAnalysis.isRunnable
    ? (workflowAnalysis.primaryPathTitles.join(" -> ") || workflowAnalysis.activeNodeTitles.join(" -> "))
    : (workflowAnalysis.errors[0] || "구성 필요");

  elements.workflowCaseBrief.innerHTML = `
    <article class="meta-stat">
      <span>Prompt</span>
      <strong>${escapeHtml(caseDraft.prompt.trim() || "없음")}</strong>
    </article>
    <article class="meta-stat">
      <span>Context</span>
      <strong>${contextCount ? `${contextCount} items` : "없음"}</strong>
    </article>
    <article class="meta-stat">
      <span>Mode</span>
      <strong>${escapeHtml(modeLabel)}</strong>
    </article>
    <article class="meta-stat">
      <span>Flow</span>
      <strong>${escapeHtml(shortenText(flowLabel, 72))}</strong>
    </article>
  `;
}

function renderResponseModelPicker() {
  if (!elements.responseModelList) {
    return;
  }
  const models = getResponseModels();
  const activeModel = getActiveResponseModel();
  if (models.length === 0) {
    elements.responseModelList.innerHTML = '<div class="empty-state">채팅 가능한 모델이 없습니다. Browse에서 ready 모델을 선택해 주세요.</div>';
    return;
  }

  elements.responseModelList.innerHTML = models.map((model) => {
    const isSelected = activeModel?.id === model.id;
    return `
      <button
        class="profile-card ${isSelected ? "is-selected" : ""}"
        type="button"
        data-action="select-response-model"
        data-model-id="${model.id}"
      >
        <strong>${escapeHtml(model.name)}</strong>
      </button>
    `;
  }).join("");
}

function renderResponseProfilePicker() {
  if (!elements.responseProfileList) {
    return;
  }
  const profiles = getResponseProfiles();
  const activeProfile = getActiveResponseProfile();
  if (profiles.length === 0) {
    elements.responseProfileList.innerHTML = '<div class="empty-state">실행 가능한 profile이 없습니다. Browse에서 활성 profile을 먼저 선택해 주세요.</div>';
    return;
  }

  elements.responseProfileList.innerHTML = profiles.map((profile) => {
    const isSelected = activeProfile?.id === profile.id;
    return `
      <button
        class="profile-card ${isSelected ? "is-selected" : ""}"
        type="button"
        data-action="select-response-profile"
        data-profile-id="${profile.id}"
      >
        <strong>${escapeHtml(profile.name)}</strong>
      </button>
    `;
  }).join("");
}

function renderResponseModePicker() {
  if (!elements.responseModeList) {
    return;
  }
  elements.responseModeList.innerHTML = RESPONSE_GROUNDING_MODES.map((mode) => {
    const isSelected = state.responseGroundingMode === mode.id;
    return `
      <button
        class="profile-card ${isSelected ? "is-selected" : ""}"
        type="button"
        data-action="select-response-mode"
        data-response-mode="${mode.id}"
      >
        <strong>${escapeHtml(mode.name)}</strong>
      </button>
    `;
  }).join("");
}

function renderResponseSummary() {
  if (!elements.responseSummaryGrid) {
    return;
  }

  const activeModel = getActiveResponseModel();
  const activeProfile = getActiveResponseProfile();
  const selectedLibrary = getSelectedLibrary();
  const selectedApp = getSelectedApp();
  const contextCount = getCaseDraft().context
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean).length;
  const summaryItems = [
    {
      label: "Live profile",
      value: activeProfile?.name || "없음",
      tone: "applied",
    },
    {
      label: "Live model",
      value: activeModel?.name || "없음",
      tone: "applied",
    },
    {
      label: "Temp",
      value: String(getCaseDraft().temperature || API_CONFIG.defaultTemperature),
      tone: "applied",
    },
    {
      label: "Mode",
      value: RESPONSE_GROUNDING_MODES.find((mode) => mode.id === state.responseGroundingMode)?.name || "Auto",
      tone: "applied",
    },
    {
      label: "Browse app",
      value: selectedApp?.name || "없음",
      tone: "context",
    },
    {
      label: "Browse library",
      value: selectedLibrary?.name || "없음",
      tone: "context",
    },
    {
      label: "Context items",
      value: contextCount ? String(contextCount) : "0",
      tone: "context",
    },
  ];

  elements.responseSummaryGrid.innerHTML = summaryItems
    .map((item) => {
      return `
        <article class="response-summary-card" data-tone="${item.tone}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </article>
      `;
    })
    .join("");
}

function renderResponseConversationList() {
  if (!elements.responseConversationList) {
    return;
  }
  if (state.responseSessions.length === 0) {
    elements.responseConversationList.innerHTML = '<div class="empty-state">아직 저장된 대화가 없습니다.</div>';
    return;
  }

  elements.responseConversationList.innerHTML = state.responseSessions
    .map((session) => {
      const isSelected = session.id === state.currentResponseSessionId;
      const timestamp = new Date(session.updatedAt);
      const updatedLabel = Number.isNaN(timestamp.getTime()) ? session.updatedAt : timestamp.toLocaleString("ko-KR");
      return `
        <button
          class="response-session-item ${isSelected ? "is-selected" : ""}"
          type="button"
          data-action="select-response-session"
          data-session-id="${session.id}"
        >
          <strong>${escapeHtml(session.title)}</strong>
          <span>${escapeHtml(updatedLabel)}</span>
        </button>
      `;
    })
    .join("");
}

function renderResponseThread() {
  if (!elements.responseThread) {
    return;
  }
  if (state.responseMessages.length === 0) {
    elements.responseThread.innerHTML = `
      <div class="empty-state">
        Browse에서 프롬프트를 보내거나 여기서 바로 메시지를 입력하면 일반 LLM 채팅처럼 대화를 시작합니다.
      </div>
    `;
    return;
  }

  elements.responseThread.innerHTML = state.responseMessages.map((message) => {
    const bubbleClass = message.role === "user" ? "is-user" : "is-assistant";
    const stateParts = [];
    if (message.state === "streaming") {
      stateParts.push("streaming");
    }
    if (message.modelName) {
      stateParts.push(message.modelName);
    }
    if (message.profileName) {
      stateParts.push(message.profileName);
    }
    const stateLabel = stateParts.join(" · ");
    return `
      <article class="chat-bubble ${bubbleClass}">
        <div class="chat-bubble-meta">
          <span>${escapeHtml(message.role === "user" ? "You" : "Assistant")}</span>
          <span>${escapeHtml(stateLabel)}</span>
        </div>
        <div class="chat-bubble-copy">${escapeHtml(message.content || (message.state === "streaming" ? "..." : ""))}</div>
      </article>
    `;
  }).join("");
  elements.responseThread.scrollTop = elements.responseThread.scrollHeight;
}

function getSelectedExplainCategory() {
  return EXPLAIN_CATEGORIES.find((category) => category.id === state.selectedExplainCategory) || EXPLAIN_CATEGORIES[0];
}

function getExplainItemsForSelectedCategory() {
  const selectedCategory = getSelectedExplainCategory();
  return EXPLAIN_ITEMS.filter((item) => item.category === selectedCategory.id);
}

function getSelectedExplainItem() {
  const scopedItems = getExplainItemsForSelectedCategory();
  return scopedItems.find((item) => item.id === state.selectedExplainId)
    || scopedItems[0]
    || EXPLAIN_ITEMS[0];
}

function persistExplainSelection() {
  localStorage.setItem(STORAGE_KEYS.explainCategory, state.selectedExplainCategory);
  localStorage.setItem(STORAGE_KEYS.explainComponent, state.selectedExplainId);
}

function renderExplain() {
  if (!elements.explainCategoryList || !elements.explainComponentList || !elements.explainDetail) {
    return;
  }

  const selectedCategory = getSelectedExplainCategory();
  const scopedItems = getExplainItemsForSelectedCategory();
  if (!scopedItems.some((item) => item.id === state.selectedExplainId)) {
    state.selectedExplainId = scopedItems[0]?.id || EXPLAIN_ITEMS[0]?.id || "";
  }
  const selectedItem = getSelectedExplainItem();
  persistExplainSelection();

  elements.explainCategoryList.innerHTML = EXPLAIN_CATEGORIES.map((category) => {
    const isSelected = category.id === selectedCategory.id;
    const count = EXPLAIN_ITEMS.filter((item) => item.category === category.id).length;
    return `
      <button
        class="explain-category-chip ${isSelected ? "is-selected" : ""}"
        type="button"
        data-action="select-explain-category"
        data-explain-category="${category.id}"
        aria-pressed="${isSelected ? "true" : "false"}"
      >
        <span>${escapeHtml(category.name)}</span>
        <strong>${count}</strong>
      </button>
    `;
  }).join("");

  elements.explainComponentList.innerHTML = scopedItems.map((item) => {
    const isSelected = item.id === selectedItem.id;
    return `
      <button
        class="explain-component-card ${isSelected ? "is-selected" : ""}"
        type="button"
        data-action="select-explain-component"
        data-explain-id="${item.id}"
        aria-pressed="${isSelected ? "true" : "false"}"
      >
        <span class="card-kicker">${escapeHtml(selectedCategory.name)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.subtitle)}</span>
      </button>
    `;
  }).join("");

  if (elements.explainDetailKicker) {
    elements.explainDetailKicker.textContent = selectedCategory.name;
  }
  if (elements.explainDetailTitle) {
    elements.explainDetailTitle.textContent = selectedItem.title;
  }
  if (elements.explainDetailBadges) {
    elements.explainDetailBadges.innerHTML = (selectedItem.badges || [])
      .map((badge, index) => `<span class="meta-pill ${index === 0 ? "is-accent" : ""}">${escapeHtml(badge)}</span>`)
      .join("");
  }

  const responsibilityItems = (selectedItem.responsibilities || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const logicItems = (selectedItem.logic || [])
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join("");
  const detail = EXPLAIN_DETAILS[selectedItem.id] || {};
  const purpose = EXPLAIN_PURPOSE_DETAILS[selectedItem.id] || {};
  const process = EXPLAIN_PROCESS_DETAILS[selectedItem.id] || {};
  const dataFlow = EXPLAIN_DATA_FLOW_DETAILS[selectedItem.id] || {};
  const buildDetailList = (items) => {
    return (items || [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
  };
  const processSteps = (process.steps || [])
    .map((step, index) => `
      <li class="explain-process-step">
        <span class="process-step-marker">${String(index + 1).padStart(2, "0")}</span>
        <div class="process-step-copy">
          <strong>${escapeHtml(step.title)}</strong>
          <span>${escapeHtml(step.body)}</span>
        </div>
      </li>
    `)
    .join("");
  const dataFlowCards = [
    { label: "받는 데이터", items: dataFlow.receives },
    { label: "처리하면서 바뀌는 데이터", items: dataFlow.transforms },
    { label: "내보내는 데이터", items: dataFlow.returns },
  ].map((card) => `
    <article class="explain-data-card">
      <strong>${escapeHtml(card.label)}</strong>
      <ul class="explain-bullet-list">${buildDetailList(card.items)}</ul>
    </article>
  `).join("");

  elements.explainDetail.innerHTML = `
    <article class="explain-detail-summary">
      <p>${escapeHtml(selectedItem.summary)}</p>
      <div class="logic-strip explain-detail-logic">${logicItems}</div>
    </article>

    <article class="history-detail-section explain-detail-section explain-process-section">
      <span class="metric-label">예시 프로세스</span>
      <div class="explain-process-example">
        <strong>${escapeHtml(process.scenario || "예시 상황")}</strong>
        <span>${escapeHtml(process.input || "")}</span>
      </div>
      <ol class="explain-process-rail">${processSteps}</ol>
      <div class="explain-process-result">
        <span>결과</span>
        <p>${escapeHtml(process.result || "")}</p>
      </div>
    </article>

    <article class="history-detail-section explain-detail-section explain-data-section">
      <span class="metric-label">데이터 흐름 예시</span>
      <div class="explain-data-flow-grid">${dataFlowCards}</div>
      <div class="explain-data-snapshot-grid">
        <div class="explain-data-snapshot">
          <span>${escapeHtml(dataFlow.beforeLabel || "Before")}</span>
          <pre class="debug-pre explain-data-pre">${escapeHtml(dataFlow.before || "")}</pre>
        </div>
        <div class="explain-data-snapshot">
          <span>${escapeHtml(dataFlow.afterLabel || "After")}</span>
          <pre class="debug-pre explain-data-pre">${escapeHtml(dataFlow.after || "")}</pre>
        </div>
      </div>
    </article>

    <section class="explain-detail-grid">
      <article class="history-detail-section explain-detail-section">
        <span class="metric-label">Role</span>
        <ul class="explain-bullet-list">${responsibilityItems}</ul>
      </article>
      <article class="history-detail-section explain-detail-section">
        <span class="metric-label">When to choose</span>
        <div class="detail-copy">${escapeHtml(selectedItem.whenToUse)}</div>
      </article>
    </section>

    <section class="explain-purpose-grid">
      <article class="history-detail-section explain-detail-section">
        <span class="metric-label">필요한 이유</span>
        <ul class="explain-bullet-list">${buildDetailList(purpose.whyNeeded)}</ul>
      </article>
      <article class="history-detail-section explain-detail-section">
        <span class="metric-label">주요 기능</span>
        <ul class="explain-bullet-list">${buildDetailList(purpose.features)}</ul>
      </article>
    </section>

    <article class="history-detail-section explain-detail-section">
      <span class="metric-label">Code path</span>
      <div class="debug-pre explain-code-path">${escapeHtml(selectedItem.codePath)}</div>
    </article>

    <section class="explain-deep-grid">
      <article class="history-detail-section explain-detail-section">
        <span class="metric-label">How it works</span>
        <ul class="explain-bullet-list">${buildDetailList(detail.mechanics)}</ul>
      </article>
      <article class="history-detail-section explain-detail-section">
        <span class="metric-label">Request and result impact</span>
        <ul class="explain-bullet-list">${buildDetailList(detail.requestEffects)}</ul>
      </article>
      <article class="history-detail-section explain-detail-section">
        <span class="metric-label">Watch out</span>
        <ul class="explain-bullet-list">${buildDetailList(detail.watchOut)}</ul>
      </article>
    </section>
  `;
}

function renderProfiles() {
  if (!elements.profileList) {
    return;
  }
  const visibleProfiles = getAppCompatibleProfiles();
  const effectiveProfileIds = new Set(getSelectedProfiles().map((profile) => profile.id));
  if (visibleProfiles.length === 0) {
    const workflowAnalysis = analyzeWorkflow();
    const message = workflowAnalysis.usesTooling
      ? "현재 워크플로를 실행할 tool-capable profile이 없습니다."
      : "현재 library와 workflow에 맞는 profile이 없습니다.";
    elements.profileList.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  elements.profileList.innerHTML = visibleProfiles.map((profile) => {
    const isSelected = effectiveProfileIds.has(profile.id);
    return `
      <button
        class="profile-card ${isSelected ? "is-selected" : ""}"
        type="button"
        data-action="toggle-profile"
        data-profile-id="${profile.id}"
      >
        <strong>${escapeHtml(profile.name)}</strong>
      </button>
    `;
  }).join("");
}

function renderCanvas() {
  if (!elements.canvasNodes || !elements.canvasSurface || !elements.canvasLinks) {
    return;
  }
  if (state.pendingNodeKind) {
    state.insertionSlots = buildInsertionSlots(state.pendingNodeKind);
  }
  elements.canvasNodes.innerHTML = state.workflow.nodes.map((node) => {
    const isSelected = node.id === state.selectedNodeId;
    const isDragging = pointerDrag?.nodeId === node.id;
    return `
      <article
        class="workflow-node ${isSelected ? "is-selected" : ""} ${isDragging ? "is-dragging" : ""}"
        data-node-id="${node.id}"
        style="left:${node.x}px; top:${node.y}px;"
      >
        <div class="workflow-node-header" data-node-id="${node.id}">
          <div>
            <strong>${escapeHtml(node.title)}</strong>
            <span>${escapeHtml(node.kind)}</span>
          </div>
          <span class="workflow-node-kind">${escapeHtml(node.kind)}</span>
        </div>
        <div class="workflow-node-body">${escapeHtml(node.body)}</div>
      </article>
    `;
  }).join("");

  renderCanvasLinks();
  renderInsertionSlots();
}

function renderCanvasLinks() {
  if (!elements.canvasSurface || !elements.canvasLinks) {
    return;
  }
  const width = elements.canvasSurface.clientWidth;
  const height = elements.canvasSurface.clientHeight;
  if (!width || !height) {
    return;
  }
  elements.canvasLinks.setAttribute("viewBox", `0 0 ${width} ${height}`);
  elements.canvasLinks.innerHTML = state.workflow.edges
    .map((edge) => {
      const source = state.workflow.nodes.find((node) => node.id === edge.from);
      const target = state.workflow.nodes.find((node) => node.id === edge.to);
      if (!source || !target) {
        return "";
      }

      const startX = source.x + 210;
      const startY = source.y + 47;
      const endX = target.x;
      const endY = target.y + 47;
      const controlX = startX + Math.max(70, (endX - startX) / 2);
      const path = `M ${startX} ${startY} C ${controlX} ${startY}, ${endX - 60} ${endY}, ${endX} ${endY}`;
      return `
        <path d="${path}" fill="none" stroke="var(--canvas-line)" stroke-width="3" stroke-linecap="round"></path>
        <circle cx="${endX}" cy="${endY}" r="5" fill="#ffb772"></circle>
      `;
    })
    .join("");
}

function renderInsertionSlots() {
  if (!elements.canvasInsertions) {
    return;
  }
  if (!state.pendingNodeKind || state.insertionSlots.length === 0) {
    elements.canvasInsertions.innerHTML = "";
    return;
  }

  elements.canvasInsertions.innerHTML = state.insertionSlots.map((slot) => {
    return `
      <button
        class="insert-slot"
        type="button"
        data-action="insert-node"
        data-slot-id="${slot.id}"
        style="left:${slot.x}px; top:${slot.y}px;"
      >
        <span>${escapeHtml(slot.label)}</span>
      </button>
    `;
  }).join("");
}

function renderRunSummary() {
  if (!elements.runSummary) {
    return;
  }
  const latestRun = getSelectedHistoryEntry();
  if (!latestRun) {
    elements.runSummary.innerHTML = '<div class="empty-state">아직 실행한 benchmark가 없습니다.</div>';
    return;
  }

  const modelCount = uniqueValues(latestRun.runs.map((item) => item.model.id)).length;
  const profileCount = uniqueValues(latestRun.runs.map((item) => item.profile?.id)).length;
  const fastestRun = latestRun.runs
    .filter((item) => item.result?.status === "completed" && Number.isFinite(item.result?.latency_ms))
    .sort((left, right) => left.result.latency_ms - right.result.latency_ms)[0];
  const completedRuns = latestRun.runs.filter((item) => item.result?.status === "completed");
  const failedRuns = latestRun.runs.filter((item) => item.result?.status !== "completed");
  const comparisonRows = latestRun.runs.map((item) => {
    const containsExpected = item.result?.score?.contains_expected;
    const keywordMatches = item.result?.score?.keyword_match_count;
    const keywordTotal = item.result?.score?.keyword_match_total;
    const scoreLabel = typeof containsExpected === "boolean"
      ? (containsExpected ? "pass" : "fail")
      : (Number.isFinite(keywordMatches) && Number.isFinite(keywordTotal) ? `${keywordMatches}/${keywordTotal}` : "n/a");
    return `
      <tr class="${item.result?.status === "completed" ? "" : "is-failed"}">
        <td>
          <strong>${escapeHtml(item.model.name)}</strong>
          <span>${escapeHtml(item.model.served_model_name)}</span>
        </td>
        <td>${escapeHtml(item.profile?.name || "-")}</td>
        <td>${escapeHtml(item.profile?.framework || latestRun.frameworkLabel || "-")}</td>
        <td>${escapeHtml(item.result?.status || item.run.status || "-")}</td>
        <td>${escapeHtml(formatLatency(item.result?.latency_ms))}</td>
        <td>${escapeHtml(scoreLabel)}</td>
        <td>${escapeHtml(item.result?.output_text ? shortenText(item.result.output_text, 96) : shortenText(item.result?.error || "-", 96))}</td>
      </tr>
    `;
  }).join("");

  elements.runSummary.innerHTML = `
    <article class="summary-card">
      <strong>${escapeHtml(latestRun.appName)}</strong>
      <p>${escapeHtml(latestRun.prompt)}</p>
      <div class="summary-grid">
        <article class="meta-stat">
          <span>Models</span>
          <strong>${modelCount}</strong>
        </article>
        <article class="meta-stat">
          <span>Profiles</span>
          <strong>${profileCount}</strong>
        </article>
        <article class="meta-stat">
          <span>Total runs</span>
          <strong>${latestRun.runs.length}</strong>
        </article>
        <article class="meta-stat">
          <span>Completed</span>
          <strong>${completedRuns.length}</strong>
        </article>
        <article class="meta-stat">
          <span>Failed</span>
          <strong>${failedRuns.length}</strong>
        </article>
        <article class="meta-stat">
          <span>Avg latency</span>
          <strong>${latestRun.averageLatencyText}</strong>
        </article>
        <article class="meta-stat">
          <span>Fastest</span>
          <strong>${escapeHtml(fastestRun ? `${fastestRun.model.name} · ${fastestRun.profile?.name || "-"} · ${formatLatency(fastestRun.result?.latency_ms)}` : "-")}</strong>
        </article>
        <article class="meta-stat">
          <span>Selection</span>
          <strong>${escapeHtml(latestRun.profileLabel)}</strong>
        </article>
        <article class="meta-stat">
          <span>Frameworks</span>
          <strong>${escapeHtml(latestRun.frameworkLabel || "-")}</strong>
        </article>
        <article class="meta-stat">
          <span>Pass rate</span>
          <strong>${latestRun.passRateText}</strong>
        </article>
      </div>
    </article>

    <article class="summary-card comparison-card">
      <div class="comparison-heading">
        <strong>Selected comparison matrix</strong>
        <span>${escapeHtml(latestRun.createdAtLabel)}</span>
      </div>
      <div class="comparison-table-shell">
        <table class="comparison-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Profile</th>
              <th>Framework</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Score</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>${comparisonRows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function renderHistoryDetail() {
  if (!elements.historyDetail) {
    return;
  }
  const selectedEntry = getSelectedHistoryEntry();
  if (!selectedEntry) {
    elements.historyDetail.innerHTML = '<div class="empty-state">실행 이력을 선택하면 prompt, context, trace를 여기에서 자세히 볼 수 있습니다.</div>';
    return;
  }

  const selectedRun = getSelectedHistoryRun(selectedEntry);
  const detail = selectedEntry.details || {};
  const contextDocuments = Array.isArray(detail.contextDocuments) ? detail.contextDocuments : [];
  const workflowNodes = Array.isArray(detail.workflowNodes) ? detail.workflowNodes : [];
  const selectedProfiles = uniqueValues(selectedEntry.runs.map((item) => item.profile?.name));
  const expectedText = detail.expectedPhrase || "없음";
  const runSelector = selectedEntry.runs.map((item) => {
    const isSelected = item.run?.id === selectedRun?.run?.id;
    return `
      <button
        class="history-run-chip ${isSelected ? "is-selected" : ""}"
        type="button"
        data-action="select-history-run"
        data-history-id="${selectedEntry.id}"
        data-run-id="${item.run?.id || ""}"
      >
        <strong>${escapeHtml(item.model.name)}</strong>
        <span>${escapeHtml(item.profile?.name || "-")} · ${escapeHtml(item.result?.status || item.run?.status || "-")} · ${escapeHtml(formatLatency(item.result?.latency_ms))}</span>
      </button>
    `;
  }).join("");

  const scoreBadges = Object.entries(selectedRun?.result?.score || {})
    .map(([key, value]) => `<span class="meta-pill">${escapeHtml(`${key}:${String(value)}`)}</span>`)
    .join("");
  const traceItems = Array.isArray(selectedRun?.result?.trace) ? selectedRun.result.trace : [];
  const requestEvents = traceItems.filter((trace) => trace?.event === "request.built");
  const promptTokens = selectedRun?.result?.prompt_tokens;
  const completionTokens = selectedRun?.result?.completion_tokens;
  const totalTokens = [promptTokens, completionTokens].every(Number.isFinite)
    ? promptTokens + completionTokens
    : null;
  const rawOutputText = selectedRun?.result?.raw_output ? formatDebugJson(selectedRun.result.raw_output) : "";

  elements.historyDetail.innerHTML = `
    <article class="summary-card history-detail-card">
      <div class="history-detail-header">
        <div>
          <strong>${escapeHtml(selectedEntry.appName)}</strong>
          <p>${escapeHtml(selectedEntry.libraryName)} · ${escapeHtml(selectedProfiles.join(", "))}</p>
        </div>
        <span class="meta-pill is-accent">${escapeHtml(selectedEntry.createdAtLabel)}</span>
      </div>

      <div class="history-detail-grid">
        <article class="history-detail-section">
          <span class="metric-label">Prompt</span>
          <div class="detail-copy">${escapeHtml(detail.prompt || selectedEntry.prompt || "")}</div>
        </article>
        <article class="history-detail-section">
          <span class="metric-label">Expected</span>
          <div class="detail-copy">${escapeHtml(expectedText)}</div>
        </article>
      </div>

      <div class="history-detail-grid">
        <article class="history-detail-section">
          <span class="metric-label">Context notes</span>
          <div class="detail-list">
            ${contextDocuments.length
              ? contextDocuments.map((item) => `<span class="detail-chip">${escapeHtml(item)}</span>`).join("")
              : '<span class="detail-empty">저장된 context가 없습니다.</span>'}
          </div>
        </article>
        <article class="history-detail-section">
          <span class="metric-label">Workflow nodes</span>
          <div class="detail-list">
            ${workflowNodes.length
              ? workflowNodes.map((node) => `<span class="detail-chip">${escapeHtml(node.title || node.kind || "node")}</span>`).join("")
              : '<span class="detail-empty">저장된 workflow가 없습니다.</span>'}
          </div>
        </article>
      </div>

      <article class="history-detail-section">
        <span class="metric-label">Run selector</span>
        <div class="history-run-selector">${runSelector}</div>
      </article>

      ${selectedRun ? `
        <article class="history-detail-section">
          <div class="history-run-header">
            <div>
              <strong>${escapeHtml(selectedRun.model.name)}</strong>
              <span>${escapeHtml(selectedRun.profile?.name || "-")} · ${escapeHtml(selectedRun.profile?.framework || "-")}</span>
            </div>
            <div class="card-meta">
              <span class="meta-pill ${selectedRun.result?.status === "completed" ? "is-success" : "is-failed"}">${escapeHtml(selectedRun.result?.status || selectedRun.run?.status || "-")}</span>
              <span class="meta-pill">${escapeHtml(formatLatency(selectedRun.result?.latency_ms))}</span>
              ${scoreBadges || '<span class="meta-pill">no score</span>'}
            </div>
          </div>
          <div class="detail-copy detail-output">${escapeHtml(selectedRun.result?.output_text || selectedRun.result?.error || "결과 없음")}</div>
          <div class="history-debug-grid">
            <article class="history-detail-section debug-block">
              <span class="metric-label">Token usage</span>
              <div class="detail-list">
                <span class="detail-chip">prompt: ${escapeHtml(Number.isFinite(promptTokens) ? String(promptTokens) : "-")}</span>
                <span class="detail-chip">completion: ${escapeHtml(Number.isFinite(completionTokens) ? String(completionTokens) : "-")}</span>
                <span class="detail-chip">total: ${escapeHtml(Number.isFinite(totalTokens) ? String(totalTokens) : "-")}</span>
                <span class="detail-chip">first token: ${escapeHtml(formatLatency(selectedRun.result?.first_token_ms))}</span>
              </div>
            </article>
            <article class="history-detail-section debug-block">
              <span class="metric-label">Raw output</span>
              ${rawOutputText
                ? `<pre class="debug-pre">${escapeHtml(rawOutputText)}</pre>`
                : '<div class="detail-empty">저장된 raw output이 없습니다.</div>'}
            </article>
          </div>
          <article class="history-detail-section debug-block">
            <span class="metric-label">Request preview</span>
            ${requestEvents.length
              ? requestEvents.map((trace, index) => `
                  <div class="debug-request-card">
                    <strong>Request ${index + 1}</strong>
                    <pre class="debug-pre">${escapeHtml(formatDebugJson(trace.request_preview || trace))}</pre>
                  </div>
                `).join("")
              : '<div class="detail-empty">저장된 request preview가 없습니다.</div>'}
          </article>
          <div class="trace-list history-trace-list">
            ${traceItems.length
              ? traceItems.map((trace) => `<div class="trace-item">${escapeHtml(formatTrace(trace))}</div>`).join("")
              : '<div class="detail-empty">저장된 trace가 없습니다.</div>'}
          </div>
        </article>
      ` : ""}
    </article>
  `;
}

function renderResultsFeed() {
  if (!elements.resultsFeed) {
    return;
  }
  if (state.runHistory.length === 0) {
    elements.resultsFeed.innerHTML = '<div class="empty-state">결과가 생기면 여기서 모델별 응답과 trace를 비교할 수 있습니다.</div>';
    return;
  }

  elements.resultsFeed.innerHTML = state.runHistory
    .map((entry) => {
      const isSelectedEntry = entry.id === state.selectedHistoryId;
      const runCards = entry.runs.map((item) => {
        const traceItems = Array.isArray(item.result?.trace) ? item.result.trace.slice(0, 6) : [];
        const scoreBadges = Object.entries(item.result?.score || {}).map(([key, value]) => {
          return `<span class="meta-pill">${escapeHtml(`${key}:${String(value)}`)}</span>`;
        }).join("");
        const statusPillClass = item.result?.status === "completed" ? "is-success" : "is-failed";
        const frameworkLabel = item.profile?.framework || entry.frameworkLabel || "-";
        const isSelectedRun = item.run?.id === state.selectedRunId && isSelectedEntry;

        return `
          <article class="result-card ${isSelectedRun ? "is-selected" : ""}" data-action="select-history-run" data-history-id="${entry.id}" data-run-id="${item.run?.id || ""}">
            <header>
              <div>
                <strong>${escapeHtml(item.model.name)}</strong>
                <span class="metric-label">${escapeHtml(item.profile?.name || "-")} · ${escapeHtml(item.run.status)} · ${formatLatency(item.result?.latency_ms)}</span>
              </div>
              <div class="card-meta">
                <span class="meta-pill ${statusPillClass}">${escapeHtml(item.result?.status || item.run.status || "-")}</span>
                <span class="meta-pill">${escapeHtml(frameworkLabel)}</span>
                ${scoreBadges || '<span class="meta-pill">no score</span>'}
              </div>
            </header>
            <div class="result-output">${escapeHtml(item.result?.output_text || item.result?.error || "결과 없음")}</div>
            ${traceItems.length ? `
              <div class="trace-list">
                ${traceItems.map((trace) => `<div class="trace-item">${escapeHtml(formatTrace(trace))}</div>`).join("")}
              </div>
            ` : ""}
          </article>
        `;
      }).join("");

      return `
        <section class="results-group ${isSelectedEntry ? "is-selected" : ""}" data-action="select-history" data-history-id="${entry.id}">
          <div class="card-meta">
            <span class="meta-pill is-accent">${escapeHtml(entry.appName)}</span>
            <span class="meta-pill">${escapeHtml(entry.libraryName)}</span>
            <span class="meta-pill">${escapeHtml(entry.profileLabel)}</span>
          </div>
          <div class="results-feed-inner">${runCards}</div>
        </section>
      `;
    })
    .join("");
}

function renderAll() {
  normalizeSingleModelSelection();
  syncHistorySelection();
  renderTheme();
  renderViewMode();
  renderCaseMode();
  renderHeaderMeta();
  renderModels();
  renderLibraries();
  renderApps();
  renderPalette();
  renderSelectedStack();
  renderWorkflowCaseBrief();
  renderProfiles();
  renderResponseModePicker();
  renderResponseProfilePicker();
  renderResponseModelPicker();
  renderResponseSummary();
  renderResponseConversationList();
  renderResponseThread();
  renderExplain();
  renderCanvas();
  renderRunSummary();
  renderHistoryDetail();
  renderResultsFeed();
  updateActionButtons();
}

function updateActionButtons() {
  const workflowAnalysis = analyzeWorkflow();
  if (elements.runButton) {
    elements.runButton.disabled = state.activeRun || !state.connection.ready || !workflowAnalysis.isRunnable;
  }
  if (elements.refreshButton) {
    elements.refreshButton.disabled = state.activeRun || state.activeResponse;
  }
  if (elements.openResponseButton) {
    elements.openResponseButton.disabled =
      state.activeRun
      || state.activeResponse
      || !state.connection.ready
      || !getActiveResponseModel()
      || !getActiveResponseProfile();
  }
  if (elements.responseSendButton) {
    elements.responseSendButton.disabled =
      state.activeResponse
      || !state.connection.ready
      || !getActiveResponseModel()
      || !getActiveResponseProfile();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function syncSelections() {
  const previousAppId = state.selectedAppId;
  const validModelIds = new Set(
    state.registryModels
      .filter((model) => isModelReadyForChat(model))
      .map((model) => model.id)
  );
  const nextSelectedModels = [...state.selectedModelIds].filter((modelId) => validModelIds.has(modelId));
  state.selectedModelIds = new Set(nextSelectedModels);
  normalizeSingleModelSelection();

  const readyModels = state.registryModels.filter((model) => isModelReadyForChat(model));
  if (state.selectedModelIds.size === 0 && readyModels.length > 0) {
    state.selectedModelIds.add(readyModels[0].id);
  }

  maybeApplyRecommendedStructure({ forceProfile: true, replaceDefault: true });

  const availableLibraries = getAvailableLibraries();
  if (!availableLibraries.some((library) => library.id === state.selectedLibraryId)) {
    state.selectedLibraryId = availableLibraries[0]?.id || LIBRARIES[0]?.id || "";
    state.selectedLibraryMode = SELECTION_MODES.auto;
  }

  const availableApps = getAvailableApps();
  if (!availableApps.some((template) => template.id === state.selectedAppId)) {
    state.selectedAppId = availableApps[0]?.id || APP_TEMPLATES[0]?.id || "";
    state.selectedAppMode = SELECTION_MODES.auto;
  }

  const selectedApp = getSelectedApp();
  const enabledProfiles = getAppCompatibleProfiles();
  const validProfileIds = new Set(enabledProfiles.map((profile) => profile.id));
  const nextSelectedProfiles = [...state.selectedProfileIds].filter((profileId) => validProfileIds.has(profileId));
  state.selectedProfileIds = new Set(nextSelectedProfiles);

    if (state.selectedProfileIds.size === 0) {
      const templateProfile = enabledProfiles.find((profile) => profile.id === selectedApp.profileId);
      if (templateProfile) {
        state.selectedProfileIds.add(templateProfile.id);
      } else if (enabledProfiles[0]) {
        state.selectedProfileIds.add(enabledProfiles[0].id);
      }
    }

  const workflowTemplateId = state.workflow?.templateId || "";
  if (state.workflow.nodes.length === 0 || workflowTemplateId !== state.selectedAppId || previousAppId !== state.selectedAppId) {
    applyTemplateById(state.selectedAppId, { forceProfile: false });
  }

  const responseModels = getResponseModels();
  if (!responseModels.some((model) => model.id === state.selectedResponseModelId)) {
    state.selectedResponseModelId = responseModels[0]?.id || "";
  }
  const responseProfiles = getResponseProfiles();
  if (!responseProfiles.some((profile) => profile.id === state.selectedResponseProfileId)) {
    state.selectedResponseProfileId = responseProfiles[0]?.id || "";
  }

  persistSelections();
  persistResponseModel();
  persistResponseProfile();
}

function applyTemplateById(appId, { forceProfile = true, selectionMode = null } = {}) {
  const template = APP_TEMPLATES.find((item) => item.id === appId);
  if (!template) {
    return;
  }

  if (template.preferredLibraryId) {
    const availableLibraries = getAvailableLibraries();
    const canSwitchLibrary = state.selectedLibraryMode !== SELECTION_MODES.manual || selectionMode === SELECTION_MODES.manual;
    if (canSwitchLibrary && availableLibraries.some((library) => library.id === template.preferredLibraryId)) {
      state.selectedLibraryId = template.preferredLibraryId;
      state.selectedLibraryMode = selectionMode === SELECTION_MODES.manual
        ? SELECTION_MODES.auto
        : state.selectedLibraryMode;
    }
  }

  state.selectedAppId = template.id;
  if (selectionMode !== null) {
    state.selectedAppMode = normalizeSelectionMode(selectionMode);
  }
  clearInsertionMode();
  state.workflow = {
    templateId: template.id,
    nodes: template.nodes.map((node) => ({ ...node })),
    edges: template.edges.map((edge) => ({ ...edge })),
  };
  state.selectedNodeId = state.workflow.nodes[0]?.id || "";
  if (forceProfile) {
    const matchingProfile = getAppCompatibleProfiles().find((profile) => profile.id === template.profileId);
    if (matchingProfile) {
      state.selectedProfileIds = new Set([matchingProfile.id]);
    }
  }
  persistSelections();
}

function autoLayoutWorkflow() {
  relayoutWorkflowGraph();
  renderAll();
}

function resetWorkflow() {
  applyTemplateById(state.selectedAppId);
  renderAll();
}

function toggleModelSelection(modelId) {
  const model = state.registryModels.find((item) => item.id === modelId);
  if (!model || model.enabled === false || model.health_status === "unhealthy" || model.capabilities?.chat_completions === false) {
    return;
  }
  if (state.selectedModelIds.has(modelId) && state.selectedModelIds.size === 1) {
    return;
  }
  const previousAppId = state.selectedAppId;
  state.selectedModelIds = new Set([modelId]);
  syncSelections();
  if (state.selectedAppId !== previousAppId) {
    const selectedApp = getSelectedApp();
    setStatus(`${model.name}에 맞춰 ${selectedApp.name} 구조로 전환했습니다.`);
  }
  renderAll();
}

function selectLibrary(libraryId) {
  state.selectedLibraryId = libraryId;
  state.selectedLibraryMode = SELECTION_MODES.manual;
  state.selectedProfileIds = new Set();
  syncSelections();
  applyTemplateById(state.selectedAppId, { forceProfile: false });
  renderAll();
}

function toggleProfileSelection(profileId) {
  const profile = state.agentProfiles.find((item) => item.id === profileId);
  if (!profile || profile.enabled === false) {
    return;
  }

  if (state.selectedProfileIds.has(profileId)) {
    if (state.selectedProfileIds.size === 1) {
      return;
    }
    state.selectedProfileIds.delete(profileId);
  } else {
    state.selectedProfileIds.add(profileId);
  }
  persistSelections();
  renderAll();
}

function selectApp(appId) {
  applyTemplateById(appId, { selectionMode: SELECTION_MODES.manual });
  renderAll();
}

function toggleCaseMode() {
  state.caseMode = state.caseMode === "advanced" ? "basic" : "advanced";
  persistCaseMode();
  renderAll();
}

function selectTheme(theme) {
  if (!THEMES.includes(theme)) {
    return;
  }
  state.theme = theme;
  persistTheme();
  renderAll();
}

function openResponseWithPrompt() {
  const selectedModel = getActiveResponseModel() || getSelectedModels()[0] || null;
  const selectedProfile = getActiveResponseProfile() || getSelectedProfiles()[0] || null;
  const selectedLibrary = getSelectedLibrary();
  const selectedApp = getSelectedApp();
  const caseDraft = getCaseDraft();
  const prompt = caseDraft.prompt.trim();
  if (selectedModel?.id) {
    localStorage.setItem(STORAGE_KEYS.responseModel, selectedModel.id);
  }
  if (selectedProfile?.id) {
    localStorage.setItem(STORAGE_KEYS.responseProfile, selectedProfile.id);
  }

  localStorage.setItem(
    STORAGE_KEYS.responseSeed,
    JSON.stringify({
      prompt,
      context: caseDraft.context,
      expected: caseDraft.expected,
      temperature: caseDraft.temperature,
      modelId: selectedModel?.id || "",
      profileId: selectedProfile?.id || "",
      groundingMode: state.responseGroundingMode,
      libraryId: selectedLibrary?.id || "",
      appId: selectedApp?.id || "",
      resetChat: true,
      createdAt: new Date().toISOString(),
    })
  );
  window.location.href = prompt ? "./response.html?autostart=1" : "./response.html?seed=1";
}

function selectResponseModel(modelId) {
  state.selectedResponseModelId = modelId;
  persistResponseModel();
  renderAll();
}

function selectResponseProfile(profileId) {
  state.selectedResponseProfileId = profileId;
  persistResponseProfile();
  renderAll();
}

function selectResponseGroundingMode(modeId) {
  state.responseGroundingMode = normalizeResponseGroundingMode(modeId);
  persistResponseGroundingMode();
  saveCurrentResponseSession();
  renderAll();
}

function clearResponseChat() {
  saveCurrentResponseSession();
  state.currentResponseSessionId = "";
  state.responseMessages = [];
  state.responseDraft = "";
  if (elements.responseInput) {
    elements.responseInput.value = "";
  }
  persistResponseDraft();
  persistCurrentResponseSession();
  renderAll();
}

function buildResponsePayload(activeModel, activeProfile) {
  return {
    messages: state.responseMessages
      .filter((message) => message.role === "user" || (message.role === "assistant" && message.state === "done"))
      .map((message) => ({
        role: message.role,
        content: message.content,
        metadata: {},
      })),
    model_id: activeModel.id,
    profile_id: activeProfile.id,
    context_documents: getCaseDraft().context
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    temperature: Number(getCaseDraft().temperature || API_CONFIG.defaultTemperature),
    metadata: {
      source: "response-page",
      grounding_mode: state.responseGroundingMode,
      selected_model_id: activeModel.id,
      selected_profile_id: activeProfile.id,
      selected_app_id: state.selectedAppId,
      selected_library_id: state.selectedLibraryId,
      system_prompt: buildWorkflowSystemPrompt({
        model: activeModel,
        profile: activeProfile,
        responseMode: true,
        includeExpectedSignal: true,
      }),
    },
  };
}

function updateStreamingAssistant(delta) {
  const lastMessage = state.responseMessages[state.responseMessages.length - 1];
  if (lastMessage?.role !== "assistant") {
    return;
  }
  lastMessage.content = `${lastMessage.content || ""}${delta || ""}`;
  renderResponseThread();
}

function completeResponseMessage(result, activeModel, activeProfile) {
  const lastMessage = state.responseMessages[state.responseMessages.length - 1];
  if (lastMessage?.role === "assistant") {
    lastMessage.state = "done";
    lastMessage.content = result.output_text || lastMessage.content || "";
    lastMessage.modelName = result.model?.name || activeModel.name;
    lastMessage.profileName = result.profile?.name || activeProfile.name;
  }
  persistResponseMessages();
  renderResponseThread();
}

function parseSseBlock(block) {
  const lines = block
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (!eventLine || dataLines.length === 0) {
    return null;
  }
  const event = eventLine.slice(6).trim();
  const dataText = dataLines.map((line) => line.slice(5).trim()).join("\n");
  try {
    return {
      event,
      data: JSON.parse(dataText),
    };
  } catch {
    return null;
  }
}

function shouldFallbackToJsonResponse(error) {
  const message = String(error?.message || "");
  return (
    message.includes("Streaming is currently available only for custom profiles")
    || message.includes("Streaming is not yet available for tool profiles")
  );
}

async function sendProfileResponseStream(payload, activeModel, activeProfile) {
  const response = await apiFetch("/v1/profile-responses/stream", {
    method: "POST",
    headers: buildRequestHeaders({}, { includeJson: true }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (!response.body) {
    throw new Error("Streaming response body가 없습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const block = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      const parsedEvent = parseSseBlock(block);
      if (parsedEvent) {
        if (parsedEvent.event === "run.started") {
          setStatus(`${activeModel.name} · ${activeProfile.name} 스트리밍 연결 완료`);
        }
        if (parsedEvent.event === "message.delta") {
          updateStreamingAssistant(parsedEvent.data?.delta || "");
          setStatus(`${activeModel.name} · ${activeProfile.name} 응답 생성 중...`);
        }
        if (parsedEvent.event === "run.failed") {
          throw new Error(parsedEvent.data?.error || "스트리밍 응답 생성에 실패했습니다.");
        }
        if (parsedEvent.event === "run.completed") {
          completeResponseMessage(parsedEvent.data || {}, activeModel, activeProfile);
          setStatus(`${activeModel.name} · ${activeProfile.name} 응답 완료`);
          return parsedEvent.data || {};
        }
      }
      boundaryIndex = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  const outputText = state.responseMessages[state.responseMessages.length - 1]?.content || "";
  return { output_text: outputText };
}

async function sendProfileResponseOnce(payload, activeModel, activeProfile) {
  const response = await apiFetch("/v1/profile-responses", {
    method: "POST",
    headers: buildRequestHeaders({}, { includeJson: true }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const result = await response.json();
  completeResponseMessage(result, activeModel, activeProfile);
  setStatus(`${activeModel.name} · ${activeProfile.name} 응답 완료`);
  return result;
}

async function sendResponseMessage(seedPrompt = "") {
  if (!state.connection.ready) {
    setStatus("먼저 response backend에 연결되어야 합니다.");
    return;
  }
  const activeModel = getActiveResponseModel();
  const activeProfile = getActiveResponseProfile();
  if (!activeModel) {
    setStatus("채팅 가능한 모델이 없습니다.");
    return;
  }
  if (!activeProfile) {
    setStatus("채팅 가능한 profile이 없습니다.");
    return;
  }

  const inputValue = seedPrompt || elements.responseInput?.value || state.responseDraft;
  const content = String(inputValue || "").trim();
  if (!content) {
    elements.responseInput?.focus();
    return;
  }

  const userMessage = {
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    state: "done",
    modelName: activeModel.name,
    profileName: activeProfile.name,
  };
  const assistantMessage = {
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    state: "streaming",
    modelName: activeModel.name,
    profileName: activeProfile.name,
  };

  state.responseMessages = [...state.responseMessages, userMessage, assistantMessage];
  state.activeResponse = true;
  state.responseDraft = "";
  if (elements.responseInput) {
    elements.responseInput.value = "";
  }
  persistResponseDraft();
  saveCurrentResponseSession({ modelId: activeModel.id, profileId: activeProfile.id });
  updateActionButtons();
  renderResponseThread();
  setStatus(`${activeModel.name} · ${activeProfile.name} 응답 생성 중...`);

  try {
    const payload = buildResponsePayload(activeModel, activeProfile);
    try {
      await sendProfileResponseStream(payload, activeModel, activeProfile);
    } catch (streamError) {
      if (!shouldFallbackToJsonResponse(streamError)) {
        throw streamError;
      }
      await sendProfileResponseOnce(payload, activeModel, activeProfile);
    }
  } catch (error) {
    const lastMessage = state.responseMessages[state.responseMessages.length - 1];
    if (lastMessage?.role === "assistant") {
      lastMessage.state = "error";
      lastMessage.content = lastMessage.content || `실행 실패: ${error.message}`;
    }
    saveCurrentResponseSession({ modelId: activeModel.id, profileId: activeProfile.id });
    setStatus(`실행 실패: ${error.message}`);
  } finally {
    state.activeResponse = false;
    updateActionButtons();
    renderResponseThread();
  }
}

function maybeAutostartResponseFromSeed() {
  if (CURRENT_PAGE !== "response") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const shouldAutostart = params.get("autostart") === "1";
  const shouldApplySeed = shouldAutostart || params.get("seed") === "1";
  if (!shouldApplySeed) {
    return;
  }

  try {
    const seed = JSON.parse(localStorage.getItem(STORAGE_KEYS.responseSeed) || "{}");
    localStorage.removeItem(STORAGE_KEYS.responseSeed);
    if (typeof seed.context === "string") {
      localStorage.setItem(STORAGE_KEYS.contextDraft, seed.context);
    }
    if (typeof seed.expected === "string") {
      localStorage.setItem(STORAGE_KEYS.expectedDraft, seed.expected);
    }
    if (seed.temperature !== undefined && seed.temperature !== null) {
      localStorage.setItem(STORAGE_KEYS.temperatureDraft, String(seed.temperature));
    }
    if (seed.libraryId) {
      state.selectedLibraryId = seed.libraryId;
    }
    if (seed.appId) {
      state.selectedAppId = seed.appId;
    }
    if (seed.profileId) {
      state.selectedProfileIds = new Set([seed.profileId]);
    }
    if (seed.modelId) {
      state.selectedResponseModelId = seed.modelId;
      persistResponseModel();
    }
    if (seed.profileId) {
      state.selectedResponseProfileId = seed.profileId;
      persistResponseProfile();
    }
    if (seed.groundingMode) {
      state.responseGroundingMode = normalizeResponseGroundingMode(seed.groundingMode);
      persistResponseGroundingMode();
    }
    syncSelections();
    renderAll();
    if (seed.resetChat) {
      state.currentResponseSessionId = "";
      state.responseMessages = [];
      state.responseDraft = "";
      if (elements.responseInput) {
        elements.responseInput.value = "";
      }
      persistCurrentResponseSession();
      persistResponseDraft();
      renderAll();
    }
    if (shouldAutostart && seed.prompt) {
      void sendResponseMessage(seed.prompt);
    }
  } catch {
    localStorage.removeItem(STORAGE_KEYS.responseSeed);
  }
}

function getCanvasPaletteNode(kind) {
  return NODE_PALETTE.find((item) => item.kind === kind);
}

function clearInsertionMode() {
  state.pendingNodeKind = "";
  state.insertionSlots = [];
}

function buildInsertionSlots(kind) {
  if (!kind || !elements.canvasSurface) {
    return [];
  }

  const nodes = state.workflow.nodes;
  const edges = state.workflow.edges;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingCounts = new Map(nodes.map((node) => [node.id, 0]));
  const outgoingCounts = new Map(nodes.map((node) => [node.id, 0]));
  const incomingKinds = new Map(nodes.map((node) => [node.id, new Set()]));
  const outgoingKinds = new Map(nodes.map((node) => [node.id, new Set()]));
  edges.forEach((edge) => {
    incomingCounts.set(edge.to, (incomingCounts.get(edge.to) || 0) + 1);
    outgoingCounts.set(edge.from, (outgoingCounts.get(edge.from) || 0) + 1);
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);
    if (source && target) {
      outgoingKinds.get(edge.from)?.add(target.kind);
      incomingKinds.get(edge.to)?.add(source.kind);
    }
  });

  if (nodes.length === 0) {
    return canConnectKinds("__start__", kind)
      ? [{
          id: `empty-${kind}`,
          mode: "empty",
          label: `Add ${kind}`,
          x: 120,
          y: 120,
        }]
      : [];
  }

  const slots = [];

  edges.forEach((edge) => {
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);
    if (!source || !target) {
      return;
    }
    if (!canConnectKinds(source.kind, kind) || !canConnectKinds(kind, target.kind)) {
      return;
    }
    if (outgoingKinds.get(source.id)?.has(kind) || incomingKinds.get(target.id)?.has(kind)) {
      return;
    }

    const startX = source.x + 210;
    const startY = source.y + 47;
    const endX = target.x;
    const endY = target.y + 47;
    slots.push({
      id: `between-${edge.from}-${edge.to}-${kind}`,
      mode: "between",
      fromId: edge.from,
      toId: edge.to,
      label: `${source.kind} -> ${kind}`,
      x: Math.round((startX + endX) / 2 - SLOT_DIMENSIONS.width / 2),
      y: Math.round((startY + endY) / 2 - SLOT_DIMENSIONS.height / 2),
    });
  });

  nodes.forEach((node) => {
    const incomingCount = incomingCounts.get(node.id) || 0;
    const outgoingCount = outgoingCounts.get(node.id) || 0;
    const allowParallelRetrieverInput =
      node.kind === "retriever" && (kind === "prompt" || kind === "context");

    const canAddStartSlot =
      (incomingCount === 0 || allowParallelRetrieverInput)
      && canConnectKinds("__start__", kind)
      && canConnectKinds(kind, node.kind)
      && !incomingKinds.get(node.id)?.has(kind);

    if (canAddStartSlot) {
      slots.push({
        id: `start-${node.id}-${kind}`,
        mode: "start",
        toId: node.id,
        label: `${kind} -> ${node.kind}`,
        x: clamp(node.x - 136, 20, Math.max(20, elements.canvasSurface.clientWidth - SLOT_DIMENSIONS.width - 20)),
        y: clamp(node.y + 24, 20, Math.max(20, elements.canvasSurface.clientHeight - SLOT_DIMENSIONS.height - 20)),
      });
    }

    if (outgoingCount === 0 && canConnectKinds(node.kind, kind) && canConnectKinds(kind, "__end__")) {
      slots.push({
        id: `end-${node.id}-${kind}`,
        mode: "end",
        fromId: node.id,
        label: `${node.kind} -> ${kind}`,
        x: clamp(node.x + 224, 20, Math.max(20, elements.canvasSurface.clientWidth - SLOT_DIMENSIONS.width - 20)),
        y: clamp(node.y + 24, 20, Math.max(20, elements.canvasSurface.clientHeight - SLOT_DIMENSIONS.height - 20)),
      });
    }
  });

  return slots.filter((slot, index, collection) =>
    collection.findIndex((candidate) => candidate.id === slot.id) === index
  );
}

function startInsertionMode(kind) {
  if (!kind) {
    clearInsertionMode();
    renderAll();
    return;
  }

  if (state.pendingNodeKind === kind) {
    clearInsertionMode();
    renderAll();
    return;
  }

  const slots = buildInsertionSlots(kind);
  if (slots.length === 0) {
    clearInsertionMode();
    setStatus(`${kind} 노드를 넣을 수 있는 위치가 없습니다.`);
    renderAll();
    return;
  }

  state.pendingNodeKind = kind;
  state.insertionSlots = slots;
  setStatus(`${kind} 노드를 넣을 위치를 선택하세요.`);
  renderAll();
}

function insertNodeIntoSlot(slotId) {
  const slot = state.insertionSlots.find((item) => item.id === slotId);
  if (!slot || !state.pendingNodeKind || !elements.canvasSurface) {
    return;
  }

  const nextNode = createNodeRecord(
    state.pendingNodeKind,
    clamp(slot.x, 20, Math.max(20, elements.canvasSurface.clientWidth - 230)),
    clamp(slot.y, 20, Math.max(20, elements.canvasSurface.clientHeight - 110))
  );
  if (!nextNode) {
    return;
  }

  state.workflow.nodes.push(nextNode);

  if (slot.mode === "between" && slot.fromId && slot.toId) {
    state.workflow.edges = state.workflow.edges.filter(
      (edge) => !(edge.from === slot.fromId && edge.to === slot.toId)
    );
    state.workflow.edges.push({ from: slot.fromId, to: nextNode.id });
    state.workflow.edges.push({ from: nextNode.id, to: slot.toId });
  } else if (slot.mode === "start" && slot.toId) {
    state.workflow.edges.push({ from: nextNode.id, to: slot.toId });
  } else if (slot.mode === "end" && slot.fromId) {
    state.workflow.edges.push({ from: slot.fromId, to: nextNode.id });
  }

  state.selectedNodeId = nextNode.id;
  clearInsertionMode();
  syncSelections();
  relayoutWorkflowGraph({ preserveOrder: true });
  const workflowAnalysis = analyzeWorkflow();
  setStatus(
    workflowAnalysis.isRunnable
      ? `${nextNode.title} 노드를 추가했습니다. 현재 실행 모드는 ${workflowAnalysis.strategyKinds[0] || "direct"}입니다.`
      : (workflowAnalysis.errors[0] || `${nextNode.title} 노드를 추가했습니다.`)
  );
  renderAll();
}

function handlePointerDown(event) {
  const nodeElement = event.target.closest(".workflow-node");
  if (!nodeElement) {
    return;
  }

  const nodeId = nodeElement.dataset.nodeId;
  const node = state.workflow.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return;
  }

  const rect = elements.canvasSurface.getBoundingClientRect();
  pointerDrag = {
    nodeId,
    offsetX: event.clientX - rect.left - node.x,
    offsetY: event.clientY - rect.top - node.y,
  };
  state.selectedNodeId = nodeId;
  renderCanvas();
}

function handlePointerMove(event) {
  if (!pointerDrag) {
    return;
  }

  const rect = elements.canvasSurface.getBoundingClientRect();
  const node = state.workflow.nodes.find((item) => item.id === pointerDrag.nodeId);
  if (!node) {
    return;
  }

  node.x = clamp(event.clientX - rect.left - pointerDrag.offsetX, 20, Math.max(20, rect.width - 230));
  node.y = clamp(event.clientY - rect.top - pointerDrag.offsetY, 20, Math.max(20, rect.height - 110));
  renderCanvas();
}

function handlePointerUp() {
  pointerDrag = null;
  document.querySelectorAll(".workflow-node.is-dragging").forEach((node) => {
    node.classList.remove("is-dragging");
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTrace(trace) {
  if (!trace || typeof trace !== "object") {
    return "unknown trace";
  }

  if (trace.event === "request.built") {
    return `request.built · ${trace.framework || "custom"} · ${trace.message_count || 0} messages`;
  }
  if (trace.event === "tool.completed") {
    return `tool.completed · ${trace.tool_name}`;
  }
  if (trace.event === "assistant.message") {
    return `assistant.message · ${trace.content || "(empty)"}`;
  }
  if (trace.event === "request.built") {
    return `request.built · ${trace.strategy} · ${trace.message_count} messages`;
  }
  return JSON.stringify(trace);
}

function formatLatency(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : "-";
}

function shortenText(value, limit = 120) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function formatDebugJson(value) {
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildCaseMetadata() {
  const caseDraft = getCaseDraft();
  const contextDocuments = caseDraft.context
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const selectedProfiles = getSelectedProfiles();
  const workflowAnalysis = analyzeWorkflow();

  return {
    context_documents: workflowAnalysis.usesRetrieval ? contextDocuments : [],
    selected_library_id: state.selectedLibraryId,
    selected_app_id: state.selectedAppId,
    selected_profile_id: selectedProfiles[0]?.id || null,
    selected_profile_ids: selectedProfiles.map((profile) => profile.id),
    system_prompt: buildWorkflowSystemPrompt({
      model: getPrimarySelectedModel(),
      profile: selectedProfiles[0] || null,
      responseMode: false,
      includeExpectedSignal: false,
    }),
    workflow_nodes: state.workflow.nodes.map((node) => ({
      kind: node.kind,
      title: node.title,
    })),
    workflow_analysis: {
      strategy_kinds: workflowAnalysis.strategyKinds,
      uses_retrieval: workflowAnalysis.usesRetrieval,
      uses_tooling: workflowAnalysis.usesTooling,
      uses_planner: workflowAnalysis.usesPlanner,
      uses_router: workflowAnalysis.usesRouter,
      has_evaluation_path: workflowAnalysis.hasEvaluationPath,
      runnable: workflowAnalysis.isRunnable,
      errors: workflowAnalysis.errors,
    },
  };
}

function buildRunParams() {
  const caseDraft = getCaseDraft();
  const workflowAnalysis = analyzeWorkflow();
  const temperature = Number(caseDraft.temperature || API_CONFIG.defaultTemperature);
  const params = {
    temperature: Number.isFinite(temperature) ? temperature : API_CONFIG.defaultTemperature,
    workflow_strategy: workflowAnalysis.strategyKinds[0] || "direct",
    workflow_uses_router: workflowAnalysis.usesRouter,
    workflow_uses_retrieval: workflowAnalysis.usesRetrieval,
    workflow_uses_tooling: workflowAnalysis.usesTooling,
  };

  if (workflowAnalysis.usesTooling) {
    params.max_steps = workflowAnalysis.usesPlanner ? 6 : 4;
  } else if (workflowAnalysis.usesPlanner) {
    params.max_steps = 3;
  }

  return params;
}

function summarizeHistoryEntry({ id, createdAt, appName, libraryName, prompt, runs, details = {} }) {
  const selectedProfiles = uniqueValues(runs.map((item) => item.profile?.name));
  const selectedFrameworks = uniqueValues(runs.map((item) => item.profile?.framework || "custom"));
  const latencies = runs
    .map((item) => item.result?.latency_ms)
    .filter((value) => Number.isFinite(value));
  const containsValues = runs
    .map((item) => item.result?.score?.contains_expected)
    .filter((value) => typeof value === "boolean");

  const averageLatency = latencies.length
    ? `${Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)} ms`
    : "-";
  const passRate = containsValues.length
    ? `${Math.round((containsValues.filter(Boolean).length / containsValues.length) * 100)}%`
    : "n/a";
  const createdAtValue = createdAt || new Date().toISOString();
  const createdAtDate = new Date(createdAtValue);

  return {
    id,
    createdAt: createdAtValue,
    createdAtLabel: Number.isNaN(createdAtDate.getTime()) ? createdAtValue : createdAtDate.toLocaleString("ko-KR"),
    appName,
    libraryName,
    profileLabel: selectedProfiles.length ? selectedProfiles.join(", ") : "unknown",
    frameworkLabel: selectedFrameworks.length ? selectedFrameworks.join(", ") : "-",
    profileCount: uniqueValues(runs.map((item) => item.profile?.id)).length,
    prompt,
    details,
    runs,
    averageLatencyText: averageLatency,
    passRateText: passRate,
  };
}

function buildHistoryEntry(runs, detailContext = {}) {
  const latestApp = getSelectedApp();
  const latestLibrary = getSelectedLibrary();
  const caseDraft = getCaseDraft();
  const stableHistoryId = detailContext.suiteId ? `history-${detailContext.suiteId}` : `history-${Date.now()}`;
  return summarizeHistoryEntry({
    id: stableHistoryId,
    createdAt: new Date().toISOString(),
    appName: latestApp.name,
    libraryName: latestLibrary.name,
    prompt: caseDraft.prompt.trim(),
    details: {
      prompt: detailContext.prompt || caseDraft.prompt.trim(),
      expectedPhrase: detailContext.expectedPhrase || caseDraft.expected.trim(),
      contextDocuments: detailContext.contextDocuments || buildCaseMetadata().context_documents || [],
      workflowNodes: detailContext.workflowNodes || buildCaseMetadata().workflow_nodes || [],
      suiteId: detailContext.suiteId || "",
    },
    runs,
  });
}

function getPromptFromCases(cases) {
  if (!Array.isArray(cases)) {
    return "";
  }

  for (const caseItem of cases) {
    const userMessage = Array.isArray(caseItem?.input_messages)
      ? caseItem.input_messages.find((message) => message?.role === "user" && typeof message?.content === "string" && message.content.trim())
      : null;
    if (userMessage?.content) {
      return userMessage.content.trim();
    }
  }

  return "";
}

function buildHistoryEntryFromApi(entry) {
  if (!entry || !entry.suite || !Array.isArray(entry.runs)) {
    return null;
  }

  const metadata = entry.suite.metadata || {};
  const runs = entry.runs.map((snapshot) => ({
    model: snapshot.model,
    profile: snapshot.profile,
    run: snapshot.run,
    result: Array.isArray(snapshot.results) ? snapshot.results[0] || null : null,
  }));
  const prompt = getPromptFromCases(entry.cases);

  return summarizeHistoryEntry({
    id: `history-${entry.suite.id}`,
    createdAt: entry.latest_updated_at || entry.suite.updated_at || entry.suite.created_at,
    appName: metadata.selected_app_id ? getAppLabel(metadata.selected_app_id) : (entry.suite.name || "Custom Benchmark"),
    libraryName: metadata.selected_library_id ? getLibraryLabel(metadata.selected_library_id) : "Custom Library",
    prompt,
    details: {
      prompt,
      expectedPhrase:
        entry.cases?.[0]?.expected_output?.contains
        || (Array.isArray(entry.cases?.[0]?.expected_output?.keywords) ? entry.cases[0].expected_output.keywords.join(", ") : ""),
      contextDocuments:
        metadata.context_documents
        || entry.cases?.[0]?.metadata?.context_documents
        || [],
      workflowNodes:
        metadata.workflow_nodes
        || entry.cases?.[0]?.metadata?.workflow_nodes
        || [],
      suiteId: entry.suite.id,
    },
    runs,
  });
}

function getHistoryIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("history") || "";
}

function applyHistorySelectionFromUrl() {
  state.historySelectionNotice = "";
  const historyId = getHistoryIdFromUrl();
  if (!historyId) {
    return;
  }
  const targetEntry = getHistoryEntryById(historyId);
  if (!targetEntry) {
    if (state.runHistory.length > 0) {
      state.selectedHistoryId = state.runHistory[0].id;
      state.selectedRunId = state.runHistory[0].runs[0]?.run?.id || "";
      state.historySelectionNotice = "요청한 결과를 찾지 못해 최신 benchmark 결과를 표시합니다.";
    }
    return;
  }
  state.selectedHistoryId = targetEntry.id;
  state.selectedRunId = targetEntry.runs[0]?.run?.id || "";
}

function openResultsPage(historyId) {
  const nextUrl = `./results.html${historyId ? `?history=${encodeURIComponent(historyId)}` : ""}`;
  if (CURRENT_PAGE === "results") {
    window.history.replaceState({}, "", nextUrl);
    applyHistorySelectionFromUrl();
    renderAll();
    return;
  }
  window.location.href = nextUrl;
}

function buildLocalFailedRun(model, profile, error) {
  const timestamp = new Date().toISOString();
  return {
    model,
    profile,
    run: {
      id: `local-failed-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      status: "failed",
      created_at: timestamp,
      updated_at: timestamp,
    },
    result: {
      status: "failed",
      latency_ms: null,
      first_token_ms: null,
      prompt_tokens: null,
      completion_tokens: null,
      score: {},
      output_text: null,
      raw_output: null,
      trace: [],
      error: error?.message || String(error || "실행 실패"),
    },
  };
}

async function runBenchmark() {
  if (!state.connection.ready) {
    setStatus("먼저 benchmark 백엔드에 연결되어야 합니다.");
    return;
  }

  const workflowAnalysis = analyzeWorkflow();
  const selectedModels = getSelectedModels();
  const selectedProfiles = getSelectedProfiles();
  const caseDraft = getCaseDraft();
  const prompt = caseDraft.prompt.trim();
  const expectedPhrase = caseDraft.expected.trim();

  if (!prompt) {
    setStatus("비교할 프롬프트를 입력하세요.");
    elements.promptInput?.focus();
    return;
  }

  if (!workflowAnalysis.isRunnable) {
    setStatus(workflowAnalysis.errors[0] || "워크플로 구성이 아직 실행 가능하지 않습니다.");
    return;
  }

  if (selectedProfiles.length === 0) {
    if (workflowAnalysis.usesTooling) {
      setStatus("현재 선택한 모델이나 라이브러리로는 tool workflow를 실행할 profile이 없습니다.");
    } else {
      setStatus("실행할 agent profile을 선택하세요.");
    }
    return;
  }
  const disabledProfile = selectedProfiles.find((profile) => profile.enabled === false);
  if (disabledProfile) {
    setStatus(`${disabledProfile.name} 프로필은 아직 런타임 의존성이 없어 비활성화되어 있습니다.`);
    return;
  }

  if (selectedModels.length === 0) {
    setStatus("최소 한 개 모델을 선택하세요.");
    return;
  }

  state.activeRun = true;
  updateActionButtons();
  setStatus("Benchmark suite를 생성하는 중입니다.");

  try {
    const template = getSelectedApp();
    const suite = await createBenchmarkSuite({
      name: `${template.name} ${new Date().toLocaleTimeString("ko-KR")}`,
      version: "1",
      description: `Ad-hoc benchmark for ${template.name}`,
      tags: [template.id, state.selectedLibraryId],
      status: "draft",
      metadata: buildCaseMetadata(),
    });

    const createdCase = await createBenchmarkCase(suite.id, {
      name: `${template.name} prompt`,
      slug: `${template.id}-${Date.now()}`,
      input_messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      expected_output: expectedPhrase ? { contains: expectedPhrase } : {},
      rubric: {
        mode: "contains-check",
      },
      metadata: buildCaseMetadata(),
      enabled: true,
    });

    const runs = [];
    let failedPairCount = 0;
    for (const profile of selectedProfiles) {
      for (const model of selectedModels) {
        setStatus(`${model.name} · ${profile.name} 실행 중...`);
        try {
          const run = await createBenchmarkRun({
            suite_id: suite.id,
            model_id: model.id,
            agent_profile_id: profile.id,
            params: buildRunParams(),
          });
          const execution = await executeBenchmarkRun(run.id);
          runs.push({
            model,
            profile,
            run: execution.run,
            result: execution.results[0] || null,
          });
        } catch (pairError) {
          failedPairCount += 1;
          runs.push(buildLocalFailedRun(model, profile, pairError));
        }
      }
    }

    const historyEntry = buildHistoryEntry(runs, {
      suiteId: suite.id,
      prompt,
      expectedPhrase,
      contextDocuments: buildCaseMetadata().context_documents,
      workflowNodes: buildCaseMetadata().workflow_nodes,
      caseId: createdCase.id,
    });
    state.runHistory = [historyEntry, ...state.runHistory.filter((entry) => entry.id !== historyEntry.id)];
    state.runHistory = state.runHistory.slice(0, 6);
    state.selectedHistoryId = historyEntry.id;
    state.selectedRunId = historyEntry.runs[0]?.run?.id || "";
    const completedPairCount = runs.filter((item) => item.result?.status === "completed").length;
    setStatus(
      failedPairCount
        ? `${completedPairCount}개 성공 · ${failedPairCount}개 실패`
        : `${selectedModels.length}개 모델 × ${selectedProfiles.length}개 프로필 benchmark 완료`
    );
    renderAll();
    openResultsPage(historyEntry.id);
  } catch (error) {
    setStatus(`실행 실패: ${error.message}`);
  } finally {
    state.activeRun = false;
    updateActionButtons();
  }
}

async function refreshCatalog() {
  if (!state.connection.ready) {
    const connected = await resolveConnection();
    if (!connected) {
      setStatus("registry backend를 찾지 못했습니다.");
      renderHeaderMeta();
      updateActionButtons();
      return;
    }
  }

  setStatus("카탈로그를 불러오는 중입니다.");
  try {
    const [models, profiles, history] = await Promise.all([
      loadRegistryModels(),
      loadAgentProfiles(),
      loadBenchmarkHistory().catch(() => []),
    ]);
    state.registryModels = Array.isArray(models) ? models : [];
    state.agentProfiles = Array.isArray(profiles) ? profiles : [];
    state.runHistory = Array.isArray(history)
      ? history.map((entry) => buildHistoryEntryFromApi(entry)).filter(Boolean)
      : [];
    syncSelections();
    applyHistorySelectionFromUrl();
    const disabledProfileCount = state.agentProfiles.filter((profile) => profile.enabled === false).length;
    const loadStatus = `모델 ${state.registryModels.length}개, 프로필 ${state.agentProfiles.length}개 로드 완료${disabledProfileCount ? ` · 비활성 ${disabledProfileCount}개` : ""}`;
    setStatus(
      state.historySelectionNotice
        ? `${loadStatus} · ${state.historySelectionNotice}`
        : loadStatus
    );
    renderAll();
  } catch (error) {
    setStatus(`카탈로그 로드 실패: ${error.message}`);
  }
}

function attachEventListeners() {
  elements.refreshButton?.addEventListener("click", refreshCatalog);
  elements.runButton?.addEventListener("click", runBenchmark);
  elements.caseModeButton?.addEventListener("click", toggleCaseMode);
  elements.openResponseButton?.addEventListener("click", openResponseWithPrompt);
  elements.autoLayoutButton?.addEventListener("click", autoLayoutWorkflow);
  elements.resetWorkflowButton?.addEventListener("click", resetWorkflow);
  elements.promptInput?.addEventListener("input", persistCaseDraft);
  elements.contextInput?.addEventListener("input", persistCaseDraft);
  elements.expectedInput?.addEventListener("input", persistCaseDraft);
  elements.temperatureInput?.addEventListener("input", persistCaseDraft);

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='select-theme']");
    if (!target) {
      return;
    }
    selectTheme(target.dataset.theme);
  });

  elements.modelsGrid?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='toggle-model']");
    if (!target) {
      return;
    }
    toggleModelSelection(target.dataset.modelId);
  });

  elements.librariesGrid?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='select-library']");
    if (!target) {
      return;
    }
    selectLibrary(target.dataset.libraryId);
  });

  elements.appsGrid?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='select-app']");
    if (!target) {
      return;
    }
    selectApp(target.dataset.appId);
  });

  elements.profileList?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='toggle-profile']");
    if (!target) {
      return;
    }
    toggleProfileSelection(target.dataset.profileId);
  });

  elements.responseModelList?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='select-response-model']");
    if (!target) {
      return;
    }
    selectResponseModel(target.dataset.modelId);
  });
  elements.responseProfileList?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='select-response-profile']");
    if (!target) {
      return;
    }
    selectResponseProfile(target.dataset.profileId);
  });
  elements.responseModeList?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='select-response-mode']");
    if (!target) {
      return;
    }
    selectResponseGroundingMode(target.dataset.responseMode);
  });
  elements.responseConversationList?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='select-response-session']");
    if (!target) {
      return;
    }
    applyResponseSessionById(target.dataset.sessionId);
    renderAll();
  });

  elements.responseSendButton?.addEventListener("click", () => {
    void sendResponseMessage();
  });
  elements.responseClearButton?.addEventListener("click", clearResponseChat);
  elements.responseInput?.addEventListener("input", (event) => {
    state.responseDraft = event.target.value;
    persistResponseDraft();
  });
  elements.responseInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendResponseMessage();
    }
  });

  elements.explainCategoryList?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='select-explain-category']");
    if (!target) {
      return;
    }
    state.selectedExplainCategory = target.dataset.explainCategory || EXPLAIN_CATEGORIES[0].id;
    state.selectedExplainId = EXPLAIN_ITEMS.find((item) => item.category === state.selectedExplainCategory)?.id || EXPLAIN_ITEMS[0].id;
    persistExplainSelection();
    renderAll();
  });

  elements.explainComponentList?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='select-explain-component']");
    if (!target) {
      return;
    }
    state.selectedExplainId = target.dataset.explainId || state.selectedExplainId;
    persistExplainSelection();
    renderAll();
  });

  elements.historyDetail?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='select-history-run']");
    if (!target) {
      return;
    }
    state.selectedHistoryId = target.dataset.historyId || state.selectedHistoryId;
    state.selectedRunId = target.dataset.runId || "";
    renderAll();
  });

  elements.resultsFeed?.addEventListener("click", (event) => {
    const runTarget = event.target.closest("[data-action='select-history-run']");
    if (runTarget) {
      state.selectedHistoryId = runTarget.dataset.historyId || state.selectedHistoryId;
      state.selectedRunId = runTarget.dataset.runId || "";
      renderAll();
      return;
    }

    const historyTarget = event.target.closest("[data-action='select-history']");
    if (!historyTarget) {
      return;
    }
    state.selectedHistoryId = historyTarget.dataset.historyId || "";
    state.selectedRunId = getSelectedHistoryRun(getSelectedHistoryEntry())?.run?.id || "";
    renderAll();
  });

  elements.paletteList?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-node-kind]");
    if (!target) {
      return;
    }
    startInsertionMode(target.dataset.nodeKind);
  });
  elements.canvasSurface?.addEventListener("click", (event) => {
    const insertTarget = event.target.closest("[data-action='insert-node']");
    if (insertTarget) {
      insertNodeIntoSlot(insertTarget.dataset.slotId);
      return;
    }
    if (!state.pendingNodeKind) {
      return;
    }
    if (event.target.closest(".insert-slot") || event.target.closest(".workflow-node")) {
      return;
    }
    clearInsertionMode();
    renderAll();
  });
  elements.canvasNodes?.addEventListener("pointerdown", handlePointerDown);
  elements.canvasNodes?.addEventListener("click", (event) => {
    const nodeElement = event.target.closest(".workflow-node");
    if (!nodeElement) {
      return;
    }
    state.selectedNodeId = nodeElement.dataset.nodeId;
    renderAll();
  });

  if (elements.canvasSurface && elements.canvasNodes) {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("resize", renderCanvasLinks);
  }
}

async function initializeApp() {
  if (elements.promptInput) {
    if (CURRENT_PAGE === "browse" && isReloadNavigation()) {
      clearPromptDraft();
    }
    elements.promptInput.value = getPromptDraft();
  }
  if (elements.contextInput) {
    elements.contextInput.value = localStorage.getItem(STORAGE_KEYS.contextDraft) || "";
  }
  if (elements.expectedInput) {
    elements.expectedInput.value = localStorage.getItem(STORAGE_KEYS.expectedDraft) || API_CONFIG.defaultExpected;
  }
  if (elements.temperatureInput) {
    elements.temperatureInput.value = localStorage.getItem(STORAGE_KEYS.temperatureDraft) || String(API_CONFIG.defaultTemperature);
  }
  if (elements.responseInput) {
    elements.responseInput.value = state.responseDraft;
  }
  state.responseGroundingMode = normalizeResponseGroundingMode(state.responseGroundingMode);
  persistResponseGroundingMode();
  syncResponseSessions();
  attachEventListeners();
  renderAll();

  if (CURRENT_PAGE === "explain") {
    return;
  }

  const connected = await resolveConnection();
  if (!connected) {
    setStatus("registry backend를 찾지 못했습니다.");
    renderHeaderMeta();
    updateActionButtons();
    return;
  }

  await refreshCatalog();
  maybeAutostartResponseFromSeed();
}

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) {
    return;
  }
  syncViewFromStorage();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    return;
  }
  syncViewFromStorage();
});

window.addEventListener("storage", (event) => {
  const relevantKeys = new Set([
    STORAGE_KEYS.selectedModels,
    STORAGE_KEYS.selectedLibrary,
    STORAGE_KEYS.selectedLibraryMode,
    STORAGE_KEYS.selectedApp,
    STORAGE_KEYS.selectedAppMode,
    STORAGE_KEYS.selectedProfiles,
    STORAGE_KEYS.selectedProfile,
  ]);
  if (!event.key || !relevantKeys.has(event.key)) {
    return;
  }
  syncViewFromStorage();
});

initializeApp();
