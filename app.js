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
  function parseStatementCSV(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted && ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { row.push(field); field = ""; }
      else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); if (row.some(cell => cell.trim())) rows.push(row);
        row = []; field = "";
      } else field += ch;
    }
    row.push(field); if (row.some(cell => cell.trim())) rows.push(row);
    if (rows.length < 2) throw new Error("The CSV has no transaction rows.");
    const headers = rows[0].map(v => v.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
    const find = (...names) => headers.findIndex(h => names.includes(h));
    const dateCol = find("transactiondate", "date", "postingdate", "postdate");
    const descCol = find("description", "merchant", "details", "memo", "payee");
    const categoryCol = find("category", "transactioncategory");
    const amountCol = find("amount", "transactionamount");
    const debitCol = find("debit", "withdrawal", "debitamount");
    const creditCol = find("credit", "deposit", "creditamount");
    if (dateCol < 0 || descCol < 0 || (amountCol < 0 && debitCol < 0 && creditCol < 0))
      throw new Error("Couldn't identify date, description, and amount columns. Use a CSV with Date, Description, and Amount (or Debit/Credit) headers.");
    const val = (r, c) => c < 0 ? "" : String(r[c] || "").trim();
    const money = value => {
      const negative = /^\s*\(.*\)\s*$/.test(value) || /^\s*-/.test(value);
      const n = Number(value.replace(/[,$()\s]/g, ""));
      return Number.isFinite(n) ? Math.abs(n) * (negative ? -1 : 1) : NaN;
    };
    return rows.slice(1).map((r, index) => {
      const rawDate = val(r, dateCol);
      let date = "";
      if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) date = rawDate.slice(0, 10);
      else { const m = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) date = `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`; }
      let amount, signed = true;
      if (amountCol >= 0 && val(r, amountCol)) amount = money(val(r, amountCol));
      else if (debitCol >= 0 || creditCol >= 0) {
        const debit = val(r, debitCol), credit = val(r, creditCol);
        amount = debit ? -Math.abs(money(debit)) : Math.abs(money(credit)); signed = true;
      }
      const rawCategory = val(r, categoryCol);
      const category = CATEGORIES.find(c => c.toLowerCase() === rawCategory.toLowerCase()) || rawCategory || "Other";
      return { id: newId(), date, description: val(r, descCol), amount, category, type: amount >= 0 ? "Income" : "Expense", include: true, originalIndex: index };
    }).filter(t => t.date && t.description && Number.isFinite(t.amount) && t.amount !== 0);
  }
  async function parseStatementPDF(file, account) {
    if (file.size > 50 * 1024 * 1024) throw new Error("This PDF is over 50 MB. Save a smaller statement file and try again.");
    let pdfjs;
    try { pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs"); }
    catch { throw new Error("The PDF reader could not load. Check your internet connection and try again; your statement itself is still processed locally."); }
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs";
    let pdf;
    try { pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
    catch (error) { throw new Error(/password/i.test(error?.message || "") ? "This PDF is password-protected. Save an unlocked copy and try again." : "Could not read this PDF. It may be damaged or use an unsupported format."); }
    if (pdf.numPages > 80) throw new Error("This PDF has more than 80 pages. Use a single monthly statement PDF.");
    const lines = [];
    let allText = "";
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const items = content.items.filter(item => typeof item.str === "string" && item.str.trim()).map(item => ({ text: item.str, x: item.transform?.[4] || 0, y: item.transform?.[5] || 0 }));
      items.sort((a,b) => b.y - a.y || a.x - b.x);
      const pageLines = [];
      for (const item of items) {
        let line = pageLines.find(entry => Math.abs(entry.y - item.y) < 2.5);
        if (!line) { line = { y: item.y, pieces: [] }; pageLines.push(line); }
        line.pieces.push(item);
      }
      for (const line of pageLines) {
        const text = line.pieces.sort((a,b)=>a.x-b.x).map(piece=>piece.text).join(" ").replace(/\s+/g," ").trim();
        if (text) { lines.push(text); allText += `${text}\n`; }
      }
      page.cleanup();
    }
    await pdf.destroy();
    if (!allText.trim()) throw new Error("This PDF has no selectable text. It looks scanned; use a text-based PDF or Chase activity CSV. The app does not send statements to an OCR service.");
    const years = [...allText.matchAll(/\b20\d{2}\b/g)].map(match=>Number(match[0]));
    const baseYear = years.length ? Math.max(...years) : new Date().getFullYear();
    const explicitStatementDate = allText.match(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](20\d{2})\b/);
    const referenceMonth = explicitStatementDate ? Number(explicitStatementDate[1]) : new Date().getMonth() + 1;
    const referenceYear = explicitStatementDate ? Number(explicitStatementDate[3]) : baseYear;
    const datePattern = /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])(?:[\/\-](\d{2,4}))?\b/g;
    const moneyPattern = /\(?\s*(?:\$\s*)?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?-?/g;
    const excluded = /^(?:new balance|previous balance|statement balance|minimum payment due|payment due date|credit limit|available credit|opening balance|closing balance|balance as of|total fees|total interest|account summary|rewards summary|interest charge calculation|annual percentage rate|important information|page \d+)/i;
    const parsed = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const dates = [...line.matchAll(datePattern)];
      const amounts = [...line.matchAll(moneyPattern)];
      if (!dates.length || !amounts.length) continue;
      const cleanLine = line.replace(datePattern, " ").replace(moneyPattern, " ").replace(/\s+/g," ").trim();
      if (excluded.test(cleanLine) || cleanLine.length < 2) continue;
      const dateMatch = dates[0];
      const month = Number(dateMatch[1]), day = Number(dateMatch[2]);
      let year = dateMatch[3] ? Number(dateMatch[3]) : referenceYear;
      if (dateMatch[3]?.length === 2) year += 2000;
      else if (dateMatch[3] && dateMatch[3].length === 4) year = Number(dateMatch[3]);
      else if (month > referenceMonth) year--;
      const date = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const amountText = amounts[amounts.length - 1][0].trim();
      const negative = /^\s*\(?-/.test(amountText) || /-\s*$/.test(amountText) || /^\s*\(.*\)\s*$/.test(amountText);
      const amount = Number(amountText.replace(/[,$()\s-]/g,""));
      if (!Number.isFinite(amount) || !amount) continue;
      let description = cleanLine.replace(/^(?:transaction date|post date|date)\s*/i, "").replace(/^(?:purchase|payment|credit|debit)\s*/i, "").trim();
      if (description.length < 2) continue;
      const hint = /payment|autopay|online pmt|thank you|payment received|refund|return|credit adjustment/i.test(description);
      const isCard = account.startsWith("Credit card");
      const signed = negative ? -amount : hint ? amount : isCard ? -amount : -amount;
      const cardType = /refund|return|credit adjustment/i.test(description) ? "Refund" : /payment|autopay|online pmt|thank you|payment received/i.test(description) ? "Payment" : /interest charge/i.test(description) ? "Interest" : /annual fee|late fee|service fee/i.test(description) ? "Fee" : "Purchase";
      const checkingType = /credit card|credit crd|card payment|payment thank/i.test(description) ? "Card payment" : /payroll|paycheck|direct deposit|deposit|refund|return|reimbursement/i.test(description) ? "Income" : "Expense";
      parsed.push({ id: newId(), date, description, amount: signed, category: inferStatementCategory(description), type: isCard ? cardType : checkingType, pdfNeedsReview: amounts.length > 1 || dates.length > 1, include: true, originalIndex: index });
    }
    if (!parsed.length) throw new Error("No transaction rows could be identified in this PDF. If it is a scanned statement or the layout differs, use Chase's CSV activity export or share a sample statement so the parser can be adjusted.");
    return parsed;
  }
  function inferStatementCategory(description) {
    const s = String(description || "").toLowerCase();
    if (/grocery|market|supermarket|whole foods|trader joe/.test(s)) return "Groceries";
    if (/restaurant|cafe|coffee|dining|doordash|uber eats|restaurant/.test(s)) return "Dining";
    if (/gas|fuel|uber|lyft|transit|parking/.test(s)) return "Transportation";
    if (/electric|utility|water bill|internet|wireless|phone bill/.test(s)) return "Utilities";
    if (/interest charge/.test(s)) return "Interest";
    if (/annual fee|late fee|service fee/.test(s)) return "Fee";
    if (/payroll|paycheck|compass group|direct deposit/.test(s)) return "Paycheck";
    return "Other";
  }
  function statementDuplicate(t, account) {
    const normalize = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 34);
    if (account.startsWith("Credit card")) return data.cardTransactions.some(x => x.card === account && x.date === t.date && Number(x.amount) === Math.abs(t.amount) && normalize(x.description) === normalize(t.description)) || (t.type === "Payment" && data.transactions.some(x => x.type === "Card payment" && x.date === t.date && Number(x.amount) === Math.abs(t.amount)));
    return data.transactions.some(x => x.account === account && x.date === t.date && Number(x.amount) === Math.abs(t.amount) && normalize(x.description) === normalize(t.description)) || (t.type === "Card payment" && data.cardTransactions.some(x => x.type === "Payment" && x.date === t.date && Number(x.amount) === Math.abs(t.amount)));
  }
  function compassIncomeForMonth(m) {
    return txsForMonth(m)
      .filter((t) => t.type === "Income" && /compass\s*group/i.test(t.description || ""))
      .reduce((sum, t) => sum + Number(t.amount), 0);
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
    $("#stat-income").textContent = fmt(compassIncomeForMonth(selectedMonth));
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
  function monthlySpendingRows(month) {
    const rows = txsForMonth(month).filter(t => t.type === "Expense").map(t => ({
      date: t.date, description: t.description || "Expense", category: t.category || "Other", amount: Math.abs(Number(t.amount) || 0),
    }));
    const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const cardTx of data.cardTransactions.filter(t => monthOf(t.date) === month)) {
      const amount = Math.abs(Number(cardTx.amount) || 0);
      if (["Purchase", "Fee", "Interest"].includes(cardTx.type)) {
        const legacyDuplicate = rows.some(row => row.date === cardTx.date && row.amount === amount && normalize(row.description) === normalize(cardTx.description));
        if (!legacyDuplicate) rows.push({ date: cardTx.date, description: cardTx.description || "Card purchase", category: cardTx.category || "Other", amount });
      } else if (cardTx.type === "Refund") {
        rows.push({ date: cardTx.date, description: cardTx.description || "Card refund", category: cardTx.category || "Other", amount: -amount });
      }
    }
    return rows;
  }
  function compactMoney(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0);
  }
  function renderMonthlyCharts(month, spendingRows, incomeRows) {
    const categoryTotals = new Map();
    for (const row of spendingRows) categoryTotals.set(row.category, (categoryTotals.get(row.category) || 0) + row.amount);
    const categories = [...categoryTotals.entries()].filter(([, amount]) => amount > 0).sort((a,b)=>b[1]-a[1]);
    const totalSpending = Math.max(0, spendingRows.reduce((sum,row)=>sum + row.amount,0));
    $("#category-chart-total").textContent = `${fmt(totalSpending)} total`;
    if (!categories.length) {
      $("#monthly-category-chart").innerHTML = `<div class="chart-empty">No spending recorded for ${esc(monthLabel(month))} yet.</div>`;
    } else {
      const shown = categories.slice(0, 6);
      if (categories.length > 6) shown.push(["Other categories", categories.slice(6).reduce((sum,row)=>sum+row[1],0)]);
      const width = 640, height = shown.length * 42 + 12, barX = 175, barWidth = 355, max = Math.max(...shown.map(([,value])=>value),1);
      const bars = shown.map(([name,value],i)=>{
        const y = 8 + i * 42, label = name.length > 21 ? `${name.slice(0,20)}…` : name;
        const fill = Math.max(2,barWidth * value / max);
        return `<g><title>${esc(name)}: ${fmt(value)}</title><text x="0" y="${y+18}" class="chart-label">${esc(label)}</text><rect x="${barX}" y="${y}" width="${barWidth}" height="23" rx="7" class="chart-track"/><rect x="${barX}" y="${y}" width="${fill}" height="23" rx="7" class="chart-category-bar"/><text x="${barX+barWidth+10}" y="${y+17}" class="chart-value">${esc(compactMoney(value))}</text></g>`;
      }).join("");
      $("#monthly-category-chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Spending by category for ${esc(monthLabel(month))}">${bars}</svg>`;
    }
    const weeks = Array.from({length:5},(_,i)=>({ label:`Week ${i+1}`, income:0, spending:0 }));
    for (const t of incomeRows) { const day = Number(t.date.slice(8,10)); if (day) weeks[Math.min(4,Math.floor((day-1)/7))].income += Number(t.amount)||0; }
    for (const t of spendingRows) { const day = Number(t.date.slice(8,10)); if (day) weeks[Math.min(4,Math.floor((day-1)/7))].spending += t.amount; }
    const maxWeek = Math.max(1,...weeks.flatMap(w=>[w.income,w.spending]));
    const plotTop = 20, baseline = 188, plotHeight = baseline - plotTop;
    const grid = [0,0.5,1].map(part=>{const y=baseline-part*plotHeight;return `<line x1="54" y1="${y}" x2="625" y2="${y}" class="chart-gridline"/><text x="48" y="${y+4}" text-anchor="end" class="chart-axis-label">${esc(compactMoney(maxWeek*part))}</text>`;}).join("");
    const weekBars = weeks.map((w,i)=>{
      const center = 105+i*108, incomeHeight = Math.max(0,plotHeight*w.income/maxWeek), spendHeight = Math.max(0,plotHeight*Math.max(0,w.spending)/maxWeek);
      return `<g><title>${w.label}: income ${fmt(w.income)}, spending ${fmt(Math.max(0,w.spending))}</title><rect x="${center-25}" y="${baseline-incomeHeight}" width="25" height="${incomeHeight}" rx="5" class="chart-income-bar"/><rect x="${center+5}" y="${baseline-spendHeight}" width="25" height="${spendHeight}" rx="5" class="chart-spend-bar"/><text x="${center+2}" y="${baseline+22}" text-anchor="middle" class="chart-axis-label">${w.label}</text></g>`;
    }).join("");
    $("#monthly-week-chart").innerHTML = `<svg viewBox="0 0 640 230" role="img" aria-label="Weekly income and spending for ${esc(monthLabel(month))}">${grid}${weekBars}</svg>`;
    const income = incomeRows.reduce((sum,t)=>sum+(Number(t.amount)||0),0), net = income-totalSpending;
    const topCategory = categories[0];
    const merchantTotals = new Map();
    for (const row of spendingRows) if (row.amount > 0) merchantTotals.set(row.description,(merchantTotals.get(row.description)||0)+row.amount);
    const topMerchant = [...merchantTotals.entries()].sort((a,b)=>b[1]-a[1])[0];
    const insights = [
      ["Actual income",fmt(income)],
      ["Actual spending",fmt(totalSpending)],
      ["Income left after spending",fmt(net)],
      ["Top category",topCategory ? `${topCategory[0]} · ${fmt(topCategory[1])}` : "No spending yet"],
      ["Largest merchant",topMerchant ? `${topMerchant[0]} · ${fmt(topMerchant[1])}` : "No purchases yet"],
    ];
    $("#monthly-spending-insights").innerHTML = insights.map(([label,value])=>`<div class="planner-insight"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");
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
      actual = sums(selectedMonth),
      spendingRows = monthlySpendingRows(selectedMonth),
      incomeRows = txsForMonth(selectedMonth).filter(t=>t.type === "Income");
    renderMonthlyCharts(selectedMonth,spendingRows,incomeRows);
    const actualByCategory = new Map();
    spendingRows.forEach(row=>actualByCategory.set(row.category,(actualByCategory.get(row.category)||0)+row.amount));
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
        ...actualByCategory.keys(),
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
            actualCat = actualByCategory.get(cat) || 0;
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
    const statementFile = $("#statement-file"), statementAccount = $("#statement-account"), reviewBox = $("#statement-review");
    let statementRows = [], statementIndex = 0, statementDecisions = [], statementStep = "review";
    const status = message => { $("#statement-import-status").textContent = message; };
    const setStatementStep = step => { statementStep = step; renderStatementReview(); };
    const updateStatementRow = () => {
      const row = statementRows[statementIndex];
      if (!row) return;
      row.date = reviewBox.querySelector("[data-statement-date]")?.value || row.date;
      row.description = reviewBox.querySelector("[data-statement-description]")?.value.trim() || row.description;
      row.type = reviewBox.querySelector("[data-statement-type]")?.value || row.type;
      const amt = Number(reviewBox.querySelector("[data-statement-amount]")?.value);
      if (Number.isFinite(amt) && amt > 0) row.amount = row.type === "Income" || row.type === "Refund" ? amt : -amt;
      row.category = reviewBox.querySelector("[data-statement-category]")?.value || row.category;
      row.paymentCard = reviewBox.querySelector("[data-statement-payment-card]")?.value || row.paymentCard || data.cards[0]?.name;
    };
    function renderStatementReview() {
      if (!statementRows.length) { reviewBox.classList.add("hidden"); reviewBox.innerHTML = ""; return; }
      reviewBox.classList.remove("hidden");
      const account = statementAccount.value, isCard = account.startsWith("Credit card");
      if (statementStep === "confirm") {
        const included = statementDecisions.filter(d => d.action === "include").map(d => d.row);
        reviewBox.innerHTML = `<div class="statement-review-head"><div><div class="eyebrow">FINAL CHECK</div><h3>Confirm statement import</h3><p class="muted">${included.length} transaction${included.length === 1 ? "" : "s"} will be added to ${esc(account)}. Skipped rows will not be saved.</p></div><span class="statement-count">${included.length} to add</span></div><div class="table-wrap statement-preview"><table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Category</th><th class="align-right">Amount</th></tr></thead><tbody>${included.map(t=>`<tr><td>${esc(t.date)}</td><td>${esc(t.description)}</td><td>${esc(t.type)}</td><td>${esc(t.category)}</td><td class="align-right">${fmt(Math.abs(t.amount))}</td></tr>`).join("")}</tbody></table></div><div class="statement-actions"><button class="button secondary" data-statement-back>Back to review</button><button class="button" data-statement-confirm>Confirm and import ${included.length}</button></div>`;
        reviewBox.querySelector("[data-statement-back]").onclick = () => setStatementStep("review");
        reviewBox.querySelector("[data-statement-confirm]").onclick = importStatementRows;
        return;
      }
      if (statementStep === "done") {
        reviewBox.innerHTML = `<div class="statement-done"><div class="eyebrow">IMPORT COMPLETE</div><h3>Statement reviewed</h3><p class="muted">${statementDecisions.filter(d=>d.action === "include").length} transactions added; ${statementDecisions.filter(d=>d.action === "skip").length} skipped.</p><button class="button secondary" data-statement-reset>Review another statement</button></div>`;
        reviewBox.querySelector("[data-statement-reset]").onclick = resetStatementReview;
        return;
      }
      if (statementIndex >= statementRows.length) { setStatementStep("confirm"); return; }
      const row = statementRows[statementIndex];
      const typeOptions = isCard ? ["Purchase", "Refund", "Payment", "Fee", "Interest"] : ["Expense", "Income", "Card payment", "Transfer"];
      const defaultType = isCard ? (/payment|autopay|online pmt/i.test(row.description) ? "Payment" : row.amount > 0 ? "Refund" : "Purchase") : (/card payment|autopay|payment thank/i.test(row.description) ? "Card payment" : row.amount > 0 ? "Income" : "Expense");
      if (!row.type || !typeOptions.includes(row.type)) row.type = defaultType;
      const duplicate = statementDuplicate(row, account);
      reviewBox.innerHTML = `<div class="statement-review-head"><div><div class="eyebrow">TRANSACTION ${statementIndex + 1} OF ${statementRows.length}</div><h3>Keep it or skip it?</h3></div><span class="statement-count">${statementDecisions.filter(d=>d.action === "include").length} kept · ${statementDecisions.filter(d=>d.action === "skip").length} skipped</span></div>${duplicate ? `<div class="duplicate-warning"><strong>Possible duplicate</strong><span>A matching transaction already exists for this account, date, amount, and description.</span></div>` : ""}${row.pdfNeedsReview ? `<div class="duplicate-warning"><strong>Double-check the PDF values</strong><span>The statement line contained more than one date or amount, so confirm the extracted date and amount before keeping it.</span></div>` : ""}<div class="swipe-transaction"><label>Date<input data-statement-date type="date" value="${esc(row.date)}"></label><label>Merchant / description<input data-statement-description maxlength="120" value="${esc(row.description)}"></label><label>Type<select data-statement-type>${typeOptions.map(t=>`<option ${row.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>Category<select data-statement-category>${[...new Set([...CATEGORIES,"Dining","Travel","Fee","Interest","Other",row.category])].map(c=>`<option ${row.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label><label>Amount ($)<input data-statement-amount type="number" min=".01" step=".01" value="${Math.abs(row.amount).toFixed(2)}"></label>${!isCard ? `<label data-payment-card-wrap>Card receiving payment<select data-statement-payment-card>${data.cards.map(c=>`<option value="${esc(c.name)}" ${row.paymentCard === c.name ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}<div class="statement-swipe-buttons"><button class="button secondary" data-statement-swipe="skip" aria-label="Skip this transaction">← Skip</button><button class="button" data-statement-swipe="include">Keep →</button></div></div><div class="statement-actions"><button class="text-button" data-statement-undo ${statementDecisions.length ? "" : "disabled"}>Undo last swipe</button></div>`;
      const statementTypeSelect = reviewBox.querySelector("[data-statement-type]");
      const paymentCardWrap = reviewBox.querySelector("[data-payment-card-wrap]");
      if (statementTypeSelect && paymentCardWrap) {
        const showPaymentCard = () => paymentCardWrap.classList.toggle("hidden", statementTypeSelect.value !== "Card payment");
        statementTypeSelect.addEventListener("change", showPaymentCard);
        showPaymentCard();
      }
      reviewBox.querySelectorAll("[data-statement-swipe]").forEach(button => button.onclick = () => {
        updateStatementRow();
        const rowNow = statementRows[statementIndex];
        if (!rowNow.date || !rowNow.description || !Number.isFinite(rowNow.amount) || rowNow.amount === 0) { status("Please enter a valid date, description, and non-zero amount before swiping."); return; }
        statementDecisions.push({ index: statementIndex, action: button.dataset.statementSwipe, row: { ...rowNow } });
        statementIndex++; status(""); renderStatementReview();
      });
      reviewBox.querySelector("[data-statement-undo]").onclick = () => {
        const prev = statementDecisions.pop(); if (!prev) return;
        statementIndex = prev.index; statementRows[statementIndex] = prev.row; renderStatementReview();
      };
    }
    function importStatementRows() {
      const account = statementAccount.value;
      for (const decision of statementDecisions) {
        if (decision.action !== "include") continue;
        const t = decision.row, amount = Math.abs(Number(t.amount));
        if (account.startsWith("Credit card")) {
          const cardTx = { id: newId(), date: t.date, type: t.type, card: account, description: t.description, category: t.category, amount, notes: "Imported from statement" };
          data.cardTransactions.push(cardTx);
          if (t.type === "Payment") {
            const checkingPayment = data.transactions.find(x => x.type === "Card payment" && x.date === t.date && Number(x.amount) === amount && !x.cardTransactionId);
            if (checkingPayment) checkingPayment.cardTransactionId = cardTx.id;
          }
        } else {
          const type = t.type;
          const tx = { id: newId(), date: t.date, type, description: t.description, category: type === "Card payment" ? "Credit card" : t.category, amount, account, notes: "Imported from statement" };
          if (type === "Card payment") {
            const card = data.cards.find(c => c.name === t.paymentCard) || data.cards[0];
            let cardTx = data.cardTransactions.find(x => x.card === card.name && x.type === "Payment" && x.date === t.date && Number(x.amount) === amount && !data.transactions.some(linked => linked.cardTransactionId === x.id));
            if (!cardTx) { cardTx = { id: newId(), date: t.date, type: "Payment", card: card.name, description: t.description, category: "Credit card", amount, notes: "Matched from checking statement" }; data.cardTransactions.push(cardTx); }
            tx.cardTransactionId = cardTx.id;
          }
          data.transactions.push(tx);
        }
      }
      const added = statementDecisions.filter(d => d.action === "include").length;
      selectedMonth = statementRows[0]?.date ? monthOf(statementRows[0].date) : selectedMonth;
      save(); render(); setStatementStep("done"); status(`${added} transaction${added === 1 ? "" : "s"} imported to ${account}.`);
    }
    function resetStatementReview() { statementRows = []; statementDecisions = []; statementIndex = 0; statementAccount.disabled = false; statementFile.value = ""; $("#start-statement-review").disabled = true; reviewBox.classList.add("hidden"); reviewBox.innerHTML = ""; status(""); }
    statementFile.onchange = () => { $("#start-statement-review").disabled = !statementFile.files?.length; status(statementFile.files?.length ? "Statement selected. Choose the account, then start reviewing." : ""); };
    statementAccount.onchange = () => {
      [...data.cards.map(c=>c.name)].forEach(name => { if (![...statementAccount.options].some(o=>o.value === name)) statementAccount.add(new Option(name, name)); });
    };
    statementAccount.onchange();
    $("#start-statement-review").onclick = async () => {
      const file = statementFile.files?.[0]; if (!file) return;
      try {
        const isPDF = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const parsed = isPDF ? await parseStatementPDF(file, statementAccount.value) : parseStatementCSV(await file.text());
        if (!parsed.length) throw new Error("No valid transactions were found. Check that the CSV includes dates and amounts.");
        statementRows = parsed; statementDecisions = []; statementIndex = 0; statementAccount.disabled = true; setStatementStep("review");
        status(`${parsed.length} possible transaction rows found. Nothing is saved until you confirm the final import.`);
      } catch (error) { status(error.message || "Could not read this CSV."); }
    };
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
