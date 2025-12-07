<!-- INPUT CHECK CONSOLE – v1.4 live engine -->
<meta name="sge:summary" content="Input Check cleans messy questions into a clear query, answer capsule, mini answer, and next best question using a fixed JSON contract.">

<link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet">

<style>
  .ic-page {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text",
      "Segoe UI", sans-serif;
    background: #f5f7fb;
    min-height: 100vh;
  }
  .ic-hero-wrap {
    padding: 72px 24px 32px;
    display: flex;
    justify-content: center;
  }
  .ic-hero {
    max-width: 960px;
    width: 100%;
    text-align: center;
  }
  .ic-brand-row {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-bottom: 10px;
  }
  .ic-brand-icon {
    width: 56px;
    height: 56px;
    border-radius: 18px;
    background: #2563ff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 16px 40px rgba(37, 99, 255, 0.55);
  }
  .ic-brand-icon svg {
    width: 24px;
    height: 24px;
    color: #ffffff;
  }
  .ic-brand-text {
    font-family: "Anton", system-ui, -apple-system, BlinkMacSystemFont,
      "SF Pro Text", "Segoe UI", sans-serif;
    font-weight: 400;
    font-size: clamp(2.4rem, 3.4vw, 2.9rem);
    letter-spacing: 0.03em;
    color: #111827;
    line-height: 1;
  }
  .ic-tagline {
    margin: 0 0 30px;
    font-family: "Anton", system-ui, -apple-system, BlinkMacSystemFont,
      "SF Pro Text", "Segoe UI", sans-serif;
    font-weight: 400;
    font-size: clamp(1.1rem, 1.9vw, 1.3rem);
    letter-spacing: 0.05em;
    color: #4b5563;
  }
  .ic-search-shell {
    margin: 0 auto 16px;
    width: 100%;
    max-width: 960px;
    background: #ffffff;
    border-radius: 9999px;
    box-shadow:
      0 20px 70px rgba(15, 23, 42, 0.18),
      0 0 0 1px rgba(148, 163, 184, 0.3);
    padding: 14px 18px 14px 30px;
    display: flex;
    align-items: center;
    gap: 16px;
    box-sizing: border-box;
  }
  .ic-search-input {
    border: none;
    outline: none;
    flex: 1;
    font-size: 1.05rem;
    color: #111827;
    background: transparent;
  }
  .ic-search-input::placeholder {
    color: #9ca3af;
  }
  .ic-search-button {
    border: none;
    outline: none;
    cursor: pointer;
    width: 50px;
    height: 50px;
    border-radius: 9999px;
    background: #2563ff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 12px 32px rgba(37, 99, 255, 0.55);
    flex-shrink: 0;
    transition: transform 0.14s ease-out, box-shadow 0.14s ease-out,
      background 0.14s ease-out;
  }
  .ic-search-button svg {
    width: 22px;
    height: 22px;
    color: #ffffff;
  }
  .ic-search-button:hover {
    transform: translateY(-1px);
    background: #1d4ed8;
    box-shadow: 0 18px 46px rgba(37, 99, 255, 0.75);
  }
  .ic-subline {
    font-size: 0.95rem;
    color: #4b5563;
    margin-top: 8px;
  }
  @media (max-width: 640px) {
    .ic-hero-wrap {
      padding: 52px 16px 24px;
    }
    .ic-search-shell {
      padding: 12px 14px 12px 22px;
      border-radius: 26px;
    }
    .ic-search-button {
      width: 46px;
      height: 46px;
    }
  }

  /* RESULTS AREA */
  .ic-results-wrap {
    display: none;
    justify-content: center;
    padding: 0 24px 72px;
  }
  .ic-results-wrap.visible {
    display: flex;
  }
  .ic-results {
    max-width: 960px;
    width: 100%;
  }
  .ic-card {
    border-radius: 24px;
    background: #ffffff;
    box-shadow:
      0 18px 60px rgba(15, 23, 42, 0.12),
      0 0 0 1px rgba(148, 163, 184, 0.25);
    padding: 24px 24px 28px;
    box-sizing: border-box;
    color: #0f172a;
  }
  .ic-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
  }
  .ic-card-title {
    font-size: 0.9rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #64748b;
  }
  .ic-meta-line {
    font-size: 0.8rem;
    color: #6b7280;
    margin-top: 2px;
  }
  .ic-score-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .ic-score-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #22c55e;
  }
  .ic-section {
    margin-bottom: 18px;
  }
  .ic-section:last-child {
    margin-bottom: 0;
  }
  .ic-section-label {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9ca3af;
    margin-bottom: 6px;
  }
  .ic-section-body {
    font-size: 0.95rem;
    line-height: 1.55;
    color: #111827;
  }
  .ic-raw-clean-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  .ic-bubble {
    padding: 10px 12px;
    border-radius: 12px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    font-size: 0.9rem;
    color: #111827;
  }
  .ic-bubble-title {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9ca3af;
    margin-bottom: 4px;
  }
  .ic-flag-pill {
    display: inline-flex;
    align-items: center;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 0.72rem;
    background: #fef3c7;
    color: #92400e;
    margin-right: 6px;
    margin-top: 4px;
  }
  .ic-two-col {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .ic-list {
    padding-left: 18px;
    margin: 6px 0 0;
  }
  .ic-list li {
    margin-bottom: 4px;
  }
  .ic-owned {
    padding: 10px 12px;
    border-radius: 12px;
    background: #ecfdf3;
    border: 1px solid #bbf7d0;
    font-size: 0.9rem;
  }
  .ic-copy-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
  }
  .ic-btn {
    border: none;
    outline: none;
    cursor: pointer;
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 0.82rem;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ic-btn-primary {
    background: #2563ff;
    color: #ffffff;
    box-shadow: 0 10px 24px rgba(37, 99, 255, 0.55);
  }
  .ic-btn-ghost {
    background: rgba(15, 23, 42, 0.02);
    color: #111827;
    border: 1px solid #e5e7eb;
  }
  .ic-copy-status {
    font-size: 0.8rem;
    color: #22c55e;
    margin-left: 4px;
  }
  .ic-json-block {
    margin-top: 14px;
    display: none;
  }
  .ic-json-block.visible {
    display: block;
  }
  .ic-json-pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
      "Liberation Mono", "Courier New", monospace;
    font-size: 0.82rem;
    background: #020617;
    color: #e5e7eb;
    padding: 12px;
    border-radius: 12px;
    max-height: 320px;
    overflow: auto;
  }
  @media (max-width: 768px) {
    .ic-raw-clean-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .ic-two-col {
      grid-template-columns: minmax(0, 1fr);
    }
    .ic-card {
      padding: 18px 16px 22px;
    }
  }
