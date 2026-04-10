const API_CONFIG = {
  model: "qwen3-8b-int4",
  systemPrompt:
    "당신은 한국어로 답하는 도움이 되는 AI 어시스턴트다. 사용자의 맥락을 이어서 자연스럽게 대화하고, 불필요한 장식 없이 명확하게 답한다.",
  streamRuns: true,
  legacyApiKey: "local-dev-token",
  backendCandidates: [
    "http://127.0.0.1:8000/api",
    "http://localhost:8000/api",
  ],
  directCandidates: [
    "http://127.0.0.1:18001",
    "http://localhost:18001",
    "http://127.0.0.1:8001",
    "http://localhost:8001",
  ],
};

const THREAD_STORAGE_KEY = "llm-chat-thread-id-v1";
const API_BASE_STORAGE_KEY = "llm-chat-api-base-v1";

const elements = {
  form: document.querySelector("#composer-form"),
  input: document.querySelector("#composer-input"),
  sendButton: document.querySelector("#send-button"),
  resetButton: document.querySelector("#reset-button"),
  statusText: document.querySelector("#status-text"),
  threadText: document.querySelector("#thread-text"),
  messageList: document.querySelector("#message-list"),
  template: document.querySelector("#message-template"),
};

let messages = [];
let isSending = false;
let currentThreadId = localStorage.getItem(THREAD_STORAGE_KEY) || "";

const connectionState = {
  mode: "unavailable",
  baseUrl: "",
  modelName: API_CONFIG.model,
};

function getPlaceholderMessages() {
  return [
    {
      role: "system",
      content: "새 대화를 시작했습니다. 메시지를 보내세요.",
    },
  ];
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function getConfiguredApiBase() {
  const params = new URLSearchParams(window.location.search);
  const queryValue =
    params.get("apiBase") || params.get("llmApiBase") || params.get("providerBase") || "";
  const injectedValue = normalizeBaseUrl(window.__CALL_LLM_CONFIG__?.apiBase);
  const storedValue = normalizeBaseUrl(localStorage.getItem(API_BASE_STORAGE_KEY));

  return normalizeBaseUrl(queryValue) || injectedValue || storedValue;
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
    ...(currentOrigin ? [`${currentOrigin}/api`, currentOrigin] : []),
    ...API_CONFIG.backendCandidates,
    ...API_CONFIG.directCandidates,
  ]).map(normalizeBaseUrl);
}

function getDirectApiKey() {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("apiKey") ||
    params.get("llmApiKey") ||
    window.__CALL_LLM_CONFIG__?.apiKey ||
    API_CONFIG.legacyApiKey
  );
}

function buildRequestHeaders(extraHeaders = {}, { includeJson = false, includeAuth = false } = {}) {
  const headers = {};

  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }

  if (includeAuth) {
    const apiKey = getDirectApiKey();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }

  return {
    ...headers,
    ...extraHeaders,
  };
}

function formatBaseLabel(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return url.pathname && url.pathname !== "/" ? `${url.host}${url.pathname}` : url.host;
  } catch {
    return baseUrl || "알 수 없음";
  }
}

