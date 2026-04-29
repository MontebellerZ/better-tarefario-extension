(() => {
  "use strict";

  const ROOT_ID = "better-tarefario-root";
  const STORAGE_KEY = "better-tarefario-active-tab";
  const STORAGE_HIDDEN_KEY = "better-tarefario-hidden-cards";
  const STORAGE_PENDING_LEGACY_KEY = "better-tarefario-pending-cards";
  const TAB_MEUS = "meus";
  const TAB_REVIEW = "review";
  const TAB_OCULTOS = "ocultos";
  const TAB_PENDENTES_LEGACY = "pendentes";
  const CARD_SELECTOR = "app-task-card";
  const TASK_CARD_SELECTOR = ".task-card";
  const TASK_ID_SELECTOR = ".task-id a";
  const STATUS_GROUP_SELECTOR = ".status-group";
  const OPTIONS_CONTAINER_CLASS = "tarefario-card-options";
  const OPTIONS_TRIGGER_CLASS = "tarefario-options-trigger";
  const OPTIONS_MENU_CLASS = "tarefario-options-menu";
  const HIDDEN_CHECKBOX_CLASS = "tarefario-hidden-checkbox";
  const CARD_HIDE_ANIMATION_MS = 220;
  const PRIORITY_TEXT_SELECTOR = ".task-meta .meta-text";
  const BADGE_SELECTOR = ".status-badge";
  const GRID_SELECTOR = ".tasks-grid";

  const APONTAMENTOS_PATH_PREFIX = "/apontamentos";
  const APONTAMENTOS_FILTER_SELECTOR = ".time-entries-filter";
  const APONTAMENTOS_TRANSFER_SLOT_ID = "better-tarefario-transfer-slot";
  const APONTAMENTOS_TRANSFER_BUTTON_ID = "better-tarefario-transfer-button";
  const APONTAMENTOS_MODAL_ROOT_ID = "better-tarefario-transfer-modal-root";
  const APONTAMENTOS_LOADING_ROOT_ID = "better-tarefario-transfer-loading-root";

  const USERNAME_STORAGE_KEY = "savedUsername";
  const PERIOD_STORAGE_KEY = "selectedCompetency";
  const SAVED_PASSWORD_STORAGE_KEY = "savedPassword";
  const REMEMBER_PASSWORD_STORAGE_KEY = "rememberPassword";
  const MONTH_NAMES = [
    "Janeiro",
    "Fevereiro",
    "Marco",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro"
  ];

  let activeTab = readSavedTab();
  let hiddenCardIds = readHiddenCardIds();
  let observer;
  let refreshPending = false;
  let resizeListenerAttached = false;
  let optionsListenersAttached = false;
  let apontamentosObserver;
  let transferModalRefs;
  let transferInProgress = false;

  function readSavedTab() {
    const savedTab = window.localStorage.getItem(STORAGE_KEY);
    if (savedTab === TAB_PENDENTES_LEGACY) {
      return TAB_OCULTOS;
    }

    if (savedTab === TAB_MEUS || savedTab === TAB_REVIEW || savedTab === TAB_OCULTOS) {
      return savedTab;
    }

    return TAB_MEUS;
  }

  function readHiddenCardIds() {
    const rawHiddenCards =
      window.localStorage.getItem(STORAGE_HIDDEN_KEY) ||
      window.localStorage.getItem(STORAGE_PENDING_LEGACY_KEY);

    if (!rawHiddenCards) {
      return new Set();
    }

    try {
      const parsedHiddenCards = JSON.parse(rawHiddenCards);
      if (!Array.isArray(parsedHiddenCards)) {
        return new Set();
      }

      const normalizedIds = parsedHiddenCards
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      return new Set(normalizedIds);
    } catch {
      return new Set();
    }
  }

  function saveActiveTab() {
    window.localStorage.setItem(STORAGE_KEY, activeTab);
  }

  function saveHiddenCardIds() {
    window.localStorage.setItem(STORAGE_HIDDEN_KEY, JSON.stringify(Array.from(hiddenCardIds)));
  }

  function getCards() {
    return Array.from(document.querySelectorAll(CARD_SELECTOR));
  }

  function getCardId(card) {
    const cachedId = card.dataset.betterTarefarioCardId;
    if (cachedId) {
      return cachedId;
    }

    const idLink = card.querySelector(TASK_ID_SELECTOR);
    if (!idLink) {
      return "";
    }

    const href = idLink.getAttribute("href") || "";
    const hrefMatch = href.match(/\/edit\/(\d+)/i);
    const textMatch = (idLink.textContent || "").trim().match(/^#?(\d+)$/);
    const cardId = (hrefMatch && hrefMatch[1]) || (textMatch && textMatch[1]) || "";

    if (cardId) {
      card.dataset.betterTarefarioCardId = cardId;
    }

    return cardId;
  }

  function isCardHidden(card) {
    const cardId = getCardId(card);
    return Boolean(cardId) && hiddenCardIds.has(cardId);
  }

  function isCodeReviewCard(card) {
    const badge = card.querySelector(BADGE_SELECTOR);
    if (!badge) {
      return false;
    }

    if (badge.classList.contains("status-code-review")) {
      return true;
    }

    const badgeText = (badge.textContent || "").toLowerCase();
    return badgeText.includes("code review");
  }

  function shouldShowCard(card) {
    if (activeTab === TAB_OCULTOS) {
      return isCardHidden(card);
    }

    const isCodeReview = isCodeReviewCard(card);
    if (activeTab === TAB_REVIEW) {
      return isCodeReview;
    }

    return !isCodeReview && !isCardHidden(card);
  }

  function updateCounters(cards) {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
      return;
    }

    const cardsList = cards || getCards();
    const reviewCount = cardsList.filter(isCodeReviewCard).length;
    const hiddenCount = cardsList.filter(isCardHidden).length;
    const meusCount = cardsList.filter((card) => !isCodeReviewCard(card) && !isCardHidden(card)).length;

    const meusButton = root.querySelector('[data-tab="meus"]');
    const reviewButton = root.querySelector('[data-tab="review"]');
    const hiddenButton = root.querySelector('[data-tab="ocultos"]');

    if (meusButton) {
      meusButton.textContent = `Meus (${meusCount})`;
    }

    if (reviewButton) {
      reviewButton.textContent = `Code Review (${reviewCount})`;
    }

    if (hiddenButton) {
      hiddenButton.textContent = `Ocultos (${hiddenCount})`;
    }
  }

  function updateTabUI() {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
      return;
    }

    root.querySelectorAll(".tarefario-tab-button").forEach((button) => {
      const isActive = button.dataset.tab === activeTab;
      button.classList.toggle("is-active", isActive);
    });
  }

  function resetCardHeights(cards) {
    cards.forEach((card) => {
      const taskCard = card.querySelector(TASK_CARD_SELECTOR);
      if (taskCard) {
        taskCard.style.height = "";
      }
    });
  }

  function alignCardsByRow(cards) {
    const cardsList = cards || getCards();
    resetCardHeights(cardsList);

    const visibleCards = cardsList.filter(
      (card) => card.style.display !== "none" && card.offsetParent !== null
    );

    if (!visibleCards.length) {
      return;
    }

    const rowsMap = new Map();

    visibleCards.forEach((card) => {
      const taskCard = card.querySelector(TASK_CARD_SELECTOR);
      if (!taskCard) {
        return;
      }

      const rowTop = Math.round(card.getBoundingClientRect().top);
      const rowCards = rowsMap.get(rowTop) || [];
      rowCards.push(taskCard);
      rowsMap.set(rowTop, rowCards);
    });

    rowsMap.forEach((rowCards) => {
      let maxHeight = 0;
      rowCards.forEach((taskCard) => {
        maxHeight = Math.max(maxHeight, taskCard.offsetHeight);
      });

      rowCards.forEach((taskCard) => {
        taskCard.style.height = `${maxHeight}px`;
      });
    });
  }

  function closeOptionsMenus(excludedCard) {
    getCards().forEach((card) => {
      if (excludedCard && card === excludedCard) {
        return;
      }

      const optionsContainer = card.querySelector(`.${OPTIONS_CONTAINER_CLASS}`);
      if (optionsContainer) {
        optionsContainer.classList.remove("is-open");
      }
    });
  }

  function ensureOptionsListeners() {
    if (optionsListenersAttached) {
      return;
    }

    document.addEventListener("click", () => {
      closeOptionsMenus();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeOptionsMenus();
      }
    });

    optionsListenersAttached = true;
  }

  function updateHiddenCardUI(card) {
    const hiddenCheckbox = card.querySelector(`.${HIDDEN_CHECKBOX_CLASS}`);
    if (!hiddenCheckbox) {
      return;
    }

    const taskCard = card.querySelector(TASK_CARD_SELECTOR);
    const cardId = getCardId(card);

    if (!cardId) {
      hiddenCheckbox.disabled = true;
      hiddenCheckbox.checked = false;
      if (taskCard) {
        taskCard.classList.remove("tarefario-is-hidden");
      }
      return;
    }

    const isHidden = hiddenCardIds.has(cardId);
    hiddenCheckbox.disabled = false;
    hiddenCheckbox.checked = isHidden;
    hiddenCheckbox.title = "Ocultar card";

    if (taskCard) {
      taskCard.classList.toggle("tarefario-is-hidden", isHidden);
    }
  }

  function animateCardHide(card, onComplete) {
    const taskCard = card.querySelector(TASK_CARD_SELECTOR);
    if (!taskCard) {
      onComplete();
      return;
    }

    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      taskCard.classList.remove("tarefario-fade-out");
      onComplete();
    };

    taskCard.addEventListener("animationend", finish, { once: true });
    window.setTimeout(finish, CARD_HIDE_ANIMATION_MS + 80);
    taskCard.classList.add("tarefario-fade-out");
  }

  function setHiddenCard(card, shouldBeHidden) {
    const cardId = getCardId(card);
    if (!cardId) {
      return;
    }

    const wasHidden = hiddenCardIds.has(cardId);
    if (wasHidden === shouldBeHidden) {
      updateHiddenCardUI(card);
      return;
    }

    if (shouldBeHidden) {
      hiddenCardIds.add(cardId);
    } else {
      hiddenCardIds.delete(cardId);
    }

    saveHiddenCardIds();
    updateHiddenCardUI(card);

    const shouldAnimateRemoval = shouldBeHidden && activeTab === TAB_MEUS && !isCodeReviewCard(card);
    if (shouldAnimateRemoval) {
      animateCardHide(card, applyCardFilter);
      return;
    }

    applyCardFilter();
  }

  function ensureHiddenMenus(cards) {
    const cardsList = cards || getCards();
    ensureOptionsListeners();

    cardsList.forEach((card) => {
      const statusGroup = card.querySelector(STATUS_GROUP_SELECTOR);
      if (!statusGroup) {
        return;
      }

      let optionsContainer = statusGroup.querySelector(`.${OPTIONS_CONTAINER_CLASS}`);
      if (!optionsContainer) {
        optionsContainer = document.createElement("div");
        optionsContainer.className = OPTIONS_CONTAINER_CLASS;

        const triggerButton = document.createElement("button");
        triggerButton.type = "button";
        triggerButton.className = OPTIONS_TRIGGER_CLASS;
        triggerButton.setAttribute("aria-label", "Abrir opcoes do card");
        triggerButton.title = "Opcoes";
        triggerButton.textContent = "•••";
        triggerButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();

          const shouldOpen = !optionsContainer.classList.contains("is-open");
          closeOptionsMenus(card);
          optionsContainer.classList.toggle("is-open", shouldOpen);
        });

        const optionsMenu = document.createElement("div");
        optionsMenu.className = OPTIONS_MENU_CLASS;
        optionsMenu.addEventListener("click", (event) => {
          event.stopPropagation();
        });

        const hiddenLabel = document.createElement("label");
        hiddenLabel.className = "tarefario-hidden-option";

        const hiddenCheckbox = document.createElement("input");
        hiddenCheckbox.type = "checkbox";
        hiddenCheckbox.className = HIDDEN_CHECKBOX_CLASS;
        hiddenCheckbox.addEventListener("change", () => {
          setHiddenCard(card, hiddenCheckbox.checked);
        });

        const hiddenText = document.createElement("span");
        hiddenText.textContent = "Ocultar";

        hiddenLabel.appendChild(hiddenCheckbox);
        hiddenLabel.appendChild(hiddenText);
        optionsMenu.appendChild(hiddenLabel);

        optionsContainer.appendChild(triggerButton);
        optionsContainer.appendChild(optionsMenu);
        statusGroup.appendChild(optionsContainer);
      }

      updateHiddenCardUI(card);
    });
  }

  function getPriorityValue(card) {
    const priorityMatch = Array.from(card.querySelectorAll(PRIORITY_TEXT_SELECTOR))
      .map((item) => (item.textContent || "").trim())
      .map((text) => text.match(/^P(\d+)$/i))
      .find(Boolean);

    if (!priorityMatch) {
      return Number.POSITIVE_INFINITY;
    }

    const priorityValue = Number.parseInt(priorityMatch[1], 10);
    if (Number.isNaN(priorityValue)) {
      return Number.POSITIVE_INFINITY;
    }

    return priorityValue;
  }

  function sortCardsByPriority(cards) {
    const grid = document.querySelector(GRID_SELECTOR);
    const cardsList = cards || getCards();

    if (!grid || !cardsList.length) {
      return cardsList;
    }

    const sortedCards = cardsList
      .map((card, index) => ({
        card,
        index,
        priority: getPriorityValue(card)
      }))
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority - right.priority;
        }

        return left.index - right.index;
      })
      .map((entry) => entry.card);

    const isSameOrder = cardsList.every((card, index) => card === sortedCards[index]);
    if (!isSameOrder) {
      const fragment = document.createDocumentFragment();
      sortedCards.forEach((card) => fragment.appendChild(card));
      grid.appendChild(fragment);
    }

    return sortedCards;
  }

  function applyCardFilter() {
    const cards = sortCardsByPriority();
    ensureHiddenMenus(cards);

    cards.forEach((card) => {
      card.style.display = shouldShowCard(card) ? "" : "none";
    });

    updateCounters(cards);
    alignCardsByRow(cards);
  }

  function setActiveTab(tab) {
    if (tab !== TAB_MEUS && tab !== TAB_REVIEW && tab !== TAB_OCULTOS) {
      return;
    }

    activeTab = tab;
    saveActiveTab();
    updateTabUI();
    applyCardFilter();
  }

  function createTabButton(tab, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tarefario-tab-button";
    button.dataset.tab = tab;
    button.textContent = label;
    button.addEventListener("click", () => setActiveTab(tab));
    return button;
  }

  function createTabsRoot() {
    const root = document.createElement("div");
    root.id = ROOT_ID;

    const buttonsContainer = document.createElement("div");
    buttonsContainer.className = "tarefario-tab-buttons";

    buttonsContainer.appendChild(createTabButton(TAB_MEUS, "Meus"));
    buttonsContainer.appendChild(createTabButton(TAB_REVIEW, "Code Review"));
    buttonsContainer.appendChild(createTabButton(TAB_OCULTOS, "Ocultos"));

    root.appendChild(buttonsContainer);
    return root;
  }

  function ensureTabsRoot() {
    const grid = document.querySelector(GRID_SELECTOR);
    if (!grid || !grid.parentElement) {
      return false;
    }

    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = createTabsRoot();
      grid.parentElement.insertBefore(root, grid);
    }

    updateTabUI();
    updateCounters();
    return true;
  }

  function scheduleRefresh() {
    if (refreshPending) {
      return;
    }

    refreshPending = true;
    window.requestAnimationFrame(() => {
      refreshPending = false;
      if (ensureTabsRoot()) {
        applyCardFilter();
      }
    });
  }

  function startObserver() {
    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver((mutationList) => {
      for (const mutation of mutationList) {
        if (mutation.type === "childList") {
          scheduleRefresh();
          break;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function startResizeListener() {
    if (resizeListenerAttached) {
      return;
    }

    window.addEventListener("resize", scheduleRefresh);
    resizeListenerAttached = true;
  }

  function isApontamentosPage() {
    return window.location.pathname.startsWith(APONTAMENTOS_PATH_PREFIX);
  }

  function formatCompetencyValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  function buildCompetencyOptions() {
    const now = new Date();
    const options = [];

    for (let offset = 0; offset < 12; offset += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const monthIndex = date.getMonth();
      const year = date.getFullYear();

      options.push({
        value: formatCompetencyValue(date),
        label: `${MONTH_NAMES[monthIndex]} de ${year}`
      });
    }

    return options;
  }

  function populateCompetencyOptions(selectElement) {
    if (!selectElement) {
      return;
    }

    const options = buildCompetencyOptions();
    selectElement.replaceChildren(
      ...options.map(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
      })
    );
  }

  function parsePeriodFromCompetency(value) {
    const [year, month] = String(value || "").split("-");
    return { year, month };
  }

  function setTransferStatus(message, type = "") {
    if (!transferModalRefs?.statusEl) {
      return;
    }

    transferModalRefs.statusEl.textContent = message;
    transferModalRefs.statusEl.className = `better-transfer-status ${type}`.trim();
  }

  function ensureTransferLoadingOverlay() {
    if (!document.body) {
      return null;
    }

    let loadingRoot = document.getElementById(APONTAMENTOS_LOADING_ROOT_ID);

    if (!loadingRoot) {
      loadingRoot = document.createElement("div");
      loadingRoot.id = APONTAMENTOS_LOADING_ROOT_ID;
      loadingRoot.className = "better-transfer-loading-root";
      loadingRoot.setAttribute("aria-hidden", "true");
      loadingRoot.innerHTML = `
        <div class="better-transfer-loading-card" role="status" aria-live="polite" aria-atomic="true">
          <div class="better-transfer-loading-spinner" aria-hidden="true"></div>
          <p class="better-transfer-loading-text">Transferencia em andamento. Aguarde...</p>
        </div>
      `;

      document.body.appendChild(loadingRoot);
    }

    return loadingRoot;
  }

  function setTransferLoading(isLoading) {
    transferInProgress = isLoading;

    const loadingRoot = ensureTransferLoadingOverlay();
    if (!loadingRoot) {
      return;
    }

    loadingRoot.classList.toggle("is-open", isLoading);
    loadingRoot.setAttribute("aria-hidden", isLoading ? "false" : "true");
  }

  async function persistTransferPasswordSettings(password) {
    if (!transferModalRefs) {
      return;
    }

    if (transferModalRefs.rememberPasswordCheckbox.checked) {
      await chrome.storage.local.set({
        [REMEMBER_PASSWORD_STORAGE_KEY]: true,
        [SAVED_PASSWORD_STORAGE_KEY]: password
      });
      return;
    }

    await chrome.storage.local.set({
      [REMEMBER_PASSWORD_STORAGE_KEY]: false
    });
    await chrome.storage.local.remove(SAVED_PASSWORD_STORAGE_KEY);
  }

  async function restoreTransferFormValues() {
    if (!transferModalRefs) {
      return;
    }

    populateCompetencyOptions(transferModalRefs.competencySelect);

    const stored = await chrome.storage.local.get([
      USERNAME_STORAGE_KEY,
      PERIOD_STORAGE_KEY,
      SAVED_PASSWORD_STORAGE_KEY,
      REMEMBER_PASSWORD_STORAGE_KEY
    ]);

    const defaultCompetency = transferModalRefs.competencySelect.options[0]?.value || "";
    const savedCompetency = stored[PERIOD_STORAGE_KEY] || defaultCompetency;
    const hasSavedCompetency = Array.from(transferModalRefs.competencySelect.options).some(
      (option) => option.value === savedCompetency
    );

    transferModalRefs.usernameInput.value = stored[USERNAME_STORAGE_KEY] || "";
    transferModalRefs.competencySelect.value = hasSavedCompetency ? savedCompetency : defaultCompetency;

    const rememberPassword = Boolean(stored[REMEMBER_PASSWORD_STORAGE_KEY]);
    transferModalRefs.rememberPasswordCheckbox.checked = rememberPassword;
    transferModalRefs.passwordInput.value = rememberPassword ? stored[SAVED_PASSWORD_STORAGE_KEY] || "" : "";
  }

  function closeTransferModal() {
    if (transferInProgress) {
      return;
    }

    if (!transferModalRefs?.root) {
      return;
    }

    transferModalRefs.root.classList.remove("is-open");
  }

  async function openTransferModal() {
    if (transferInProgress) {
      return;
    }

    ensureTransferModal();
    await restoreTransferFormValues();
    setTransferStatus("");

    transferModalRefs.root.classList.add("is-open");
    if (!transferModalRefs.usernameInput.value) {
      transferModalRefs.usernameInput.focus();
      return;
    }

    if (!transferModalRefs.passwordInput.value) {
      transferModalRefs.passwordInput.focus();
    }
  }

  async function handleTransferSubmit() {
    if (!transferModalRefs || transferInProgress) {
      return;
    }

    const username = transferModalRefs.usernameInput.value.trim();
    const password = transferModalRefs.passwordInput.value;
    const competency = transferModalRefs.competencySelect.value;
    const { month, year } = parsePeriodFromCompetency(competency);

    if (!username) {
      setTransferStatus("Informe a matricula para continuar.", "error");
      transferModalRefs.usernameInput.focus();
      return;
    }

    if (!password) {
      setTransferStatus("Informe a senha do site do ponto para continuar.", "error");
      transferModalRefs.passwordInput.focus();
      return;
    }

    if (!month || !year) {
      setTransferStatus("Selecione a competencia para continuar.", "error");
      transferModalRefs.competencySelect.focus();
      return;
    }

    transferModalRefs.transferBtn.disabled = true;
    setTransferLoading(true);
    setTransferStatus("Processando dados e atualizando o sistema de ponto...");

    try {
      await chrome.storage.local.set({ [USERNAME_STORAGE_KEY]: username });
      await chrome.storage.local.set({ [PERIOD_STORAGE_KEY]: competency });
      await persistTransferPasswordSettings(password);

      const response = await chrome.runtime.sendMessage({
        type: "TRANSFER",
        credentials: {
          username,
          password
        },
        period: {
          month,
          year
        }
      });

      if (!response || !response.ok) {
        throw new Error(response?.error || "Falha ao transferir dados.");
      }

      if (!transferModalRefs.rememberPasswordCheckbox.checked) {
        transferModalRefs.passwordInput.value = "";
      }

      setTransferStatus(
        `Dados processados: ${response.count || 0}. Grade lida: ${response.tableCount || 0}. Novos: ${response.newCount || 0}. Salvos: ${response.savedCount || 0}. Falhas: ${response.failedCount || 0}.`,
        "success"
      );
    } catch (error) {
      setTransferStatus(error?.message || "Erro inesperado.", "error");
    } finally {
      setTransferLoading(false);
      transferModalRefs.transferBtn.disabled = false;
    }
  }

  function ensureTransferModal() {
    if (transferModalRefs?.root && document.body.contains(transferModalRefs.root)) {
      return transferModalRefs;
    }

    if (!document.body) {
      return null;
    }

    let root = document.getElementById(APONTAMENTOS_MODAL_ROOT_ID);

    if (!root) {
      root = document.createElement("div");
      root.id = APONTAMENTOS_MODAL_ROOT_ID;
      root.className = "better-transfer-modal-root";
      root.innerHTML = `
        <div class="better-transfer-modal" role="dialog" aria-modal="true" aria-labelledby="better-transfer-modal-title">
          <div class="better-transfer-header">
            <h2 id="better-transfer-modal-title">Transferir para Ponto</h2>
            <button type="button" class="better-transfer-close" aria-label="Fechar">x</button>
          </div>
          <p class="better-transfer-description">Importa seus lancamentos do Tarefario, compara com o espelho do ponto e registra automaticamente somente as marcacoes pendentes.</p>

          <label class="better-transfer-field" for="better-transfer-username">
            <span>Matricula</span>
            <input id="better-transfer-username" type="text" autocomplete="username" />
          </label>

          <label class="better-transfer-field" for="better-transfer-password">
            <span>Senha do site do ponto</span>
            <input id="better-transfer-password" type="password" autocomplete="current-password" />
          </label>

          <label class="better-transfer-check" for="better-transfer-remember-password">
            <input id="better-transfer-remember-password" type="checkbox" />
            <span>Lembrar senha neste navegador</span>
          </label>

          <label class="better-transfer-field" for="better-transfer-competency">
            <span>Competencia</span>
            <select id="better-transfer-competency"></select>
          </label>

          <div class="better-transfer-actions">
            <button type="button" class="better-transfer-cancel">Cancelar</button>
            <button type="button" class="better-transfer-submit">Transferir</button>
          </div>

          <p class="better-transfer-status" aria-live="polite"></p>
        </div>
      `;
      document.body.appendChild(root);
    }

    transferModalRefs = {
      root,
      closeBtn: root.querySelector(".better-transfer-close"),
      cancelBtn: root.querySelector(".better-transfer-cancel"),
      transferBtn: root.querySelector(".better-transfer-submit"),
      usernameInput: root.querySelector("#better-transfer-username"),
      passwordInput: root.querySelector("#better-transfer-password"),
      rememberPasswordCheckbox: root.querySelector("#better-transfer-remember-password"),
      competencySelect: root.querySelector("#better-transfer-competency"),
      statusEl: root.querySelector(".better-transfer-status")
    };

    transferModalRefs.closeBtn?.addEventListener("click", closeTransferModal);
    transferModalRefs.cancelBtn?.addEventListener("click", closeTransferModal);
    transferModalRefs.transferBtn?.addEventListener("click", handleTransferSubmit);

    root.addEventListener("click", (event) => {
      if (event.target === root && !transferInProgress) {
        closeTransferModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        transferModalRefs?.root?.classList.contains("is-open") &&
        !transferInProgress
      ) {
        closeTransferModal();
      }
    });

    ensureTransferLoadingOverlay();

    return transferModalRefs;
  }

  function ensureTransferButton() {
    const filterContainer = document.querySelector(APONTAMENTOS_FILTER_SELECTOR);
    if (!filterContainer) {
      return false;
    }

    let slot = document.getElementById(APONTAMENTOS_TRANSFER_SLOT_ID);
    if (!slot) {
      slot = document.createElement("div");
      slot.id = APONTAMENTOS_TRANSFER_SLOT_ID;
      slot.className = "better-transfer-slot";
      filterContainer.appendChild(slot);
    }

    if (!slot.querySelector(`#${APONTAMENTOS_TRANSFER_BUTTON_ID}`)) {
      const button = document.createElement("button");
      button.id = APONTAMENTOS_TRANSFER_BUTTON_ID;
      button.type = "button";
      button.className = "better-transfer-open-button";
      button.textContent = "Transferir para ponto";
      button.addEventListener("click", openTransferModal);
      slot.appendChild(button);
    }

    return true;
  }

  function startApontamentosObserver() {
    if (apontamentosObserver) {
      apontamentosObserver.disconnect();
    }

    apontamentosObserver = new MutationObserver(() => {
      if (!isApontamentosPage()) {
        return;
      }

      ensureTransferButton();
      ensureTransferModal();
    });

    apontamentosObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function bootstrapApontamentos(attempt = 0) {
    if (!isApontamentosPage()) {
      return;
    }

    ensureTransferModal();

    if (ensureTransferButton()) {
      startApontamentosObserver();
      return;
    }

    if (attempt < 80) {
      window.setTimeout(() => bootstrapApontamentos(attempt + 1), 250);
    }
  }

  function bootstrap(attempt = 0) {
    if (ensureTabsRoot()) {
      applyCardFilter();
      startObserver();
      startResizeListener();
      return;
    }

    if (attempt < 80) {
      window.setTimeout(() => bootstrap(attempt + 1), 250);
    }
  }

  if (isApontamentosPage()) {
    bootstrapApontamentos();
    return;
  }

  bootstrap();
})();