</style>

<div class="ic-page">
  <section class="ic-hero-wrap">
    <div class="ic-hero">
      <div class="ic-brand-row">
        <div class="ic-brand-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.5 5.75 9.75 15.5l-5.25-5.25 1.5-1.5 3.75 3.75 8.25-8.25z"
            />
          </svg>
        </div>
        <div class="ic-brand-text">Input Check</div>
      </div>
      <p class="ic-tagline">Ask big questions. Get capsule-ready answers.</p>

      <div class="ic-search-shell">
        <input
          class="ic-search-input"
          type="text"
          id="ic-input"
          placeholder="pay off 18% credit card debt or invest extra cash"
          autocomplete="off"
        />
        <button class="ic-search-button" type="button" id="ic-run-btn" aria-label="Run Input Check">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79L19 20.49 20.49 19 15.5 14zm-6 0C8.01 14 6 11.99 6 9.5S8.01 5 10.5 5 15 7.01 15 9.5 12.99 14 10.5 14z"
            />
          </svg>
        </button>
      </div>

      <p class="ic-subline">
        Live engine using the v1.4 JSON contract from inputcheck-api.vercel.app.
      </p>
    </div>
  </section>

  <section class="ic-results-wrap" id="ic-results-wrap">
    <div class="ic-results">
      <div class="ic-card">
        <div class="ic-card-header">
          <div>
            <div class="ic-card-title">Capsule engine result</div>
            <div class="ic-meta-line" id="ic-meta-line"></div>
          </div>
          <div class="ic-score-pill" id="ic-score-pill">
            <span class="ic-score-dot"></span>
            <span id="ic-score-text">Engine ready</span>
          </div>
        </div>

        <!-- Question & cleaning -->
        <div class="ic-section">
          <div class="ic-section-label">Question & cleaning</div>
          <div class="ic-raw-clean-grid">
            <div class="ic-bubble">
              <div class="ic-bubble-title">Raw input</div>
              <div id="ic-raw-text"></div>
            </div>
            <div class="ic-bubble">
              <div class="ic-bubble-title">Cleaned question</div>
              <div id="ic-cleaned-text"></div>
            </div>
            <div class="ic-bubble">
              <div class="ic-bubble-title">Google-style query</div>
              <div id="ic-canonical-text"></div>
            </div>
          </div>
        </div>

        <!-- Capsule + mini + next best -->
        <div class="ic-section">
          <div class="ic-section-label">Answer capsule (~25 words)</div>
          <div class="ic-section-body" id="ic-capsule-text"></div>
        </div>

        <div class="ic-section">
          <div class="ic-section-label">Mini answer</div>
          <div class="ic-section-body" id="ic-mini-answer"></div>
        </div>

        <div class="ic-section">
          <div class="ic-section-label">Next best question</div>
          <div class="ic-section-body" id="ic-nbq"></div>
        </div>

        <!-- Input health & routing -->
        <div class="ic-section">
          <div class="ic-section-label">Input health & routing</div>
          <div class="ic-two-col">
            <div class="ic-bubble">
              <div class="ic-bubble-title">Score & grade</div>
              <div id="ic-score-grade"></div>
              <div id="ic-flags"></div>
            </div>
            <div class="ic-bubble">
              <div class="ic-bubble-title">Vault routing</div>
              <div id="ic-vault-routing"></div>
            </div>
          </div>
        </div>

        <!-- Decision frame -->
        <div class="ic-section">
          <div class="ic-section-label">Decision frame</div>
          <div class="ic-two-col">
            <div class="ic-bubble">
              <div class="ic-bubble-title">Question type & pros</div>
              <div id="ic-question-type"></div>
              <ul class="ic-list" id="ic-pros-list"></ul>
            </div>
            <div class="ic-bubble">
              <div class="ic-bubble-title">Cons & personal checks</div>
              <ul class="ic-list" id="ic-cons-list"></ul>
              <ul class="ic-list" id="ic-checks-list"></ul>
            </div>
          </div>
        </div>

        <!-- Action protocol -->
        <div class="ic-section">
          <div class="ic-section-label">Action protocol</div>
          <div class="ic-bubble" id="ic-action-protocol"></div>
        </div>

        <!-- Owned insight -->
        <div class="ic-section">
          <div class="ic-section-label">Owned insight</div>
          <div class="ic-owned" id="ic-owned-insight"></div>
        </div>

        <!-- Copy + raw JSON -->
        <div class="ic-copy-row">
          <button class="ic-btn ic-btn-primary" id="ic-copy-capsule">Copy capsule</button>
          <button class="ic-btn ic-btn-ghost" id="ic-copy-mini">Copy mini answer</button>
          <button class="ic-btn ic-btn-ghost" id="ic-toggle-json">Toggle raw JSON</button>
          <span class="ic-copy-status" id="ic-copy-status"></span>
        </div>

        <div class="ic-json-block" id="ic-json-block">
          <pre class="ic-json-pre" id="ic-json-pre"></pre>
        </div>
      </div>
    </div>
  </section>
