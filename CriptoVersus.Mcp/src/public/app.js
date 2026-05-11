const state = {
  sessionToken: localStorage.getItem("cv_mcp_session_token") ?? "",
  walletAddress: localStorage.getItem("cv_mcp_wallet_address") ?? "",
  language: resolveInitialLanguage(),
  tokenList: []
};

const elements = {
  connectWalletButton: document.getElementById("connectWalletButton"),
  clearSessionButton: document.getElementById("clearSessionButton"),
  langPtButton: document.getElementById("langPtButton"),
  langEnButton: document.getElementById("langEnButton"),
  walletStatus: document.getElementById("walletStatus"),
  tokenForm: document.getElementById("tokenForm"),
  tokenName: document.getElementById("tokenName"),
  tokenOutput: document.getElementById("tokenOutput"),
  tokenValue: document.getElementById("tokenValue"),
  copyTokenButton: document.getElementById("copyTokenButton"),
  authMessage: document.getElementById("authMessage"),
  tokenList: document.getElementById("tokenList"),
  installExample: document.getElementById("installExample")
};

const translations = {
  en: {
    pageTitle: "CriptoVersus MCP",
    developerAccess: "Developer Access",
    title: "CriptoVersus MCP",
    subtitle: "Connect AI agents to live crypto battles, rankings and match statistics.",
    description:
      "Authenticate with your Solana wallet, generate a personal Bearer Token, and plug it into Claude, Cursor or OpenHands without exposing any private key.",
    connectWallet: "Connect Phantom Wallet",
    disconnectWallet: "Disconnect Wallet",
    walletNotConnected: "Wallet not connected.",
    tools: "Tools",
    features: "Features",
    authentication: "Authentication",
    generateToken: "Generate MCP Token",
    authDescription:
      "Connect your Solana wallet and generate a Bearer Token for your AI agent. Tokens are hashed server-side and shown only once.",
    tokenName: "Token name",
    tokenPlaceholder: "Claude Desktop",
    newToken: "New token",
    copyToken: "Copy token",
    copyTokenNote: "Copy and store this token now. It will not be shown again.",
    authMessageIdle: "You need an active wallet session before creating or revoking tokens.",
    install: "Install",
    configurationExample: "Configuration Example",
    tokens: "Tokens",
    yourIssuedTokens: "Your Issued Tokens",
    connectWalletToManageTokens: "Connect your wallet to list and revoke tokens.",
    securityNotes: "Security notes",
    mcpEndpoint: "MCP Endpoint",
    endpointDescription: "Streamable HTTP endpoint: <code>/mcp</code><br />Health check: <code>/health</code>",
    securityDescription:
      "This developer access flow stays read-only. No balances, positions, custody, ledger entries or financial actions are exposed here.",
    walletConnecting: "Connecting wallet...",
    walletConnected: "Wallet connected: {wallet}",
    walletVerified: "Wallet verified. You can now generate and revoke MCP tokens.",
    tokenCreated: 'Token "{name}" created. It is visible only once.',
    tokenRevoked: "Token revoked.",
    localSessionCleared: "Local wallet session cleared.",
    noTokensYet: "No tokens issued for this wallet yet.",
    phantomMissing: "Phantom wallet was not detected in this browser.",
    sessionRequired: "Connect and verify your wallet before managing tokens.",
    copyTokenSuccess: "Token copied to clipboard.",
    copyTokenError: "Unable to copy the token automatically.",
    revokeToken: "Revoke",
    revokedToken: "Revoked",
    tokenId: "ID",
    dailyLimit: "Daily limit",
    createdAt: "Created at",
    lastUsedAt: "Last used at",
    revokedAt: "Revoked at"
  },
  pt: {
    pageTitle: "CriptoVersus MCP",
    developerAccess: "Acesso para desenvolvedores",
    title: "CriptoVersus MCP",
    subtitle: "Conecte agentes de IA a batalhas cripto ao vivo, rankings e estatisticas de partidas.",
    description:
      "Autentique com sua carteira Solana, gere um Bearer Token pessoal e conecte ao Claude, Cursor ou OpenHands sem expor nenhuma chave privada.",
    connectWallet: "Conectar Phantom",
    disconnectWallet: "Desconectar carteira",
    walletNotConnected: "Carteira nao conectada.",
    tools: "Ferramentas",
    features: "Recursos",
    authentication: "Autenticacao",
    generateToken: "Gerar token MCP",
    authDescription:
      "Conecte sua carteira Solana e gere um Bearer Token para seu agente de IA. Os tokens sao armazenados com hash no servidor e exibidos apenas uma vez.",
    tokenName: "Nome do token",
    tokenPlaceholder: "Claude Desktop",
    newToken: "Novo token",
    copyToken: "Copiar token",
    copyTokenNote: "Copie e guarde este token agora. Ele nao sera exibido novamente.",
    authMessageIdle: "Voce precisa de uma sessao ativa da carteira antes de criar ou revogar tokens.",
    install: "Instalacao",
    configurationExample: "Exemplo de configuracao",
    tokens: "Tokens",
    yourIssuedTokens: "Seus tokens emitidos",
    connectWalletToManageTokens: "Conecte sua carteira para listar e revogar tokens.",
    securityNotes: "Notas de seguranca",
    mcpEndpoint: "Endpoint MCP",
    endpointDescription: "Endpoint Streamable HTTP: <code>/mcp</code><br />Health check: <code>/health</code>",
    securityDescription:
      "Este fluxo de acesso para desenvolvedores continua somente leitura. Nenhum saldo, posicao, custody, ledger ou acao financeira e exposta aqui.",
    walletConnecting: "Conectando carteira...",
    walletConnected: "Carteira conectada: {wallet}",
    walletVerified: "Carteira verificada. Agora voce pode gerar e revogar tokens MCP.",
    tokenCreated: 'Token "{name}" criado. Ele e exibido apenas uma vez.',
    tokenRevoked: "Token revogado.",
    localSessionCleared: "Sessao local da carteira removida.",
    noTokensYet: "Nenhum token emitido para esta carteira ainda.",
    phantomMissing: "A carteira Phantom nao foi detectada neste navegador.",
    sessionRequired: "Conecte e verifique sua carteira antes de gerenciar tokens.",
    copyTokenSuccess: "Token copiado para a area de transferencia.",
    copyTokenError: "Nao foi possivel copiar o token automaticamente.",
    revokeToken: "Revogar",
    revokedToken: "Revogado",
    tokenId: "ID",
    dailyLimit: "Limite diario",
    createdAt: "Criado em",
    lastUsedAt: "Ultimo uso em",
    revokedAt: "Revogado em"
  }
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  applyTranslations();
  renderInstallExample();
  renderWalletStatus();

  if (state.sessionToken) {
    loadTokens().catch((error) => {
      showAuthMessage(error.message, true);
    });
  }
});

