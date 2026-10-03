const PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSidb2RfYHa6ffWiale6czVqih6e7BrrZ-ZmRdnT10WTsS5M1ZJF9-jKSvcpyyrv5imytQ9lZsvL8su/pub?gid=0&single=true&output=csv';
const SPREADSHEET_ID = '1XKPloRF46l0GGQOCdH0ce6Krjriitvj1LAdGTl_kkLI';
const GVIZ_CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;

// LocalStorage Cache Configuration (10 minutes)
const CACHE_KEY_DATA = 'flee_items_cache_v1';
const CACHE_KEY_TIME = 'flee_items_time_v1';
const CACHE_TTL_MS = 10 * 60 * 1000;

// Persistent Trade State Keys
const TRADE_KEY_YOUR = 'flee_trade_your_v1';
const TRADE_KEY_THEIR = 'flee_trade_their_v1';

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

const TAB_KEY_PREF = 'flee_active_tab_v1';

// Immediate Tab Switching with Persistent Memory
function switchTab(targetTab, saveToStorage = true) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === targetTab);
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

  // Restore last used tab on boot
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
    label.innerHTML = `<input type="checkbox" class="cb-event" value="${ev}" ${activeEvents.has(ev) ? 'checked' : ''}> ${ev}`;

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

  renderTrayList(yourOffer, 'tray-list-your', 'your');
  renderTrayList(theirOffer, 'tray-list-their', 'their');
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
    li.innerHTML = `
      <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
        <b>${item.name}</b> ${item.isShiny ? '<span style="color:#fbbf24;">★</span>' : ''}
        <span style="color:var(--text-muted); font-size:10px;">(${valText})</span>
      </div>
      <button type="button" class="remove-btn" style="width:22px; height:22px; font-size:11px;">✕</button>
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

// Sequential Word-Prefix Search & Autocomplete
function setupPrefixSearch(inputId, clearBtnId, panelId, side) {
  const input = document.getElementById(inputId);
  const clearBtn = document.getElementById(clearBtnId);
  const panel = document.getElementById(panelId);
  if (!input || !panel) return;

  function renderMatches(query) {
    const cleanQuery = query.toLowerCase().trim();
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
      panel.innerHTML = `<div class="calc-no-match-msg">⚠️ No items starting with "${query}"</div>`;
      panel.classList.add('open');
      return;
    }

    matches.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'calc-match-item';
      const valText = item.isNilValue ? 'Nil' : item.baseValue;
      const shinyTag = item.hasShiny ? '★' : '';

      row.innerHTML = `
        <div class="calc-match-item-name">
          <span>${item.name}</span>
          <span style="font-size: 10px; color: var(--accent-cyan);">(${item.type})</span>
          ${shinyTag ? '<span style="color: var(--accent-gold); font-size: 10px;">★</span>' : ''}
        </div>
        <div class="calc-match-item-meta">Val: ${valText} | Dem: ${item.demandLabel}</div>
      `;

      // Automatically add item directly upon clicking dropdown suggestion
      row.addEventListener('click', () => {
        const isShiny = document.getElementById(`shiny-${side}`)?.checked || false;
        addItemToTrade(item, side, isShiny);

        input.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        panel.classList.remove('open');
        selectItemForSide(null, side);
      });

      panel.appendChild(row);
    });

    panel.classList.add('open');
  }

  input.addEventListener('input', (e) => {
    renderMatches(e.target.value);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length > 0) {
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
      if (firstMatch) {
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
  if (nameEl) nameEl.innerHTML = `${item.name} <span style="font-size: 11px; color: var(--accent-cyan);">(${item.type})</span>`;
  if (metaEl) metaEl.textContent = `Val: ${valText} • Dem: ${item.demandLabel}`;

  if (cb && label) {
    if (item.hasShiny) {
      cb.disabled = false;
      label.classList.remove('disabled');
      label.title = `Add Shiny ${item.name} (Val: ${item.shinyValue})`;
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

  if (percentDiff > 15) {
    verdictEl.textContent = '🎉 Big Win';
    verdictEl.classList.add('status-win');
  } else if (percentDiff > 5) {
    verdictEl.textContent = '✅ Small Win';
    verdictEl.classList.add('status-win');
  } else if (percentDiff >= -5) {
    verdictEl.textContent = '⚖️ Fair Trade';
    verdictEl.classList.add('status-fair');
  } else if (percentDiff >= -15) {
    verdictEl.textContent = '🔻 Small Loss';
    verdictEl.classList.add('status-loss');
  } else {
    verdictEl.textContent = '❌ Big Loss';
    verdictEl.classList.add('status-loss');
  }

  const sign = diff > 0 ? '+' : '';
  detailsEl.textContent = `Their Offer has ${sign}${diff} value (${diff >= 0 ? 'Profit' : 'Loss'} for You)`;
}

// Group duplicate items by quantity stacking (x2, x3)
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
    const imagePath = group.isShiny ? `images/${group.id}_shiny.png` : `images/${group.id}.png`;

    li.innerHTML = `
      <div class="trade-item-left">
        <img 
          src="${imagePath}" 
          alt="${group.name}" 
          class="trade-thumb"
          onerror="this.src='images/${group.id}.png'; this.onerror=function(){this.style.display='none'; this.nextElementSibling.style.display='flex';};"
        />
        <div class="trade-thumb-fallback" style="display: none;">${fallbackEmoji}</div>
        <div style="min-width: 0; flex: 1;">
          <div class="trade-item-title">
            ${group.name}
            ${group.isShiny ? '<span style="color: #fbbf24; font-size: 10px; margin-left: 2px;">★</span>' : ''}
          </div>
          <span style="font-size: 10px; color: var(--text-muted);">Val: <b style="color: var(--accent-gold);">${valText}</b> • Dem: ${group.demandLabel}</span>
        </div>
      </div>
      <div class="trade-item-controls">
        <button class="qty-btn btn-minus" title="Decrease quantity">−</button>
        <span class="qty-badge">×${group.quantity}</span>
        <button class="qty-btn btn-plus" title="Increase quantity">+</button>
        <button class="remove-btn btn-remove" title="Remove all">✕</button>
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

