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
  if (page === "workflow" || page === "results" || page === "response") {
    return page;
  }
  return "browse";
})();

const STORAGE_KEYS = {
  selectedModels: "callllm:selected-models:v2",
  selectedLibrary: "callllm:selected-library:v2",
  selectedApp: "callllm:selected-app:v2",
  selectedProfile: "callllm:selected-profile:v2",
  selectedProfiles: "callllm:selected-profiles:v3",
  promptDraft: "callllm:prompt-draft:v1",
  contextDraft: "callllm:context-draft:v1",
  expectedDraft: "callllm:expected-draft:v1",
  temperatureDraft: "callllm:temperature-draft:v2",
  caseMode: "callllm:case-mode:v1",
  responseDraft: "callllm:response-draft:v1",
  responseMessages: "callllm:response-messages:v1",
  responseModel: "callllm:response-model:v1",
  responseProfile: "callllm:response-profile:v1",
  responseSeed: "callllm:response-seed:v1",
  theme: "callllm:theme:v1",
};

const THEMES = ["red", "blue", "yellow"];

function normalizeTheme(value) {
  if (value === "dark") {
    return "yellow";
  }
  return THEMES.includes(value) ? value : "blue";
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
    supportedStrategies: ["direct"],
    nodes: [
      { id: "prompt", kind: "prompt", title: "Prompt", body: "Single shared user prompt for every selected model.", x: 48, y: 224 },
      { id: "router", kind: "router", title: "Model Router", body: "Fan out to every checked model card in the catalog.", x: 318, y: 224 },
      { id: "llm", kind: "llm", title: "LLM Runtime", body: "Benchmark the same payload against each selected runtime.", x: 588, y: 224 },
      { id: "judge", kind: "evaluator", title: "Evaluator", body: "Aggregate latency, pass rate, and output snapshots.", x: 858, y: 224 },
    ],
    edges: [
      { from: "prompt", to: "router" },
      { from: "router", to: "llm" },
      { from: "llm", to: "judge" },
    ],
  },
  {
    id: "rag-lab",
    name: "RAG Lab",
    profileId: "rag-context",
    badge: "Grounded",
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
    id: "tool-orchestrator",
    name: "Tool Agent",
    profileId: "tool-agent",
    badge: "Agent",
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
  { kind: "router", title: "Router", body: "Split one case across many selected models." },
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
  responseSummaryGrid: document.querySelector("#response-summary-grid"),
  responseThread: document.querySelector("#response-thread"),
  responseInput: document.querySelector("#response-input"),
  responseSendButton: document.querySelector("#response-send-button"),
  responseClearButton: document.querySelector("#response-clear-button"),
};

const state = {
  connection: {
    ready: false,
    baseUrl: "",
  },
  registryModels: [],
  agentProfiles: [],
  selectedModelIds: new Set(readStoredArray(STORAGE_KEYS.selectedModels)),
  selectedLibraryId: localStorage.getItem(STORAGE_KEYS.selectedLibrary) || LIBRARIES[0].id,
  selectedAppId: localStorage.getItem(STORAGE_KEYS.selectedApp) || APP_TEMPLATES[0].id,
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
  responseMessages: readStoredArray(STORAGE_KEYS.responseMessages)
    .filter((item) => item && typeof item.role === "string")
    .map((item) => ({
      role: item.role,
      content: String(item.content || ""),
      createdAt: item.createdAt || new Date().toISOString(),
      state: item.state || "done",
      modelName: item.modelName || "",
      profileName: item.profileName || "",
    })),
  selectedResponseModelId: localStorage.getItem(STORAGE_KEYS.responseModel) || "",
  selectedResponseProfileId: localStorage.getItem(STORAGE_KEYS.responseProfile) || "",
  activeResponse: false,
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

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
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
  const selectedLibrary = getSelectedLibrary();
  return uniqueProfilesById(
    getEnabledProfiles().filter((profile) =>
      profileMatchesLibrary(profile, selectedLibrary.id)
      && profileIsRunnableForModels(profile, getBenchmarkScopeModels())
    )
  );
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
  );
}

