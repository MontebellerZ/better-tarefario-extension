(() => {
  "use strict";

  const ROOT_ID = "better-tarefario-root";
  const STORAGE_KEY = "better-tarefario-active-tab";
  const TAB_MEUS = "meus";
  const TAB_REVIEW = "review";
  const CARD_SELECTOR = "app-task-card";
  const BADGE_SELECTOR = ".status-badge";
  const GRID_SELECTOR = ".tasks-grid";

  let activeTab = readSavedTab();
  let observer;
  let refreshPending = false;

  function readSavedTab() {
    const savedTab = window.localStorage.getItem(STORAGE_KEY);
    if (savedTab === TAB_MEUS || savedTab === TAB_REVIEW) {
      return savedTab;
    }

    return TAB_MEUS;
  }

  function saveActiveTab() {
    window.localStorage.setItem(STORAGE_KEY, activeTab);
  }

  function getCards() {
    return Array.from(document.querySelectorAll(CARD_SELECTOR));
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
    const isCodeReview = isCodeReviewCard(card);
    if (activeTab === TAB_REVIEW) {
      return isCodeReview;
    }

    return !isCodeReview;
  }

  function updateCounters(cards) {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
      return;
    }

    const cardsList = cards || getCards();
    const reviewCount = cardsList.filter(isCodeReviewCard).length;
    const meusCount = cardsList.length - reviewCount;

    const meusButton = root.querySelector('[data-tab="meus"]');
    const reviewButton = root.querySelector('[data-tab="review"]');

    if (meusButton) {
      meusButton.textContent = `Meus (${meusCount})`;
    }

    if (reviewButton) {
      reviewButton.textContent = `Code Review (${reviewCount})`;
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

  function applyCardFilter() {
    const cards = getCards();
    cards.forEach((card) => {
      card.style.display = shouldShowCard(card) ? "" : "none";
    });

    updateCounters(cards);
  }

  function setActiveTab(tab) {
    if (tab !== TAB_MEUS && tab !== TAB_REVIEW) {
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

  function bootstrap(attempt = 0) {
    if (ensureTabsRoot()) {
      applyCardFilter();
      startObserver();
      return;
    }

    if (attempt < 80) {
      window.setTimeout(() => bootstrap(attempt + 1), 250);
    }
  }

  bootstrap();
})();