(async function () {
  const passwordEl = document.getElementById("password");
  const loginBtn = document.getElementById("loginBtn");
  const msgEl = document.getElementById("msg");
  const resetLink = document.getElementById("resetLink");

  function setMsg(text, ok = false) {
    msgEl.textContent = text || "";
    msgEl.className = "msg" + (ok ? " ok" : "");
  }

  async function login() {
    setMsg("");
    const password = passwordEl.value || "";

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      setMsg(data.error || "Nepodarilo sa prihlásiť.");
      return;
    }

    setMsg("✅ Prihlásené.", true);
    // sem si dáme cieľovú admin stránku
    window.location.href = "admin_index.html";
  }

  async function requestReset() {
    setMsg("");
    const res = await fetch("/api/auth/request-reset", { method: "POST" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      setMsg(data.error || "Nepodarilo sa vytvoriť reset link.");
      return;
    }

    setMsg("Reset link vytvorený. Pozri konzolu servera.", true);
  }

  loginBtn.addEventListener("click", login);
  passwordEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });

  resetLink.addEventListener("click", (e) => {
    e.preventDefault();
    requestReset();
  });

  // ak už si prihlásený, preskoč login
  const me = await fetch("/api/auth/me").then(r => r.json()).catch(() => null);
  if (me && me.admin) window.location.href = "admin_index.html";
})();