function bindEvents() {
  elements.connectWalletButton.addEventListener("click", connectWallet);
  elements.clearSessionButton.addEventListener("click", clearSession);
  elements.langPtButton.addEventListener("click", () => setLanguage("pt"));
  elements.langEnButton.addEventListener("click", () => setLanguage("en"));
  elements.tokenForm.addEventListener("submit", handleCreateToken);
  elements.copyTokenButton.addEventListener("click", copyTokenToClipboard);
}

async function connectWallet() {
  try {
    ensurePhantom();
    showWalletStatus(t("walletConnecting"));

    const response = await window.solana.connect();
    const walletAddress = response.publicKey.toString();
    state.walletAddress = walletAddress;
    localStorage.setItem("cv_mcp_wallet_address", walletAddress);
    showWalletStatus(t("walletConnected", { wallet: walletAddress }));

    const challenge = await request("/auth/challenge", {
      method: "POST",
      body: { walletAddress }
    });

    const messageBytes = new TextEncoder().encode(challenge.message);
    const signed = await window.solana.signMessage(messageBytes, "utf8");
    const signatureBase58 = base58Encode(signed.signature);

    const verified = await request("/auth/verify", {
      method: "POST",
      body: {
        walletAddress,
        message: challenge.message,
        signature: signatureBase58
      }
    });

    state.sessionToken = verified.sessionToken;
    localStorage.setItem("cv_mcp_session_token", state.sessionToken);
    showAuthMessage(t("walletVerified"));
    await loadTokens();
  } catch (error) {
    showWalletStatus(error.message, true);
  }
}

