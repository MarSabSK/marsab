(async function () {
  // 1) bezpečnostná kontrola: ak nie si admin, pošli späť na login
  const me = await fetch("/api/auth/me", { credentials: "include" })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  if (!me || !me.admin) {
    window.location.href = "admin_login.html";
    return;
  }

  // 2) UI helpers
  const $ = (id) => document.getElementById(id);

  const toastOk = $("toastOk");
  const toastErr = $("toastErr");
  const toastOk2 = $("toastOk2");
  const toastErr2 = $("toastErr2");

  function showToast(el, msg, isErr = false) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    if (isErr) el.classList.add("err");
    else el.classList.remove("err");
    setTimeout(() => { el.style.display = "none"; }, 3500);
  }

  // 3) tabs
  const tabDocs = $("tabDocs");
  const tabSettings = $("tabSettings");
  const viewDocs = $("viewDocs");
  const viewSettings = $("viewSettings");

  tabDocs.addEventListener("click", () => {
    tabDocs.classList.add("active");
    tabSettings.classList.remove("active");
    viewDocs.style.display = "block";
    viewSettings.style.display = "none";
  });

  tabSettings.addEventListener("click", () => {
    tabSettings.classList.add("active");
    tabDocs.classList.remove("active");
    viewDocs.style.display = "none";
    viewSettings.style.display = "block";
  });

  // 4) month/year select
  const monthSelect = $("monthSelect");
  const yearSelect = $("yearSelect");

  const now = new Date();
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
  const currentYear = String(now.getFullYear());

  const months = [
    ["01", "01"], ["02", "02"], ["03", "03"], ["04", "04"], ["05", "05"], ["06", "06"],
    ["07", "07"], ["08", "08"], ["09", "09"], ["10", "10"], ["11", "11"], ["12", "12"],
  ];

  months.forEach(([val, label]) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    monthSelect.appendChild(opt);
  });

  // roky: min (2024) až +2 dopredu
  const startYear = Math.max(2024, now.getFullYear() - 1);
  const endYear = now.getFullYear() + 2;
  for (let y = startYear; y <= endYear; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }

  monthSelect.value = currentMonth;
  yearSelect.value = currentYear;

  // 5) settings load/save
  const accountantEmail = $("accountantEmail");
  const emailTemplate = $("emailTemplate");
  const saveSettingsBtn = $("saveSettingsBtn");

  async function loadSettings() {
    const data = await fetch("/api/admin/settings", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);

    if (!data) return;

    accountantEmail.value = data.accountantEmail || "";
    emailTemplate.value = data.emailTemplate || "Dobrý deň,\n\nv prílohe Vám posielam mesačné doklady.\n\nĎakujem.";
    updateSendHint();
  }

  async function saveSettings() {
    const payload = {
      accountantEmail: (accountantEmail.value || "").trim(),
      emailTemplate: (emailTemplate.value || "").trim(),
    };

    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (!res || !res.ok) {
      showToast(toastErr2, "Nepodarilo sa uložiť nastavenia.", true);
      return;
    }

    showToast(toastOk2, "Nastavenia uložené.");
    updateSendHint();
  }

  saveSettingsBtn.addEventListener("click", saveSettings);

  // 6) docs list
  const docsList = $("docsList");
  const listMeta = $("listMeta");
  const refreshBtn = $("refreshBtn");

  async function loadDocs() {
    const month = monthSelect.value;
    const year = yearSelect.value;

    listMeta.textContent = `Načítavam doklady pre ${month}/${year}…`;
    docsList.innerHTML = "";

    const data = await fetch(`/api/admin/docs?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`, {
      credentials: "include"
    })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);

    if (!data) {
      listMeta.textContent = `Nepodarilo sa načítať doklady.`;
      return;
    }

    const items = Array.isArray(data.items) ? data.items : [];
    listMeta.textContent = `Doklady pre ${month}/${year}: ${items.length} ks`;

    if (items.length === 0) {
      docsList.innerHTML = `<div class="item"><div class="item-left">
        <div class="item-title">Zatiaľ nič</div>
        <div class="item-meta">Pridaj prvé PDF hore cez formulár.</div>
      </div><span class="badge soft">—</span></div>`;
      return;
    }

    docsList.innerHTML = "";
    for (const it of items) {
      const wrap = document.createElement("div");
      wrap.className = "item";

      const left = document.createElement("div");
      left.className = "item-left";

      const title = document.createElement("div");
      title.className = "item-title";
      title.textContent = it.title || it.originalName || "Doklad";

      const meta = document.createElement("div");
      meta.className = "item-meta";
      const note = it.note ? ` • Pozn.: ${it.note}` : "";
      const when = it.createdAt ? ` • ${new Date(it.createdAt).toLocaleString("sk-SK")}` : "";
      meta.textContent = `${month}/${year}${when}${note}`;

      left.appendChild(title);
      left.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "item-actions";

      const btnDl = document.createElement("button");
      btnDl.className = "btn";
      btnDl.type = "button";
      btnDl.textContent = "Stiahnuť";
      btnDl.addEventListener("click", () => {
        // server bude vracať file
        window.open(`/api/admin/docs/${encodeURIComponent(it.id)}/download`, "_blank");
      });

      const btnDel = document.createElement("button");
      btnDel.className = "btn danger";
      btnDel.type = "button";
      btnDel.textContent = "Vymazať";
      btnDel.addEventListener("click", async () => {
        if (!confirm("Naozaj vymazať tento doklad?")) return;

        const res = await fetch(`/api/admin/docs/${encodeURIComponent(it.id)}`, {
          method: "DELETE",
          credentials: "include",
        }).catch(() => null);

        if (!res || !res.ok) {
          showToast(toastErr, "Nepodarilo sa vymazať doklad.", true);
          return;
        }
        showToast(toastOk, "Doklad vymazaný.");
        loadDocs();
      });

      actions.appendChild(btnDl);
      actions.appendChild(btnDel);

      wrap.appendChild(left);
      wrap.appendChild(actions);
      docsList.appendChild(wrap);
    }
  }

  refreshBtn.addEventListener("click", loadDocs);
  monthSelect.addEventListener("change", loadDocs);
  yearSelect.addEventListener("change", loadDocs);

  // 7) upload
  const uploadBtn = $("uploadBtn");
  const titleInput = $("titleInput");
  const noteInput = $("noteInput");
  const fileInput = $("fileInput");

  async function uploadDoc() {
    const month = monthSelect.value;
    const year = yearSelect.value;

    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      showToast(toastErr, "Vyber PDF súbor.", true);
      return;
      }
    const allowedTypes = [
      "application/pdf",
      "application/vnd.ms-excel", // .xls
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/msword", // .doc
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
      "text/csv"
    ];

