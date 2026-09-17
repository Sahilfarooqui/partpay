(function () {
  "use strict";

  const STORAGE_KEY = "partpay-plan-v1";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const form = $("#split-form");
  const planner = $("#planner");
  const planView = $("#plan-view");
  const partsList = $("#parts-list");
  const modePartsBtn = $("#mode-parts");
  const modeMaxBtn = $("#mode-max");
  const partsField = $("#parts-field");
  const maxField = $("#max-field");
  const upiInput = $("#upi-id");
  const upiHint = $("#upi-hint");
  const toastEl = $("#toast");
  const qrModal = $("#qr-modal");
  const qrBox = $("#qr-box");
  const qrSub = $("#qr-sub");

  let splitMode = "parts"; // "parts" | "max"
  let currentPlan = null;
  let toastTimer = null;

  /* ---------- Money helpers (integer paise) ---------- */

  /** Convert rupees string/number to paise (integer). */
  function toPaise(rupees) {
    const n = Number(rupees);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }

  /** Format paise as ₹X.XX (or ₹X if whole rupees). */
  function formatINR(paise) {
    const rupees = paise / 100;
    if (Number.isInteger(rupees)) {
      return "₹" + rupees.toLocaleString("en-IN");
    }
    return "₹" + rupees.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * Split totalPaise into exactly `count` parts that sum to totalPaise.
   * Base amount = floor(total/count); first (total % count) parts get +1 paise.
   */
  function splitByParts(totalPaise, count) {
    const base = Math.floor(totalPaise / count);
    const rem = totalPaise % count;
    const parts = [];
    for (let i = 0; i < count; i++) {
      parts.push(base + (i < rem ? 1 : 0));
    }
    return parts;
  }

  /**
   * Split so no part exceeds maxPaise. Last part may be smaller.
   * Number of parts = ceil(total / max).
   */
  function splitByMax(totalPaise, maxPaise) {
    if (maxPaise <= 0) return null;
    const count = Math.ceil(totalPaise / maxPaise);
    // Prefer even-ish split across those parts (still never over max)
    // Using floor division of total ensures sum exact; clamp each to max.
    // If floor would make some > max (shouldn't when count = ceil), fall back.
    const parts = splitByParts(totalPaise, count);
    if (parts.some((p) => p > maxPaise)) {
      // Safety: fill max-sized chunks then remainder
      const safe = [];
      let left = totalPaise;
      while (left > 0) {
        const chunk = Math.min(maxPaise, left);
        safe.push(chunk);
        left -= chunk;
      }
      return safe;
    }
    return parts;
  }

  function buildUpiUrl({ pa, pn, amPaise, tn }) {
    const am = (amPaise / 100).toFixed(2);
    const params = new URLSearchParams();
    params.set("pa", pa);
    if (pn) params.set("pn", pn);
    params.set("am", am);
    params.set("cu", "INR");
    if (tn) params.set("tn", tn);
    return "upi://pay?" + params.toString();
  }

  /* ---------- UI helpers ---------- */

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2200);
  }

  function setMode(mode) {
    splitMode = mode;
    const isParts = mode === "parts";
    modePartsBtn.classList.toggle("active", isParts);
    modeMaxBtn.classList.toggle("active", !isParts);
    modePartsBtn.setAttribute("aria-pressed", String(isParts));
    modeMaxBtn.setAttribute("aria-pressed", String(!isParts));
    partsField.classList.toggle("hidden", !isParts);
    maxField.classList.toggle("hidden", isParts);
  }

  function validateUpi(v) {
    const s = (v || "").trim();
    if (!s) return "UPI ID is required";
    if (!s.includes("@")) return "UPI ID must contain @";
    if (/\s/.test(s)) return "UPI ID cannot have spaces";
    return null;
  }

  function savePlan() {
    if (!currentPlan) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPlan));
  }

  function loadPlan() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function updateProgress() {
    if (!currentPlan) return;
    const total = currentPlan.parts.length;
    const done = currentPlan.parts.filter((p) => p.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    $("#progress-fill").style.width = pct + "%";
    $("#progress-bar").setAttribute("aria-valuenow", String(pct));
    $("#progress-label").textContent =
      done + " of " + total + " paid · " + formatINR(currentPlan.totalPaise) + " total";
  }

  function renderPlan() {
    if (!currentPlan) return;
    planner.classList.add("hidden");
    planView.classList.remove("hidden");

    const name = currentPlan.receiverName || currentPlan.upiId;
    $("#plan-meta").textContent =
      name + " · " + currentPlan.upiId + " · " + currentPlan.parts.length + " parts";

    partsList.innerHTML = "";
    currentPlan.parts.forEach((part, idx) => {
      const li = document.createElement("li");
      li.className = "part-card" + (part.done ? " done" : "");
      li.dataset.index = String(idx);

      const upiUrl = buildUpiUrl({
        pa: currentPlan.upiId,
        pn: currentPlan.receiverName || undefined,
        amPaise: part.paise,
        tn: partNote(idx),
      });

      li.innerHTML =
        '<div class="part-top">' +
        '<span class="part-label">Part ' + (idx + 1) + "</span>" +
        '<span class="part-amount">' + formatINR(part.paise) + "</span>" +
        "</div>" +
        '<div class="part-qr" data-upi="' + escapeAttr(upiUrl) + '" aria-label="QR for Part ' + (idx + 1) + '"></div>' +
        '<div class="part-actions">' +
        '<a class="btn btn-sm btn-upi" href="' + escapeAttr(upiUrl) + '">Pay with UPI</a>' +
        '<button type="button" class="btn btn-sm btn-secondary" data-action="copy">Copy link</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-action="qr">Show QR</button>' +
        "</div>" +
        '<label class="done-toggle">' +
        '<input type="checkbox" data-action="done"' + (part.done ? " checked" : "") + " />" +
        "<span>Mark as paid</span>" +
        "</label>";

      partsList.appendChild(li);
    });

    $$(".part-qr", partsList).forEach((el) => {
      const url = el.dataset.upi;
      if (url) makeQr(el, url, 104);
    });

    updateProgress();
  }

  function partNote(idx) {
    const base = (currentPlan.note || "Installment").trim() || "Installment";
    return base + " " + (idx + 1) + "/" + currentPlan.parts.length;
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function makeQr(el, text, size) {
    if (typeof QRCode === "undefined" || !el) return false;
    el.innerHTML = "";
    try {
      new QRCode(el, {
        text: text,
        width: size,
        height: size,
        correctLevel: QRCode.CorrectLevel.M,
        colorDark: "#1f1a17",
        colorLight: "#ffffff",
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  function showQr(upiUrl, label) {
    qrSub.textContent = label;
    qrModal.classList.remove("hidden");
    if (!makeQr(qrBox, upiUrl, 240)) {
      showToast(typeof QRCode === "undefined" ? "QR library not loaded" : "Could not generate QR");
    }
  }

  function closeQr() {
    qrModal.classList.add("hidden");
    if (qrBox) qrBox.innerHTML = "";
  }

  /* ---------- Events ---------- */

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function decidePartsFromTotal(totalPaise) {
    // Aim for ~₹1,000–₹1,500 per part (target ~₹1,500)
    return clamp(Math.round(totalPaise / 150000), 2, 50);
  }

  $("#decide-for-me").addEventListener("click", () => {
    const totalPaise = toPaise($("#total-amount").value);
    if (totalPaise === null || totalPaise < 1) {
      showToast("Enter a total amount first");
      $("#total-amount").focus();
      return;
    }
    const parts = decidePartsFromTotal(totalPaise);
    // Cap so we never exceed total paise
    const n = Math.min(parts, Math.max(2, totalPaise));
    setMode("parts");
    $("#num-parts").value = String(n);
    showToast("Suggested " + n + " parts (~" + formatINR(Math.round(totalPaise / n)) + " each)");

    const upiErr = validateUpi(upiInput.value);
    if (!upiErr && totalPaise >= 1) {
      // Auto-create plan when UPI + amount are valid
      form.requestSubmit();
    }
  });

  modePartsBtn.addEventListener("click", () => setMode("parts"));
  modeMaxBtn.addEventListener("click", () => setMode("max"));

  upiInput.addEventListener("input", () => {
    upiInput.classList.remove("invalid");
    upiHint.textContent = "Must include @ (like name@okaxis)";
    upiHint.classList.remove("error");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const upiErr = validateUpi(upiInput.value);
    if (upiErr) {
      upiInput.classList.add("invalid");
      upiHint.textContent = upiErr;
      upiHint.classList.add("error");
      upiInput.focus();
      return;
    }

    const totalPaise = toPaise($("#total-amount").value);
    if (totalPaise === null || totalPaise < 1) {
      showToast("Enter a valid total amount");
      $("#total-amount").focus();
      return;
    }

    let amounts;
    if (splitMode === "parts") {
      const n = parseInt($("#num-parts").value, 10);
      if (!Number.isInteger(n) || n < 2 || n > 50) {
        showToast("Number of parts must be 2–50");
        return;
      }
      if (n > totalPaise) {
        showToast("Too many parts for this amount");
        return;
      }
      amounts = splitByParts(totalPaise, n);
    } else {
      const maxPaise = toPaise($("#max-per-part").value);
      if (maxPaise === null || maxPaise < 1) {
        showToast("Enter a max amount per part");
        $("#max-per-part").focus();
        return;
      }
      if (maxPaise > totalPaise) {
        showToast("Max per part is larger than total — use 1 part or lower the max");
        return;
      }
      amounts = splitByMax(totalPaise, maxPaise);
      if (!amounts || amounts.length > 50) {
        showToast("That max would create too many parts (max 50). Raise the max amount.");
        return;
      }
    }

    // Sanity: exact sum
    const sum = amounts.reduce((a, b) => a + b, 0);
    if (sum !== totalPaise) {
      showToast("Split math error — please try again");
      return;
    }

    currentPlan = {
      receiverName: $("#receiver-name").value.trim(),
      upiId: upiInput.value.trim(),
      totalPaise,
      note: $("#note").value.trim(),
      mode: splitMode,
      parts: amounts.map((paise) => ({ paise, done: false })),
      createdAt: Date.now(),
    };

    savePlan();
    renderPlan();
    showToast("Plan ready — " + amounts.length + " parts");
  });

  partsList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || !currentPlan) return;
    const card = btn.closest(".part-card");
    if (!card) return;
    const idx = parseInt(card.dataset.index, 10);
    const part = currentPlan.parts[idx];
    const action = btn.dataset.action;

    const upiUrl = buildUpiUrl({
      pa: currentPlan.upiId,
      pn: currentPlan.receiverName || undefined,
      amPaise: part.paise,
      tn: partNote(idx),
    });

    if (action === "copy") {
      e.preventDefault();
      navigator.clipboard.writeText(upiUrl).then(
        () => showToast("UPI link copied"),
        () => showToast("Could not copy — long-press the Pay button")
      );
    } else if (action === "qr") {
      e.preventDefault();
      showQr(upiUrl, "Part " + (idx + 1) + " · " + formatINR(part.paise));
    } else if (action === "done") {
      // handled by change
    }
  });

  partsList.addEventListener("change", (e) => {
    const input = e.target;
    if (input.dataset.action !== "done" || !currentPlan) return;
    const card = input.closest(".part-card");
    const idx = parseInt(card.dataset.index, 10);
    currentPlan.parts[idx].done = input.checked;
    card.classList.toggle("done", input.checked);
    savePlan();
    updateProgress();
  });

  $("#edit-plan").addEventListener("click", () => {
    if (!currentPlan) return;
    $("#receiver-name").value = currentPlan.receiverName || "";
    upiInput.value = currentPlan.upiId;
    $("#total-amount").value = (currentPlan.totalPaise / 100).toString();
    $("#note").value = currentPlan.note || "";
    setMode(currentPlan.mode || "parts");
    if (currentPlan.mode === "max") {
      const max = Math.max(...currentPlan.parts.map((p) => p.paise));
      $("#max-per-part").value = (max / 100).toString();
    } else {
      $("#num-parts").value = String(currentPlan.parts.length);
    }
    planView.classList.add("hidden");
    planner.classList.remove("hidden");
  });

  $("#reset-done").addEventListener("click", () => {
    if (!currentPlan) return;
    currentPlan.parts.forEach((p) => { p.done = false; });
    savePlan();
    renderPlan();
    showToast("Cleared paid marks");
  });

  $("#new-plan").addEventListener("click", () => {
    if (!confirm("Start over? Your current plan will be cleared.")) return;
    currentPlan = null;
    savePlan();
    form.reset();
    $("#num-parts").value = "3";
    setMode("parts");
    planView.classList.add("hidden");
    planner.classList.remove("hidden");
  });

  $$("[data-close]", qrModal).forEach((el) => {
    el.addEventListener("click", closeQr);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeQr();
  });

  /* ---------- PWA ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  /* ---------- Boot ---------- */
  setMode("parts");
  const saved = loadPlan();
  if (saved && saved.parts && saved.parts.length) {
    currentPlan = saved;
    renderPlan();
  }
})();