function renderItems(items) {
  const grid = document.getElementById('items-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (items.length === 0) {
    grid.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1; padding: 24px; text-align: center;">No matching items found with the active filters.</p>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('div');
    const isShiny = item.hasShiny && !!shinyState[item.id];
    const displayRarity = item.rarity === 'Unobtainable' ? 'Untradeable' : item.rarity;
    const rarityClass = `rarity-${displayRarity.toLowerCase()}`;
    const isMythical = (item.rarity || '').toLowerCase() === 'mythical';

    card.className = `card ${rarityClass} ${isShiny ? 'is-shiny' : ''}`;

    const isGem = (item.type || '').toLowerCase() === 'gem';
    const display = getItemActiveDisplay(item, isShiny);
    const fallbackEmoji = isGem ? '💎' : '🔨';
    const imagePath = isShiny ? `images/${item.id}_shiny.png` : `images/${item.id}.png`;

    const countYour = yourOffer.filter((i) => i.id === item.id).length;
    const countTheir = theirOffer.filter((i) => i.id === item.id).length;

    const starButtonHtml = item.hasShiny
      ? `<div class="shiny-star-btn ${isShiny ? 'active' : ''}" data-id="${item.id}" title="Toggle Shiny Version">★</div>`
      : '';

    const audioButtonHtml = isMythical
      ? `<button type="button" class="card-audio-btn" data-id="${item.id}" title="Play Sound Effect">🔊</button>`
      : '';

    card.innerHTML = `
      ${audioButtonHtml}
      ${starButtonHtml}
      <div class="card-image-wrap">
        <img 
          src="${imagePath}" 
          alt="${item.name}" 
          class="card-img"
          loading="lazy"
          onerror="this.src='images/${item.id}.png'; this.onerror=function(){this.style.display='none'; this.nextElementSibling.style.display='flex';};"
        />
        <div class="card-img-fallback" style="display: none;">${fallbackEmoji}</div>
      </div>
      <div class="card-top-info">
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 3px;">
          <span class="badge ${isGem ? 'badge-gem' : ''}">${item.type}</span>
          <span class="badge-rarity badge-${rarityClass}">${displayRarity}</span>
          ${isShiny ? '<span class="badge badge-shiny">★ SHINY</span>' : ''}
        </div>
        <span class="set-tag" title="${item.setName || item.releaseEvent}">${item.setName || item.releaseEvent}</span>
      </div>
      <h3 class="card-title" title="${item.name}">${item.name}</h3>
      <div class="meta-rows">
        <div class="row">
          <span>Value</span>
          <span class="val">${display.value}</span>
        </div>
        <div class="row">
          <span>Demand</span>
          <span class="demand">${display.demandLabel}</span>
        </div>
        <div class="row">
          <span>Status</span>
          <span class="status-tag" title="${display.status}">${display.status}</span>
        </div>
      </div>
      <div class="card-actions">
        <div class="card-btn-group side-your ${countYour > 0 ? 'has-items' : ''}">
          <button class="card-add-btn" data-id="${item.id}">${countYour > 0 ? `+ You (${countYour})` : '+ Your Offer'}</button>
          <button class="card-minus-btn" data-id="${item.id}" title="Remove one from Your Offer">−</button>
        </div>
        <div class="card-btn-group side-their ${countTheir > 0 ? 'has-items' : ''}">
          <button class="card-add-btn" data-id="${item.id}">${countTheir > 0 ? `+ Them (${countTheir})` : '+ Their Offer'}</button>
          <button class="card-minus-btn" data-id="${item.id}" title="Remove one from Their Offer">−</button>
        </div>
      </div>
    `;

    // Mythical Audio Preview
    const audioBtn = card.querySelector('.card-audio-btn');
    if (audioBtn) {
      audioBtn.addEventListener('click', (e) => {
        e.stopPropagation();

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

        const audioSrc = `audio/${item.id}.mp3`;
        const audio = new Audio(audioSrc);

        audio.play().then(() => {
          audioBtn.classList.add('is-playing');
          audioBtn.textContent = '⏹';
          currentPlayingAudio = audio;
          currentPlayingBtn = audioBtn;
        }).catch((err) => {
          console.warn(`Audio track for ${item.name} not found at ${audioSrc}:`, err);
        });

        audio.onended = () => {
          audioBtn.classList.remove('is-playing');
          audioBtn.textContent = '🔊';
          currentPlayingAudio = null;
          currentPlayingBtn = null;
        };
      });
    }

    // Touch & Click Shiny Toggle
    const starBtn = card.querySelector('.shiny-star-btn');
    if (starBtn) {
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        shinyState[item.id] = !shinyState[item.id];
        const isNowShiny = !!shinyState[item.id];
        const updatedDisplay = getItemActiveDisplay(item, isNowShiny);
        const updatedImagePath = isNowShiny ? `images/${item.id}_shiny.png` : `images/${item.id}.png`;

        card.classList.toggle('is-shiny', isNowShiny);
        starBtn.classList.toggle('active', isNowShiny);

        const valEl = card.querySelector('.val');
        if (valEl) valEl.textContent = updatedDisplay.value;

        const demEl = card.querySelector('.demand');
        if (demEl) demEl.textContent = updatedDisplay.demandLabel;

        const statEl = card.querySelector('.status-tag');
        if (statEl) {
          statEl.textContent = updatedDisplay.status;
          statEl.title = updatedDisplay.status;
        }

        const imgEl = card.querySelector('.card-img');
        if (imgEl) {
          imgEl.src = updatedImagePath;
          imgEl.onerror = function () {
            this.src = `images/${item.id}.png`;
            this.onerror = function () {
              this.style.display = 'none';
              this.nextElementSibling.style.display = 'flex';
            };
          };
        }

        const badgeGroup = card.querySelector('.card-top-info div');
        if (badgeGroup) {
          const existingShinyBadge = badgeGroup.querySelector('.badge-shiny');
          if (isNowShiny && !existingShinyBadge) {
            const shinySpan = document.createElement('span');
            shinySpan.className = 'badge badge-shiny';
            shinySpan.textContent = '★ SHINY';
            badgeGroup.appendChild(shinySpan);
          } else if (!isNowShiny && existingShinyBadge) {
            existingShinyBadge.remove();
          }
        }
      });
    }

    // Card Add & Remove Handlers
    const btnAddYour = card.querySelector('.card-btn-group.side-your .card-add-btn');
    const btnMinusYour = card.querySelector('.card-btn-group.side-your .card-minus-btn');

    if (btnAddYour) {
      btnAddYour.addEventListener('click', () => {
        const itemObj = allItems.find((i) => i.id === item.id);
        addItemToTrade(itemObj, 'your', item.hasShiny && !!shinyState[item.id]);
      });
    }
    if (btnMinusYour) {
      btnMinusYour.addEventListener('click', () => {
        removeItemFromTrade(item.id, 'your');
      });
    }

    const btnAddTheir = card.querySelector('.card-btn-group.side-their .card-add-btn');
    const btnMinusTheir = card.querySelector('.card-btn-group.side-their .card-minus-btn');

    if (btnAddTheir) {
      btnAddTheir.addEventListener('click', () => {
        const itemObj = allItems.find((i) => i.id === item.id);
        addItemToTrade(itemObj, 'their', item.hasShiny && !!shinyState[item.id]);
      });
    }
    if (btnMinusTheir) {
      btnMinusTheir.addEventListener('click', () => {
        removeItemFromTrade(item.id, 'their');
      });
    }

    grid.appendChild(card);
  });
}

