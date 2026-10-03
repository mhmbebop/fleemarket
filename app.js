const PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSidb2RfYHa6ffWiale6czVqih6e7BrrZ-ZmRdnT10WTsS5M1ZJF9-jKSvcpyyrv5imytQ9lZsvL8su/pub?gid=0&single=true&output=csv';
const SPREADSHEET_ID = '1XKPloRF46l0GGQOCdH0ce6Krjriitvj1LAdGTl_kkLI';
const GVIZ_CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;
const LOCAL_CSV_PATH = '10_Player_Flee_Items_Database_Complete.csv';

// LocalStorage Cache Configuration (10 minutes)
const CACHE_KEY_DATA = 'flee_items_cache_v1';
const CACHE_KEY_TIME = 'flee_items_time_v1';
const CACHE_TTL_MS = 10 * 60 * 1000;

// Persistent Trade, Tab & History Keys
const TRADE_KEY_YOUR = 'flee_trade_your_v1';
const TRADE_KEY_THEIR = 'flee_trade_their_v1';
const TAB_KEY_PREF = 'flee_active_tab_v1';
const HISTORY_KEY = 'flee_trade_history_v1';

let allItems = [];
let yourOffer = [];
let theirOffer = [];
let currentFilter = 'all'; // 'all' | 'hammer' | 'gem'
let currentSort = 'val-desc';
const shinyState = {};

// Audio controller
let currentPlayingAudio = null;
let currentPlayingBtn = null;

// Active selections in calculator
let selectedItemYour = null;
let selectedItemTheir = null;

// Multi-filter states
const activeRarities = new Set();
const activeDemands = new Set();
const activeStatuses = new Set();
const activeEvents = new Set();
let filterHasShiny = false;

