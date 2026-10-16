(() => {
  "use strict";
  const KEY = "fernFunds.v1";
  const MONTH_START = "2026-10";
  const DEFAULT = {
    settings: {
      startingCash: 8364,
      tuitionTarget: 12000,
      tuitionDate: "2027-08-20",
      paycheck: 446,
      nycTarget: 1100,
      indiaTarget: 1200,
    },
    cards: [
      {
        name: "Credit card 1",
        limit: 2500,
        balance: 0,
        apr: 27.74,
        minPayment: 0,
        dueDate: "",
      },
      {
        name: "Credit card 2",
        limit: 3000,
        balance: null,
        apr: 26.74,
        minPayment: 0,
        dueDate: "",
      },
    ],
    goals: { tuition: 0, nyc: 0, india: 0 },
    plans: {},
    transactions: [],
    cardTransactions: [],
  };
  const CATEGORIES = [
    "Rent",
    "Utilities",
    "Internet",
    "Groceries",
    "Miscellaneous",
    "Paycheck",
    "Tuition",
    "NYC trip",
    "India trip",
    "Credit card",
    "Transportation",
    "Health",
    "Entertainment",
    "Other",
  ];
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const fmt = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(Number(n) || 0);
  const monthLabel = (m) => {
    const [y, mo] = m.split("-").map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const monthOf = (d) => String(d || "").slice(0, 7);
  const newId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let data = loadData();
  let selectedMonth = MONTH_START;
  let currentView = "overview";
  let cloudClient = null;
  let cloudUser = null;
  let cloudSaveTimer = null;
  let cloudWriteInProgress = false;
  let cloudDirty = false;
  let localRevision = 0;
  let cloudConfigured = false;
  let cloudReady = false;
  function loadData() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...structuredClone(DEFAULT),
          ...parsed,
          settings: { ...DEFAULT.settings, ...parsed.settings },
          cards: parsed.cards || structuredClone(DEFAULT.cards),
          goals: parsed.goals || {},
          plans: parsed.plans || {},
          transactions: parsed.transactions || [],
          cardTransactions: parsed.cardTransactions || [],
        };
      }
    } catch (e) {
      console.warn("Could not load local data", e);
    }
    return structuredClone(DEFAULT);
  }
  function scheduleCloudSave(delay = 700) {
    if (!cloudUser || !cloudClient || !cloudReady) return;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => {
      cloudSaveTimer = null;
      pushCloudData(false);
    }, delay);
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      toast(
        "Could not save locally. Export a backup and check browser storage.",
      );
      console.error(e);
    }
    localRevision++;
    if (cloudUser && cloudClient && cloudReady) {
      cloudDirty = true;
      scheduleCloudSave(700);
      setCloudStatus(
        "Changes saved on this device. Syncing to cloud…",
        "pending",
      );
    }
  }
  function setCloudStatus(message, state = "") {
    $$(".cloud-status").forEach((el) => {
      el.textContent = message;
      el.dataset.state = state;
    });
  }
  function showLogin(message, state = "") {
    const gate = $("#login-gate"),
      shell = $("#app-shell");
    if (gate) gate.hidden = false;
    if (shell) shell.hidden = true;
    if (message) setCloudStatus(message, state);
  }
  function showDashboard() {
    const gate = $("#login-gate"),
      shell = $("#app-shell");
    if (gate) gate.hidden = true;
    if (shell) shell.hidden = false;
  }
  function setupCloud() {
    const cfg = window.FERN_FUNDS_SUPABASE || {};
    cloudConfigured = !!(
      window.supabase &&
      cfg.url &&
      cfg.anonKey &&
      !String(cfg.url).includes("YOUR_SUPABASE") &&
      !String(cfg.anonKey).includes("YOUR_SUPABASE")
    );
    const form = $("#cloud-auth-form");
    if (!cloudConfigured) {
      showLogin(
        "Cloud sign-in is not configured yet. Add your Supabase project URL and publishable/anon key to config.js, then run supabase-schema.sql in the SQL Editor.",
        "error",
      );
      $$(
        "#gate-auth-form input, #gate-auth-form button, #cloud-auth-form input, #cloud-auth-form button",
      ).forEach((el) => (el.disabled = true));
      return;
    }
    cloudClient = window.supabase.createClient(cfg.url, cfg.anonKey);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await signIn("cloud");
    });
    $("#cloud-signup").addEventListener("click", () => signUp("cloud"));
    $("#gate-auth-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await signIn("gate");
    });
    $("#gate-signup").addEventListener("click", () => signUp("gate"));
    $("#cloud-signout").addEventListener("click", signOut);
    $("#cloud-sync-now").addEventListener("click", () => syncCloud(true));
    cloudClient.auth.getSession().then(({ data: sessionData, error }) => {
      if (error) {
        showLogin("Could not check sign-in session: " + error.message, "error");
        return;
      }
      if (sessionData.session) handleSignedIn(sessionData.session.user);
      else showLogin("Sign in or create an account to open your dashboard.");
    });
    cloudClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) handleSignedIn(session.user);
      if (event === "SIGNED_OUT") {
        cloudUser = null;
        cloudReady = false;
        $("#cloud-auth-form").hidden = false;
        $("#cloud-account-actions").hidden = true;
        showLogin("Signed out. Sign in to reopen your dashboard.");
      }
    });
    // Refresh when returning to this tab or switching back to the app on another device.
    window.addEventListener("focus", () => {
      if (cloudUser && cloudReady) syncCloud(false);
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && cloudUser && cloudReady) syncCloud(false);
    });
    // Periodic pull keeps an already-open device reasonably fresh when another device changes data.
    window.setInterval(() => {
      if (!document.hidden && cloudUser && cloudReady) syncCloud(false);
    }, 30000);
  }
  function authFields(source) {
    return source === "gate"
      ? {
          email: $("#gate-email").value.trim(),
          password: $("#gate-password").value,
        }
      : {
          email: $("#cloud-email").value.trim(),
          password: $("#cloud-password").value,
        };
  }
  async function signUp(source = "cloud") {
    const { email, password } = authFields(source);
    if (!email || password.length < 8) {
      setCloudStatus(
        "Enter a valid email and a password with at least 8 characters.",
        "error",
      );
      return;
    }
    setCloudStatus("Creating account…");
    const { data: result, error } = await cloudClient.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.href.split("#")[0] },
    });
    if (error) {
      setCloudStatus("Account creation failed: " + error.message, "error");
      return;
    }
    if (result.session) await handleSignedIn(result.user);
    else
      setCloudStatus(
        "Account created. Check your email for a confirmation link, then return here and sign in.",
        "connected",
      );
  }
  async function signIn(source = "cloud") {
    const { email, password } = authFields(source);
    if (!email || !password) {
      setCloudStatus("Enter your email and password to sign in.", "error");
      return;
    }
    setCloudStatus("Signing in…");
    const { data: result, error } = await cloudClient.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setCloudStatus("Sign-in failed: " + error.message, "error");
      return;
    }
    await handleSignedIn(result.user);
  }
  async function signOut() {
    if (!cloudClient) {
      setCloudStatus("Cloud sign-out is unavailable because Supabase is not connected.", "error");
      return;
    }
    setCloudStatus("Signing out…", "pending");
    try {
      const { error } = await cloudClient.auth.signOut();
      if (error) setCloudStatus("Sign-out failed: " + error.message, "error");
    } catch (error) {
      setCloudStatus("Sign-out failed: " + (error.message || "Check your connection and try again."), "error");
    }
  }
  async function handleSignedIn(user) {
    if (!user || !cloudClient) return;
    if (cloudUser?.id === user.id && cloudReady) return;
    cloudUser = user;
    cloudReady = false;
    $("#cloud-auth-form").hidden = true;
    $("#cloud-account-actions").hidden = false;
    setCloudStatus(
      "Signed in as " + user.email + ". Checking cloud data…",
      "pending",
    );
    await syncCloud(false);
    showDashboard();
  }
  async function syncCloud(manual) {
    if (!cloudUser || !cloudClient) {
      setCloudStatus("Sign in to sync data.", "error");
      return;
    }
    // Never pull while a write is active or local edits are waiting to be saved.
    if (cloudWriteInProgress) {
      if (cloudDirty) scheduleCloudSave(500);
      return;
    }
    if (cloudDirty) {
      clearTimeout(cloudSaveTimer);
      cloudSaveTimer = null;
      await pushCloudData(manual);
      return;
    }
    const revisionBeforePull = localRevision;
    cloudWriteInProgress = true;
    try {
      const { data: row, error } = await cloudClient
        .from("user_finance_data")
        .select("data,updated_at")
        .eq("user_id", cloudUser.id)
        .maybeSingle();
      if (error) throw error;
      // A delete/edit made while the read was in flight must win over the stale response.
      if (cloudDirty || localRevision !== revisionBeforePull) {
        cloudDirty = true;
        return;
      }
      const localRaw = localStorage.getItem(KEY);
      const localHasData = (() => {
        try {
          const x = JSON.parse(localRaw || "{}");
          return (
            (x.transactions || []).length > 0 ||
            Object.keys(x.plans || {}).length > 0 ||
            Object.values(x.goals || {}).some((v) => Number(v) > 0) ||
            JSON.stringify(x.cards) !== JSON.stringify(DEFAULT.cards) ||
            JSON.stringify(x.settings) !== JSON.stringify(DEFAULT.settings)
          );
        } catch {
          return false;
        }
      })();
      if (row?.data) {
        let useCloud = true;
        if (
          !cloudReady &&
          localHasData &&
          JSON.stringify(data) !== JSON.stringify(row.data)
        )
          useCloud = confirm(
            "Cloud data already exists for this account. Choose OK to load the cloud copy onto this device, or Cancel to upload this device's current data and replace the cloud copy.",
          );
        if (useCloud) {
          data = {
            ...structuredClone(DEFAULT),
            ...row.data,
            settings: { ...DEFAULT.settings, ...row.data.settings },
            cards: row.data.cards || structuredClone(DEFAULT.cards),
            goals: row.data.goals || {},
            plans: row.data.plans || {},
            transactions: row.data.transactions || [],
            cardTransactions: row.data.cardTransactions || [],
          };
          localStorage.setItem(KEY, JSON.stringify(data));
          render();
          setCloudStatus(
            "Synced with cloud · " +
              cloudUser.email +
              " · last cloud update " +
              new Date(row.updated_at).toLocaleString(),
            "connected",
          );
        } else {
          cloudDirty = true;
        }
      } else {
        cloudDirty = true;
      }
      cloudReady = true;
    } catch (e) {
      console.error("Cloud sync failed", e);
      setCloudStatus(
        "Cloud sync failed: " +
          (e.message ||
            "Check your Supabase URL, schema, and access policies."),
        "error",
      );
    } finally {
      cloudWriteInProgress = false;
      if (cloudDirty) scheduleCloudSave(250);
    }
  }
  async function pushCloudData(manual) {
    if (!cloudUser || !cloudClient) return;
    if (cloudWriteInProgress) {
      cloudDirty = true;
      scheduleCloudSave(500);
      return;
    }
    cloudWriteInProgress = true;
    const snapshot = structuredClone(data);
    const revisionAtStart = localRevision;
    try {
      const { error } = await cloudClient.from("user_finance_data").upsert(
        {
          user_id: cloudUser.id,
          data: snapshot,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      if (localRevision === revisionAtStart) {
        cloudDirty = false;
        clearTimeout(cloudSaveTimer);
        cloudSaveTimer = null;
        setCloudStatus(
          "Synced to cloud · " +
            cloudUser.email +
            " · " +
            new Date().toLocaleTimeString(),
          "connected",
        );
      } else {
        cloudDirty = true;
        setCloudStatus("A newer change is waiting to sync…", "pending");
      }
      if (manual && !cloudDirty) toast("Cloud sync complete");
    } catch (e) {
      console.error("Cloud save failed", e);
      cloudDirty = true;
      setCloudStatus(
        "Could not sync to cloud: " +
          (e.message || "Check your Supabase table and security policies."),
        "error",
      );
      if (manual) toast("Cloud sync failed. Check the status message.");
    } finally {
      cloudWriteInProgress = false;
      if (cloudDirty) scheduleCloudSave(300);
    }
  }
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2500);
  }
  function esc(s) {
    return String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function amountClass(t) {
    return t === "Income"
      ? "income"
      : t === "Expense"
        ? "expense"
        : t === "Card payment"
          ? "card-payment"
          : "";
  }
  function txSigned(t) {
    if (t.type === "Income") return Number(t.amount);
    if (t.type === "Card payment") return -Number(t.amount);
    if (t.type === "Expense")
      return String(t.account || "")
        .toLowerCase()
        .startsWith("credit card")
        ? 0
        : -Number(t.amount);
    return 0;
  }
  function txsForMonth(m) {
    return data.transactions.filter((t) => monthOf(t.date) === m);
  }
  function sums(m) {
    const ts = txsForMonth(m);
    return {
      income: ts
        .filter((t) => t.type === "Income")
        .reduce((s, t) => s + Number(t.amount), 0),
      expenses: ts
        .filter((t) => t.type === "Expense")
        .reduce((s, t) => s + Number(t.amount), 0),
      payments: ts
        .filter((t) => t.type === "Card payment")
        .reduce((s, t) => s + Number(t.amount), 0),
      net: ts.reduce((s, t) => s + txSigned(t), 0),
    };
  }
  function getPlan(m) {
    if (!data.plans[m])
      data.plans[m] = {
        income: m >= "2026-11" && m <= "2027-04" ? 892 : 0,
        categories: {
          Rent: 360,
          Utilities: 40,
          Internet: 15,
          Groceries: m >= "2027-05" && m <= "2027-08" ? 25 : 100,
          Miscellaneous: m >= "2027-05" && m <= "2027-08" ? 25 : 50,
          "NYC trip": m === "2026-12" ? 1100 : 0,
          "India trip": m === "2027-05" ? 1200 : 0,
          Tuition: m === "2027-08" ? 12000 : 0,
          Transportation: 0,
          Health: 0,
          Entertainment: 0,
          Other: 0,
        },
      };
    return data.plans[m];
  }
  function allMonths() {
    const months = [];
    for (let y = 2026; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, "0")}`;
        if (key >= MONTH_START && key <= "2027-12") months.push(key);
      }
    }
    return months;
  }
  function nav(view) {
    currentView = view;
    const navEl = $("#workspace-nav");
    if (navEl) navEl.classList.remove("mobile-open");
    const menuBtn = $("#mobile-menu-toggle");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    $$(".view").forEach((v) =>
      v.classList.toggle("active", v.id === `view-${view}`),
    );
    $$(".nav-item[data-view]").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === view),
    );
    const titles = {
      overview: "Good planning, less money stress.",
      monthly: "Your month, with intention.",
      transactions: "Every dollar has a story.",
      goals: "Save for what matters.",
      cards: "Keep borrowing in view.",
      settings: "Your money, your rules.",
    };
    $("#page-title").textContent = titles[view] || "Fern & Funds";
    render();
  }
  function render() {
    renderOverview();
    renderMonthly();
    renderTransactions();
    renderGoals();
    renderCards();
    renderSettings();
    $("#current-month-label").textContent = monthLabel(selectedMonth);
  }
  function renderOverview() {
    const s = data.settings,
      m = sums(selectedMonth);
    $("#stat-cash").textContent = fmt(Number(s.startingCash) || 0);
    $("#stat-tuition").textContent = fmt(s.tuitionTarget);
    const funded = Math.min(
      100,
      ((Number(s.startingCash) + Number(data.goals.tuition || 0)) /
        Math.max(1, Number(s.tuitionTarget))) *
        100,
    );
    $("#tuition-progress").style.width = `${funded}%`;
    $("#tuition-progress-label").textContent =
      `${funded.toFixed(1)}% funded toward tuition`;
    $("#stat-income").textContent = fmt(m.income);
    $("#stat-expenses").textContent = fmt(m.expenses);
    $("#overview-month-title").textContent = monthLabel(selectedMonth);
    $("#month-income").textContent = fmt(m.income);
    $("#month-expenses").textContent = fmt(m.expenses);
    $("#month-net").textContent = fmt(m.net);
    $("#month-net").className = m.net >= 0 ? "positive" : "negative";
    const recent = txsForMonth(selectedMonth)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
    $("#recent-transactions").innerHTML = recent.length
      ? recent
          .map(
            (t) =>
              `<div class="recent-item"><div class="recent-icon">${t.type === "Income" ? "↓" : t.type === "Expense" ? "↗" : "↔"}</div><div class="recent-info"><strong>${esc(t.description)}</strong><small>${esc(t.category)} · ${esc(t.date)}</small></div><div class="recent-amount ${t.type === "Income" ? "income" : ""}">${t.type === "Income" ? "+" : "−"}${fmt(t.amount)}</div></div>`,
          )
          .join("")
      : `<div class="empty-state visible"><strong>No activity for ${monthLabel(selectedMonth)}</strong><p>Add transactions to see your month take shape.</p></div>`;
    const g = data.goals,
      spec = [
        ["tuition", s.tuitionTarget, "#goal-tuition"],
        ["nyc", s.nycTarget, "#goal-nyc"],
        ["india", s.indiaTarget, "#goal-india"],
      ];
    for (const [key, target, prefix] of spec) {
      const saved =
        Number(g[key] || 0) + (key === "tuition" ? Number(s.startingCash) : 0);
      const pct = target ? Math.min(100, (saved / target) * 100) : 0;
      const id = prefix;
      $(id + "-pct").textContent = `${pct.toFixed(0)}%`;
      $(id + "-bar").style.width = `${pct}%`;
      $(id + "-copy").textContent = `${fmt(saved)} of ${fmt(target)}`;
    }
  }
  function renderMonthly() {
    const months = allMonths();
    const sel = $("#month-select");
    const old = sel.value || selectedMonth;
    sel.innerHTML = months
      .map((m) => `<option value="${m}">${monthLabel(m)}</option>`)
      .join("");
    sel.value = months.includes(old) ? old : selectedMonth;
    const p = getPlan(selectedMonth),
      actual = sums(selectedMonth);
    const plannedIncome = Number(p.income || 0),
      cats = p.categories || {},
      plannedExpenses = Object.values(cats).reduce(
        (s, n) => s + Number(n || 0),
        0,
      );
    $("#planned-income").textContent = fmt(plannedIncome);
    $("#planned-expenses").textContent = fmt(plannedExpenses);
    $("#planned-leftover").textContent = fmt(plannedIncome - plannedExpenses);
    const categories = [
      ...new Set([
        ...Object.keys(cats),
        ...CATEGORIES.filter((c) =>
          [
            "Rent",
            "Utilities",
            "Internet",
            "Groceries",
            "Miscellaneous",
          ].includes(c),
        ),
      ]),
    ];
    $("#budget-rows").innerHTML =
      `<tr><td><strong>Income</strong></td><td><input data-plan-income type="number" min="0" step=".01" value="${Number(p.income || 0)}"></td><td class="positive">${fmt(actual.income)}</td><td>${fmt(actual.income - Number(p.income || 0))}</td></tr>` +
      categories
        .map((cat) => {
          const planned = Number(cats[cat] || 0),
            actualCat = txsForMonth(selectedMonth)
              .filter((t) => t.type === "Expense" && t.category === cat)
              .reduce((s, t) => s + Number(t.amount), 0);
          return `<tr><td>${esc(cat)}</td><td><input data-plan-cat="${esc(cat)}" type="number" min="0" step=".01" value="${planned}"></td><td>${fmt(actualCat)}</td><td class="${planned - actualCat >= 0 ? "positive" : "negative"}">${fmt(planned - actualCat)}</td></tr>`;
        })
        .join("");
    $$("[data-plan-income]").forEach((el) =>
      el.addEventListener("change", () => {
        p.income = Number(el.value) || 0;
        save();
        renderMonthly();
      }),
    );
    $$("[data-plan-cat]").forEach((el) =>
      el.addEventListener("change", () => {
        p.categories[el.dataset.planCat] = Number(el.value) || 0;
        save();
        renderMonthly();
      }),
    );
  }
  function renderTransactions() {
    const search = ($("#transaction-search")?.value || "").toLowerCase(),
      mf = $("#transaction-month-filter"),
      tf = $("#transaction-type-filter");
    const months = [...new Set(data.transactions.map((t) => monthOf(t.date)))]
      .sort()
      .reverse();
    const old = mf.value || "all";
    mf.innerHTML =
      `<option value="all">All months</option>` +
      months
        .map((m) => `<option value="${m}">${monthLabel(m)}</option>`)
        .join("");
    mf.value = [...mf.options].some((o) => o.value === old) ? old : "all";
    const filtered = data.transactions
      .filter(
        (t) =>
          (mf.value === "all" || monthOf(t.date) === mf.value) &&
          (tf.value === "all" || t.type === tf.value) &&
          `${t.description} ${t.category} ${t.account} ${t.notes || ""}`
            .toLowerCase()
            .includes(search),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    $("#transaction-rows").innerHTML = filtered
      .map(
        (t) =>
          `<tr><td>${esc(t.date)}</td><td><strong>${esc(t.description)}</strong>${t.notes ? `<br><small class="muted">${esc(t.notes)}</small>` : ""}</td><td>${esc(t.category)}</td><td><span class="type-pill ${amountClass(t.type)}">${esc(t.type)}</span></td><td>${esc(t.account || "—")}</td><td class="align-right ${t.type === "Income" ? "positive" : t.type === "Expense" ? "negative" : ""}">${t.type === "Income" ? "+" : t.type === "Expense" ? "−" : ""}${fmt(t.amount)}</td><td><button class="text-button" data-delete-tx="${t.id}" title="Delete transaction">Delete</button></td></tr>`,
      )
      .join("");
    $("#empty-transactions").classList.toggle("visible", filtered.length === 0);
    $("#transaction-rows").parentElement.style.display = filtered.length
      ? "table"
      : "none";
    $$("[data-delete-tx]").forEach((b) =>
      b.addEventListener("click", () => {
        if (confirm("Delete this transaction?")) {
          data.transactions = data.transactions.filter(
            (t) => t.id !== b.dataset.deleteTx,
          );
          save();
          render();
          toast("Transaction deleted");
        }
      }),
    );
  }
  function renderGoals() {
    const s = data.settings,
      g = data.goals;
    const goals = [
      {
        key: "tuition",
        name: "August tuition",
        target: s.tuitionTarget,
        saved: Number(s.startingCash) + Number(g.tuition || 0),
        due: s.tuitionDate,
        desc: "Your most important financial commitment.",
        icon: "✦",
        cls: "tuition",
      },
      {
        key: "nyc",
        name: "NYC trip",
        target: s.nycTarget,
        saved: Number(g.nyc || 0),
        due: "Dec 31, 2026 – Jan 5, 2027",
        desc: "A fun trip, planned without taking on debt.",
        icon: "✈",
        cls: "travel",
      },
      {
        key: "india",
        name: "India trip",
        target: s.indiaTarget,
        saved: Number(g.india || 0),
        due: "May – mid-August 2027",
        desc: "Include flights and spending in your total estimate.",
        icon: "⌁",
        cls: "india",
      },
    ];
    $("#goals-grid").innerHTML = goals
      .map((o) => {
        const pct = o.target ? Math.min(100, (o.saved / o.target) * 100) : 0;
        return `<article class="goal-card"><div class="goal-icon ${o.cls}">${o.icon}</div><h3>${o.name}</h3><div class="goal-desc">${o.desc}</div><div class="goal-amount">${fmt(o.saved)}</div><div class="goal-target">of ${fmt(o.target)} · ${pct.toFixed(1)}% funded</div><div class="progress-track ${o.cls === "travel" ? "gold-track" : o.cls === "india" ? "rose-track" : ""}"><div class="progress-fill ${o.cls === "travel" ? "gold-fill" : o.cls === "india" ? "rose-fill" : ""}" style="width:${pct}%"></div></div><label>Add to goal savings ($)<input type="number" min="0" step=".01" id="goal-add-${o.key}" placeholder="0.00"></label><button class="button" data-add-goal="${o.key}">Record savings</button><small class="muted" style="display:block;margin-top:10px">Target / due: ${esc(o.due)}</small></article>`;
      })
      .join("");
    $$("[data-add-goal]").forEach((b) =>
      b.addEventListener("click", () => {
        const key = b.dataset.addGoal,
          el = $(`#goal-add-${key}`),
          v = Number(el.value);
        if (!Number.isFinite(v) || v <= 0) {
          toast("Enter an amount greater than zero");
          return;
        }
        data.goals[key] = Number(data.goals[key] || 0) + v;
        save();
        render();
        toast("Goal savings updated");
      }),
    );
    const totalTravel = s.nycTarget + s.indiaTarget,
      short = Math.max(
        0,
        s.tuitionTarget - s.startingCash - Number(g.tuition || 0),
      );
    $("#goal-summary").innerHTML =
      `<div><span>Tuition still to fund</span><strong>${fmt(short)}</strong></div><div><span>Travel budget combined</span><strong>${fmt(totalTravel)}</strong></div><div><span>Current savings above tuition target</span><strong>${fmt(Math.max(0, s.startingCash - s.tuitionTarget))}</strong></div>`;
  }
  function renderCards() {
    const cardBalance = (c) => Number(c.balance || 0) + data.cardTransactions.filter((t) => t.card === c.name).reduce((n, t) => n + (t.type === "Purchase" || t.type === "Fee" || t.type === "Interest" ? 1 : -1) * Number(t.amount), 0);
    $("#cards-grid").innerHTML = data.cards
      .map(
        (c, i) =>
          `<div><div class="bank-card ${i === 1 ? "card-two" : ""}"><div class="card-label">${esc(c.name.toUpperCase())} · PURCHASE APR ${Number(c.apr || 0).toFixed(2)}%</div><div class="card-balance">${fmt(cardBalance(c))}</div><div class="card-bottom"><span>Limit ${fmt(c.limit)}</span><span>Available ${fmt(Number(c.limit) - cardBalance(c))}</span></div></div><div class="card-edit"><h4>${esc(c.name)} details</h4><div class="card-edit-grid"><label>Credit limit ($)<input type="number" min="0" step=".01" data-card="${i}" data-field="limit" value="${c.limit}"></label><label>Starting balance ($)<input type="number" min="0" step=".01" data-card="${i}" data-field="balance" value="${c.balance ?? ""}" placeholder="Unknown"></label><label>Purchase APR (%)<input type="number" min="0" step=".01" data-card="${i}" data-field="apr" value="${c.apr}"></label><label>Minimum payment ($)<input type="number" min="0" step=".01" data-card="${i}" data-field="minPayment" value="${c.minPayment || 0}"></label><label>Payment due date<input type="date" data-card="${i}" data-field="dueDate" value="${c.dueDate || ""}"></label></div></div></div>`,
      )
      .join("");
    const priorSelection = $("#statement-card").value;
    const cardOptions = data.cards.map(c => `<option>${esc(c.name)}</option>`).join("");
    $("#statement-card").innerHTML = cardOptions;
    if (data.cards.some(c => c.name === priorSelection)) $("#statement-card").value = priorSelection;
    $("#card-transaction-form").elements.card.innerHTML = cardOptions;
    if (!$("#statement-month").value) $("#statement-month").value = selectedMonth;
    const cardName = $("#statement-card").value || data.cards[0]?.name;
    const month = $("#statement-month").value || selectedMonth;
    const activity = data.cardTransactions.filter(t => t.card === cardName && monthOf(t.date) === month);
    const total = type => activity.filter(t => t.type === type).reduce((a,t) => a + Number(t.amount), 0);
    const card = data.cards.find(c => c.name === cardName);
    const prior = card ? Number(card.balance || 0) + data.cardTransactions.filter(t => t.card === cardName && monthOf(t.date) < month).reduce((n,t) => n + (["Purchase","Fee","Interest"].includes(t.type) ? 1 : -1) * Number(t.amount), 0) : 0;
    const statementBalance = prior + total("Purchase") + total("Fee") + total("Interest") - total("Refund") - total("Payment");
    $("#statement-summary").innerHTML = `<div><span>Purchases</span><strong>${fmt(total("Purchase"))}</strong></div><div><span>Payments & refunds</span><strong>${fmt(total("Payment") + total("Refund"))}</strong></div><div><span>Fees & interest</span><strong>${fmt(total("Fee") + total("Interest"))}</strong></div><div><span>Statement balance</span><strong>${fmt(statementBalance)}</strong></div><div><span>Minimum due</span><strong>${fmt(card?.minPayment || 0)}</strong></div><div><span>Payment due date</span><strong>${esc(card?.dueDate || "Not set")}</strong></div>`;
    $("#card-transaction-list").innerHTML = activity.length ? `<table><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Type</th><th class="align-right">Amount</th><th></th></tr></thead><tbody>${activity.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(t=>`<tr><td>${esc(t.date)}</td><td>${esc(t.description)}</td><td>${esc(t.category)}</td><td>${esc(t.type)}</td><td class="align-right">${fmt(t.amount)}</td><td><button class="text-button" data-edit-card-tx="${esc(t.id)}">Edit</button> <button class="text-button" data-delete-card-tx="${esc(t.id)}" title="Delete card transaction">Delete</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state visible"><strong>No card activity for ${esc(monthLabel(month))}</strong><p>Add purchases, payments, refunds, fees, or interest to build this statement.</p></div>`;
    $("#statement-card").onchange = renderCards;
    $("#statement-month").onchange = renderCards;
    $("#save-cards").onclick = () => {
      $$("[data-card]").forEach((el) => {
        const c = data.cards[Number(el.dataset.card)],
          field = el.dataset.field;
        if (field === "dueDate") c[field] = el.value;
        else if (field === "balance" && el.value === "") c[field] = null;
        else c[field] = Number(el.value) || 0;
      });
      save();
      renderCards();
      toast("Credit-card details saved");
    };
  }
  function renderSettings() {
    const f = $("#settings-form");
    for (const [k, v] of Object.entries(data.settings)) {
      if (f.elements[k]) f.elements[k].value = v;
    }
  }
  function showModal() {
    const f = $("#transaction-form");
    f.reset();
    f.elements.date.value = todayISO();
    $("#transaction-modal").classList.add("open");
    $("#transaction-modal").setAttribute("aria-hidden", "false");
    f.elements.description.focus();
  }
  function hideModal() {
    $("#transaction-modal").classList.remove("open");
    $("#transaction-modal").setAttribute("aria-hidden", "true");
  }
  function download(name, content, type) {
    const blob = new Blob([content], { type }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  function exportJSON() {
    download(
      `fern-funds-backup-${todayISO()}.json`,
      JSON.stringify(data, null, 2),
      "application/json",
    );
    toast("Backup downloaded");
  }
  function exportCSV() {
    const rows = [
      ["Date", "Type", "Description", "Category", "Amount", "Account", "Notes"],
      ...data.transactions.map((t) => [
        t.date,
        t.type,
        t.description,
        t.category,
        t.amount,
        t.account,
        t.notes || "",
      ]),
    ];
    const csv = rows
      .map((r) =>
        r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","),
      )
      .join("\r\n");
    download(
      `fern-funds-transactions-${todayISO()}.csv`,
      csv,
      "text/csv;charset=utf-8",
    );
    toast("CSV downloaded");
  }
  function init() {
    $("#today-label").textContent = new Date()
      .toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
      .toUpperCase();
    $("#current-month-label").textContent = monthLabel(selectedMonth);
    $$("[data-view]").forEach((b) =>
      b.addEventListener("click", () => nav(b.dataset.view)),
    );
    $("#mobile-menu-toggle").onclick = () => {
      const navEl = $("#workspace-nav"),
        open = navEl.classList.toggle("mobile-open");
      $("#mobile-menu-toggle").setAttribute("aria-expanded", String(open));
    };
    $("#account-menu-button").onclick = () => nav("settings");
    $$("[data-goto]").forEach((b) =>
      b.addEventListener("click", () => nav(b.dataset.goto)),
    );
    $("#prev-month").onclick = () => {
      const d = new Date(selectedMonth + "-01T12:00:00");
      d.setMonth(d.getMonth() - 1);
      selectedMonth = d.toISOString().slice(0, 7);
      render();
    };
    $("#next-month").onclick = () => {
      const d = new Date(selectedMonth + "-01T12:00:00");
      d.setMonth(d.getMonth() + 1);
      selectedMonth = d.toISOString().slice(0, 7);
      render();
    };
    $("#month-select").onchange = (e) => {
      selectedMonth = e.target.value;
      render();
    };
    $("#monthly-prev").onclick = () => {
      const d = new Date(selectedMonth + "-01T12:00:00");
      d.setMonth(d.getMonth() - 1);
      selectedMonth = d.toISOString().slice(0, 7);
      render();
    };
    $("#monthly-next").onclick = () => {
      const d = new Date(selectedMonth + "-01T12:00:00");
      d.setMonth(d.getMonth() + 1);
      selectedMonth = d.toISOString().slice(0, 7);
      render();
    };
    $("#add-transaction").onclick = showModal;
    $("#empty-add").onclick = showModal;
    const cardModal = $("#card-transaction-modal"), cardForm = $("#card-transaction-form");
    const cardReview = $("#card-tx-review"), cardReviewButton = $("#review-card-tx");
    let editingCardTransactionId = null, pendingCardTransaction = null;
    const cardFields = () => [...cardForm.querySelectorAll("label")];
    const closeCardModal = () => { cardModal.classList.remove("open"); cardModal.setAttribute("aria-hidden", "true"); };
    const setCardFormStep = (review) => {
      cardFields().forEach(label => label.classList.toggle("hidden", review));
      cardReview.classList.toggle("hidden", !review);
      cardReviewButton.classList.toggle("hidden", review);
    };
    const openCardModal = (transaction = null) => {
      cardForm.reset();
      editingCardTransactionId = transaction?.id || null;
      pendingCardTransaction = null;
      cardForm.elements.card.innerHTML = data.cards.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");
      cardForm.elements.date.value = transaction?.date || todayISO();
      cardForm.elements.type.value = transaction?.type || "Purchase";
      cardForm.elements.card.value = transaction?.card || $("#statement-card").value || data.cards[0]?.name || "";
      cardForm.elements.description.value = transaction?.description || "";
      cardForm.elements.category.value = transaction?.category || "Groceries";
      cardForm.elements.amount.value = transaction?.amount ?? "";
      cardForm.elements.notes.value = transaction?.notes || "";
      $("#card-modal-title").textContent = transaction ? "Edit card transaction" : "New card transaction";
      setCardFormStep(false);
      cardModal.classList.add("open");
      cardModal.setAttribute("aria-hidden", "false");
    };
    $("#add-card-transaction").onclick = () => openCardModal();
    $("#close-card-modal").onclick = $("#cancel-card-modal").onclick = closeCardModal;
    cardModal.addEventListener("click", e => { if (e.target === cardModal) closeCardModal(); });
    $("#back-card-tx").onclick = () => { pendingCardTransaction = null; setCardFormStep(false); };
    cardForm.onsubmit = e => {
      e.preventDefault();
      if (!cardForm.reportValidity()) return;
      const fd = new FormData(cardForm);
      pendingCardTransaction = { id: editingCardTransactionId || newId(), date: fd.get("date"), type: fd.get("type"), card: fd.get("card"), description: fd.get("description").trim(), category: fd.get("category"), amount: Number(fd.get("amount")), notes: fd.get("notes").trim() };
      $("#card-tx-review-details").innerHTML = `<div><span>Card</span><strong>${esc(pendingCardTransaction.card)}</strong></div><div><span>Type</span><strong>${esc(pendingCardTransaction.type)}</strong></div><div><span>Date</span><strong>${esc(pendingCardTransaction.date)}</strong></div><div><span>Merchant</span><strong>${esc(pendingCardTransaction.description)}</strong></div><div><span>Category</span><strong>${esc(pendingCardTransaction.category)}</strong></div><div><span>Amount</span><strong>${fmt(pendingCardTransaction.amount)}</strong></div>`;
      setCardFormStep(true);
    };
    $("#confirm-card-tx").onclick = () => {
      const t = pendingCardTransaction;
      if (!t) return;
      const existingIndex = data.cardTransactions.findIndex(item => item.id === t.id);
      if (existingIndex < 0) data.cardTransactions.push(t);
      else data.cardTransactions[existingIndex] = t;
      const linked = data.transactions.find(item => item.cardTransactionId === t.id);
      if (t.type === "Payment") {
        const payment = { id: linked?.id || newId(), date: t.date, type: "Card payment", description: `${t.card} payment`, category: "Credit card", amount: t.amount, account: "Checking", notes: `Card payment · ${t.description}`, cardTransactionId: t.id };
        if (linked) Object.assign(linked, payment); else data.transactions.push(payment);
      } else if (linked) data.transactions = data.transactions.filter(item => item.cardTransactionId !== t.id);
      selectedMonth = monthOf(t.date);
      const edited = editingCardTransactionId !== null;
      save(); closeCardModal(); render(); toast(edited ? "Card transaction updated" : "Card transaction saved");
    };
    $("#card-transaction-list").addEventListener("click", event => {
      const editButton = event.target.closest("[data-edit-card-tx]");
      if (editButton) {
        const transaction = data.cardTransactions.find(item => item.id === editButton.dataset.editCardTx);
        if (transaction) openCardModal(transaction);
        return;
      }
      const deleteButton = event.target.closest("[data-delete-card-tx]");
      if (!deleteButton) return;
      const id = deleteButton.dataset.deleteCardTx;
      if (!data.cardTransactions.some(item => item.id === id)) return;
      data.cardTransactions = data.cardTransactions.filter(item => item.id !== id);
      data.transactions = data.transactions.filter(item => item.cardTransactionId !== id);
      save(); render(); toast("Card transaction deleted");
    });
    $("#close-modal").onclick = hideModal;
    $("#cancel-modal").onclick = hideModal;
    $("#transaction-modal").addEventListener("click", (e) => {
      if (e.target.id === "transaction-modal") hideModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideModal();
    });
    $("#transaction-form").onsubmit = (e) => {
      e.preventDefault();
      const f = e.currentTarget,
        fd = new FormData(f),
        tx = {
          id: newId(),
          date: fd.get("date"),
          type: fd.get("type"),
          description: fd.get("description").trim(),
          category: fd.get("category"),
          amount: Number(fd.get("amount")),
          account: fd.get("account"),
          notes: fd.get("notes").trim(),
        };
      if (!tx.description || tx.amount <= 0) return;
      data.transactions.push(tx);
      selectedMonth = monthOf(tx.date);
      save();
      hideModal();
      render();
      nav("transactions");
      toast("Transaction saved");
    };
    $("#transaction-search").oninput = renderTransactions;
    $("#transaction-month-filter").onchange = renderTransactions;
    $("#transaction-type-filter").onchange = renderTransactions;
    $("#settings-form").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      for (const k of [
        "startingCash",
        "tuitionTarget",
        "paycheck",
        "nycTarget",
        "indiaTarget",
      ])
        data.settings[k] = Number(fd.get(k)) || 0;
      data.settings.tuitionDate = fd.get("tuitionDate");
      save();
      render();
      toast("Settings saved");
    };
    $("#copy-last-month").onclick = () => {
      const d = new Date(selectedMonth + "-01T12:00:00");
      d.setMonth(d.getMonth() - 1);
      const prev = d.toISOString().slice(0, 7);
      if (!data.plans[prev]) {
        toast("No previous plan found to copy");
        return;
      }
      data.plans[selectedMonth] = JSON.parse(JSON.stringify(data.plans[prev]));
      save();
      renderMonthly();
      toast(`Copied ${monthLabel(prev)} plan`);
    };
    $("#export-top").onclick = exportJSON;
    $("#export-json").onclick = exportJSON;
    $("#export-csv").onclick = exportCSV;
    $("#import-json").onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const imported = JSON.parse(await file.text());
        if (
          !imported.settings ||
          !Array.isArray(imported.transactions) ||
          !Array.isArray(imported.cards)
        )
          throw new Error("Invalid backup");
        if (
          !confirm(
            "Replace current app data with this backup? Export your current data first if you want to keep it.",
          )
        )
          return;
        data = {
          ...structuredClone(DEFAULT),
          ...imported,
          settings: { ...DEFAULT.settings, ...imported.settings },
          cards: imported.cards || structuredClone(DEFAULT.cards),
          goals: imported.goals || {},
          plans: imported.plans || {},
          transactions: imported.transactions || [],
          cardTransactions: imported.cardTransactions || [],
        };
        save();
        render();
        toast("Backup restored");
      } catch (err) {
        alert(
          "Could not import this file. Choose a valid Fern & Funds JSON backup.",
        );
      } finally {
        e.target.value = "";
      }
    };
    $("#reset-data").onclick = () => {
      if (
        confirm(
          "This will permanently clear all app records in this browser. Download a backup first. Continue?",
        ) &&
        confirm("Final confirmation: delete all Fern & Funds data?")
      ) {
        localStorage.removeItem(KEY);
        data = structuredClone(DEFAULT);
        save();
        render();
        toast("App data reset");
      }
    };
    render();
    setupCloud();
  }
  init();
})();