function getCaseDraft() {
  return {
    prompt: elements.promptInput?.value ?? localStorage.getItem(STORAGE_KEYS.promptDraft) ?? API_CONFIG.defaultPrompt,
    context: elements.contextInput?.value ?? localStorage.getItem(STORAGE_KEYS.contextDraft) ?? "",
    expected: elements.expectedInput?.value ?? localStorage.getItem(STORAGE_KEYS.expectedDraft) ?? API_CONFIG.defaultExpected,
    temperature: elements.temperatureInput?.value ?? localStorage.getItem(STORAGE_KEYS.temperatureDraft) ?? String(API_CONFIG.defaultTemperature),
  };
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
  localStorage.setItem(STORAGE_KEYS.selectedModels, JSON.stringify([...state.selectedModelIds]));
  localStorage.setItem(STORAGE_KEYS.selectedLibrary, state.selectedLibraryId);
  localStorage.setItem(STORAGE_KEYS.selectedApp, state.selectedAppId);
  localStorage.setItem(STORAGE_KEYS.selectedProfiles, JSON.stringify([...state.selectedProfileIds]));
  localStorage.setItem(STORAGE_KEYS.selectedProfile, [...state.selectedProfileIds][0] || "");
}

function persistCaseDraft() {
  if (elements.promptInput) {
    localStorage.setItem(STORAGE_KEYS.promptDraft, elements.promptInput.value);
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
}

function persistResponseModel() {
  localStorage.setItem(STORAGE_KEYS.responseModel, state.selectedResponseModelId);
}

function persistResponseProfile() {
  localStorage.setItem(STORAGE_KEYS.responseProfile, state.selectedResponseProfileId);
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
  const baseLabel = state.connection.baseUrl
    ? state.connection.baseUrl.replace(/^https?:\/\//, "")
    : "오프라인";
  const profileTitle = selectedProfiles.length
    ? selectedProfiles.map((profile) => profile.name).join(", ")
    : "전략 선택 필요";

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
    elements.activeAppDescription.textContent = "";
  }
  if (elements.activeProfileTitle) {
    elements.activeProfileTitle.textContent = profileTitle;
  }
  if (elements.activeProfileDescription) {
    elements.activeProfileDescription.textContent = "";
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
      const capabilities = Object.entries(model.capabilities || {})
        .filter(([, value]) => Boolean(value))
        .slice(0, 3)
        .map(([key]) => key.replace(/_/g, " "));

      return `
        <button
          class="catalog-card ${isSelected ? "is-selected" : ""} ${isSelectable ? "" : "is-disabled"}"
          type="button"
          data-action="toggle-model"
          data-model-id="${model.id}"
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
  renderResponseProfilePicker();
  renderResponseModelPicker();
  renderResponseSummary();
  renderResponseThread();
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

  const readyModels = state.registryModels.filter((model) => isModelReadyForChat(model));
  if (state.selectedModelIds.size === 0 && readyModels.length > 0) {
    state.selectedModelIds.add(readyModels[0].id);
  }

  const availableLibraries = getAvailableLibraries();
  if (!availableLibraries.some((library) => library.id === state.selectedLibraryId)) {
    state.selectedLibraryId = availableLibraries[0]?.id || LIBRARIES[0]?.id || "";
  }

  const availableApps = getAvailableApps();
  if (!availableApps.some((template) => template.id === state.selectedAppId)) {
    state.selectedAppId = availableApps[0]?.id || APP_TEMPLATES[0]?.id || "";
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

function applyTemplateById(appId, { forceProfile = true } = {}) {
  const template = APP_TEMPLATES.find((item) => item.id === appId);
  if (!template) {
    return;
  }

  state.selectedAppId = template.id;
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
  const template = getSelectedApp();
  applyTemplateById(template.id);
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
  if (state.selectedModelIds.has(modelId)) {
    if (state.selectedModelIds.size === 1) {
      return;
    }
    state.selectedModelIds.delete(modelId);
  } else {
    state.selectedModelIds.add(modelId);
  }
  persistSelections();
  renderAll();
}

function selectLibrary(libraryId) {
  state.selectedLibraryId = libraryId;
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
  applyTemplateById(appId);
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
  localStorage.setItem(STORAGE_KEYS.promptDraft, caseDraft.prompt || "");
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

function clearResponseChat() {
  state.responseMessages = [];
  state.responseDraft = "";
  if (elements.responseInput) {
    elements.responseInput.value = "";
  }
  persistResponseDraft();
  persistResponseMessages();
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
      selected_model_id: activeModel.id,
      selected_profile_id: activeProfile.id,
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
  persistResponseMessages();
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
    persistResponseMessages();
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
    syncSelections();
    renderAll();
    if (seed.resetChat) {
      state.responseMessages = [];
      state.responseDraft = "";
      if (elements.responseInput) {
        elements.responseInput.value = "";
      }
      persistResponseMessages();
      persistResponseDraft();
      renderResponseThread();
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
    elements.promptInput.value = localStorage.getItem(STORAGE_KEYS.promptDraft) || API_CONFIG.defaultPrompt;
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
  attachEventListeners();
  renderAll();

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

initializeApp();