// Security Input Sanitization
function sanitizeInput(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// LocalStorage Housekeeping (Stale Cache Cleanup on Startup)
function performLocalStorageHousekeeping() {
  try {
    const cachedTime = Number(localStorage.getItem(CACHE_KEY_TIME)) || 0;
    if (Date.now() - cachedTime > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(CACHE_KEY_DATA);
      localStorage.removeItem(CACHE_KEY_TIME);
    }
  } catch (e) {
    console.warn('LocalStorage housekeeping warning:', e);
  }
}

// Immediate Tab Switching with Persistent Memory
function switchTab(targetTab, saveToStorage = true) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const isTarget = btn.getAttribute('data-tab') === targetTab;
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${targetTab}`);
  });

  const dock = document.getElementById('floating-trade-dock');
  const drawer = document.getElementById('dock-items-drawer');
  if (drawer) drawer.classList.remove('open');

  if (dock) {
    if (targetTab === 'calculator' || (yourOffer.length === 0 && theirOffer.length === 0)) {
      dock.classList.remove('visible');
    } else {
      dock.classList.add('visible');
    }
  }

  if (saveToStorage) {
    try {
      localStorage.setItem(TAB_KEY_PREF, targetTab);
    } catch (e) {
      console.warn('Failed to save tab preference:', e);
    }
  }
}

function initTabNavigation() {
  const tabsContainer = document.querySelector('.nav-tabs');
  if (!tabsContainer) return;

  try {
    const savedTab = localStorage.getItem(TAB_KEY_PREF);
    if (savedTab) {
      switchTab(savedTab, false);
    }
  } catch (e) {
    console.warn('Failed to load tab preference:', e);
  }

  tabsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const targetTab = btn.getAttribute('data-tab');
    if (targetTab) switchTab(targetTab, true);
  });
}

// Robust CSV Parser with Row-Error Boundary Protection
function parseCSV(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const splitLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values.map((val) => val.replace(/^"|"$/g, '').trim());
  };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  const parsedItems = [];

  for (let r = 1; r < lines.length; r++) {
    try {
      const cols = splitLine(lines[r]);
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cols[index] !== undefined ? cols[index] : '';
      });

      if (!row.name || row.name.length === 0) continue;

      const rawRarity = (row.rarity || 'Rare').trim();
      const normalizedRarity = rawRarity.toLowerCase() === 'unobtainable' ? 'Untradeable' : rawRarity;

      parsedItems.push({
        id: (row.id || '').trim(),
        name: (row.name || '').trim(),
        type: (row.type || 'Hammer').trim(),
        category: (row.category || '').trim(),
        releaseEvent: (row.release_event || row.releaseevent || '').trim(),
        baseValue: Number(row.base_value || row.basevalue) || 0,
        isNilValue: String(row.is_nil_value || row.isnilvalue).toUpperCase() === 'TRUE',
        demandTier: Number(row.demand_tier || row.demandtier) || 1,
        demandLabel: String(row.demand_label || row.demandlabel || '1').trim(),
        status: (row.status || 'Stable').trim(),
        setName: (row.set_name || row.setname || '').trim(),
        hasShiny: String(row.has_shiny || row.hasshiny).toUpperCase() === 'TRUE',
        shinyValue: Number(row.shiny_value || row.shinyvalue) || 0,
        rarity: normalizedRarity,
      });
    } catch (rowErr) {
      console.warn(`Skipping malformed row at line ${r + 1}:`, rowErr);
    }
  }

  return parsedItems;
}

// Builds the dynamic list of events/crates inside the filter drawer
function populateEventFilters(items) {
  const container = document.getElementById('events-checkbox-group');
  if (!container) return;
  container.innerHTML = '';

  const uniqueEvents = [
    ...new Set(
      items
        .map((i) => i.releaseEvent)
        .filter((ev) => ev && ev.toLowerCase() !== 'unobtainable')
    ),
  ].sort();

  if (uniqueEvents.length === 0) {
    container.innerHTML = '<span style="font-size: 11px; color: var(--text-muted);">No events found</span>';
    return;
  }

  uniqueEvents.forEach((ev) => {
    const label = document.createElement('label');
    label.className = 'drawer-label';
    const safeEv = sanitizeInput(ev);
    label.innerHTML = `<input type="checkbox" class="cb-event" value="${safeEv}" aria-label="Filter event ${safeEv}" ${activeEvents.has(ev) ? 'checked' : ''}> ${safeEv}`;

    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) {
        activeEvents.add(e.target.value);
      } else {
        activeEvents.delete(e.target.value);
      }
      updateFilterBadge();
      applyFilters();
    });

    container.appendChild(label);
  });
}

function updateFilterBadge() {
  const countBadge = document.getElementById('filter-count');
  const totalActive =
    activeRarities.size +
    activeDemands.size +
    activeStatuses.size +
    activeEvents.size +
    (filterHasShiny ? 1 : 0);

  if (countBadge) {
    if (totalActive > 0) {
      countBadge.textContent = totalActive;
      countBadge.style.display = 'inline-block';
    } else {
      countBadge.style.display = 'none';
    }
  }
}

function getItemActiveDisplay(item, isShiny = false) {
  if (isShiny && item.hasShiny) {
    return {
      value: item.isNilValue ? 'Indefinite' : item.shinyValue,
      numValue: item.isNilValue ? 0 : item.shinyValue,
      isNil: item.isNilValue,
      demandLabel: item.demandLabel,
      demandTier: item.demandTier,
      status: item.status,
    };
  }
  return {
    value: item.isNilValue ? 'Indefinite' : item.baseValue,
    numValue: item.isNilValue ? 0 : item.baseValue,
    isNil: item.isNilValue,
    demandLabel: item.demandLabel,
    demandTier: item.demandTier,
    status: item.status,
  };
}

// Persistent Trade State Storage
function saveTradeState() {
  try {
    localStorage.setItem(TRADE_KEY_YOUR, JSON.stringify(yourOffer));
    localStorage.setItem(TRADE_KEY_THEIR, JSON.stringify(theirOffer));
  } catch (e) {
    console.warn('Failed to save trade state to localStorage:', e);
  }
}

function loadTradeState() {
  const params = new URLSearchParams(window.location.search);
  const paramYou = params.get('you');
  const paramTheir = params.get('them');

  if (paramYou || paramTheir) {
    try {
      if (paramYou) {
        yourOffer = [];
        paramYou.split(',').forEach((part) => {
          const [id, countStr, shinyStr] = part.split(':');
          const item = allItems.find((i) => i.id === id);
          if (item) {
            const count = parseInt(countStr) || 1;
            const isShiny = shinyStr === '1';
            for (let c = 0; c < count; c++) {
              addItemToTrade(item, 'your', isShiny);
            }
          }
        });
      }
      if (paramTheir) {
        theirOffer = [];
        paramTheir.split(',').forEach((part) => {
          const [id, countStr, shinyStr] = part.split(':');
          const item = allItems.find((i) => i.id === id);
          if (item) {
            const count = parseInt(countStr) || 1;
            const isShiny = shinyStr === '1';
            for (let c = 0; c < count; c++) {
              addItemToTrade(item, 'their', isShiny);
            }
          }
        });
      }
      return;
    } catch (e) {
      console.warn('Failed to parse shareable URL trade link:', e);
    }
  }

  try {
    const savedYour = localStorage.getItem(TRADE_KEY_YOUR);
    const savedTheir = localStorage.getItem(TRADE_KEY_THEIR);
    if (savedYour) yourOffer = JSON.parse(savedYour);
    if (savedTheir) theirOffer = JSON.parse(savedTheir);
  } catch (e) {
    console.warn('Failed to load trade state from localStorage:', e);
  }
}

// Syncs tab badges, floating dock, and floating tray
function updateCalculatorUI() {
  const badge = document.getElementById('trade-count-badge');
  const dock = document.getElementById('floating-trade-dock');
  const drawer = document.getElementById('dock-items-drawer');
  const totalItems = yourOffer.length + theirOffer.length;

  if (badge) {
    if (totalItems > 0) {
      badge.textContent = totalItems;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  const dataYour = calculateSide(yourOffer);
  const dataTheir = calculateSide(theirOffer);

  if (totalItems === 0) {
    if (dock) dock.classList.remove('visible');
    if (drawer) drawer.classList.remove('open');
  } else {
    const catalogActive = document.getElementById('tab-catalog')?.classList.contains('active');
    if (dock && catalogActive) {
      dock.classList.add('visible');
    }
  }

  if (dock && totalItems > 0) {
    const countYour = document.getElementById('dock-count-your');
    const valYour = document.getElementById('dock-val-your');
    const countTheir = document.getElementById('dock-count-their');
    const valTheir = document.getElementById('dock-val-their');

    if (countYour) countYour.textContent = yourOffer.length;
    if (valYour) valYour.textContent = dataYour.hasNil ? `${dataYour.totalValue} + Nil` : dataYour.totalValue;
    if (countTheir) countTheir.textContent = theirOffer.length;
    if (valTheir) valTheir.textContent = dataTheir.hasNil ? `${dataTheir.totalValue} + Nil` : dataTheir.totalValue;
  }

  renderTradeList(yourOffer, 'list-your');
  renderTradeList(theirOffer, 'list-their');
  const trayCountYour = document.getElementById('tray-count-your');
  const trayCountTheir = document.getElementById('tray-count-their');
  if (trayCountYour) trayCountYour.textContent = yourOffer.length;
  if (trayCountTheir) trayCountTheir.textContent = theirOffer.length;

  refreshCardButtonBadges();
  saveTradeState();
}

function renderTrayList(sideItems, listId, sideTarget) {
  const ul = document.getElementById(listId);
  if (!ul) return;
  ul.innerHTML = '';

  if (sideItems.length === 0) {
    ul.innerHTML = '<li style="font-size: 11px; color: var(--text-muted); padding: 4px 0;">No items added</li>';
    return;
  }

  sideItems.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'drawer-item';
    const valText = item.isNilValue ? 'Nil' : item.tradeValue;
    const safeName = sanitizeInput(item.name);
    li.innerHTML = `
      <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
        <b>${safeName}</b> ${item.isShiny ? '<span style="color:#fbbf24;">★</span>' : ''}
        <span style="color:var(--text-muted); font-size:10px;">(${valText})</span>
      </div>
      <button type="button" class="remove-btn" aria-label="Remove item" style="width:22px; height:22px; font-size:11px;">✕</button>
    `;

    li.querySelector('.remove-btn').addEventListener('click', () => {
      sideItems.splice(index, 1);
      renderTradeList(yourOffer, 'list-your');
      renderTradeList(theirOffer, 'list-their');
      updateTradeVerdict();
    });

    ul.appendChild(li);
  });
}

function refreshCardButtonBadges() {
  document.querySelectorAll('.card').forEach((card) => {
    const starBtn = card.querySelector('.shiny-star-btn');
    const itemId = starBtn ? starBtn.getAttribute('data-id') : null;
    if (!itemId) return;

    const countYour = yourOffer.filter((i) => i.id === itemId).length;
    const countTheir = theirOffer.filter((i) => i.id === itemId).length;

    const groupYour = card.querySelector('.card-btn-group.side-your');
    const groupTheir = card.querySelector('.card-btn-group.side-their');

    if (groupYour) {
      const btnAdd = groupYour.querySelector('.card-add-btn');
      if (btnAdd) btnAdd.textContent = countYour > 0 ? `+ You (${countYour})` : '+ Your Offer';
      groupYour.classList.toggle('has-items', countYour > 0);
    }

    if (groupTheir) {
      const btnAdd = groupTheir.querySelector('.card-add-btn');
      if (btnAdd) btnAdd.textContent = countTheir > 0 ? `+ Them (${countTheir})` : '+ Their Offer';
      groupTheir.classList.toggle('has-items', countTheir > 0);
    }
  });
}

// Sequential Word-Prefix Search & Autocomplete with Selection (Allows checking Shiny before adding)
function setupPrefixSearch(inputId, clearBtnId, panelId, side) {
  const input = document.getElementById(inputId);
  const clearBtn = document.getElementById(clearBtnId);
  const panel = document.getElementById(panelId);
  if (!input || !panel) return;

  function renderMatches(query) {
    const cleanQuery = sanitizeInput(query).toLowerCase().trim();
    panel.innerHTML = '';

    if (clearBtn) {
      clearBtn.style.display = cleanQuery.length > 0 ? 'flex' : 'none';
    }

    if (!cleanQuery) {
      panel.classList.remove('open');
      return;
    }

    const queryWords = cleanQuery.split(/\s+/);

    const matches = allItems.filter((item) => {
      const name = (item.name || '').toLowerCase();
      const words = name.split(/\s+/);

      if (name.startsWith(cleanQuery)) return true;

      if (queryWords.length === 1) {
        return words.some((w) => w.startsWith(cleanQuery));
      }

      return queryWords.every((qw) => words.some((w) => w.startsWith(qw))) || name.includes(cleanQuery);
    });

    matches.sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aDirect = aName.startsWith(cleanQuery) ? 0 : 1;
      const bDirect = bName.startsWith(cleanQuery) ? 0 : 1;

      if (aDirect !== bDirect) return aDirect - bDirect;
      return aName.localeCompare(bName);
    });

    if (matches.length === 0) {
      panel.innerHTML = `<div class="calc-no-match-msg">⚠️ No items starting with "${sanitizeInput(query)}"</div>`;
      panel.classList.add('open');
      return;
    }

    matches.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'calc-match-item';
      const valText = item.isNilValue ? 'Nil' : item.baseValue;
      const shinyTag = item.hasShiny ? '★' : '';
      const safeName = sanitizeInput(item.name);
      const safeType = sanitizeInput(item.type);

      row.innerHTML = `
        <div class="calc-match-item-name">
          <span>${safeName}</span>
          <span style="font-size: 10px; color: var(--accent-cyan);">(${safeType})</span>
          ${shinyTag ? '<span style="color: var(--accent-gold); font-size: 10px;">★</span>' : ''}
        </div>
        <div class="calc-match-item-meta">Val: ${valText} | Dem: ${sanitizeInput(item.demandLabel)}</div>
      `;

      row.addEventListener('click', () => {
        selectItemForSide(item, side);
        input.value = item.name;
        if (clearBtn) clearBtn.style.display = 'flex';
        panel.classList.remove('open');
      });

      panel.appendChild(row);
    });

    panel.classList.add('open');
  }

  input.addEventListener('input', (e) => {
    selectItemForSide(null, side);
    renderMatches(e.target.value);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length > 0 && !((side === 'your' ? selectedItemYour : selectedItemTheir))) {
      renderMatches(input.value);
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      panel.classList.remove('open');
      selectItemForSide(null, side);
      input.focus();
    });
  }

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.remove('open');
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstMatch = panel.querySelector('.calc-match-item');
      if (firstMatch && panel.classList.contains('open')) {
        firstMatch.click();
      } else {
        const btnAdd = document.getElementById(side === 'your' ? 'btn-add-your' : 'btn-add-their');
        if (btnAdd) btnAdd.click();
      }
    }
  });
}

function selectItemForSide(item, side) {
  if (side === 'your') {
    selectedItemYour = item;
    updateSidePreview('your', item);
  } else {
    selectedItemTheir = item;
    updateSidePreview('their', item);
  }
}

function updateSidePreview(side, item) {
  const nameEl = document.getElementById(`preview-name-${side}`);
  const metaEl = document.getElementById(`preview-meta-${side}`);
  const cb = document.getElementById(`shiny-${side}`);
  const label = document.getElementById(`label-shiny-${side}`);

  if (!item) {
    if (nameEl) nameEl.textContent = 'Type above to select an item';
    if (metaEl) metaEl.textContent = '-';
    if (cb) { cb.checked = false; cb.disabled = true; }
    if (label) { label.classList.add('disabled'); label.title = 'Select an item with shiny'; }
    return;
  }

  const valText = item.isNilValue ? 'Nil' : item.baseValue;
  const safeName = sanitizeInput(item.name);
  const safeType = sanitizeInput(item.type);
  if (nameEl) nameEl.innerHTML = `${safeName} <span style="font-size: 11px; color: var(--accent-cyan);">(${safeType})</span>`;
  if (metaEl) metaEl.textContent = `Val: ${valText} • Dem: ${sanitizeInput(item.demandLabel)}`;

  if (cb && label) {
    if (item.hasShiny) {
      cb.disabled = false;
      label.classList.remove('disabled');
      label.title = `Add Shiny ${safeName} (Val: ${item.shinyValue})`;
    } else {
      cb.checked = false;
      cb.disabled = true;
      label.classList.add('disabled');
      label.title = 'This item does not have a shiny variant';
    }
  }
}

function calculateSide(items) {
  let totalValue = 0;
  let totalDemandTier = 0;
  let hasNil = false;

  items.forEach((item) => {
    if (item.isNilValue) {
      hasNil = true;
    } else {
      totalValue += item.tradeValue;
    }
    totalDemandTier += item.demandTier;
  });

  const avgDemand = items.length > 0 ? (totalDemandTier / items.length).toFixed(1) : '-';
  return { totalValue, hasNil, avgDemand };
}

function updateTradeVerdict() {
  const dataYour = calculateSide(yourOffer);
  const dataTheir = calculateSide(theirOffer);

  const valYour = document.getElementById('total-val-your');
  const demYour = document.getElementById('avg-dem-your');
  const valTheir = document.getElementById('total-val-their');
  const demTheir = document.getElementById('avg-dem-their');
  const verdictEl = document.getElementById('verdict-text');
  const detailsEl = document.getElementById('verdict-details');

  if (valYour) valYour.textContent = dataYour.hasNil ? `${dataYour.totalValue} + Nil` : dataYour.totalValue;
  if (demYour) demYour.textContent = dataYour.avgDemand;
  if (valTheir) valTheir.textContent = dataTheir.hasNil ? `${dataTheir.totalValue} + Nil` : dataTheir.totalValue;
  if (demTheir) demTheir.textContent = dataTheir.avgDemand;

  updateCalculatorUI();

  if (!verdictEl || !detailsEl) return;
  verdictEl.className = 'verdict-text';

  if (yourOffer.length === 0 && theirOffer.length === 0) {
    verdictEl.textContent = 'Add items to compare trade';
    detailsEl.textContent = 'Difference: 0 Value';
    return;
  }

  if (dataYour.hasNil || dataTheir.hasNil) {
    verdictEl.textContent = '⚠️ Contains Indefinite / Nil Item(s)';
    detailsEl.textContent = 'Nil or priceless items cannot be purely compared with numbers.';
    verdictEl.classList.add('status-fair');
    return;
  }

  const diff = dataTheir.totalValue - dataYour.totalValue;
  const maxVal = Math.max(dataYour.totalValue, dataTheir.totalValue, 1);
  const percentDiff = (diff / maxVal) * 100;

  let verdictString = 'Fair Trade';
  if (percentDiff > 15) {
    verdictEl.textContent = '🎉 Big Win';
    verdictEl.classList.add('status-win');
    verdictString = 'Big Win';
  } else if (percentDiff > 5) {
    verdictEl.textContent = '✅ Small Win';
    verdictEl.classList.add('status-win');
    verdictString = 'Small Win';
  } else if (percentDiff >= -5) {
    verdictEl.textContent = '⚖️ Fair Trade';
    verdictEl.classList.add('status-fair');
    verdictString = 'Fair Trade';
  } else if (percentDiff >= -15) {
    verdictEl.textContent = '🔻 Small Loss';
    verdictEl.classList.add('status-loss');
    verdictString = 'Small Loss';
  } else {
    verdictEl.textContent = '❌ Big Loss';
    verdictEl.classList.add('status-loss');
    verdictString = 'Big Loss';
  }

  const sign = diff > 0 ? '+' : '';
  detailsEl.textContent = `Their Offer has ${sign}${diff} value (${diff >= 0 ? 'Profit' : 'Loss'} for You)`;
}

// Group duplicate items by quantity stacking with corrected listElementId parameter
function renderTradeList(sideItems, listElementId) {
  const ul = document.getElementById(listElementId);
  if (!ul) return;
  ul.innerHTML = '';

  if (sideItems.length === 0) {
    ul.innerHTML = '<li style="font-size: 11px; color: var(--text-muted); padding: 4px 0;">No items added</li>';
    return;
  }

  const groupedMap = new Map();
  sideItems.forEach((item) => {
    const key = `${item.id}_${item.isShiny ? 'shiny' : 'base'}`;
    if (!groupedMap.has(key)) {
      groupedMap.set(key, { ...item, quantity: 1 });
    } else {
      groupedMap.get(key).quantity += 1;
    }
  });

  groupedMap.forEach((group, key) => {
    const li = document.createElement('li');
    li.className = 'trade-item';
    const valText = group.isNilValue ? 'Nil' : group.tradeValue * group.quantity;
    const fallbackEmoji = (group.type || '').toLowerCase() === 'gem' ? '💎' : '🔨';
    const safeName = sanitizeInput(group.name);

    li.innerHTML = `
      <div class="trade-item-left">
        <div class="trade-thumb-fallback" style="display: flex; width: 38px; height: 38px; border-radius: var(--radius-sm); background: #090b10; border: 1px solid var(--border); align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">${fallbackEmoji}</div>
        <div style="min-width: 0; flex: 1;">
          <div class="trade-item-title">
            ${safeName}
            ${group.isShiny ? '<span style="color: #fbbf24; font-size: 10px; margin-left: 2px;">★</span>' : ''}
          </div>
          <span style="font-size: 10px; color: var(--text-muted);">Val: <b style="color: var(--accent-gold);">${valText}</b> • Dem: ${sanitizeInput(group.demandLabel)}</span>
        </div>
      </div>
      <div class="trade-item-controls">
        <button class="qty-btn btn-minus" aria-label="Decrease quantity">−</button>
        <span class="qty-badge">×${group.quantity}</span>
        <button class="qty-btn btn-plus" aria-label="Increase quantity">+</button>
        <button class="remove-btn btn-remove" aria-label="Remove item" title="Remove all">✕</button>
      </div>
    `;

    li.querySelector('.btn-minus').addEventListener('click', () => {
      const idx = sideItems.findIndex((i) => i.id === group.id && !!i.isShiny === !!group.isShiny);
      if (idx !== -1) {
        sideItems.splice(idx, 1);
        renderTradeList(sideItems, listElementId);
        updateTradeVerdict();
      }
    });

    li.querySelector('.btn-plus').addEventListener('click', () => {
      addItemToTrade(group, listElementId === 'list-your' ? 'your' : 'their', group.isShiny);
    });

    li.querySelector('.btn-remove').addEventListener('click', () => {
      const targetArray = listElementId === 'list-your' ? yourOffer : theirOffer;
      for (let i = targetArray.length - 1; i >= 0; i--) {
        if (targetArray[i].id === group.id && !!targetArray[i].isShiny === !!group.isShiny) {
          targetArray.splice(i, 1);
        }
      }
      renderTradeList(targetArray, listElementId);
      updateTradeVerdict();
    });

    ul.appendChild(li);
  });
}

function addItemToTrade(item, sideTarget, isShiny = false) {
  if (!item) return;

  const display = getItemActiveDisplay(item, isShiny);

  const tradeItem = {
    ...item,
    isShiny: isShiny,
    tradeValue: display.numValue,
    isNilValue: display.isNil,
    demandLabel: display.demandLabel,
    demandTier: display.demandTier,
    status: display.status,
  };

  if (sideTarget === 'your') {
    yourOffer.push(tradeItem);
    renderTradeList(yourOffer, 'list-your');
  } else if (sideTarget === 'their') {
    theirOffer.push(tradeItem);
    renderTradeList(theirOffer, 'list-their');
  }
  updateTradeVerdict();
}

function removeItemFromTrade(itemId, sideTarget) {
  const targetArray = sideTarget === 'your' ? yourOffer : theirOffer;
  const listId = sideTarget === 'your' ? 'list-your' : 'list-their';

  for (let i = targetArray.length - 1; i >= 0; i--) {
    if (targetArray[i].id === itemId) {
      targetArray.splice(i, 1);
      break;
    }
  }

  renderTradeList(targetArray, listId);
  updateTradeVerdict();
}

// Render Catalog Grid with Direct Emoji Fallbacks
function renderItems(items) {
  const grid = document.getElementById('items-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (items.length === 0) {
    grid.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1; padding: 24px; text-align: center;">No matching items found with the active filters.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const card = document.createElement('div');
    const isShiny = item.hasShiny && !!shinyState[item.id];
    const displayRarity = item.rarity === 'Unobtainable' ? 'Untradeable' : item.rarity;
    const rarityClass = `rarity-${sanitizeInput(displayRarity).toLowerCase()}`;
    const isMythical = (item.rarity || '').toLowerCase() === 'mythical';

    card.className = `card ${rarityClass} ${isShiny ? 'is-shiny' : ''}`;
    card.setAttribute('data-id', item.id);

    const isGem = (item.type || '').toLowerCase() === 'gem';
    const display = getItemActiveDisplay(item, isShiny);
    const fallbackEmoji = isGem ? '💎' : '🔨';
    
    const safeName = sanitizeInput(item.name);
    const safeType = sanitizeInput(item.type);
    const safeSet = sanitizeInput(item.setName || item.releaseEvent);
    const safeStatus = sanitizeInput(display.status);

    const countYour = yourOffer.filter((i) => i.id === item.id).length;
    const countTheir = theirOffer.filter((i) => i.id === item.id).length;

    const starButtonHtml = item.hasShiny
      ? `<div class="shiny-star-btn ${isShiny ? 'active' : ''}" data-action="toggle-shiny" data-id="${item.id}" aria-label="Toggle shiny for ${safeName}" title="Toggle Shiny Version">★</div>`
      : '';

    const audioButtonHtml = isMythical
      ? `<button type="button" class="card-audio-btn" data-action="play-audio" data-id="${item.id}" aria-label="Play sound effect for ${safeName}" title="Play Sound Effect">🔊</button>`
      : '';

    card.innerHTML = `
      ${audioButtonHtml}
      ${starButtonHtml}
      <div class="card-image-wrap">
        <div class="card-img-fallback" style="display: flex; align-items: center; justify-content: center; font-size: 42px; width: 100%; height: 100%; background: #090b10;">${fallbackEmoji}</div>
      </div>
      <div class="card-top-info">
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 3px;">
          <span class="badge ${isGem ? 'badge-gem' : ''}">${safeType}</span>
          <span class="badge-rarity badge-${rarityClass}">${sanitizeInput(displayRarity)}</span>
          ${isShiny ? '<span class="badge badge-shiny">★ SHINY</span>' : ''}
        </div>
        <span class="set-tag" title="${safeSet}">${safeSet}</span>
      </div>
      <h3 class="card-title" title="${safeName}">${safeName}</h3>
      <div class="meta-rows">
        <div class="row">
          <span>Value</span>
          <span class="val">${display.value}</span>
        </div>
        <div class="row">
          <span>Demand</span>
          <span class="demand">${sanitizeInput(display.demandLabel)}</span>
        </div>
        <div class="row">
          <span>Status</span>
          <span class="status-tag" title="${safeStatus}">${safeStatus}</span>
        </div>
      </div>
      <div class="card-actions">
        <div class="card-btn-group side-your ${countYour > 0 ? 'has-items' : ''}">
          <button class="card-add-btn" data-action="add-your" data-id="${item.id}" aria-label="Add ${safeName} to your offer">${countYour > 0 ? `+ You (${countYour})` : '+ Your Offer'}</button>
          <button class="card-minus-btn" data-action="minus-your" data-id="${item.id}" aria-label="Remove one ${safeName} from your offer">−</button>
        </div>
        <div class="card-btn-group side-their ${countTheir > 0 ? 'has-items' : ''}">
          <button class="card-add-btn" data-action="add-their" data-id="${item.id}" aria-label="Add ${safeName} to their offer">${countTheir > 0 ? `+ Them (${countTheir})` : '+ Their Offer'}</button>
          <button class="card-minus-btn" data-action="minus-their" data-id="${item.id}" aria-label="Remove one ${safeName} from their offer">−</button>
        </div>
      </div>
    `;

    fragment.appendChild(card);
  });

  grid.appendChild(fragment);
}

// Mythical Audio Controller Helper
function playMythicalAudio(item, audioBtn) {
  if (currentPlayingAudio && currentPlayingBtn === audioBtn) {
    currentPlayingAudio.pause();
    currentPlayingAudio.currentTime = 0;
    audioBtn.classList.remove('is-playing');
    audioBtn.textContent = '🔊';
    currentPlayingAudio = null;
    currentPlayingBtn = null;
    return;
  }

  if (currentPlayingAudio) {
    currentPlayingAudio.pause();
    currentPlayingAudio.currentTime = 0;
    if (currentPlayingBtn) {
      currentPlayingBtn.classList.remove('is-playing');
      currentPlayingBtn.textContent = '🔊';
    }
  }

  const audioPaths = [
    `audio/${item.id}.mp3`,
    `audio/${String(item.id).toLowerCase()}.mp3`
  ];

  let audioLoaded = false;
  for (const audioSrc of audioPaths) {
    const audio = new Audio(audioSrc);
    audio.play().then(() => {
      audioBtn.classList.add('is-playing');
      audioBtn.textContent = '⏹';
      currentPlayingAudio = audio;
      currentPlayingBtn = audioBtn;
      audioLoaded = true;
    }).catch(() => {});

    if (audioLoaded) break;

    audio.onended = () => {
      audioBtn.classList.remove('is-playing');
      audioBtn.textContent = '🔊';
      currentPlayingAudio = null;
      currentPlayingBtn = null;
    };
    break;
  }
}

// Multi-Criteria Filtering Logic with Sanitized Query
function applyFilters() {
  const searchInput = document.getElementById('search');
  const query = sanitizeInput(searchInput ? searchInput.value : '').toLowerCase().trim();

  let filtered = allItems.filter((item) => {
    const itemType = (item.type || '').toLowerCase().trim();
    const itemRarity = (item.rarity || '').trim().toLowerCase();
    const itemEvent = (item.releaseEvent || '').trim();
    const itemDemand = String(item.demandTier);
    const itemStatus = (item.status || '').trim().toLowerCase();

    if (currentFilter === 'hammer' && itemType !== 'hammer') return false;
    if (currentFilter === 'gem' && itemType !== 'gem') return false;

    if (activeRarities.size > 0) {
      let matchesRarity = false;
      for (const selRarity of activeRarities) {
        const lowerSel = selRarity.toLowerCase();
        if (lowerSel === 'untradeable' && (itemRarity === 'untradeable' || itemRarity === 'unobtainable')) {
          matchesRarity = true;
          break;
        } else if (itemRarity === lowerSel) {
          matchesRarity = true;
          break;
        }
      }
      if (!matchesRarity) return false;
    }

    if (activeDemands.size > 0 && !activeDemands.has(itemDemand)) return false;

    if (activeStatuses.size > 0) {
      let matchesStatus = false;
      for (const selStatus of activeStatuses) {
        if (itemStatus === selStatus.toLowerCase()) {
          matchesStatus = true;
          break;
        }
      }
      if (!matchesStatus) return false;
    }

    if (filterHasShiny && !item.hasShiny) return false;

    if (activeEvents.size > 0 && !activeEvents.has(itemEvent)) return false;

    const matchesSearch =
      !query ||
      (item.name && item.name.toLowerCase().includes(query)) ||
      (item.setName && item.setName.toLowerCase().includes(query)) ||
      (item.releaseEvent && item.releaseEvent.toLowerCase().includes(query));

    return matchesSearch;
  });

  filtered.sort((a, b) => {
    if (currentSort === 'val-desc') return b.baseValue - a.baseValue;
    if (currentSort === 'val-asc') return a.baseValue - b.baseValue;
    if (currentSort === 'dem-desc') return b.demandTier - a.demandTier;
    if (currentSort === 'dem-asc') return a.demandTier - b.demandTier;
    if (currentSort === 'name-asc') return a.name.localeCompare(b.name);
    if (currentSort === 'name-desc') return b.name.localeCompare(a.name);
    return 0;
  });

  renderItems(filtered);
}

// Global Force Sync Handler
window.forceSyncNow = async function(event) {
  if (event) event.preventDefault();
  const btn = document.getElementById('btn-force-sync');
  const icon = btn?.querySelector('.sync-icon');
  
  if (btn) btn.classList.add('is-syncing');
  if (icon) icon.textContent = '⏳';

  const startTime = Date.now();
  await loadData(true);

  const elapsed = Date.now() - startTime;
  if (elapsed < 600) {
    await new Promise((resolve) => setTimeout(resolve, 600 - elapsed));
  }

  if (btn) btn.classList.remove('is-syncing');
  if (icon) icon.textContent = '↻';
};

// Discord Trade Export Formatter
function copyTradeForDiscord() {
  const dataYour = calculateSide(yourOffer);
  const dataTheir = calculateSide(theirOffer);

  const formatList = (items) => {
    if (items.length === 0) return 'None';
    const map = new Map();
    items.forEach((i) => {
      const key = `${i.name} ${i.isShiny ? '★' : ''}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).map(([k, count]) => count > 1 ? `${k} x${count}` : k).join(', ');
  };

  const text = `### ⚖️ **FLEEMARKET Trade Breakdown**\n` +
    `**Your Offer:** ${formatList(yourOffer)} (Val: **${dataYour.totalValue}**)\n` +
    `**Their Offer:** ${formatList(theirOffer)} (Val: **${dataTheir.totalValue}**)\n` +
    `**Verdict:** ${document.getElementById('verdict-text')?.textContent || 'Fair Trade'}\n` +
    `_Generated via FLEEMARKET Trade Hub_`;

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-copy-discord');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied to Clipboard!';
      setTimeout(() => btn.textContent = orig, 2000);
    }
  }).catch((err) => {
    console.warn('Failed to copy to clipboard:', err);
  });
}

