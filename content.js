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

  let activeTab = readSavedTab();
  let hiddenCardIds = readHiddenCardIds();
  let observer;
  let refreshPending = false;
  let resizeListenerAttached = false;
  let optionsListenersAttached = false;

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

  bootstrap();
})();