const PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSidb2RfYHa6ffWiale6czVqih6e7BrrZ-ZmRdnT10WTsS5M1ZJF9-jKSvcpyyrv5imytQ9lZsvL8su/pub?gid=0&single=true&output=csv';
const SPREADSHEET_ID = '1XKPloRF46l0GGQOCdH0ce6Krjriitvj1LAdGTl_kkLI';
const GVIZ_CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;
const LOCAL_CSV_PATH = '10_Player_Flee_Items_Database_Complete.csv';

const CACHE_KEY_DATA = 'flee_items_cache_v1';
const CACHE_KEY_TIME = 'flee_items_time_v1';
const CACHE_TTL_MS = 10 * 60 * 1000;

const TRADE_KEY_YOUR = 'flee_trade_your_v1';
const TRADE_KEY_THEIR = 'flee_trade_their_v1';
const TAB_KEY_PREF = 'flee_active_tab_v1';
const HISTORY_KEY = 'flee_trade_history_v1';
const VIEW_MODE_KEY = 'flee_view_mode_v1';

let allItems = [];
let yourOffer = [];
let theirOffer = [];
let currentFilter = 'all';
let currentSort = 'val-desc';
let currentViewMode = 'grid';
const shinyState = {};

let currentPlayingAudio = null;
let currentPlayingBtn = null;

let selectedItemYour = null;
let selectedItemTheir = null;

const activeRarities = new Set();
const activeDemands = new Set();
const activeStatuses = new Set();
const activeEvents = new Set();
let filterHasShiny = false;

function sanitizeInput(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

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
    if (savedTab) switchTab(savedTab, false);
    const savedView = localStorage.getItem(VIEW_MODE_KEY);
    if (savedView) {
      currentViewMode = savedView;
      document.querySelectorAll('#view-mode-group .filter-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-view') === currentViewMode);
      });
    }
  } catch (e) {
    console.warn('Failed to load preferences:', e);
  }

  tabsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const targetTab = btn.getAttribute('data-tab');
    if (targetTab) switchTab(targetTab, true);
  });
}

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
    label.innerHTML = `<input type="checkbox" class="cb-event" value="${safeEv}" ${activeEvents.has(ev) ? 'checked' : ''}> ${safeEv}`;

    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) activeEvents.add(e.target.value);
      else activeEvents.delete(e.target.value);
      updateFilterBadge();
      applyFilters();
    });

    container.appendChild(label);
  });
}

function updateFilterBadge() {
  const countBadge = document.getElementById('filter-count');
  const totalActive =
    activeRarities.size + activeDemands.size + activeStatuses.size + activeEvents.size + (filterHasShiny ? 1 : 0);

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

function saveTradeState() {
  try {
    localStorage.setItem(TRADE_KEY_YOUR, JSON.stringify(yourOffer));
    localStorage.setItem(TRADE_KEY_THEIR, JSON.stringify(theirOffer));
  } catch (e) {
    console.warn('Failed to save trade state:', e);
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
            for (let c = 0; c < count; c++) addItemToTrade(item, 'your', isShiny);
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
            for (let c = 0; c < count; c++) addItemToTrade(item, 'their', isShiny);
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
    console.warn('Failed to load trade state:', e);
  }
}

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
    if (dock && catalogActive) dock.classList.add('visible');
  }

  if (dock && totalItems > 0) {
    document.getElementById('dock-count-your').textContent = yourOffer.length;
    document.getElementById('dock-val-your').textContent = dataYour.hasNil ? `${dataYour.totalValue} + Nil` : dataYour.totalValue;
    document.getElementById('dock-count-their').textContent = theirOffer.length;
    document.getElementById('dock-val-their').textContent = dataTheir.hasNil ? `${dataTheir.totalValue} + Nil` : dataTheir.totalValue;
  }

  document.getElementById('total-val-your').textContent = dataYour.hasNil ? `${dataYour.totalValue} + Nil` : dataYour.totalValue;
  document.getElementById('avg-dem-your').textContent = dataYour.avgDemand;
  document.getElementById('total-val-their').textContent = dataTheir.hasNil ? `${dataTheir.totalValue} + Nil` : dataTheir.totalValue;
  document.getElementById('avg-dem-their').textContent = dataTheir.avgDemand;

  document.getElementById('banner-val-your').textContent = dataYour.totalValue;
  document.getElementById('banner-val-their').textContent = dataTheir.totalValue;

  renderTradeList(yourOffer, 'list-your');
  renderTradeList(theirOffer, 'list-their');

  const trayCountYour = document.getElementById('tray-count-your');
  const trayCountTheir = document.getElementById('tray-count-their');
  if (trayCountYour) trayCountYour.textContent = yourOffer.length;
  if (trayCountTheir) trayCountTheir.textContent = theirOffer.length;

  const btnFinalize = document.getElementById('btn-finalize-trade');
  if (btnFinalize) {
    const hasBoth = yourOffer.length > 0 && theirOffer.length > 0;
    btnFinalize.disabled = !hasBoth;
  }

  refreshCardButtonBadges();
  saveTradeState();
}