// Multi-Criteria Filtering Logic
function applyFilters() {
  const searchInput = document.getElementById('search');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

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

function setupEventListeners() {
  setupPrefixSearch('calc-search-your', 'btn-clear-calc-your', 'matches-panel-your', 'your');
  setupPrefixSearch('calc-search-their', 'btn-clear-calc-their', 'matches-panel-their', 'their');

  const btnForceSync = document.getElementById('btn-force-sync');
  if (btnForceSync) {
    btnForceSync.addEventListener('click', (e) => window.forceSyncNow(e));
  }

  const btnAddYour = document.getElementById('btn-add-your');
  if (btnAddYour) {
    btnAddYour.addEventListener('click', () => {
      const input = document.getElementById('calc-search-your');
      const query = (input ? input.value : '').toLowerCase().trim();

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
      const query = (input ? input.value : '').toLowerCase().trim();

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
    searchInput.addEventListener('input', () => {
      if (btnClearSearch) {
        btnClearSearch.style.display = searchInput.value.trim().length > 0 ? 'flex' : 'none';
      }
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

async function fetchFreshCSV() {
  const cacheBust = `&_t=${Date.now()}`;

  try {
    const res = await fetch(PRIMARY_CSV_URL + cacheBust);
    if (res.ok) return await res.text();
  } catch (err) {
    console.warn('Primary CSV fetch failed, trying GVIZ fallback...', err);
  }

  try {
    const res = await fetch(GVIZ_CSV_URL + cacheBust);
    if (res.ok) return await res.text();
  } catch (err) {
    console.warn('GVIZ fallback fetch failed, trying local file...', err);
  }

  try {
    const res = await fetch('10_Player_Flee_Items_Database_Complete.csv');
    if (res.ok) return await res.text();
  } catch (err) {
    console.error('All fetch sources failed.', err);
  }

  return null;
}

async function loadData(forceRefresh = false) {
  const statusEl = document.getElementById('status');

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
      return;
    }
  }

  if (allItems.length === 0 && statusEl) {
    statusEl.textContent = '⚠️ Could not reach Google Sheets. Please verify permissions.';
    statusEl.style.color = 'var(--accent-rose)';
  }
}

// Immediate Boot
initTabNavigation();
setupEventListeners();
loadData();
