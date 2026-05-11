const state = {
  sessionToken: localStorage.getItem("cv_mcp_session_token") ?? "",
  walletAddress: localStorage.getItem("cv_mcp_wallet_address") ?? ""
};

const elements = {
  connectWalletButton: document.getElementById("connectWalletButton"),
  clearSessionButton: document.getElementById("clearSessionButton"),
  walletStatus: document.getElementById("walletStatus"),
  tokenForm: document.getElementById("tokenForm"),
  tokenName: document.getElementById("tokenName"),
  tokenOutput: document.getElementById("tokenOutput"),
  tokenValue: document.getElementById("tokenValue"),
  authMessage: document.getElementById("authMessage"),
  tokenList: document.getElementById("tokenList"),
  installExample: document.getElementById("installExample")
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
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
  elements.tokenForm.addEventListener("submit", handleCreateToken);
}

async function connectWallet() {
  try {
    ensurePhantom();
    showWalletStatus("Connecting wallet...");

    const response = await window.solana.connect();
    const walletAddress = response.publicKey.toString();
    state.walletAddress = walletAddress;
    localStorage.setItem("cv_mcp_wallet_address", walletAddress);
    showWalletStatus(`Wallet connected: ${walletAddress}`);

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
    showAuthMessage("Wallet verified. You can now generate and revoke MCP tokens.");
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
    showAuthMessage(`Token "${payload.name}" created. It is visible only once.`);
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

  renderTokenList(payload.tokens ?? []);
}

async function revokeToken(id) {
  try {
    ensureSession();
    await request(`/tokens/${id}`, {
      method: "DELETE",
      token: state.sessionToken
    });
    showAuthMessage("Token revoked.");
    await loadTokens();
  } catch (error) {
    showAuthMessage(error.message, true);
  }
}

function renderTokenList(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    elements.tokenList.innerHTML = "No tokens issued for this wallet yet.";
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
          Revoke
        </button>
      </div>
      <dl>
        <div>
          <dt>ID</dt>
          <dd>${token.id}</dd>
        </div>
        <div>
          <dt>Daily limit</dt>
          <dd>${token.dailyLimit}</dd>
        </div>
        <div>
          <dt>Created at</dt>
          <dd>${formatDate(token.createdAt)}</dd>
        </div>
        <div>
          <dt>Last used at</dt>
          <dd>${formatDate(token.lastUsedAt)}</dd>
        </div>
        <div>
          <dt>Revoked at</dt>
          <dd>${formatDate(token.revokedAt)}</dd>
        </div>
      </dl>
    `;

    const revokeButton = row.querySelector("[data-revoke-id]");
    if (token.revokedAt) {
      revokeButton.disabled = true;
      revokeButton.textContent = "Revoked";
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
    showWalletStatus(`Wallet connected: ${state.walletAddress}`);
  } else {
    showWalletStatus("Wallet not connected.");
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
  elements.tokenOutput.classList.add("hidden");
  renderInstallExample();
  renderWalletStatus();
  elements.tokenList.innerHTML = "Connect your wallet to list and revoke tokens.";
  elements.tokenList.classList.add("empty-state");
  showAuthMessage("Local wallet session cleared.");
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
    throw new Error("Phantom wallet was not detected in this browser.");
  }
}

function ensureSession() {
  if (!state.sessionToken) {
    throw new Error("Connect and verify your wallet before managing tokens.");
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
