const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSidb2RfYHa6ffWiale6czVqih6e7BrrZ-ZmRdnT10WTsS5M1ZJF9-jKSvcpyyrv5imytQ9lZsvL8su/pub?gid=0&single=true&output=csv';

let allItems = [];
let yourOffer = [];
let theirOffer = [];
let currentFilter = 'all'; // 'all' | 'hammer' | 'gem'
let currentSort = 'val-desc';
const shinyState = {};

// Multi-filter states
const activeRarities = new Set();
const activeDemands = new Set();
const activeStatuses = new Set();
const activeEvents = new Set();
let filterHasShiny = false;

// Immediate Tab Switching (Runs as soon as DOM loads, no network waiting)
function switchTab(targetTab) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === targetTab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${targetTab}`);
  });
}

function initTabNavigation() {
  const tabsContainer = document.querySelector('.nav-tabs');
  if (!tabsContainer) return;

  tabsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const targetTab = btn.getAttribute('data-tab');
    if (targetTab) switchTab(targetTab);
  });
}

// Robust CSV Parser
function parseCSV(text) {
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

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase());

  return lines.slice(1).map((line) => {
    const cols = splitLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cols[index] !== undefined ? cols[index] : '';
    });

    const rawRarity = (row.rarity || 'Rare').trim();
    const normalizedRarity = rawRarity.toLowerCase() === 'unobtainable' ? 'Untradeable' : rawRarity;

    return {
      id: row.id,
      name: (row.name || '').trim(),
      type: (row.type || '').trim(),
      category: (row.category || '').trim(),
      releaseEvent: (row.release_event || '').trim(),
      baseValue: Number(row.base_value) || 0,
      isNilValue: (row.is_nil_value || '').toUpperCase() === 'TRUE',
      demandTier: Number(row.demand_tier) || 1,
      demandLabel: (row.demand_label || '1').trim(),
      status: (row.status || 'Stable').trim(),
      setName: (row.set_name || '').trim(),
      hasShiny: (row.has_shiny || '').toUpperCase() === 'TRUE',
      shinyValue: Number(row.shiny_value) || 0,
      rarity: normalizedRarity,
    };
  });
}

// Builds the dynamic list of events/crates inside the filter drawer, excluding "Unobtainable"
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

  uniqueEvents.forEach((ev) => {
    const label = document.createElement('label');
    label.className = 'drawer-label';
    label.innerHTML = `<input type="checkbox" class="cb-event" value="${ev}"> ${ev}`;

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

function updateCalculatorTabBadge() {
  const badge = document.getElementById('trade-count-badge');
  const totalItems = yourOffer.length + theirOffer.length;
  if (badge) {
    if (totalItems > 0) {
      badge.textContent = totalItems;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
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

function populateDropdowns(items) {
  const selectYour = document.getElementById('select-your');
  const selectTheir = document.getElementById('select-their');
  if (!selectYour || !selectTheir) return;

  selectYour.innerHTML = '<option value="">Select item...</option>';
  selectTheir.innerHTML = '<option value="">Select item...</option>';

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));

  sorted.forEach((item) => {
    const valText = item.isNilValue ? 'Nil' : item.baseValue;
    const optionText = `${item.name} (${item.type}) [Val: ${valText} | Dem: ${item.demandLabel}]`;

    const optYour = document.createElement('option');
    optYour.value = item.id;
    optYour.textContent = optionText;
    selectYour.appendChild(optYour);

    const optTheir = document.createElement('option');
    optTheir.value = item.id;
    optTheir.textContent = optionText;
    selectTheir.appendChild(optTheir);
  });
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

  updateCalculatorTabBadge();

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

function renderTradeList(sideItems, listElementId) {
  const ul = document.getElementById(listElementId);
  if (!ul) return;
  ul.innerHTML = '';

  sideItems.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'trade-item';
    const valText = item.isNilValue ? 'Nil' : item.tradeValue;
    const fallbackEmoji = (item.type || '').toLowerCase() === 'gem' ? '💎' : '🔨';
    const imagePath = item.isShiny ? `images/${item.id}_shiny.png` : `images/${item.id}.png`;

    li.innerHTML = `
      <div class="trade-item-left">
        <img 
          src="${imagePath}" 
          alt="${item.name}" 
          class="trade-thumb"
          onerror="this.src='images/${item.id}.png'; this.onerror=function(){this.style.display='none'; this.nextElementSibling.style.display='flex';};"
        />
        <div class="trade-thumb-fallback" style="display: none;">${fallbackEmoji}</div>
        <div style="min-width: 0; flex: 1;">
          <div class="trade-item-title">
            ${item.name}
            ${item.isShiny ? '<span style="color: #fbbf24; font-size: 10px; margin-left: 2px;">★</span>' : ''}
          </div>
          <span style="font-size: 10px; color: var(--text-muted);">Val: <b style="color: var(--accent-gold);">${valText}</b> • Dem: ${item.demandLabel}</span>
        </div>
      </div>
      <button class="remove-btn" data-index="${index}">✕</button>
    `;

    li.querySelector('.remove-btn').addEventListener('click', () => {
      sideItems.splice(index, 1);
      renderTradeList(sideItems, listElementId);
      updateTradeVerdict();
    });

    ul.appendChild(li);
  });
}

function addItemToTrade(itemId, sideTarget, isShiny = false) {
  const item = allItems.find((i) => i.id === itemId);
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

    card.className = `card ${rarityClass} ${isShiny ? 'is-shiny' : ''}`;

    const isGem = (item.type || '').toLowerCase() === 'gem';
    const display = getItemActiveDisplay(item, isShiny);
    const fallbackEmoji = isGem ? '💎' : '🔨';
    const imagePath = isShiny ? `images/${item.id}_shiny.png` : `images/${item.id}.png`;

    const starButtonHtml = item.hasShiny
      ? `<div class="shiny-star-btn ${isShiny ? 'active' : ''}" data-id="${item.id}" title="Toggle Shiny Version">★</div>`
      : '';

    card.innerHTML = `
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
        <button class="card-add-btn side-your" data-id="${item.id}">+ Your Offer</button>
        <button class="card-add-btn side-their" data-id="${item.id}">+ Their Offer</button>
      </div>
    `;

    // Touch & Click In-place Shiny Toggle
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

    const btnYour = card.querySelector('.card-add-btn.side-your');
    if (btnYour) {
      btnYour.addEventListener('click', (e) => {
        addItemToTrade(e.currentTarget.getAttribute('data-id'), 'your', item.hasShiny && !!shinyState[item.id]);
      });
    }

    const btnTheir = card.querySelector('.card-add-btn.side-their');
    if (btnTheir) {
      btnTheir.addEventListener('click', (e) => {
        addItemToTrade(e.currentTarget.getAttribute('data-id'), 'their', item.hasShiny && !!shinyState[item.id]);
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

    // 1. Hammer / Gem pill filter
    if (currentFilter === 'hammer' && itemType !== 'hammer') return false;
    if (currentFilter === 'gem' && itemType !== 'gem') return false;

    // 2. Multi-select Rarity filter
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

    // 3. Multi-select Demand filter
    if (activeDemands.size > 0 && !activeDemands.has(itemDemand)) {
      return false;
    }

    // 4. Multi-select Status filter
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

    // 5. Has Shiny property filter
    if (filterHasShiny && !item.hasShiny) {
      return false;
    }

    // 6. Multi-select Event/Crate filter
    if (activeEvents.size > 0 && !activeEvents.has(itemEvent)) {
      return false;
    }

    // 7. Search query matching
    const matchesSearch =
      !query ||
      (item.name && item.name.toLowerCase().includes(query)) ||
      (item.setName && item.setName.toLowerCase().includes(query)) ||
      (item.releaseEvent && item.releaseEvent.toLowerCase().includes(query));

    return matchesSearch;
  });

  // Sorting
  filtered.sort((a, b) => {
    if (currentSort === 'val-desc') {
      return b.baseValue - a.baseValue;
    } else if (currentSort === 'val-asc') {
      return a.baseValue - b.baseValue;
    } else if (currentSort === 'dem-desc') {
      return b.demandTier - a.demandTier;
    } else if (currentSort === 'dem-asc') {
      return a.demandTier - b.demandTier;
    } else if (currentSort === 'name-asc') {
      return a.name.localeCompare(b.name);
    } else if (currentSort === 'name-desc') {
      return b.name.localeCompare(a.name);
    }
    return 0;
  });

  renderItems(filtered);
}

function setupEventListeners() {
  // Calculator Dropdown Add Buttons
  const btnAddYour = document.getElementById('btn-add-your');
  if (btnAddYour) {
    btnAddYour.addEventListener('click', () => {
      const selectYour = document.getElementById('select-your');
      if (selectYour && selectYour.value) addItemToTrade(selectYour.value, 'your', false);
    });
  }

  const btnAddTheir = document.getElementById('btn-add-their');
  if (btnAddTheir) {
    btnAddTheir.addEventListener('click', () => {
      const selectTheir = document.getElementById('select-their');
      if (selectTheir && selectTheir.value) addItemToTrade(selectTheir.value, 'their', false);
    });
  }

  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      yourOffer = [];
      theirOffer = [];
      renderTradeList(yourOffer, 'list-your');
      renderTradeList(theirOffer, 'list-their');
      updateTradeVerdict();
    });
  }

  // Live Search with Quick Clear Button
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

  // Rarity Checkboxes
  document.querySelectorAll('.cb-rarity').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        activeRarities.add(e.target.value);
      } else {
        activeRarities.delete(e.target.value);
      }
      updateFilterBadge();
      applyFilters();
    });
  });

  // Demand Checkboxes
  document.querySelectorAll('.cb-demand').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        activeDemands.add(e.target.value);
      } else {
        activeDemands.delete(e.target.value);
      }
      updateFilterBadge();
      applyFilters();
    });
  });

  // Status Checkboxes
  document.querySelectorAll('.cb-status').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        activeStatuses.add(e.target.value);
      } else {
        activeStatuses.delete(e.target.value);
      }
      updateFilterBadge();
      applyFilters();
    });
  });

  // Has Shiny Checkbox
  const cbShiny = document.getElementById('cb-has-shiny');
  if (cbShiny) {
    cbShiny.addEventListener('change', (e) => {
      filterHasShiny = e.target.checked;
      updateFilterBadge();
      applyFilters();
    });
  }

  // Clear / Reset All Filters
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

async function loadData() {
  const statusEl = document.getElementById('status');
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to load CSV`);

    const csvText = await response.text();
    allItems = parseCSV(csvText);

    if (statusEl) {
      statusEl.textContent = `✓ Synced ${allItems.length} items from Google Sheets`;
      statusEl.style.color = 'var(--accent-green)';
    }
    populateDropdowns(allItems);
    populateEventFilters(allItems);
    applyFilters();
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `Error: ${error.message}. Please refresh or check sheet permissions.`;
      statusEl.style.color = 'var(--accent-rose)';
    }
    console.error('Data sync failed:', error);
  }
}

// 1. Immediately mount tab navigation and UI controls
initTabNavigation();
setupEventListeners();

// 2. Fetch dataset
loadData();