async function handleCreateToken(event) {
  event.preventDefault();

  try {
    ensureSession();
    const payload = await request("/tokens", {
      method: "POST",
      token: state.sessionToken,
      body: {
        name: elements.tokenName.value
      }
    });

    elements.tokenValue.textContent = payload.token;
    elements.tokenOutput.classList.remove("hidden");
    renderInstallExample(payload.token);
    showAuthMessage(t("tokenCreated", { name: payload.name }));
    elements.tokenForm.reset();
    await loadTokens();
  } catch (error) {
    showAuthMessage(error.message, true);
  }
}

async function loadTokens() {
  ensureSession();

  const payload = await request("/tokens", {
    method: "GET",
    token: state.sessionToken
  });

  if (payload.walletAddress) {
    state.walletAddress = payload.walletAddress;
    localStorage.setItem("cv_mcp_wallet_address", payload.walletAddress);
    renderWalletStatus();
  }

  state.tokenList = payload.tokens ?? [];
  renderTokenList(state.tokenList);
}

async function revokeToken(id) {
  try {
    ensureSession();
    await request(`/tokens/${id}`, {
      method: "DELETE",
      token: state.sessionToken
    });
    showAuthMessage(t("tokenRevoked"));
    await loadTokens();
  } catch (error) {
    showAuthMessage(error.message, true);
  }
}

function renderTokenList(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    elements.tokenList.innerHTML = t("noTokensYet");
    elements.tokenList.classList.add("empty-state");
    return;
  }

  elements.tokenList.classList.remove("empty-state");
  elements.tokenList.innerHTML = "";

  for (const token of tokens) {
    const row = document.createElement("article");
    row.className = "token-row";
    row.innerHTML = `
      <div class="token-row__head">
        <strong>${escapeHtml(token.name)}</strong>
        <button class="button button--danger" type="button" data-revoke-id="${token.id}">
          ${t("revokeToken")}
        </button>
      </div>
      <dl>
        <div>
          <dt>${t("tokenId")}</dt>
          <dd>${token.id}</dd>
        </div>
        <div>
          <dt>${t("dailyLimit")}</dt>
          <dd>${token.dailyLimit}</dd>
        </div>
        <div>
          <dt>${t("createdAt")}</dt>
          <dd>${formatDate(token.createdAt)}</dd>
        </div>
        <div>
          <dt>${t("lastUsedAt")}</dt>
          <dd>${formatDate(token.lastUsedAt)}</dd>
        </div>
        <div>
          <dt>${t("revokedAt")}</dt>
          <dd>${formatDate(token.revokedAt)}</dd>
        </div>
      </dl>
    `;

    const revokeButton = row.querySelector("[data-revoke-id]");
    if (token.revokedAt) {
      revokeButton.disabled = true;
      revokeButton.textContent = t("revokedToken");
    } else {
      revokeButton.addEventListener("click", () => revokeToken(token.id));
    }

    elements.tokenList.appendChild(row);
  }
}