function refreshCardButtonBadges() {
  document.querySelectorAll('.card, .compact-row').forEach((card) => {
    const itemId = card.getAttribute('data-id');
    if (!itemId) return;

    const countYour = yourOffer.filter((i) => i.id === itemId).length;
    const countTheir = theirOffer.filter((i) => i.id === itemId).length;

    const groupYour = card.querySelector('.card-btn-group.side-your');
    const groupTheir = card.querySelector('.card-btn-group.side-their');

    if (groupYour) {
      const btnAdd = groupYour.querySelector('.card-add-btn');
      if (btnAdd) btnAdd.textContent = countYour > 0 ? `You (${countYour})` : '+ You';
      groupYour.classList.toggle('has-items', countYour > 0);
    }

    if (groupTheir) {
      const btnAdd = groupTheir.querySelector('.card-add-btn');
      if (btnAdd) btnAdd.textContent = countTheir > 0 ? `Them (${countTheir})` : '+ Them';
      groupTheir.classList.toggle('has-items', countTheir > 0);
    }
  });
}

function setupPrefixSearch(inputId, clearBtnId, panelId, side) {
  const input = document.getElementById(inputId);
  const clearBtn = document.getElementById(clearBtnId);
  const panel = document.getElementById(panelId);
  if (!input || !panel) return;

  function renderMatches(query) {
    const cleanQuery = sanitizeInput(query).toLowerCase().trim();
    panel.innerHTML = '';
    if (clearBtn) clearBtn.style.display = cleanQuery.length > 0 ? 'flex' : 'none';

    if (!cleanQuery) {
      panel.classList.remove('open');
      return;
    }

    const queryWords = cleanQuery.split(/\s+/);
    const matches = allItems.filter((item) => {
      const name = (item.name || '').toLowerCase();
      const words = name.split(/\s+/);
      if (name.startsWith(cleanQuery)) return true;
      if (queryWords.length === 1) return words.some((w) => w.startsWith(cleanQuery));
      return queryWords.every((qw) => words.some((w) => w.startsWith(qw))) || name.includes(cleanQuery);
    });

    matches.sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      return (aName.startsWith(cleanQuery) ? 0 : 1) - (bName.startsWith(cleanQuery) ? 0 : 1) || aName.localeCompare(bName);
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
      row.innerHTML = `
        <div style="font-weight: 600;">${sanitizeInput(item.name)} ${shinyTag ? '<span style="color:var(--accent-gold);">★</span>' : ''}</div>
        <div style="font-size: 11px; color: var(--text-muted);">Val: ${valText} | Dem: ${sanitizeInput(item.demandLabel)}</div>
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
    if (input.value.trim().length > 0) renderMatches(input.value);
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
    if (!input.contains(e.target) && !panel.contains(e.target)) panel.classList.remove('open');
  });
}

function selectItemForSide(item, side) {
  if (side === 'your') selectedItemYour = item;
  else selectedItemTheir = item;
  updateSidePreview(side, item);
}

function updateSidePreview(side, item) {
  const thumbEl = document.getElementById(`preview-thumb-${side}`);
  const nameEl = document.getElementById(`preview-name-${side}`);
  const badgesEl = document.getElementById(`preview-badges-${side}`);
  const valEl = document.getElementById(`preview-val-${side}`);
  const demEl = document.getElementById(`preview-dem-${side}`);
  const cb = document.getElementById(`shiny-${side}`);
  const label = document.getElementById(`label-shiny-${side}`);
  const btnAdd = document.getElementById(`btn-add-${side}`);

  if (!item) {
    if (thumbEl) thumbEl.textContent = '🔨';
    if (nameEl) nameEl.textContent = 'Type above to select an item';
    if (badgesEl) badgesEl.innerHTML = '<span class="badge badge-rarity" style="opacity: 0.5;">Select Item</span>';
    if (valEl) valEl.textContent = '-';
    if (demEl) demEl.textContent = 'Demand: -';
    if (cb) { cb.checked = false; cb.disabled = true; }
    if (label) label.classList.add('disabled');
    if (btnAdd) btnAdd.disabled = true;
    return;
  }

  const isShiny = cb?.checked && item.hasShiny;
  const display = getItemActiveDisplay(item, isShiny);
  const displayRarity = item.rarity === 'Unobtainable' ? 'Untradeable' : item.rarity;
  const rarityClass = `rarity-${sanitizeInput(displayRarity).toLowerCase()}`;
  const isGem = (item.type || '').toLowerCase() === 'gem';

  if (thumbEl) {
    thumbEl.textContent = isGem ? '💎' : '🔨';
    const testImg = new Image();
    testImg.src = `images/${item.id}.png`;
    testImg.onload = () => { thumbEl.innerHTML = `<img src="images/${item.id}.png" style="width:100%; height:100%; object-fit:contain;" />`; };
  }

  if (nameEl) nameEl.textContent = item.name;
  if (badgesEl) {
    badgesEl.innerHTML = `
      <span class="badge-rarity badge-rarity-${rarityClass}" style="font-size:9px; padding:2px 6px;">${sanitizeInput(displayRarity)}</span>
      ${isShiny ? '<span class="badge badge-shiny" style="font-size:9px; padding:2px 5px;">★ Shiny</span>' : ''}
    `;
  }
  if (valEl) valEl.textContent = display.value;
  if (demEl) demEl.textContent = `Demand: ${display.demandLabel}`;

  if (cb && label) {
    if (item.hasShiny) {
      cb.disabled = false;
      label.classList.remove('disabled');
    } else {
      cb.checked = false;
      cb.disabled = true;
      label.classList.add('disabled');
    }
  }

  if (btnAdd) btnAdd.disabled = false;
}

function calculateSide(items) {
  let totalValue = 0;
  let totalDemandTier = 0;
  let hasNil = false;

  items.forEach((item) => {
    if (item.isNilValue) hasNil = true;
    else totalValue += item.tradeValue;
    totalDemandTier += item.demandTier;
  });

  const avgDemand = items.length > 0 ? (totalDemandTier / items.length).toFixed(1) : '-';
  return { totalValue, hasNil, avgDemand };
}

function updateTradeVerdict(verdictType = null, diffVal = 0, pctStr = '', isWin = false, isFair = false) {
  const verdictText = document.getElementById('verdict-text');
  const verdictDetails = document.getElementById('verdict-details');
  const centerBox = document.getElementById('verdict-center-box');

  if (!verdictText || !verdictDetails) return;

  if (!verdictType) {
    verdictText.className = 'verdict-status status-fair';
    verdictText.textContent = 'ADD ITEMS TO BOTH SIDES';
    verdictDetails.textContent = 'Compare trade fairness instantly';
    return;
  }

  verdictText.textContent = verdictType;
  if (isWin) {
    verdictText.className = 'verdict-status status-win';
    verdictDetails.textContent = `+${diffVal} value (+${pctStr}%) profit for you`;
  } else if (isFair) {
    verdictText.className = 'verdict-status status-fair';
    verdictDetails.textContent = `Balanced trade within ${pctStr}% value range`;
  } else {
    verdictText.className = 'verdict-status status-loss';
    verdictDetails.textContent = `${diffVal} value (${pctStr}%) deficit for you`;
  }
}

function renderTradeList(sideItems, listElementId) {
  const ul = document.getElementById(listElementId);
  if (!ul) return;
  ul.innerHTML = '';

  if (sideItems.length === 0) {
    ul.innerHTML = '<li style="font-size: 11px; color: var(--text-muted); padding: 6px 0; text-align:center;">No items added</li>';
    return;
  }

  const groupedMap = new Map();
  sideItems.forEach((item) => {
    const key = `${item.id}_${item.isShiny ? 'shiny' : 'base'}`;
    if (!groupedMap.has(key)) groupedMap.set(key, { ...item, quantity: 1 });
    else groupedMap.get(key).quantity += 1;
  });

  groupedMap.forEach((group) => {
    const li = document.createElement('li');
    li.className = 'trade-item';
    const valText = group.isNilValue ? 'Nil' : group.tradeValue * group.quantity;
    const fallbackEmoji = (group.type || '').toLowerCase() === 'gem' ? '💎' : '🔨';

    li.innerHTML = `
      <div class="trade-item-left">
        <div class="trade-thumb" id="tray-thumb-${group.id}-${group.isShiny}">${fallbackEmoji}</div>
        <div style="min-width: 0; flex: 1;">
          <div class="trade-item-title">${sanitizeInput(group.name)} ${group.isShiny ? '<span style="color:#fbbf24;">★</span>' : ''}</div>
          <span style="font-size: 10px; color: var(--text-muted);">Val: <b style="color:var(--accent-gold);">${valText}</b></span>
        </div>
      </div>
      <div class="trade-item-controls">
        <button class="qty-btn btn-minus">−</button>
        <span class="qty-badge">×${group.quantity}</span>
        <button class="qty-btn btn-plus">+</button>
        <button class="remove-btn btn-remove">✕</button>
      </div>
    `;

    const thumbWrap = li.querySelector(`#tray-thumb-${group.id}-${group.isShiny}`);
    const imgTest = new Image();
    imgTest.src = `images/${group.id}.png`;
    imgTest.onload = () => { thumbWrap.innerHTML = `<img src="images/${group.id}.png" style="width:100%; height:100%; object-fit:contain;" />`; };

    li.querySelector('.btn-minus').addEventListener('click', () => {
      const idx = sideItems.findIndex((i) => i.id === group.id && !!i.isShiny === !!group.isShiny);
      if (idx !== -1) sideItems.splice(idx, 1);
      updateCalculatorUI();
      updateTradeVerdict();
    });

    li.querySelector('.btn-plus').addEventListener('click', () => {
      addItemToTrade(group, listElementId === 'list-your' ? 'your' : 'their', group.isShiny);
    });

    li.querySelector('.btn-remove').addEventListener('click', () => {
      const targetArray = listElementId === 'list-your' ? yourOffer : theirOffer;
      for (let i = targetArray.length - 1; i >= 0; i--) {
        if (targetArray[i].id === group.id && !!targetArray[i].isShiny === !!group.isShiny) targetArray.splice(i, 1);
      }
      updateCalculatorUI();
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

  if (sideTarget === 'your') yourOffer.push(tradeItem);
  else theirOffer.push(tradeItem);

  updateCalculatorUI();
  updateTradeVerdict();
}

function renderItems(items) {
  const grid = document.getElementById('items-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (items.length === 0) {
    grid.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1; padding: 24px; text-align: center;">No matching items found.</p>';
    return;
  }

  if (currentViewMode === 'compact') {
    const container = document.createElement('div');
    container.className = 'compact-container';
    const groups = new Map();
    items.forEach((item) => {
      const key = item.releaseEvent || item.setName || 'Other Items';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    groups.forEach((groupItems, groupName) => {
      const section = document.createElement('div');
      section.className = 'compact-section';
      section.innerHTML = `<div class="compact-section-header"><span>🎃 ${sanitizeInput(groupName)}</span></div>`;

      groupItems.forEach((item) => {
        const isShiny = item.hasShiny && !!shinyState[item.id];
        const display = getItemActiveDisplay(item, isShiny);
        const displayRarity = item.rarity === 'Unobtainable' ? 'Untradeable' : item.rarity;
        const rarityClass = `rarity-${sanitizeInput(displayRarity).toLowerCase()}`;
        const countYour = yourOffer.filter((i) => i.id === item.id).length;
        const countTheir = theirOffer.filter((i) => i.id === item.id).length;

        const row = document.createElement('div');
        row.className = 'compact-row';
        row.setAttribute('data-id', item.id);
        row.innerHTML = `
          <div class="compact-name">
            <span class="badge-rarity badge-rarity-${rarityClass}" style="font-size: 8px; padding: 1px 4px;">${sanitizeInput(displayRarity)}</span>
            <span>${sanitizeInput(item.name)}</span>
            ${isShiny ? '<span style="color:var(--accent-gold);">★</span>' : ''}
          </div>
          <div class="compact-meta">
            <span style="font-size: 11px; color: var(--text-muted); width: 50px;">${sanitizeInput(item.type).toUpperCase()}</span>
            <span class="val" style="width: 45px; text-align: right;">${display.value}</span>
            <span class="demand" style="width: 25px; text-align: center;">${sanitizeInput(display.demandLabel)}</span>
            <span style="font-size: 11px; color: var(--text-muted); width: 80px; text-align: right; overflow:hidden; text-overflow:ellipsis;">${sanitizeInput(display.status)}</span>
            <div style="display: flex; gap: 4px;">
              <div class="card-btn-group side-your ${countYour > 0 ? 'has-items' : ''}" style="height: 24px;">
                <button class="card-add-btn" data-action="add-your" data-id="${item.id}" style="font-size:9px; padding:2px 5px;">${countYour > 0 ? `You (${countYour})` : '+ You'}</button>
                <button class="card-minus-btn" data-action="minus-your" data-id="${item.id}">−</button>
              </div>
              <div class="card-btn-group side-their ${countTheir > 0 ? 'has-items' : ''}" style="height: 24px;">
                <button class="card-add-btn" data-action="add-their" data-id="${item.id}" style="font-size:9px; padding:2px 5px;">${countTheir > 0 ? `Them (${countTheir})` : '+ Them'}</button>
                <button class="card-minus-btn" data-action="minus-their" data-id="${item.id}">−</button>
              </div>
            </div>
          </div>
        `;
        section.appendChild(row);
      });
      container.appendChild(section);
    });
    grid.appendChild(container);
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const card = document.createElement('div');
    const isShiny = item.hasShiny && !!shinyState[item.id];
    const displayRarity = item.rarity === 'Unobtainable' ? 'Untradeable' : item.rarity;
    const rarityClass = `rarity-${sanitizeInput(displayRarity).toLowerCase()}`;
    card.className = `card rarity-${rarityClass} ${isShiny ? 'is-shiny' : ''}`;
    card.setAttribute('data-id', item.id);

    const isGem = (item.type || '').toLowerCase() === 'gem';
    const display = getItemActiveDisplay(item, isShiny);
    const countYour = yourOffer.filter((i) => i.id === item.id).length;
    const countTheir = theirOffer.filter((i) => i.id === item.id).length;

    card.innerHTML = `
      ${(item.rarity || '').toLowerCase() === 'mythical' ? `<button type="button" class="card-audio-btn" data-action="play-audio" data-id="${item.id}">🔊</button>` : ''}
      ${item.hasShiny ? `<div class="shiny-star-btn ${isShiny ? 'active' : ''}" data-action="toggle-shiny" data-id="${item.id}">★</div>` : ''}
      <div class="card-image-wrap" id="img-wrap-${item.id}"><div class="card-img-fallback">${isGem ? '💎' : '🔨'}</div></div>
      <div class="card-top-info">
        <div style="display: flex; gap: 3px;">
          <span class="badge ${isGem ? 'badge-gem' : ''}">${sanitizeInput(item.type)}</span>
          <span class="badge-rarity badge-rarity-${rarityClass}">${sanitizeInput(displayRarity)}</span>
          ${isShiny ? '<span class="badge badge-shiny">★ SHINY</span>' : ''}
        </div>
        <span class="set-tag">${sanitizeInput(item.setName || item.releaseEvent)}</span>
      </div>
      <h3 class="card-title">${sanitizeInput(item.name)}</h3>
      <div class="meta-rows">
        <div class="row"><span>Value</span><span class="val">${display.value}</span></div>
        <div class="row"><span>Demand</span><span class="demand">${sanitizeInput(display.demandLabel)}</span></div>
        <div class="row"><span>Status</span><span class="status-tag">${sanitizeInput(display.status)}</span></div>
      </div>
      <div class="card-actions">
        <div class="card-btn-group side-your ${countYour > 0 ? 'has-items' : ''}">
          <button class="card-add-btn" data-action="add-your" data-id="${item.id}">${countYour > 0 ? `You (${countYour})` : '+ Your Offer'}</button>
          <button class="card-minus-btn" data-action="minus-your" data-id="${item.id}">−</button>
        </div>
        <div class="card-btn-group side-their ${countTheir > 0 ? 'has-items' : ''}">
          <button class="card-add-btn" data-action="add-their" data-id="${item.id}">${countTheir > 0 ? `Them (${countTheir})` : '+ Their Offer'}</button>
          <button class="card-minus-btn" data-action="minus-their" data-id="${item.id}">−</button>
        </div>
      </div>
    `;
    fragment.appendChild(card);

    const imgTest = new Image();
    imgTest.src = `images/${item.id}.png`;
    imgTest.onload = () => {
      const wrap = card.querySelector(`#img-wrap-${item.id}`);
      if (wrap) wrap.innerHTML = `<img src="images/${item.id}.png" style="width:100%; height:100%; object-fit:contain; padding:6px;" />`;
    };
  });
  grid.appendChild(fragment);
}

function saveCompletedTrade(verdict, isWin, isFair) {
  if (yourOffer.length === 0 || theirOffer.length === 0) return;
  try {
    let history = [];
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) history = JSON.parse(saved);

    const dataYour = calculateSide(yourOffer);
    const dataTheir = calculateSide(theirOffer);

    const entry = {
      date: 'Just now',
      verdict,
      isWin,
      isFair,
      yourThumb: yourOffer[0]?.id || '',
      theirThumb: theirOffer[0]?.id || '',
      yourVal: dataYour.totalValue,
      theirVal: dataTheir.totalValue
    };

    history.unshift(entry);
    if (history.length > 3) history = history.slice(0, 3);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderTradeHistory();
  } catch (e) {
    console.warn('Failed to save history:', e);
  }
}

function renderTradeHistory() {
  const grid = document.getElementById('trade-history-grid');
  if (!grid) return;
  grid.innerHTML = '';

  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (!saved) {
      grid.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); grid-column: 1 / -1; text-align: center; padding: 10px;">No recent trades saved</div>';
      return;
    }
    const history = JSON.parse(saved);
    if (history.length === 0) {
      grid.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); grid-column: 1 / -1; text-align: center; padding: 10px;">No recent trades saved</div>';
      return;
    }

    history.forEach((h) => {
      const card = document.createElement('div');
      card.className = 'recent-trade-card';
      const badgeClass = h.isWin ? 'badge-win' : (h.isFair ? 'badge-fair' : 'badge-loss');

      card.innerHTML = `
        <div class="recent-trade-sides">
          <div class="recent-thumb">🔨</div>
          <span style="font-size: 11px; font-weight:700; color:var(--accent-cyan);">${h.yourVal}</span>
          <span style="font-size: 11px; color:var(--text-muted);">⇄</span>
          <div class="recent-thumb">🔨</div>
          <span style="font-size: 11px; font-weight:700; color:var(--accent-green);">${h.theirVal}</span>
        </div>
        <span class="recent-badge ${badgeClass}">${h.verdict}</span>
      `;
      grid.appendChild(card);
    });
  } catch (e) {
    console.warn('History render error:', e);
  }
}

