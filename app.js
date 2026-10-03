const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSidb2RfYHa6ffWiale6czVqih6e7BrrZ-ZmRdnT10WTsS5M1ZJF9-jKSvcpyyrv5imytQ9lZsvL8su/pub?gid=0&single=true&output=csv';

let allItems = [];
let sideA = [];
let sideB = [];
let currentFilter = 'all'; // 'all' | 'hammer' | 'gem' | 'shiny'
let currentSort = 'val-desc';
const shinyState = {};

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
    };
  });
}

// Determines accurate game rarity
function getItemRarity(item) {
  const name = (item.name || '').toLowerCase();
  const cat = (item.category || '').toLowerCase();

  if (
    name.includes('eternaswan') ||
    name.includes('pan') ||
    name.includes('sapphira') ||
    name.includes('mythical') ||
    cat.includes('mythical')
  ) {
    return 'Mythical';
  }

  if (name.includes('common')) return 'Common';
  if (name.includes('rare')) return 'Rare';

  if (item.baseValue >= 70 || item.isNilValue || cat.includes('special') || cat.includes('bundle')) {
    return 'Legendary';
  }

  if (item.baseValue >= 20) {
    return 'Epic';
  }

  return 'Rare';
}

// Multiplier calculation for shinies
function getShinyMultiplier(item) {
  const name = (item.name || '').toLowerCase();
  if (name.includes('rare') || name.includes('common')) return 4;
  return 10;
}

// Checks if weapon has an official in-game shiny variant
function itemHasShinyVariant(item) {
  const cat = (item.category || '').toLowerCase();
  const name = (item.name || '').toLowerCase();

  if (cat.includes('tournament') || name.includes('tournament')) {
    return false;
  }

  if (cat.includes('crate')) {
    return true;
  }

  if (cat.includes('event shop') || cat.includes('bundle')) {
    if (cat.includes('permanent') && !name.includes('pan') && !name.includes('midaflame') && !name.includes('cash')) {
      return false;
    }
    return true;
  }

  return false;
}

// Deduplicates and builds shiny records cleanly
function processAndDeduplicateItems(rawItems) {
  const baseMap = new Map();
  const explicitShinies = [];

  rawItems.forEach((item) => {
    if (item.name.toLowerCase().startsWith('shiny ')) {
      explicitShinies.push(item);
    } else {
      const key = `${item.name.toLowerCase()}_${item.type.toLowerCase()}`;
      item.hasShiny = false;
      item.shinyData = null;
      baseMap.set(key, item);
    }
  });

  explicitShinies.forEach((shinyItem) => {
    const baseName = shinyItem.name.replace(/^shiny\s+/i, '').trim().toLowerCase();
    const key = `${baseName}_${shinyItem.type.toLowerCase()}`;

    if (baseMap.has(key)) {
      const baseItem = baseMap.get(key);
      baseItem.hasShiny = true;
      baseItem.shinyData = {
        value: shinyItem.baseValue,
        isNilValue: shinyItem.isNilValue,
        demandTier: shinyItem.demandTier,
        demandLabel: shinyItem.demandLabel,
        status: shinyItem.status,
      };
    }
  });

  baseMap.forEach((item) => {
    if (!item.hasShiny && itemHasShinyVariant(item)) {
      const mult = getShinyMultiplier(item);
      item.hasShiny = true;
      item.shinyData = {
        value: item.isNilValue ? 0 : item.baseValue * mult,
        isNilValue: item.isNilValue,
        demandTier: item.demandTier,
        demandLabel: item.demandLabel,
        status: item.status,
      };
    }
  });

  return Array.from(baseMap.values());
}

