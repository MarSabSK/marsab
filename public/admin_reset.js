(function () {
  const msgEl = document.getElementById("msg");
  const passEl = document.getElementById("newPassword");
  const saveBtn = document.getElementById("saveBtn");

  function setMsg(text, ok = false) {
    msgEl.textContent = text || "";
    msgEl.className = "msg" + (ok ? " ok" : "");
  }

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (!token) {
    setMsg("Chýba token v linku.");
    saveBtn.disabled = true;
    return;
  }

  async function save() {
    setMsg("");

    const newPassword = passEl.value || "";
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setMsg(data.error || "Nepodarilo sa nastaviť heslo.");
      return;
    }

    setMsg("✅ Heslo zmenené. Môžeš sa prihlásiť.", true);
    setTimeout(() => (window.location.href = "admin_login.html"), 800);
  }

  saveBtn.addEventListener("click", save);
  passEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
  });
})();