function setupEventListeners() {
  setupPrefixSearch('calc-search-your', 'btn-clear-calc-your', 'matches-panel-your', 'your');
  setupPrefixSearch('calc-search-their', 'btn-clear-calc-their', 'matches-panel-their', 'their');

  const btnForceSync = document.getElementById('btn-force-sync');
  if (btnForceSync) btnForceSync.addEventListener('click', (e) => window.forceSyncNow(e));

  document.getElementById('btn-copy-discord')?.addEventListener('click', () => {
    const dataYour = calculateSide(yourOffer);
    const dataTheir = calculateSide(theirOffer);
    const text = `### ⚖️ **FLEEMARKET Trade Breakdown**\n**Your Offer Value:** ${dataYour.totalValue}\n**Their Offer Value:** ${dataTheir.totalValue}\n**Verdict:** ${document.getElementById('verdict-text')?.textContent || 'Fair Trade'}`;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('btn-copy-discord');
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => btn.textContent = orig, 2000);
    });
  });

  document.getElementById('btn-share-link')?.addEventListener('click', () => {
    const encodeSide = (items) => items.map(i => `${i.id}:1:${i.isShiny ? 1 : 0}`).join(',');
    const url = new URL(window.location.origin + window.location.pathname);
    if (yourOffer.length) url.searchParams.set('you', encodeSide(yourOffer));
    if (theirOffer.length) url.searchParams.set('them', encodeSide(theirOffer));
    navigator.clipboard.writeText(url.toString()).then(() => {
      const btn = document.getElementById('btn-share-link');
      const orig = btn.textContent;
      btn.textContent = '✓ Link Copied!';
      setTimeout(() => btn.textContent = orig, 2000);
    });
  });

  document.getElementById('btn-finalize-trade')?.addEventListener('click', () => {
    const dataYour = calculateSide(yourOffer);
    const dataTheir = calculateSide(theirOffer);

    if (dataYour.hasNil || dataTheir.hasNil) {
      updateTradeVerdict('CONTAINS NIL', 0, '0', false, true);
      saveCompletedTrade('FAIR', false, true);
      return;
    }

    const diff = dataTheir.totalValue - dataYour.totalValue;
    const maxVal = Math.max(dataYour.totalValue, dataTheir.totalValue, 1);
    const pct = ((Math.abs(diff) / maxVal) * 100).toFixed(1);

    if (diff > 0) {
      updateTradeVerdict('WIN', diff, pct, true, false);
      saveCompletedTrade('WIN', true, false);
    } else if (diff < 0) {
      updateTradeVerdict('LOSS', Math.abs(diff), pct, false, false);
      saveCompletedTrade('LOSS', false, false);
    } else {
      updateTradeVerdict('FAIR', 0, '0', false, true);
      saveCompletedTrade('FAIR', false, true);
    }
  });

  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderTradeHistory();
  });

  document.getElementById('shiny-your')?.addEventListener('change', () => {
    updateSidePreview('your', selectedItemYour);
  });
  document.getElementById('shiny-their')?.addEventListener('change', () => {
    updateSidePreview('their', selectedItemTheir);
  });

  document.getElementById('btn-add-your')?.addEventListener('click', () => {
    if (selectedItemYour) {
      const isShiny = document.getElementById('shiny-your')?.checked || false;
      addItemToTrade(selectedItemYour, 'your', isShiny);
      selectedItemYour = null;
      updateSidePreview('your', null);
      document.getElementById('calc-search-your').value = '';
    }
  });

  document.getElementById('btn-add-their')?.addEventListener('click', () => {
    if (selectedItemTheir) {
      const isShiny = document.getElementById('shiny-their')?.checked || false;
      addItemToTrade(selectedItemTheir, 'their', isShiny);
      selectedItemTheir = null;
      updateSidePreview('their', null);
      document.getElementById('calc-search-their').value = '';
    }
  });

  document.getElementById('btn-reset')?.addEventListener('click', () => {
    yourOffer = [];
    theirOffer = [];
    localStorage.removeItem(TRADE_KEY_YOUR);
    localStorage.removeItem(TRADE_KEY_THEIR);
    selectedItemYour = null;
    selectedItemTheir = null;
    updateSidePreview('your', null);
    updateSidePreview('their', null);
    document.getElementById('calc-search-your').value = '';
    document.getElementById('calc-search-their').value = '';
    updateCalculatorUI();
    updateTradeVerdict();
  });

  document.getElementById('items-grid')?.addEventListener('click', (e) => {
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
    } else if (action === 'add-your') {
      addItemToTrade(itemObj, 'your', itemObj.hasShiny && !!shinyState[itemObj.id]);
    } else if (action === 'minus-your') {
      const idx = yourOffer.findIndex((i) => i.id === itemId);
      if (idx !== -1) yourOffer.splice(idx, 1);
      updateCalculatorUI();
      updateTradeVerdict();
    } else if (action === 'add-their') {
      addItemToTrade(itemObj, 'their', itemObj.hasShiny && !!shinyState[itemObj.id]);
    } else if (action === 'minus-their') {
      const idx = theirOffer.findIndex((i) => i.id === itemId);
      if (idx !== -1) theirOffer.splice(idx, 1);
      updateCalculatorUI();
      updateTradeVerdict();
    }
  });

  document.querySelectorAll('#view-mode-group .filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#view-mode-group .filter-btn').forEach((b) => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentViewMode = e.currentTarget.getAttribute('data-view');
      localStorage.setItem(VIEW_MODE_KEY, currentViewMode);
      applyFilters();
    });
  });

  document.querySelectorAll('.filter-btn:not(#view-mode-group .filter-btn)').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn:not(#view-mode-group .filter-btn)').forEach((b) => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentFilter = e.currentTarget.getAttribute('data-filter').toLowerCase().trim();
      applyFilters();
    });
  });

  document.getElementById('btn-toggle-filters')?.addEventListener('click', () => {
    const drawer = document.getElementById('filter-drawer');
    const isOpen = drawer.classList.toggle('open');
    document.getElementById('btn-toggle-filters').classList.toggle('open', isOpen);
  });

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

  document.getElementById('cb-has-shiny')?.addEventListener('change', (e) => {
    filterHasShiny = e.target.checked;
    updateFilterBadge();
    applyFilters();
  });

  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    activeRarities.clear();
    activeDemands.clear();
    activeStatuses.clear();
    activeEvents.clear();
    filterHasShiny = false;
    document.querySelectorAll('.cb-rarity, .cb-demand, .cb-status, .cb-event').forEach((cb) => cb.checked = false);
    document.getElementById('cb-has-shiny').checked = false;
    updateFilterBadge();
    applyFilters();
  });

  const searchInput = document.getElementById('search');
  const btnClearSearch = document.getElementById('btn-clear-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (btnClearSearch) btnClearSearch.style.display = searchInput.value.trim().length > 0 ? 'flex' : 'none';
      applyFilters();
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

  document.getElementById('sort-select')?.addEventListener('change', (e) => {
    currentSort = e.target.value;
    applyFilters();
  });
}