</div>

<script>
  (function () {
    const INPUTCHECK_API_URL = "https://inputcheck-api.vercel.app/api/inputcheck-run";

    const inputEl = document.getElementById("ic-input");
    const runBtn = document.getElementById("ic-run-btn");
    const resultsWrap = document.getElementById("ic-results-wrap");

    const rawTextEl = document.getElementById("ic-raw-text");
    const cleanedTextEl = document.getElementById("ic-cleaned-text");
    const canonicalTextEl = document.getElementById("ic-canonical-text");
    const capsuleTextEl = document.getElementById("ic-capsule-text");
    const miniAnswerEl = document.getElementById("ic-mini-answer");
    const nbqEl = document.getElementById("ic-nbq");

    const metaLineEl = document.getElementById("ic-meta-line");
    const scoreTextEl = document.getElementById("ic-score-text");
    const scoreGradeEl = document.getElementById("ic-score-grade");
    const flagsEl = document.getElementById("ic-flags");
    const vaultRoutingEl = document.getElementById("ic-vault-routing");

    const qTypeEl = document.getElementById("ic-question-type");
    const prosListEl = document.getElementById("ic-pros-list");
    const consListEl = document.getElementById("ic-cons-list");
    const checksListEl = document.getElementById("ic-checks-list");

    const actionProtocolEl = document.getElementById("ic-action-protocol");
    const ownedInsightEl = document.getElementById("ic-owned-insight");

    const copyCapsuleBtn = document.getElementById("ic-copy-capsule");
    const copyMiniBtn = document.getElementById("ic-copy-mini");
    const toggleJsonBtn = document.getElementById("ic-toggle-json");
    const copyStatusEl = document.getElementById("ic-copy-status");
    const jsonBlockEl = document.getElementById("ic-json-block");
    const jsonPreEl = document.getElementById("ic-json-pre");

    function setLoading(isLoading) {
      if (!runBtn || !inputEl) return;
      if (isLoading) {
        runBtn.dataset.prevHtml = runBtn.innerHTML;
        runBtn.innerHTML =
          '<span style="width:16px;height:16px;border-radius:999px;border:2px solid rgba(255,255,255,0.5);border-top-color:#fff;display:inline-block;box-sizing:border-box;animation:ic-spin 0.8s linear infinite;"></span>';
        runBtn.disabled = true;
        inputEl.disabled = true;
      } else {
        if (runBtn.dataset.prevHtml) {
          runBtn.innerHTML = runBtn.dataset.prevHtml;
        }
        runBtn.disabled = false;
        inputEl.disabled = false;
      }
    }

    async function runInputCheck(rawInput) {
      const res = await fetch(INPUTCHECK_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_input: rawInput })
      });

      if (!res.ok) {
        throw new Error("InputCheck API error: " + res.status + " " + res.statusText);
      }

      return await res.json();
    }

    function clearList(el) {
      while (el.firstChild) el.removeChild(el.firstChild);
    }

    function renderResult(rawInput, data) {
      resultsWrap.classList.add("visible");

      const ic = data.inputcheck || {};
      const df = data.decision_frame || {};
      const ap = data.action_protocol || {};
      const vn = data.vault_node || {};
      const flags = Array.isArray(ic.flags) ? ic.flags : [];

      const cleaned = ic.cleaned_question || rawInput;
      const canonical = ic.canonical_query || cleaned;
      const capsule = (typeof data.answer_capsule_25w === "string" && data.answer_capsule_25w.trim())
        ? data.answer_capsule_25w.trim()
        : "";
      const mini = (typeof data.mini_answer === "string" && data.mini_answer.trim())
        ? data.mini_answer.trim()
        : "";
      const nbq = ic.next_best_question || "";

      rawTextEl.textContent = rawInput;
      cleanedTextEl.textContent = cleaned;
      canonicalTextEl.textContent = canonical;
      capsuleTextEl.textContent = capsule || "No capsule generated.";
      miniAnswerEl.textContent = mini || "No mini answer generated.";
      nbqEl.textContent = nbq || "None returned.";

      // Meta line, score, grade
      const engineVersion = ic.engine_version || "inputcheck-v1.4.0";
      const score = typeof ic.score_10 === "number" ? ic.score_10 : null;
      const grade = ic.grade_label || "";
      metaLineEl.textContent = engineVersion;
      scoreTextEl.textContent = score !== null ? `${score}/10 · ${grade || "ungraded"}` : "Engine result";

      if (score !== null) {
        scoreGradeEl.textContent = `${score}/10 · ${grade || "ungraded"}`;
      } else {
        scoreGradeEl.textContent = "No score returned.";
      }

      // Flags
      flagsEl.innerHTML = "";
      if (flags.length) {
        flags.forEach((f) => {
          const span = document.createElement("span");
          span.className = "ic-flag-pill";
          span.textContent = f;
          flagsEl.appendChild(span);
        });
      } else {
        flagsEl.textContent = "no_flags";
      }

      // Vault routing
      const slug = vn.slug || "n/a";
      const vertical = vn.vertical_guess || "general";
      const status = vn.cmn_status || "draft";
      vaultRoutingEl.textContent =
        `slug: ${slug} · vertical: ${vertical} · status: ${status}`;

      // Decision frame
      qTypeEl.textContent = df.question_type ? `question_type: ${df.question_type}` : "question_type: unknown";

      clearList(prosListEl);
      if (Array.isArray(df.pros) && df.pros.length) {
        df.pros.forEach((p) => {
          const li = document.createElement("li");
          li.textContent = `${p.label || ""}: ${p.reason || ""}`;
          prosListEl.appendChild(li);
        });
      }

      clearList(consListEl);
      if (Array.isArray(df.cons) && df.cons.length) {
        df.cons.forEach((c) => {
          const li = document.createElement("li");
          li.textContent = `${c.label || ""}: ${c.reason || ""}`;
          consListEl.appendChild(li);
        });
      }

      clearList(checksListEl);
      if (Array.isArray(df.personal_checks) && df.personal_checks.length) {
        df.personal_checks.forEach((pc) => {
          const li = document.createElement("li");
          li.textContent = `${pc.label || ""} — ${pc.prompt || ""}`;
          checksListEl.appendChild(li);
        });
      }

      // Action protocol
      const steps = Array.isArray(ap.steps) ? ap.steps : [];
      const type = ap.type || "none";
      const effort = ap.estimated_effort || "";
      const tools = Array.isArray(ap.recommended_tools) ? ap.recommended_tools : [];

      let apText = `type: ${type}`;
      if (steps.length) {
        apText += "\nSteps:\n" + steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
      }
      if (effort) {
        apText += `\nEstimated effort: ${effort}`;
      }
      if (tools.length) {
        apText += `\nTools: ${tools.join(", ")}`;
      }
      actionProtocolEl.textContent = apText;

      // Owned insight
      const oi = typeof data.owned_insight === "string" ? data.owned_insight.trim() : "";
      ownedInsightEl.textContent = oi || "No owned insight returned.";

      // Copy payloads
      copyCapsuleBtn.dataset.copy = capsule;
      copyMiniBtn.dataset.copy = mini;
      copyStatusEl.textContent = "";

      // Raw JSON
      jsonPreEl.textContent = JSON.stringify(data, null, 2);
    }

    function copyText(text) {
      if (!navigator.clipboard) {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return;
      }
      navigator.clipboard.writeText(text);
    }

    async function handleRun() {
      const raw = (inputEl && inputEl.value || "").trim();
      if (!raw) return;

      setLoading(true);
      try {
        const data = await runInputCheck(raw);
        console.log("InputCheck payload:", data);
        renderResult(raw, data);
      } catch (err) {
        console.error("InputCheck error:", err);
        alert("Input Check API error: " + (err.message || String(err)));
      } finally {
        setLoading(false);
      }
    }

    if (runBtn && inputEl) {
      runBtn.addEventListener("click", handleRun);
      inputEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          handleRun();
        }
      });
    }

    copyCapsuleBtn.addEventListener("click", function () {
      const text = copyCapsuleBtn.dataset.copy || "";
      if (!text) return;
      copyText(text);
      copyStatusEl.textContent = "Copied capsule.";
      setTimeout(function () {
        copyStatusEl.textContent = "";
      }, 1500);
    });

    copyMiniBtn.addEventListener("click", function () {
      const text = copyMiniBtn.dataset.copy || "";
      if (!text) return;
      copyText(text);
      copyStatusEl.textContent = "Copied mini answer.";
      setTimeout(function () {
        copyStatusEl.textContent = "";
      }, 1500);
    });

    toggleJsonBtn.addEventListener("click", function () {
      jsonBlockEl.classList.toggle("visible");
    });

    // Spinner animation
    const style = document.createElement("style");
    style.innerHTML =
      "@keyframes ic-spin {from{transform:rotate(0deg);}to{transform:rotate(360deg);}}";
    document.head.appendChild(style);
  })();
</script>