// Shareable URL Trade Link Generator
function copyShareableLink() {
  const encodeSide = (items) => {
    const map = new Map();
    items.forEach((i) => {
      const key = `${i.id}_${i.isShiny ? '1' : '0'}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).map(([key, count]) => {
      const [id, shiny] = key.split('_');
      return `${id}:${count}:${shiny}`;
    }).join(',');
  };

  const paramYou = encodeSide(yourOffer);
  const paramTheir = encodeSide(theirOffer);
  const url = new URL(window.location.origin + window.location.pathname);
  if (paramYou) url.searchParams.set('you', paramYou);
  if (paramTheir) url.searchParams.set('them', paramTheir);

  navigator.clipboard.writeText(url.toString()).then(() => {
    const btn = document.getElementById('btn-share-link');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Link Copied!';
      setTimeout(() => btn.textContent = orig, 2000);
    }
  }).catch((err) => {
    console.warn('Failed to copy shareable link:', err);
  });
}

// Summarize items helper for history logs
const formatTradeSummary = (items) => {
  if (!items || items.length === 0) return 'None';
  const map = new Map();
  items.forEach((i) => {
    const key = `${i.name}${i.isShiny ? ' (★)' : ''}`;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries()).map(([name, count]) => count > 1 ? `${name} x${count}` : name).join(', ');
};

// Trade History Log Management with Full Item Breakdown
function saveCompletedTrade(verdict = 'Completed Trade') {
  if (yourOffer.length === 0 && theirOffer.length === 0) return;
  try {
    let history = [];
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) history = JSON.parse(saved);

    const dataYour = calculateSide(yourOffer);
    const dataTheir = calculateSide(theirOffer);

    const entry = {
      date: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      yourVal: dataYour.totalValue,
      theirVal: dataTheir.totalValue,
      verdict: verdict,
      yourSummary: formatTradeSummary(yourOffer),
      theirSummary: formatTradeSummary(theirOffer)
    };

    history.unshift(entry);
    if (history.length > 5) history = history.slice(0, 5);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderTradeHistory();
  } catch (e) {
    console.warn('Failed to save trade history:', e);
  }
}

function renderTradeHistory() {
  const ul = document.getElementById('trade-history-list');
  if (!ul) return;
  ul.innerHTML = '';

  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (!saved) {
      ul.innerHTML = '<li style="font-size: 11px; color: var(--text-muted);">No recent trades saved</li>';
      return;
    }
    const history = JSON.parse(saved);
    if (history.length === 0) {
      ul.innerHTML = '<li style="font-size: 11px; color: var(--text-muted);">No recent trades saved</li>';
      return;
    }

    history.forEach((h) => {
      const li = document.createElement('li');
      li.style.cssText = 'font-size: 11px; color: var(--text-main); background: var(--surface-2); padding: 8px 10px; border-radius: 6px; display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--border);';
      li.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: var(--text-muted); font-size: 10px;">${h.date}</span>
          <span style="color: var(--accent-cyan); font-weight: 700;">${h.verdict}</span>
        </div>
        <div style="font-size: 11px;">
          <span style="color: var(--accent-cyan);">You (${h.yourVal}):</span> ${sanitizeInput(h.yourSummary)}
        </div>
        <div style="font-size: 11px;">
          <span style="color: var(--accent-green);">Them (${h.theirVal}):</span> ${sanitizeInput(h.theirSummary)}
        </div>
      `;
      ul.appendChild(li);
    });
  } catch (e) {
    console.warn('Failed to render trade history:', e);
  }
}