function getItemActiveDisplay(item, isShiny = false) {
  if (isShiny && item.hasShiny && item.shinyData) {
    return {
      value: item.shinyData.isNilValue ? 'Indefinite' : item.shinyData.value,
      numValue: item.shinyData.isNilValue ? 0 : item.shinyData.value,
      isNil: item.shinyData.isNilValue,
      demandLabel: item.shinyData.demandLabel,
      demandTier: item.shinyData.demandTier,
      status: item.shinyData.status,
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
  const selectA = document.getElementById('select-a');
  const selectB = document.getElementById('select-b');
  if (!selectA || !selectB) return;

  selectA.innerHTML = '<option value="">Select item...</option>';
  selectB.innerHTML = '<option value="">Select item...</option>';

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));

  sorted.forEach((item) => {
    const valText = item.isNilValue ? 'Nil' : item.baseValue;
    const optionText = `${item.name} (${item.type}) [Val: ${valText} | Dem: ${item.demandLabel}]`;

    const optA = document.createElement('option');
    optA.value = item.id;
    optA.textContent = optionText;
    selectA.appendChild(optA);

    const optB = document.createElement('option');
    optB.value = item.id;
    optB.textContent = optionText;
    selectB.appendChild(optB);
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
  const dataA = calculateSide(sideA);
  const dataB = calculateSide(sideB);

  const valA = document.getElementById('total-val-a');
  const demA = document.getElementById('avg-dem-a');
  const valB = document.getElementById('total-val-b');
  const demB = document.getElementById('avg-dem-b');
  const verdictEl = document.getElementById('verdict-text');
  const detailsEl = document.getElementById('verdict-details');

  if (valA) valA.textContent = dataA.hasNil ? `${dataA.totalValue} + Nil` : dataA.totalValue;
  if (demA) demA.textContent = dataA.avgDemand;
  if (valB) valB.textContent = dataB.hasNil ? `${dataB.totalValue} + Nil` : dataB.totalValue;
  if (demB) demB.textContent = dataB.avgDemand;

  if (!verdictEl || !detailsEl) return;
  verdictEl.className = 'verdict-text';

  if (sideA.length === 0 && sideB.length === 0) {
    verdictEl.textContent = 'Add items to both sides';
    detailsEl.textContent = 'Difference: 0 Value';
    return;
  }

  if (dataA.hasNil || dataB.hasNil) {
    verdictEl.textContent = '⚠ Contains Indefinite / Nil Item(s)';
    detailsEl.textContent = 'Nil or priceless items cannot be purely compared with numbers.';
    verdictEl.classList.add('status-fair');
    return;
  }

  const diff = dataB.totalValue - dataA.totalValue;
  const maxVal = Math.max(dataA.totalValue, dataB.totalValue, 1);
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
  detailsEl.textContent = `Side B has ${sign}${diff} value (${diff >= 0 ? 'Profit' : 'Loss'} for You)`;
}

function renderTradeList(side, listElementId) {
  const ul = document.getElementById(listElementId);
  if (!ul) return;
  ul.innerHTML = '';

  side.forEach((item, index) => {
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
        <div>
          <div style="font-weight: 700; font-size: 13px;">
            ${item.name}
            ${item.isShiny ? '<span style="color: #fbbf24; font-size: 11px; margin-left: 4px;">★ SHINY</span>' : ''}
          </div>
          <span style="font-size: 11px; color: var(--text-muted);">Val: <b style="color: var(--accent-gold);">${valText}</b> • Dem: ${item.demandLabel}</span>
        </div>
      </div>
      <button class="remove-btn" data-index="${index}">✕</button>
    `;

    li.querySelector('.remove-btn').addEventListener('click', () => {
      side.splice(index, 1);
      renderTradeList(side, listElementId);
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

  if (sideTarget === 'A') {
    sideA.push(tradeItem);
    renderTradeList(sideA, 'list-a');
  } else if (sideTarget === 'B') {
    sideB.push(tradeItem);
    renderTradeList(sideB, 'list-b');
  }
  updateTradeVerdict();
}

function renderItems(items) {
  const grid = document.getElementById('items-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (items.length === 0) {
    grid.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1;">No matching items found.</p>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('div');
    const isShiny = item.hasShiny && !!shinyState[item.id];
    const rarity = getItemRarity(item);
    const rarityClass = `rarity-${rarity.toLowerCase()}`;

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
          onerror="this.src='images/${item.id}.png'; this.onerror=function(){this.style.display='none'; this.nextElementSibling.style.display='flex';};"
        />
        <div class="card-img-fallback" style="display: none;">${fallbackEmoji}</div>
      </div>
      <div class="card-top-info">
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
          <span class="badge ${isGem ? 'badge-gem' : ''}">${item.type}</span>
          <span class="badge-rarity badge-${rarityClass}">${rarity}</span>
          ${isShiny ? '<span class="badge badge-shiny">★ SHINY</span>' : ''}
        </div>
        <span class="set-tag" title="${item.setName || item.releaseEvent}">${item.setName || item.releaseEvent}</span>
      </div>
      <h3 class="card-title">${item.name}</h3>
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
          <span class="status-tag">${display.status}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="card-add-btn side-a" data-id="${item.id}">+ Side A</button>
        <button class="card-add-btn side-b" data-id="${item.id}">+ Side B</button>
      </div>
    `;

    // In-place Shiny Toggle
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
        if (statEl) statEl.textContent = updatedDisplay.status;

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

    const btnA = card.querySelector('.card-add-btn.side-a');
    if (btnA) {
      btnA.addEventListener('click', (e) => {
        addItemToTrade(e.currentTarget.getAttribute('data-id'), 'A', item.hasShiny && !!shinyState[item.id]);
      });
    }

    const btnB = card.querySelector('.card-add-btn.side-b');
    if (btnB) {
      btnB.addEventListener('click', (e) => {
        addItemToTrade(e.currentTarget.getAttribute('data-id'), 'B', item.hasShiny && !!shinyState[item.id]);
      });
    }

    grid.appendChild(card);
  });
}

function applyFilters() {
  const searchInput = document.getElementById('search');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

  let filtered = allItems.filter((item) => {
    const itemType = (item.type || '').toLowerCase().trim();

    let matchesFilter = true;
    if (currentFilter === 'hammer') {
      matchesFilter = itemType === 'hammer';
    } else if (currentFilter === 'gem') {
      matchesFilter = itemType === 'gem';
    } else if (currentFilter === 'shiny') {
      matchesFilter = item.hasShiny === true;
    }

    const matchesSearch =
      !query ||
      (item.name && item.name.toLowerCase().includes(query)) ||
      (item.setName && item.setName.toLowerCase().includes(query)) ||
      (item.releaseEvent && item.releaseEvent.toLowerCase().includes(query));

    return matchesFilter && matchesSearch;
  });

  filtered.sort((a, b) => {
    if (currentSort === 'val-desc') {
      return b.baseValue - a.baseValue;
    } else if (currentSort === 'val-asc') {
      return a.baseValue - b.baseValue;
    } else if (currentSort === 'dem-desc') {
      return b.demandTier - a.demandTier;
    } else if (currentSort === 'name-asc') {
      return a.name.localeCompare(b.name);
    }
    return 0;
  });

  renderItems(filtered);
}

function setupEventListeners() {
  const btnAddA = document.getElementById('btn-add-a');
  if (btnAddA) {
    btnAddA.addEventListener('click', () => {
      const selectA = document.getElementById('select-a');
      if (selectA && selectA.value) addItemToTrade(selectA.value, 'A', false);
    });
  }

  const btnAddB = document.getElementById('btn-add-b');
  if (btnAddB) {
    btnAddB.addEventListener('click', () => {
      const selectB = document.getElementById('select-b');
      if (selectB && selectB.value) addItemToTrade(selectB.value, 'B', false);
    });
  }

  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      sideA = [];
      sideB = [];
      renderTradeList(sideA, 'list-a');
      renderTradeList(sideB, 'list-b');
      updateTradeVerdict();
    });
  }

  const searchInput = document.getElementById('search');
  if (searchInput) searchInput.addEventListener('input', applyFilters);

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
}

async function loadData() {
  const statusEl = document.getElementById('status');
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to load CSV`);

    const csvText = await response.text();
    const rawItems = parseCSV(csvText);

    allItems = processAndDeduplicateItems(rawItems);

    if (statusEl) {
      statusEl.textContent = `✓ Synced ${allItems.length} items from Google Sheets`;
      statusEl.style.color = 'var(--accent-green)';
    }
    populateDropdowns(allItems);
    setupEventListeners();
    applyFilters();
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `Error: ${error.message}. Please refresh or check sheet permissions.`;
      statusEl.style.color = 'var(--accent-rose)';
    }
    console.error('Data sync failed:', error);
  }
}

loadData();