function autosizeTextarea() {
  elements.input.style.height = "0px";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 220)}px`;
}

function scrollToBottom() {
  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: "smooth",
  });
}

function setStatus(text) {
  elements.statusText.textContent = text;
}

function setThreadText(text) {
  if (elements.threadText) {
    elements.threadText.textContent = text;
  }
}

function renderThreadLabel() {
  if (connectionState.mode === "backend") {
    setThreadText(
      currentThreadId
        ? `Thread ${currentThreadId.slice(0, 8)} · ${formatBaseLabel(connectionState.baseUrl)}`
        : `Proxy · ${formatBaseLabel(connectionState.baseUrl)}`
    );
    return;
  }

  if (connectionState.mode === "direct") {
    setThreadText(`Direct · ${formatBaseLabel(connectionState.baseUrl)}`);
    return;
  }

  setThreadText("연결 대상 없음");
}

function setThreadId(threadId) {
  currentThreadId = threadId;
  if (threadId) {
    localStorage.setItem(THREAD_STORAGE_KEY, threadId);
  } else {
    localStorage.removeItem(THREAD_STORAGE_KEY);
  }
  renderThreadLabel();
}

function createMessageNode(message) {
  const fragment = elements.template.content.cloneNode(true);
  const article = fragment.querySelector(".message");
  const meta = fragment.querySelector(".message-meta");
  const bubble = fragment.querySelector(".message-bubble");

  article.dataset.role = message.role;
  if (message.loading) {
    article.classList.add("is-loading");
  }

  meta.textContent =
    message.role === "user"
      ? "You"
      : message.role === "assistant"
        ? "Assistant"
        : message.role === "tool"
          ? message.name || "Tool"
          : "System";
  bubble.textContent = message.content || "";

  return fragment;
}

function renderMessages() {
  const renderableMessages = messages.length > 0 ? messages : getPlaceholderMessages();
  elements.messageList.replaceChildren(...renderableMessages.map((message) => createMessageNode(message)));
  scrollToBottom();
}

async function fetchWithBase(
  baseUrl,
  path,
  options = {},
  { includeAuth = false } = {}
) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error("API base URL이 설정되지 않았습니다.");
  }

  return fetch(`${normalizedBaseUrl}${path}`, {
    ...options,
    headers: buildRequestHeaders(options.headers, {
      includeJson: false,
      includeAuth,
    }),
  });
}

async function apiFetch(path, options = {}, { includeAuth = connectionState.mode === "direct" } = {}) {
  return fetchWithBase(connectionState.baseUrl, path, options, { includeAuth });
}

async function readError(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.detail || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function probeModels(baseUrl) {
  try {
    const response = await fetchWithBase(baseUrl, "/v1/models", {}, { includeAuth: true });
    if (!response.ok) {
      return {
        ok: false,
        error: await readError(response),
      };
    }

    const data = await response.json();
    if (!Array.isArray(data?.data)) {
      return {
        ok: false,
        error: "모델 목록 형식이 아닙니다.",
      };
    }

    return {
      ok: true,
      modelName: data?.data?.[0]?.id || API_CONFIG.model,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

async function probeThreads(baseUrl) {
  try {
    const response = await fetchWithBase(baseUrl, "/v1/threads");
    if (!response.ok) {
      return {
        ok: false,
        error: await readError(response),
      };
    }

    const data = await response.json();
    return {
      ok: Array.isArray(data),
      error: Array.isArray(data) ? "" : "스레드 목록 형식이 아닙니다.",
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

async function probeCandidate(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const modelProbe = await probeModels(normalizedBaseUrl);
  const looksLikeBackend = normalizedBaseUrl.endsWith("/api");

  if (!looksLikeBackend) {
    return {
      baseUrl: normalizedBaseUrl,
      mode: modelProbe.ok ? "direct" : "unavailable",
      modelName: modelProbe.modelName || API_CONFIG.model,
      error: modelProbe.error || "",
    };
  }

  const threadProbe = await probeThreads(normalizedBaseUrl);
  if (modelProbe.ok && threadProbe.ok) {
    return {
      baseUrl: normalizedBaseUrl,
      mode: "backend",
      modelName: modelProbe.modelName,
      error: "",
    };
  }

  if (threadProbe.ok) {
    return {
      baseUrl: normalizedBaseUrl,
      mode: "backend_unhealthy",
      modelName: API_CONFIG.model,
      error: modelProbe.error || "백엔드 upstream 확인 실패",
    };
  }

  return {
    baseUrl: normalizedBaseUrl,
    mode: "unavailable",
    modelName: API_CONFIG.model,
    error: modelProbe.error || threadProbe.error || "사용 가능한 API를 찾지 못했습니다.",
  };
}

async function resolveConnection() {
  let fallbackProbe = null;
  let firstErrorProbe = null;

  for (const baseUrl of getCandidateBaseUrls()) {
    const probe = await probeCandidate(baseUrl);

    if (probe.mode === "backend" || probe.mode === "direct") {
      connectionState.mode = probe.mode;
      connectionState.baseUrl = probe.baseUrl;
      connectionState.modelName = probe.modelName || API_CONFIG.model;

      if (probe.mode !== "backend") {
        setThreadId("");
      } else {
        renderThreadLabel();
      }

      return {
        ok: true,
        mode: probe.mode,
        modelName: connectionState.modelName,
      };
    }

    if (!fallbackProbe && probe.mode === "backend_unhealthy") {
      fallbackProbe = probe;
    }

    if (!firstErrorProbe && probe.mode === "unavailable" && probe.error) {
      firstErrorProbe = probe;
    }
  }

  const selectedProbe = fallbackProbe || firstErrorProbe;
  if (!selectedProbe) {
    connectionState.mode = "unavailable";
    connectionState.baseUrl = "";
    connectionState.modelName = API_CONFIG.model;
    renderThreadLabel();
    return {
      ok: false,
      error: "사용 가능한 API를 찾지 못했습니다.",
    };
  }

  connectionState.mode = "backend";
  connectionState.baseUrl = selectedProbe.baseUrl;
  connectionState.modelName = API_CONFIG.model;
  renderThreadLabel();

  return {
    ok: false,
    error: `백엔드는 연결됐지만 upstream LLM 호출이 실패했습니다: ${selectedProbe.error}`,
  };
}

async function createThread() {
  const response = await apiFetch("/v1/threads", {
    method: "POST",
    headers: buildRequestHeaders({}, { includeJson: true }),
    body: JSON.stringify({
      title: "LLM Chat Session",
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

async function fetchThread(threadId) {
  const response = await apiFetch(`/v1/threads/${threadId}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