function setupEventListeners() {
  setupPrefixSearch('calc-search-your', 'btn-clear-calc-your', 'matches-panel-your', 'your');
  setupPrefixSearch('calc-search-their', 'btn-clear-calc-their', 'matches-panel-their', 'their');

  const btnForceSync = document.getElementById('btn-force-sync');
  if (btnForceSync) {
    btnForceSync.addEventListener('click', (e) => window.forceSyncNow(e));
  }

  const btnCopyDiscord = document.getElementById('btn-copy-discord');
  if (btnCopyDiscord) {
    btnCopyDiscord.addEventListener('click', copyTradeForDiscord);
  }

  const btnShareLink = document.getElementById('btn-share-link');
  if (btnShareLink) {
    btnShareLink.addEventListener('click', copyShareableLink);
  }

  const btnFinalize = document.getElementById('btn-finalize-trade');
  if (btnFinalize) {
    btnFinalize.addEventListener('click', () => {
      const verdictText = document.getElementById('verdict-text')?.textContent || 'Completed Trade';
      
      // Save trade to history log
      saveCompletedTrade(verdictText);

      // Reset offers and clear from localStorage
      yourOffer = [];
      theirOffer = [];
      localStorage.removeItem(TRADE_KEY_YOUR);
      localStorage.removeItem(TRADE_KEY_THEIR);

      // Refresh calculator UI, lists, and verdict display
      renderTradeList(yourOffer, 'list-your');
      renderTradeList(theirOffer, 'list-their');
      selectedItemYour = null;
      selectedItemTheir = null;
      updateSidePreview('your', null);
      updateSidePreview('their', null);

      const inYour = document.getElementById('calc-search-your');
      const inTheir = document.getElementById('calc-search-their');
      const clrYour = document.getElementById('btn-clear-calc-your');
      const clrTheir = document.getElementById('btn-clear-calc-their');
      if (inYour) inYour.value = '';
      if (inTheir) inTheir.value = '';
      if (clrYour) clrYour.style.display = 'none';
      if (clrTheir) clrTheir.style.display = 'none';

      document.getElementById('dock-items-drawer')?.classList.remove('open');
      document.getElementById('floating-trade-dock')?.classList.remove('visible');
      updateTradeVerdict();
    });
  }

  const btnClearHistory = document.getElementById('btn-clear-history');
  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', () => {
      localStorage.removeItem(HISTORY_KEY);
      renderTradeHistory();
    });
  }

  const itemsGrid = document.getElementById('items-grid');
  if (itemsGrid) {
    itemsGrid.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;

      const action = actionEl.getAttribute('data-action');
      const itemId = actionEl.getAttribute('data-id');
      const itemObj = allItems.find((i) => i.id === itemId);
      if (!itemObj) return;

      if (action === 'toggle-shiny') {
        e.stopPropagation();
        shinyState[itemObj.id] = !shinyState[itemObj.id];
        applyFilters();
      } else if (action === 'play-audio') {
        e.stopPropagation();
        playMythicalAudio(itemObj, actionEl);
      } else if (action === 'add-your') {
        addItemToTrade(itemObj, 'your', itemObj.hasShiny && !!shinyState[itemObj.id]);
      } else if (action === 'minus-your') {
        removeItemFromTrade(itemObj.id, 'your');
      } else if (action === 'add-their') {
        addItemToTrade(itemObj, 'their', itemObj.hasShiny && !!shinyState[itemObj.id]);
      } else if (action === 'minus-their') {
        removeItemFromTrade(itemObj.id, 'their');
      }
    });
  }

  const btnAddYour = document.getElementById('btn-add-your');
  if (btnAddYour) {
    btnAddYour.addEventListener('click', () => {
      const input = document.getElementById('calc-search-your');
      const query = sanitizeInput(input ? input.value : '').toLowerCase().trim();

      if (!selectedItemYour && query) {
        selectedItemYour = allItems.find((i) => 
          (i.name || '').toLowerCase().startsWith(query) || 
          (i.name || '').toLowerCase().includes(query)
        ) || null;
      }

      if (selectedItemYour) {
        const isShiny = document.getElementById('shiny-your')?.checked || false;
        addItemToTrade(selectedItemYour, 'your', isShiny);
        selectedItemYour = null;
        updateSidePreview('your', null);
        const clearBtn = document.getElementById('btn-clear-calc-your');
        if (input) input.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        document.getElementById('matches-panel-your')?.classList.remove('open');
      }
    });
  }

  const btnAddTheir = document.getElementById('btn-add-their');
  if (btnAddTheir) {
    btnAddTheir.addEventListener('click', () => {
      const input = document.getElementById('calc-search-their');
      const query = sanitizeInput(input ? input.value : '').toLowerCase().trim();

      if (!selectedItemTheir && query) {
        selectedItemTheir = allItems.find((i) => 
          (i.name || '').toLowerCase().startsWith(query) || 
          (i.name || '').toLowerCase().includes(query)
        ) || null;
      }

      if (selectedItemTheir) {
        const isShiny = document.getElementById('shiny-their')?.checked || false;
        addItemToTrade(selectedItemTheir, 'their', isShiny);
        selectedItemTheir = null;
        updateSidePreview('their', null);
        const clearBtn = document.getElementById('btn-clear-calc-their');
        if (input) input.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        document.getElementById('matches-panel-their')?.classList.remove('open');
      }
    });
  }

  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      yourOffer = [];
      theirOffer = [];
      localStorage.removeItem(TRADE_KEY_YOUR);
      localStorage.removeItem(TRADE_KEY_THEIR);
      renderTradeList(yourOffer, 'list-your');
      renderTradeList(theirOffer, 'list-their');
      selectedItemYour = null;
      selectedItemTheir = null;
      updateSidePreview('your', null);
      updateSidePreview('their', null);
      const inYour = document.getElementById('calc-search-your');
      const inTheir = document.getElementById('calc-search-their');
      const clrYour = document.getElementById('btn-clear-calc-your');
      const clrTheir = document.getElementById('btn-clear-calc-their');
      if (inYour) inYour.value = '';
      if (inTheir) inTheir.value = '';
      if (clrYour) clrYour.style.display = 'none';
      if (clrTheir) clrTheir.style.display = 'none';
      document.getElementById('dock-items-drawer')?.classList.remove('open');
      document.getElementById('floating-trade-dock')?.classList.remove('visible');
      updateTradeVerdict();
    });
  }

  const btnDockOpen = document.getElementById('btn-dock-open');
  if (btnDockOpen) {
    btnDockOpen.addEventListener('click', () => {
      switchTab('calculator');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  const btnTrayToggle = document.getElementById('btn-dock-tray-toggle');
  const pillYour = document.getElementById('pill-dock-your');
  const pillTheir = document.getElementById('pill-dock-their');
  const drawer = document.getElementById('dock-items-drawer');

  const toggleDrawer = () => {
    if (drawer) drawer.classList.toggle('open');
  };

  if (btnTrayToggle) btnTrayToggle.addEventListener('click', toggleDrawer);
  if (pillYour) pillYour.addEventListener('click', toggleDrawer);
  if (pillTheir) pillTheir.addEventListener('click', toggleDrawer);

  const btnClearAllDrawer = document.getElementById('btn-drawer-clear-all');
  if (btnClearAllDrawer) {
    btnClearAllDrawer.addEventListener('click', () => {
      yourOffer = [];
      theirOffer = [];
      localStorage.removeItem(TRADE_KEY_YOUR);
      localStorage.removeItem(TRADE_KEY_THEIR);
      renderTradeList(yourOffer, 'list-your');
      renderTradeList(theirOffer, 'list-their');
      document.getElementById('dock-items-drawer')?.classList.remove('open');
      document.getElementById('floating-trade-dock')?.classList.remove('visible');
      updateTradeVerdict();
    });
  }

  const searchInput = document.getElementById('search');
  const btnClearSearch = document.getElementById('btn-clear-search');

  if (searchInput) {
    let searchTimeout = null;
    searchInput.addEventListener('input', () => {
      if (btnClearSearch) {
        btnClearSearch.style.display = searchInput.value.trim().length > 0 ? 'flex' : 'none';
      }
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        applyFilters();
      }, 100);
    });
  }

  if (btnClearSearch && searchInput) {
    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      btnClearSearch.style.display = 'none';
      searchInput.focus();
      applyFilters();
    });
  }

  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      applyFilters();
    });
  }

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const button = e.currentTarget;
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
      currentFilter = button.getAttribute('data-filter').toLowerCase().trim();
      applyFilters();
    });
  });

  const btnToggleDrawer = document.getElementById('btn-toggle-filters');
  const filterDrawer = document.getElementById('filter-drawer');
  if (btnToggleDrawer && filterDrawer) {
    btnToggleDrawer.addEventListener('click', () => {
      const isOpen = filterDrawer.classList.toggle('open');
      btnToggleDrawer.classList.toggle('open', isOpen);
    });
  }

  document.querySelectorAll('.cb-rarity').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) activeRarities.add(e.target.value);
      else activeRarities.delete(e.target.value);
      updateFilterBadge();
      applyFilters();
    });
  });

  document.querySelectorAll('.cb-demand').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) activeDemands.add(e.target.value);
      else activeDemands.delete(e.target.value);
      updateFilterBadge();
      applyFilters();
    });
  });

  document.querySelectorAll('.cb-status').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) activeStatuses.add(e.target.value);
      else activeStatuses.delete(e.target.value);
      updateFilterBadge();
      applyFilters();
    });
  });

  const cbShiny = document.getElementById('cb-has-shiny');
  if (cbShiny) {
    cbShiny.addEventListener('change', (e) => {
      filterHasShiny = e.target.checked;
      updateFilterBadge();
      applyFilters();
    });
  }

  const btnClearFilters = document.getElementById('btn-clear-filters');
  if (btnClearFilters) {
    btnClearFilters.addEventListener('click', () => {
      activeRarities.clear();
      activeDemands.clear();
      activeStatuses.clear();
      activeEvents.clear();
      filterHasShiny = false;

      document
        .querySelectorAll('.cb-rarity, .cb-demand, .cb-status, .cb-event')
        .forEach((cb) => (cb.checked = false));
      if (cbShiny) cbShiny.checked = false;

      updateFilterBadge();
      applyFilters();
    });
  }
}