function applyFilters() {
  const query = sanitizeInput(document.getElementById('search')?.value || '').toLowerCase().trim();
  let filtered = allItems.filter((item) => {
    const itemType = (item.type || '').toLowerCase().trim();
    const itemRarity = (item.rarity || '').trim().toLowerCase();
    const itemEvent = (item.releaseEvent || '').trim();
    const itemDemand = String(item.demandTier);
    const itemStatus = (item.status || '').trim().toLowerCase();

    if (currentFilter === 'hammer' && itemType !== 'hammer') return false;
    if (currentFilter === 'gem' && itemType !== 'gem') return false;

    if (activeRarities.size > 0) {
      let matches = false;
      for (const r of activeRarities) {
        if (r.toLowerCase() === 'untradeable' && (itemRarity === 'untradeable' || itemRarity === 'unobtainable')) { matches = true; break; }
        if (itemRarity === r.toLowerCase()) { matches = true; break; }
      }
      if (!matches) return false;
    }

    if (activeDemands.size > 0 && !activeDemands.has(itemDemand)) return false;
    if (activeStatuses.size > 0 && !Array.from(activeStatuses).some(s => itemStatus === s.toLowerCase())) return false;
    if (filterHasShiny && !item.hasShiny) return false;
    if (activeEvents.size > 0 && !activeEvents.has(itemEvent)) return false;

    return !query || (item.name && item.name.toLowerCase().includes(query)) || (item.setName && item.setName.toLowerCase().includes(query));
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

window.forceSyncNow = async function(event) {
  if (event) event.preventDefault();
  const btn = document.getElementById('btn-force-sync');
  const icon = btn?.querySelector('.sync-icon');
  if (btn) btn.classList.add('is-syncing');
  if (icon) icon.textContent = '⏳';
  await loadData(true);
  if (btn) btn.classList.remove('is-syncing');
  if (icon) icon.textContent = '↻';
};

async function fetchFreshCSV() {
  const cacheBust = `&_t=${Date.now()}`;
  try {
    const res = await fetch(GVIZ_CSV_URL + cacheBust);
    if (res.ok) { const text = await res.text(); if (text && text.length > 50) return text; }
  } catch (e) {}
  try {
    const res = await fetch(PRIMARY_CSV_URL + cacheBust);
    if (res.ok) { const text = await res.text(); if (text && text.length > 50) return text; }
  } catch (e) {}
  try {
    const res = await fetch(LOCAL_CSV_PATH + `?_t=${Date.now()}`);
    if (res.ok) { const text = await res.text(); if (text && text.length > 50) return text; }
  } catch (e) {}
  try {
    const cached = localStorage.getItem(CACHE_KEY_DATA);
    if (cached) return cached;
  } catch (e) {}
  return null;
}

async function loadData(forceRefresh = false) {
  const statusEl = document.getElementById('status');
  performLocalStorageHousekeeping();

  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY_DATA);
      const time = Number(localStorage.getItem(CACHE_KEY_TIME)) || 0;
      if (cached && Date.now() - time < CACHE_TTL_MS) {
        allItems = parseCSV(cached);
        if (allItems.length > 0) {
          if (statusEl) { statusEl.textContent = `✓ Loaded ${allItems.length} items (Cached)`; statusEl.style.color = 'var(--accent-green)'; }
          populateEventFilters(allItems);
          applyFilters();
          loadTradeState();
          updateCalculatorUI();
          updateTradeVerdict();
          renderTradeHistory();
          return;
        }
      }
    } catch (e) {}
  }

  const fresh = await fetchFreshCSV();
  if (fresh) {
    const parsed = parseCSV(fresh);
    if (parsed.length > 0) {
      allItems = parsed;
      try {
        localStorage.setItem(CACHE_KEY_DATA, fresh);
        localStorage.setItem(CACHE_KEY_TIME, String(Date.now()));
      } catch (e) {}
      if (statusEl) {
        statusEl.textContent = `✓ Synced ${allItems.length} items successfully`;
        statusEl.style.color = 'var(--accent-green)';
      }
      populateEventFilters(allItems);
      applyFilters();
      loadTradeState();
      updateCalculatorUI();
      updateTradeVerdict();
      renderTradeHistory();
      return;
    }
  }

  if (allItems.length === 0 && statusEl) {
    statusEl.textContent = '⚠️ Could not reach Google Sheets.';
    statusEl.style.color = 'var(--accent-rose)';
  }
}

initTabNavigation();
setupEventListeners();
loadData();