if (!allowedTypes.includes(file.type)) {
  showToast(toastErr, "Povolené sú iba PDF, XLS, XLSX, DOC, DOCX alebo CSV.", true);
  return;
}

    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", (titleInput.value || "").trim());
    fd.append("note", (noteInput.value || "").trim());
    fd.append("month", month);
    fd.append("year", year);

    uploadBtn.disabled = true;
    uploadBtn.textContent = "Ukladám…";

    const res = await fetch("/api/admin/docs", {
      method: "POST",
      credentials: "include",
      body: fd,
    }).catch(() => null);

    uploadBtn.disabled = false;
    uploadBtn.textContent = "Uložiť dokument";

    if (!res || !res.ok) {
      showToast(toastErr, "Upload zlyhal (backend ešte doplníme / alebo chyba servera).", true);
      return;
    }

    titleInput.value = "";
    noteInput.value = "";
    fileInput.value = "";

    showToast(toastOk, "Dokument uložený.");
    loadDocs();
  }

  uploadBtn.addEventListener("click", uploadDoc);

  // 8) send month
  const sendMonthBtn = $("sendMonthBtn");
  const sendHint = $("sendHint");

  function updateSendHint() {
    const email = (accountantEmail.value || "").trim();
    if (!email) {
      sendHint.textContent = "Najprv nastav e-mail účtovníčky v Nastaveniach.";
      sendMonthBtn.disabled = true;
      return;
    }
    sendHint.textContent = `Odosiela sa na: ${email}`;
    sendMonthBtn.disabled = false;
  }

  accountantEmail.addEventListener("input", updateSendHint);

  async function sendMonth() {
    const month = monthSelect.value;
    const year = yearSelect.value;

    sendMonthBtn.disabled = true;
    sendMonthBtn.textContent = "Odosielam…";

    const res = await fetch("/api/admin/send-month", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ month, year }),
    }).catch(() => null);

    sendMonthBtn.textContent = "Odoslať mesiac účtovníčke";
    updateSendHint();

    if (!res || !res.ok) {
      showToast(toastErr, "Odoslanie zlyhalo (backend doplníme v ďalšom kroku).", true);
      return;
    }

    showToast(toastOk, `Odoslané: ${month}/${year}`);
  }

  sendMonthBtn.addEventListener("click", sendMonth);

  // 9) logout
  const logoutBtn = $("logoutBtn");
  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => null);
    window.location.href = "admin_login.html";
  });

  // init
  await loadSettings();
  updateSendHint();
  await loadDocs();
})();