// Multi-Source CSV Fallback Cascade
async function fetchFreshCSV() {
  const cacheBust = `&_t=${Date.now()}`;

  try {
    const res = await fetch(GVIZ_CSV_URL + cacheBust);
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 50) return text;
    }
  } catch (err) {
    console.warn('GVIZ CSV fetch failed...', err);
  }

  try {
    const res = await fetch(PRIMARY_CSV_URL + cacheBust);
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 50) return text;
    }
  } catch (err) {
    console.warn('Publish-to-Web CSV fetch failed...', err);
  }

  try {
    const res = await fetch(LOCAL_CSV_PATH + `?_t=${Date.now()}`);
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 50) return text;
    }
  } catch (err) {
    console.warn('Local CSV fetch failed...', err);
  }

  try {
    const cachedCSV = localStorage.getItem(CACHE_KEY_DATA);
    if (cachedCSV) return cachedCSV;
  } catch (err) {
    console.warn('LocalStorage cache retrieval failed.', err);
  }

  return null;
}

async function loadData(forceRefresh = false) {
  const statusEl = document.getElementById('status');

  performLocalStorageHousekeeping();

  if (!forceRefresh) {
    try {
      const cachedCSV = localStorage.getItem(CACHE_KEY_DATA);
      const cachedTime = Number(localStorage.getItem(CACHE_KEY_TIME)) || 0;
      const isFresh = Date.now() - cachedTime < CACHE_TTL_MS;

      if (cachedCSV) {
        allItems = parseCSV(cachedCSV);
        if (allItems.length > 0) {
          if (statusEl) {
            statusEl.textContent = `✓ Loaded ${allItems.length} items (Cached)`;
            statusEl.style.color = 'var(--accent-green)';
          }
          populateEventFilters(allItems);
          applyFilters();

          if (isFresh) {
            loadTradeState();
            renderTradeList(yourOffer, 'list-your');
            renderTradeList(theirOffer, 'list-their');
            updateTradeVerdict();
            renderTradeHistory();
            return;
          }
        }
      }
    } catch (e) {
      console.warn('LocalStorage access warning:', e);
    }
  } else {
    if (statusEl) {
      statusEl.textContent = 'Syncing live with Google Sheets...';
      statusEl.style.color = 'var(--accent-cyan)';
    }
  }

  const freshCSV = await fetchFreshCSV();
  if (freshCSV) {
    const parsed = parseCSV(freshCSV);
    if (parsed.length > 0) {
      allItems = parsed;

      try {
        localStorage.setItem(CACHE_KEY_DATA, freshCSV);
        localStorage.setItem(CACHE_KEY_TIME, String(Date.now()));
      } catch (e) {
        console.warn('Failed to save to localStorage:', e);
      }

      if (statusEl) {
        const timeStr = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        statusEl.textContent = forceRefresh
          ? `✓ Live synced ${allItems.length} items (${timeStr})`
          : `✓ Synced ${allItems.length} items successfully`;
        statusEl.style.color = 'var(--accent-green)';
      }
      populateEventFilters(allItems);
      applyFilters();
      loadTradeState();
      renderTradeList(yourOffer, 'list-your');
      renderTradeList(theirOffer, 'list-their');
      updateTradeVerdict();
      renderTradeHistory();
      return;
    }
  }

  if (allItems.length === 0 && statusEl) {
    statusEl.textContent = '⚠️ Could not reach Google Sheets. Please verify permissions.';
    statusEl.style.color = 'var(--accent-rose)';
  }
}

// Register PWA Service Worker for Offline Mode
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}

// Immediate Boot
initTabNavigation();
setupEventListeners();
loadData();
