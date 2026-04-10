const API_CONFIG = {
  baseUrl: "http://127.0.0.1:8001",
  apiKey: "local-dev-token",
  model: "qwen3-8b-int4",
  systemPrompt:
    "당신은 한국어로 답하는 도움이 되는 AI 어시스턴트다. 사용자의 맥락을 이어서 자연스럽게 대화하고, 불필요한 장식 없이 명확하게 답한다.",
};

const STORAGE_KEY = "llm-chat-messages-v1";

const elements = {
  form: document.querySelector("#composer-form"),
  input: document.querySelector("#composer-input"),
  sendButton: document.querySelector("#send-button"),
  resetButton: document.querySelector("#reset-button"),
  statusText: document.querySelector("#status-text"),
  messageList: document.querySelector("#message-list"),
  template: document.querySelector("#message-template"),
};

let messages = loadMessages();
let isSending = false;

function loadMessages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {}

  return [
    {
      role: "assistant",
      content: "안녕하세요. 메시지를 보내면 바로 이어서 대화합니다.",
    },
  ];
}

function saveMessages() {
  const safeMessages = messages.filter((message) => !message.loading);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeMessages));
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

function createMessageNode(message) {
  const fragment = elements.template.content.cloneNode(true);
  const article = fragment.querySelector(".message");
  const meta = fragment.querySelector(".message-meta");
  const bubble = fragment.querySelector(".message-bubble");

  article.dataset.role = message.role;
  if (message.loading) {
    article.classList.add("is-loading");
  }

  meta.textContent = message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System";
  bubble.textContent = message.content;

  return fragment;
}

function renderMessages() {
  elements.messageList.replaceChildren(...messages.map((message) => createMessageNode(message)));
  scrollToBottom();
}

function getConversationPayload() {
  return [
    { role: "system", content: API_CONFIG.systemPrompt },
    ...messages
      .filter((message) => (message.role === "user" || message.role === "assistant") && !message.loading)
      .map((message) => ({
        role: message.role,
        content: message.content,
      })),
  ];
}

async function checkConnection() {
  try {
    const response = await fetch(`${API_CONFIG.baseUrl}/v1/models`, {
      headers: {
        Authorization: `Bearer ${API_CONFIG.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const modelName = data?.data?.[0]?.id || API_CONFIG.model;
    setStatus(`${modelName} 연결됨`);
  } catch (error) {
    setStatus(`연결 실패: ${error.message}`);
  }
}

async function sendMessage(event) {
  event.preventDefault();

  const content = elements.input.value.trim();
  if (!content || isSending) {
    return;
  }

  isSending = true;
  elements.sendButton.disabled = true;
  setStatus("응답 생성 중");

  messages.push({ role: "user", content });
  messages.push({ role: "assistant", content: "응답 생성 중...", loading: true });
  renderMessages();
  saveMessages();

  elements.input.value = "";
  autosizeTextarea();

  try {
    const response = await fetch(`${API_CONFIG.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: API_CONFIG.model,
        messages: getConversationPayload(),
        temperature: 0.7,
        max_tokens: 600,
        chat_template_kwargs: {
          enable_thinking: false,
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `HTTP ${response.status}`);
    }

    const reply = data?.choices?.[0]?.message?.content?.trim() || "응답이 비어 있습니다.";
    messages[messages.length - 1] = {
      role: "assistant",
      content: reply,
    };
    renderMessages();
    saveMessages();
    setStatus(`${data.model || API_CONFIG.model} 응답 완료`);
  } catch (error) {
    messages[messages.length - 1] = {
      role: "assistant",
      content: `호출 오류: ${error.message}`,
    };
    renderMessages();
    saveMessages();
    setStatus("응답 실패");
  } finally {
    isSending = false;
    elements.sendButton.disabled = false;
  }
}

function resetConversation() {
  messages = [
    {
      role: "assistant",
      content: "새 대화를 시작했습니다. 메시지를 보내세요.",
    },
  ];
  saveMessages();
  renderMessages();
  setStatus("새 대화");
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

renderMessages();
autosizeTextarea();
checkConnection();