function syncMessagesFromThread(thread) {
  messages = Array.isArray(thread?.messages) ? thread.messages : [];
  renderMessages();
}

async function ensureThread({ forceNew = false } = {}) {
  if (connectionState.mode !== "backend") {
    setThreadId("");
    return null;
  }

  if (forceNew) {
    setThreadId("");
  }

  if (!currentThreadId) {
    const thread = await createThread();
    setThreadId(thread.id);
    syncMessagesFromThread(thread);
    return thread;
  }

  try {
    const thread = await fetchThread(currentThreadId);
    syncMessagesFromThread(thread);
    return thread;
  } catch {
    const thread = await createThread();
    setThreadId(thread.id);
    syncMessagesFromThread(thread);
    return thread;
  }
}

function appendLocalMessage(message) {
  messages.push(message);
  renderMessages();
}

function updateLoadingAssistant(content, { loading = true } = {}) {
  const assistantIndex = messages.findLastIndex((message) => message.loading);
  if (assistantIndex === -1) {
    return;
  }

  messages[assistantIndex] = {
    role: "assistant",
    content,
    loading,
  };
  renderMessages();
}

function parseSseEvent(block) {
  const normalized = block.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  const lines = normalized.split("\n");
  let event = "message";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return {
      event,
      data: JSON.parse(dataLines.join("\n")),
    };
  } catch {
    return null;
  }
}