function renderInstallExample(token = "YOUR_TOKEN") {
  const config = {
    mcpServers: {
      criptoversus: {
        transport: {
          type: "streamable-http",
          url: `${window.location.origin}/mcp`,
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      }
    }
  };

  elements.installExample.textContent = JSON.stringify(config, null, 2);
}

function renderWalletStatus() {
  if (state.walletAddress) {
    showWalletStatus(t("walletConnected", { wallet: state.walletAddress }));
  } else {
    showWalletStatus(t("walletNotConnected"));
  }
}

function showWalletStatus(message, isError = false) {
  elements.walletStatus.textContent = message;
  elements.walletStatus.style.color = isError ? "var(--danger)" : "var(--blue)";
}

function showAuthMessage(message, isError = false) {
  elements.authMessage.textContent = message;
  elements.authMessage.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function clearSession() {
  localStorage.removeItem("cv_mcp_session_token");
  localStorage.removeItem("cv_mcp_wallet_address");
  state.sessionToken = "";
  state.walletAddress = "";
  state.tokenList = [];
  elements.tokenOutput.classList.add("hidden");
  renderInstallExample();
  renderWalletStatus();
  elements.tokenList.innerHTML = t("connectWalletToManageTokens");
  elements.tokenList.classList.add("empty-state");
  showAuthMessage(t("localSessionCleared"));
}

async function request(url, options) {
  const headers = {
    Accept: "application/json"
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

function ensurePhantom() {
  if (!window.solana?.isPhantom) {
    throw new Error(t("phantomMissing"));
  }
}

function ensureSession() {
  if (!state.sessionToken) {
    throw new Error(t("sessionRequired"));
  }
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function base58Encode(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (input.length === 0) {
    return "";
  }

  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];

  for (let i = 0; i < input.length; i += 1) {
    let carry = input[i];

    for (let j = 0; j < digits.length; j += 1) {
      const value = digits[j] * 256 + carry;
      digits[j] = value % 58;
      carry = Math.floor(value / 58);
    }

    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let output = "";
  for (let i = 0; i < input.length && input[i] === 0; i += 1) {
    output += alphabet[0];
  }

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    output += alphabet[digits[i]];
  }

  return output;
}

async function copyTokenToClipboard() {
  try {
    if (!elements.tokenValue.textContent) {
      return;
    }

    await navigator.clipboard.writeText(elements.tokenValue.textContent);
    showAuthMessage(t("copyTokenSuccess"));
  } catch {
    showAuthMessage(t("copyTokenError"), true);
  }
}

function setLanguage(language) {
  state.language = language === "pt" ? "pt" : "en";
  localStorage.setItem("cv_mcp_language", state.language);
  applyTranslations();
  renderInstallExample(elements.tokenValue.textContent || "YOUR_TOKEN");
  renderWalletStatus();
  renderTokenList(state.tokenList);
}

function applyTranslations() {
  const locale = translations[state.language] ?? translations.en;
  document.documentElement.lang = state.language;
  document.title = locale.pageTitle;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (!key || !(key in locale)) {
      return;
    }

    element.innerHTML = locale[key];
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.getAttribute("data-i18n-placeholder");
    if (!key || !(key in locale)) {
      return;
    }

    element.setAttribute("placeholder", locale[key]);
  });

  elements.langPtButton.classList.toggle("is-active", state.language === "pt");
  elements.langEnButton.classList.toggle("is-active", state.language === "en");
  elements.langPtButton.setAttribute("aria-pressed", state.language === "pt" ? "true" : "false");
  elements.langEnButton.setAttribute("aria-pressed", state.language === "en" ? "true" : "false");
}

function resolveInitialLanguage() {
  const saved = localStorage.getItem("cv_mcp_language");
  if (saved === "pt" || saved === "en") {
    return saved;
  }

  return navigator.language?.toLowerCase().startsWith("pt") ? "pt" : "en";
}

function t(key, replacements = {}) {
  const locale = translations[state.language] ?? translations.en;
  const template = locale[key] ?? translations.en[key] ?? key;

  return Object.entries(replacements).reduce(
    (result, [replacementKey, replacementValue]) =>
      result.replaceAll(`{${replacementKey}}`, String(replacementValue)),
    template
  );
}
