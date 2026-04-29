const TARGET_URL = "https://tarefario.dtigab.com.br";
const STORAGE_KEY = "task-time-entries-v1";
const LOGIN_URL = "http://ponto4psg.aguiabranca.com.br/Paginas/pgLogin.aspx";

let cachedTransformedEntries = [];
let cachedSelectedPeriod = null;
let cachedPointTableEntries = [];
let cachedNewEntries = [];
let cachedRegisteredEntries = [];
let cachedFailedEntries = [];
const executionTabIds = new Set();

function trackExecutionTab(tabId) {
  if (typeof tabId === "number") {
    executionTabIds.add(tabId);
  }
}

async function closeExecutionTabs() {
  const ids = Array.from(executionTabIds);
  executionTabIds.clear();

  if (ids.length === 0) {
    return;
  }

  for (const tabId of ids) {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // Ignore tabs already closed by navigation or user interaction.
    }
  }
}

function capitalizeWords(value) {
  const normalized = String(value || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  return normalized.replace(/(^|\s)(\S)/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function isMissingTimeValue(value) {
  const normalized = String(value || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();

  return normalized === "" || normalized === "falta" || normalized === "folga";
}

function hasMissingHours(pointEntry) {
  return [pointEntry.ent1, pointEntry.sai1, pointEntry.ent2, pointEntry.sai2].some(isMissingTimeValue);
}

function isValidHour(value) {
  const normalized = String(value || "")
    .replace(/\u00a0/g, " ")
    .trim();

  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized);
}

function hasCompleteTarefarioHours(entry) {
  return [entry?.ent1, entry?.sai1, entry?.ent2, entry?.sai2].every(isValidHour);
}

function buildNewEntries(pointEntries, tarefarioEntries) {
  const tarefarioByDate = new Map(
    tarefarioEntries
      .filter((entry) => entry?.date)
      .map((entry) => [entry.date, entry])
  );

  const selectedDates = new Set();
  const result = [];

  for (const pointEntry of pointEntries) {
    if (!hasMissingHours(pointEntry)) {
      continue;
    }

    const tarefarioEntry = tarefarioByDate.get(pointEntry.date);

    if (!tarefarioEntry) {
      continue;
    }

    if (!hasCompleteTarefarioHours(tarefarioEntry)) {
      continue;
    }

    if (selectedDates.has(pointEntry.date)) {
      continue;
    }

    selectedDates.add(pointEntry.date);
    result.push(tarefarioEntry);
  }

  return result;
}

async function readPointTableEntries(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const toAbsoluteUrl = (value) => {
        if (!value) {
          return null;
        }

        return new URL(value, window.location.href).toString();
      };

      const normalizeCell = (value) =>
        String(value || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const extractEditUrl = (cell) => {
        const link = cell.querySelector("a");
        const href = link?.getAttribute("href") || "";
        const optionsMatch = href.match(/WebForm_PostBackOptions\([^)]*?\"([^\"]*pgAlterarBatidas\.aspx[^\"]*)\"/i);

        if (optionsMatch?.[1]) {
          return toAbsoluteUrl(optionsMatch[1].replace(/&amp;/g, "&"));
        }

        const directMatch = href.match(/(pgAlterarBatidas\.aspx[^"']*)/i);

        if (directMatch?.[1]) {
          return toAbsoluteUrl(directMatch[1].replace(/&amp;/g, "&"));
        }

        return null;
      };

      const parseDate = (value) => {
        const match = String(value || "").match(/(\d{2})\/(\d{2})\/(\d{2,4})/);

        if (!match) {
          return null;
        }

        const day = Number(match[1]);
        const month = Number(match[2]);
        let year = Number(match[3]);

        if (year < 100) {
          year += 2000;
        }

        return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      };

      const table = document.querySelector("#ctl00_ContentPlaceHolder1_dgvGrade");

      if (!table) {
        throw new Error("Tabela de grade nao encontrada na pagina.");
      }

      const rows = Array.from(table.querySelectorAll("tr"));
      const entries = [];

      for (const row of rows.slice(1)) {
        const cells = Array.from(row.querySelectorAll("td"));

        if (cells.length < 5) {
          continue;
        }

        const rawDate = normalizeCell(cells[0].textContent);
        const normalizedDate = parseDate(rawDate);

        if (!normalizedDate) {
          continue;
        }

        entries.push({
          date: normalizedDate,
          ent1: normalizeCell(cells[1].textContent),
          sai1: normalizeCell(cells[2].textContent),
          ent2: normalizeCell(cells[3].textContent),
          sai2: normalizeCell(cells[4].textContent),
          rawDate,
          editUrl: extractEditUrl(cells[0]),
        });
      }

      return entries;
    },
  });

  if (!Array.isArray(result)) {
    throw new Error("Nao foi possivel ler os dados da grade de ponto.");
  }

  return result;
}

function formatPeriodRange(period) {
  if (!period?.month || !period?.year) {
    throw new Error("Mes e ano sao obrigatorios para definir o periodo.");
  }

  const monthNumber = Number(period.month);
  const yearNumber = Number(period.year);

  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    throw new Error("Mes invalido para definir o periodo.");
  }

  if (!Number.isInteger(yearNumber) || yearNumber < 1900) {
    throw new Error("Ano invalido para definir o periodo.");
  }

  const lastDay = new Date(yearNumber, monthNumber, 0).getDate();
  const month = String(monthNumber).padStart(2, "0");

  return {
    startDate: `01/${month}/${yearNumber}`,
    endDate: `${String(lastDay).padStart(2, "0")}/${month}/${yearNumber}`,
  };
}

async function focusTabWindow(tabId) {
  const tab = await chrome.tabs.get(tabId);

  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  await chrome.tabs.update(tabId, { active: true });
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timeout ao carregar a pagina do Tarefario."));
    }, timeoutMs);

    const listener = (updatedTabId, info) => {
      if (updatedTabId !== tabId) {
        return;
      }

      if (info.status === "complete") {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function waitForPossibleNavigation(tabId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);

    const listener = (updatedTabId, info) => {
      if (updatedTabId !== tabId) {
        return;
      }

      if (info.status === "complete") {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function createFreshTab(url, active = false) {
  const createdTab = await chrome.tabs.create({ url, active });

  if (!createdTab.id) {
    throw new Error("Nao foi possivel abrir uma nova aba.");
  }

  trackExecutionTab(createdTab.id);
  await waitForTabComplete(createdTab.id);
  return createdTab.id;
}

async function getOrCreateTargetTab() {
  return createFreshTab(TARGET_URL, false);
}

async function resolveSourceTarefarioTabId(sender) {
  const senderTabId = sender?.tab?.id;

  if (typeof senderTabId === "number") {
    return senderTabId;
  }

  return getOrCreateTargetTab();
}

async function getOrCreateLoginTab() {
  return createFreshTab(LOGIN_URL, false);
}

async function readStorageFromTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (key) => {
      return localStorage.getItem(key);
    },
    args: [STORAGE_KEY],
  });

  return result;
}

function normalizePayload(rawValue) {
  if (!rawValue) {
    throw new Error(`A chave ${STORAGE_KEY} nao foi encontrada no localStorage.`);
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      throw new Error("O formato de task-time-entries-v1 nao e uma lista de registros.");
    }

    const transformed = parsed.map((entry) => ({
      date: entry?.date ?? null,
      ent1: entry?.startTime ?? null,
      sai1: entry?.lunchOutTime ?? null,
      ent2: entry?.lunchReturnTime ?? null,
      sai2: entry?.endTime ?? null,
      observacao: capitalizeWords(entry?.workMode),
    }));

    return transformed;
  } catch {
    throw new Error("Nao foi possivel ler e transformar o JSON de task-time-entries-v1.");
  }
}

function filterEntriesByPeriod(entries, period) {
  if (!period?.month || !period?.year) {
    throw new Error("Mes e ano sao obrigatorios para selecionar os lancamentos.");
  }

  return entries.filter((entry) => {
    if (!entry?.date || typeof entry.date !== "string") {
      return false;
    }

    const [year, month] = entry.date.split("-");
    return year === period.year && month === period.month;
  });
}

function cacheTransformedEntries(entries, period) {
  cachedTransformedEntries = entries;
  cachedSelectedPeriod = period;
}

async function openFinalResultTab() {
  const rowsHtml = cachedRegisteredEntries
    .map(
      (entry) => `
      <tr>
        <td>${entry.date || "-"}</td>
        <td>${entry.ent1 || "-"}</td>
        <td>${entry.sai1 || "-"}</td>
        <td>${entry.ent2 || "-"}</td>
        <td>${entry.sai2 || "-"}</td>
        <td>${entry.observacao || "-"}</td>
      </tr>`
    )
    .join("");

  const failedHtml = cachedFailedEntries
    .map((entry) => `<li>${entry.date || "Sem data"}: ${entry.error || "Falha desconhecida"}</li>`)
    .join("");

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Resultado Final - Drop Ponto Tarefário</title>
    <style>
      body { margin: 0; padding: 16px; font-family: "Segoe UI", Tahoma, sans-serif; background: #f7f9fc; color: #162033; }
      h1 { margin: 0 0 12px; font-size: 18px; }
      .summary { display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 10px; margin-bottom: 16px; }
      .card { background: #ffffff; border: 1px solid #d7e1ee; border-radius: 8px; padding: 10px; }
      .card b { display: block; font-size: 12px; color: #52607a; margin-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #d7e1ee; }
      th, td { border: 1px solid #d7e1ee; padding: 8px; font-size: 12px; text-align: left; }
      th { background: #edf3fb; }
      .empty { margin-top: 8px; color: #52607a; }
      .failed { margin-top: 14px; padding: 10px; border-radius: 8px; background: #fff7f7; border: 1px solid #f1c9c9; }
      .failed h2 { margin: 0 0 6px; font-size: 14px; color: #8f1f1f; }
      .failed ul { margin: 0; padding-left: 18px; font-size: 12px; }
    </style>
  </head>
  <body>
    <h1>Resultado Final</h1>
    <div class="summary">
      <div class="card"><b>Competência</b>${cachedSelectedPeriod?.month || "--"}/${cachedSelectedPeriod?.year || "----"}</div>
      <div class="card"><b>Registros do Tarefário</b>${cachedTransformedEntries.length}</div>
      <div class="card"><b>Registros lidos na grade</b>${cachedPointTableEntries.length}</div>
      <div class="card"><b>Registros novos identificados</b>${cachedNewEntries.length}</div>
      <div class="card"><b>Registros salvos com sucesso</b>${cachedRegisteredEntries.length}</div>
      <div class="card"><b>Registros com falha</b>${cachedFailedEntries.length}</div>
    </div>
    ${
      cachedRegisteredEntries.length > 0
        ? `<table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Ent. 1</th>
          <th>Saí. 1</th>
          <th>Ent. 2</th>
          <th>Saí. 2</th>
          <th>Observação</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`
        : '<p class="empty">Nenhuma alteração foi registrada.</p>'
    }
    ${
      cachedFailedEntries.length > 0
        ? `<section class="failed"><h2>Falhas no processamento</h2><ul>${failedHtml}</ul></section>`
        : ""
    }
  </body>
</html>`;

  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const tab = await chrome.tabs.create({ url, active: true });

  if (tab.id) {
    await focusTabWindow(tab.id);
  }
}

async function navigateTab(tabId, url) {
  await chrome.tabs.update(tabId, { url, active: false });
  await waitForTabComplete(tabId);
}

async function fillAndSavePointEntry(tabId, entry) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (payload) => {
      const parsePostBack = (element) => {
        const href = element?.getAttribute("href") || "";
        const match = href.match(/__doPostBack\('([^']*)','([^']*)'\)/);

        return {
          eventTarget: match?.[1] || element?.name || element?.id || "",
          eventArgument: match?.[2] || "",
        };
      };

      const setFieldValue = (selector, value) => {
        const input = document.querySelector(selector);

        if (!input) {
          throw new Error(`Campo nao encontrado: ${selector}`);
        }

        input.focus();
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return input;
      };

      setFieldValue("#ctl00_ContentPlaceHolder1_txtEntrada1", payload.ent1);
      setFieldValue("#ctl00_ContentPlaceHolder1_txtSaida1", payload.sai1);
      setFieldValue("#ctl00_ContentPlaceHolder1_txtEntrada2", payload.ent2);
      setFieldValue("#ctl00_ContentPlaceHolder1_txtSaida2", payload.sai2);

      const observationInput = document.querySelector("#ctl00_ContentPlaceHolder1_txtObservacao");

      if (!observationInput) {
        throw new Error("Campo de observacao nao encontrado.");
      }

      const currentObservation = String(observationInput.value || "").trim();

      if (!currentObservation && payload.observacao) {
        observationInput.focus();
        observationInput.value = payload.observacao;
        observationInput.dispatchEvent(new Event("input", { bubbles: true }));
        observationInput.dispatchEvent(new Event("change", { bubbles: true }));
      }

      const saveButton = document.querySelector("#ctl00_ContentPlaceHolder1_lnkSalvar");
      const form = saveButton?.closest("form") || document.forms[0];

      if (!saveButton || !form) {
        throw new Error("Botao Salvar nao encontrado na tela de alteracao.");
      }

      const { eventTarget, eventArgument } = parsePostBack(saveButton);
      const eventTargetInput = form.querySelector('input[name="__EVENTTARGET"]');
      const eventArgumentInput = form.querySelector('input[name="__EVENTARGUMENT"]');

      if (eventTargetInput) {
        eventTargetInput.value = eventTarget;
      }

      if (eventArgumentInput) {
        eventArgumentInput.value = eventArgument;
      }

      const shouldSubmit = typeof form.onsubmit !== "function" || form.onsubmit() !== false;

      if (!shouldSubmit) {
        throw new Error("O salvamento foi bloqueado pela validacao da pagina.");
      }

      HTMLFormElement.prototype.submit.call(form);
    },
    args: [entry],
  });

  await waitForTabComplete(tabId);
}

async function applyNewEntriesOnPointSystem(tabId, newEntries, pointEntries) {
  const pointEntriesByDate = new Map(pointEntries.filter((entry) => entry?.date).map((entry) => [entry.date, entry]));
  const registered = [];
  const failed = [];

  for (const entry of newEntries) {
    const pointEntry = pointEntriesByDate.get(entry.date);

    if (!pointEntry?.editUrl) {
      failed.push({
        date: entry.date,
        error: "Link de edição não encontrado para a data.",
      });
      continue;
    }

    try {
      await navigateTab(tabId, pointEntry.editUrl);
      await fillAndSavePointEntry(tabId, entry);
      registered.push(entry);
    } catch (error) {
      failed.push({
        date: entry.date,
        error: error instanceof Error ? error.message : "Falha ao salvar registro.",
      });
    }
  }

  return { registered, failed };
}

async function loginToPointSystem(credentials) {
  if (!credentials?.username || !credentials?.password) {
    throw new Error("Usuario e senha sao obrigatorios para o login.");
  }

  const loginTabId = await getOrCreateLoginTab();

  await chrome.scripting.executeScript({
    target: { tabId: loginTabId },
    func: ({ username, password }) => {
      const parsePostBack = (element) => {
        const href = element?.getAttribute("href") || "";
        const match = href.match(/__doPostBack\('([^']*)','([^']*)'\)/);

        return {
          eventTarget: match?.[1] || element?.name || element?.id || "",
          eventArgument: match?.[2] || "",
        };
      };

      const usernameInput = document.querySelector("#txtUsuario");
      const passwordInput = document.querySelector("#txtSenha");
      const loginButton = document.querySelector("#lnkLogin");
      const form = loginButton?.closest("form") || document.forms[0];

      if (!usernameInput || !passwordInput || !loginButton || !form) {
        throw new Error("Campos de login nao encontrados na pagina de ponto.");
      }

      usernameInput.focus();
      usernameInput.value = username;
      usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
      usernameInput.dispatchEvent(new Event("change", { bubbles: true }));

      passwordInput.focus();
      passwordInput.value = password;
      passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
      passwordInput.dispatchEvent(new Event("change", { bubbles: true }));

      const { eventTarget, eventArgument } = parsePostBack(loginButton);
      const eventTargetInput = form.querySelector('input[name="__EVENTTARGET"]');
      const eventArgumentInput = form.querySelector('input[name="__EVENTARGUMENT"]');

      if (eventTargetInput) {
        eventTargetInput.value = eventTarget;
      }

      if (eventArgumentInput) {
        eventArgumentInput.value = eventArgument;
      }

      const shouldSubmit = typeof form.onsubmit !== "function" || form.onsubmit() !== false;

      if (!shouldSubmit) {
        throw new Error("O formulario de login foi bloqueado pela validacao da pagina.");
      }

      HTMLFormElement.prototype.submit.call(form);
    },
    args: [credentials],
  });

  await waitForTabComplete(loginTabId);

  return loginTabId;
}

async function setSelectedPeriodOnPointSystem(tabId, period) {
  const { startDate, endDate } = formatPeriodRange(period);

  await chrome.scripting.executeScript({
    target: { tabId },
    func: ({ startDateValue, endDateValue }) => {
      const parsePostBack = (element) => {
        const href = element?.getAttribute("href") || "";
        const match = href.match(/__doPostBack\('([^']*)','([^']*)'\)/);

        return {
          eventTarget: match?.[1] || element?.name || element?.id || "",
          eventArgument: match?.[2] || "",
        };
      };

      const startInput = document.querySelector("#ctl00_ContentPlaceHolder1_txtPeriodoIni");
      const endInput = document.querySelector("#ctl00_ContentPlaceHolder1_txtPeriodoFim");
      const updateButton = document.querySelector("#ctl00_ContentPlaceHolder1_lnkAtualizar");
      const form = updateButton?.closest("form") || document.forms[0];

      if (!startInput || !endInput || !updateButton || !form) {
        throw new Error("Campos de periodo ou botao Atualizar nao encontrados na pagina de ponto.");
      }

      startInput.focus();
      startInput.value = startDateValue;
      startInput.dispatchEvent(new Event("input", { bubbles: true }));
      startInput.dispatchEvent(new Event("change", { bubbles: true }));

      endInput.focus();
      endInput.value = endDateValue;
      endInput.dispatchEvent(new Event("input", { bubbles: true }));
      endInput.dispatchEvent(new Event("change", { bubbles: true }));

      const { eventTarget, eventArgument } = parsePostBack(updateButton);
      const eventTargetInput = form.querySelector('input[name="__EVENTTARGET"]');
      const eventArgumentInput = form.querySelector('input[name="__EVENTARGUMENT"]');

      if (eventTargetInput) {
        eventTargetInput.value = eventTarget;
      }

      if (eventArgumentInput) {
        eventArgumentInput.value = eventArgument;
      }

      const shouldSubmit = typeof form.onsubmit !== "function" || form.onsubmit() !== false;

      if (!shouldSubmit) {
        throw new Error("A atualizacao do periodo foi bloqueada pela validacao da pagina.");
      }

      HTMLFormElement.prototype.submit.call(form);
    },
    args: [{ startDateValue: startDate, endDateValue: endDate }],
  });

  await waitForPossibleNavigation(tabId, 15000);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "TRANSFER") {
    return false;
  }

  (async () => {
    try {
      const sourceTabId = await resolveSourceTarefarioTabId(sender);
      const rawValue = await readStorageFromTab(sourceTabId);
      const transformedEntries = normalizePayload(rawValue);
      const filteredEntries = filterEntriesByPeriod(transformedEntries, message.period);

      if (filteredEntries.length === 0) {
        throw new Error("Nenhum lancamento encontrado para o mes/ano selecionado.");
      }

      cacheTransformedEntries(filteredEntries, message.period);
      const pointTabId = await loginToPointSystem(message.credentials);
      await setSelectedPeriodOnPointSystem(pointTabId, cachedSelectedPeriod);
      cachedPointTableEntries = await readPointTableEntries(pointTabId);
      cachedNewEntries = buildNewEntries(cachedPointTableEntries, cachedTransformedEntries);
      const applyResult = await applyNewEntriesOnPointSystem(pointTabId, cachedNewEntries, cachedPointTableEntries);
      cachedRegisteredEntries = applyResult.registered;
      cachedFailedEntries = applyResult.failed;
      await openFinalResultTab();

      sendResponse({
        ok: true,
        count: cachedTransformedEntries.length,
        tableCount: cachedPointTableEntries.length,
        newCount: cachedNewEntries.length,
        savedCount: cachedRegisteredEntries.length,
        failedCount: cachedFailedEntries.length,
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao transferir.",
      });
    } finally {
      await closeExecutionTabs();
    }
  })();

  return true;
});