async function streamThreadRun(threadId, content) {
  const response = await apiFetch(`/v1/threads/${threadId}/runs/stream`, {
    method: "POST",
    headers: buildRequestHeaders(
      {
        Accept: "text/event-stream",
      },
      { includeJson: true }
    ),
    body: JSON.stringify({
      user_message: content,
      model: API_CONFIG.model,
      system_prompt: API_CONFIG.systemPrompt,
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (!response.body) {
    throw new Error("스트리밍 응답을 사용할 수 없습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalOutputText = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      const parsed = parseSseEvent(block);
      if (!parsed) {
        continue;
      }

      if (parsed.event === "run.started") {
        setStatus("응답 생성 중");
        continue;
      }

      if (parsed.event === "message.delta") {
        finalOutputText += parsed.data?.delta || "";
        updateLoadingAssistant(finalOutputText, { loading: true });
        continue;
      }

      if (parsed.event === "run.completed") {
        finalOutputText = parsed.data?.output_text || finalOutputText;
        updateLoadingAssistant(finalOutputText || "응답이 비어 있습니다.", { loading: false });
        setStatus(`${connectionState.modelName} 응답 완료`);
        continue;
      }

      if (parsed.event === "run.failed") {
        throw new Error(parsed.data?.error || "스트리밍 실행에 실패했습니다.");
      }
    }

    if (done) {
      break;
    }
  }

  return finalOutputText;
}

function extractTextContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (typeof item?.text === "string") {
        return item.text;
      }
      if (typeof item?.text?.value === "string") {
        return item.text.value;
      }
      return "";
    })
    .join("")
    .trim();
}

function extractAssistantMessage(payload) {
  return (
    extractTextContent(payload?.choices?.[0]?.message?.content) ||
    extractTextContent(payload?.output?.[0]?.content) ||
    payload?.output_text ||
    ""
  );
}

function getDirectConversationMessages() {
  const conversation = [];

  if (API_CONFIG.systemPrompt) {
    conversation.push({
      role: "system",
      content: API_CONFIG.systemPrompt,
    });
  }

  for (const message of messages) {
    if (message.loading || !message.content) {
      continue;
    }

    if (!["user", "assistant", "system"].includes(message.role)) {
      continue;
    }

    conversation.push({
      role: message.role,
      content: message.content,
    });
  }

  return conversation;
}

async function createDirectChatCompletion() {
  const response = await apiFetch(
    "/v1/chat/completions",
    {
      method: "POST",
      headers: buildRequestHeaders({}, { includeJson: true, includeAuth: true }),
      body: JSON.stringify({
        model: API_CONFIG.model,
        messages: getDirectConversationMessages(),
        stream: false,
      }),
    },
    { includeAuth: true }
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = await response.json();
  return extractAssistantMessage(data) || "응답이 비어 있습니다.";
}

async function checkConnection() {
  const result = await resolveConnection();

  if (result.ok) {
    setStatus(`${result.modelName || API_CONFIG.model} 연결됨`);
    return true;
  }

  setStatus(`연결 실패: ${result.error}`);
  return false;
}

async function sendMessage(event) {
  event.preventDefault();

  const content = elements.input.value.trim();
  if (!content || isSending) {
    return;
  }

  if (!connectionState.baseUrl) {
    setStatus("연결된 API가 없습니다.");
    return;
  }

  isSending = true;
  elements.sendButton.disabled = true;

  let createdLoadingAssistant = false;

  try {
    if (connectionState.mode === "backend") {
      setStatus("스레드 준비 중");
      await ensureThread();
    } else {
      setStatus("직접 호출 준비 중");
    }

    appendLocalMessage({ role: "user", content });
    appendLocalMessage({ role: "assistant", content: "응답 생성 중...", loading: true });
    createdLoadingAssistant = true;

    elements.input.value = "";
    autosizeTextarea();

    if (connectionState.mode === "backend" && API_CONFIG.streamRuns) {
      await streamThreadRun(currentThreadId, content);
      const thread = await fetchThread(currentThreadId);
      syncMessagesFromThread(thread);
    } else {
      const assistantReply = await createDirectChatCompletion();
      updateLoadingAssistant(assistantReply, { loading: false });
      setStatus(`${connectionState.modelName} 응답 완료`);
    }
  } catch (error) {
    if (createdLoadingAssistant) {
      updateLoadingAssistant(`호출 오류: ${error.message}`, { loading: false });
    }
    setStatus(`응답 실패: ${error.message}`);
  } finally {
    isSending = false;
    elements.sendButton.disabled = false;
  }
}

async function resetConversation() {
  if (isSending) {
    return;
  }

  if (connectionState.mode === "backend") {
    setStatus("새 스레드 생성 중");
    try {
      const thread = await createThread();
      setThreadId(thread.id);
      syncMessagesFromThread(thread);
      setStatus("새 대화");
    } catch (error) {
      setStatus(`초기화 실패: ${error.message}`);
    }
    return;
  }

  messages = [];
  setThreadId("");
  renderMessages();
  setStatus(connectionState.baseUrl ? "새 대화" : "연결된 API가 없습니다.");
}

async function initializeApp() {
  renderMessages();
  autosizeTextarea();

  const connected = await checkConnection();
  if (!connected) {
    renderThreadLabel();
    return;
  }

  if (connectionState.mode === "backend") {
    try {
      await ensureThread();
    } catch (error) {
      setStatus(`초기화 실패: ${error.message}`);
      setThreadText("스레드 생성 실패");
    }
    return;
  }

  setThreadId("");
}

elements.form.addEventListener("submit", sendMessage);
elements.resetButton.addEventListener("click", resetConversation);
elements.input.addEventListener("input", autosizeTextarea);
elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});

initializeApp();
