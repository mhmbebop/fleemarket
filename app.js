const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSidb2RfYHa6ffWiale6czVqih6e7BrrZ-ZmRdnT10WTsS5M1ZJF9-jKSvcpyyrv5imytQ9lZsvL8su/pub?gid=0&single=true&output=csv';

let allItems = [];
let sideA = [];
let sideB = [];
let currentFilter = 'all'; // 'all' | 'hammer' | 'gem'
let currentSort = 'val-desc';
// Track shiny toggle per item ID
const shinyState = {};

// CSV Parser
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
      name: row.name,
      type: row.type,
      category: row.category,
      releaseEvent: row.release_event,
      baseValue: Number(row.base_value) || 0,
      isNilValue: row.is_nil_value?.toUpperCase() === 'TRUE',
      demandTier: Number(row.demand_tier) || 1,
      demandLabel: row.demand_label,
      status: row.status,
      setName: row.set_name,
    };
  });
}

// Determines the shiny multiplier (4x for Commons/Rares; 10x for Epics/Legendaries/Event bundles)
function getShinyMultiplier(item) {
  const name = (item.name || '').toLowerCase();
  const cat = (item.category || '').toLowerCase();
  if (name.includes('rare') || name.includes('common')) {
    return 4;
  }
  return 10;
}

// Calculates active display value taking into account shiny toggle
function getItemActiveValue(item, isShiny = false) {
  if (item.isNilValue) return 0;
  return isShiny ? item.baseValue * getShinyMultiplier(item) : item.baseValue;
}

// Populate dropdown selectors for trade calculator
function populateDropdowns(items) {
  const selectA = document.getElementById('select-a');
  const selectB = document.getElementById('select-b');
  if (!selectA || !selectB) return;

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

// Calculate total value and average demand tier
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

// Trade comparison verdict logic
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
    verdictEl.textContent = '⚠️ Contains Indefinite / Nil Item(s)';
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

// Render selected items list with icon previews
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
          <div>
            <strong>${item.name}</strong>
            ${item.isShiny ? '<span style="color: #ffd700; font-size: 11px; margin-left: 4px;">★ SHINY</span>' : ''}
          </div>
          <span style="font-size: 12px; color: #8b949e;">Val: <b style="color: #f2cc60;">${valText}</b> | Dem: ${item.demandLabel}</span>
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

// Helper to push items into trade sides
function addItemToTrade(itemId, sideTarget, isShiny = false) {
  const item = allItems.find((i) => i.id === itemId);
  if (!item) return;

  const tradeItem = {
    ...item,
    isShiny: isShiny,
    tradeValue: getItemActiveValue(item, isShiny),
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

// Render catalog cards with yellow star shiny toggle
function renderItems(items) {
  const grid = document.getElementById('items-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (items.length === 0) {
    grid.innerHTML = '<p>No items found.</p>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('div');
    const isShiny = !!shinyState[item.id];
    card.className = `card ${isShiny ? 'is-shiny' : ''}`;

    const isGem = (item.type || '').toLowerCase() === 'gem';
    const activeValue = getItemActiveValue(item, isShiny);
    const displayValue = item.isNilValue ? 'Indefinite' : activeValue;
    const fallbackEmoji = isGem ? '💎' : '🔨';
    const imagePath = isShiny ? `images/${item.id}_shiny.png` : `images/${item.id}.png`;

    card.innerHTML = `
      <div 
        class="shiny-star-btn ${isShiny ? 'active' : ''}" 
        data-id="${item.id}"
        title="Toggle Shiny Version"
      >★</div>

      <div class="card-image-wrap">
        <img 
          src="${imagePath}" 
          alt="${item.name}" 
          class="card-img"
          onerror="this.src='images/${item.id}.png'; this.onerror=function(){this.style.display='none'; this.nextElementSibling.style.display='flex';};"
        />
        <div class="card-img-fallback" style="display: none;">${fallbackEmoji}</div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span class="badge ${isGem ? 'badge-gem' : ''}">${item.type}</span>
          ${isShiny ? '<span class="badge badge-shiny">SHINY</span>' : ''}
        </div>
        <span style="font-size: 12px; color: #8b949e;">${item.setName || item.releaseEvent}</span>
      </div>
      <h3 class="card-title">${item.name}</h3>
      <div class="row">
        <span>Value:</span>
        <span class="val">${displayValue}</span>
      </div>
      <div class="row">
        <span>Demand:</span>
        <span class="demand">${item.demandLabel}</span>
      </div>
      <div class="row">
        <span>Status:</span>
        <span>${item.status}</span>
      </div>
      <div class="card-actions">
        <button class="card-add-btn side-a" data-id="${item.id}">+ Side A</button>
        <button class="card-add-btn side-b" data-id="${item.id}">+ Side B</button>
      </div>
    `;

    // Star Click: Toggle regular <-> shiny
    card.querySelector('.shiny-star-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      shinyState[item.id] = !shinyState[item.id];
      applyFilters(); // Re-renders the card instantly with updated values and glowing star
    });

    // Quick Add Buttons (pass the current shiny state into the trade)
    card.querySelector('.card-add-btn.side-a').addEventListener('click', (e) => {
      addItemToTrade(e.currentTarget.getAttribute('data-id'), 'A', !!shinyState[item.id]);
    });
    card.querySelector('.card-add-btn.side-b').addEventListener('click', (e) => {
      addItemToTrade(e.currentTarget.getAttribute('data-id'), 'B', !!shinyState[item.id]);
    });

    grid.appendChild(card);
  });
}

// Filter and Sort items safely
function applyFilters() {
  const searchInput = document.getElementById('search');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

  // 1. Filter by Type and Search Query
  let filtered = allItems.filter((item) => {
    const itemType = (item.type || '').toLowerCase().trim();
    const matchesType = (currentFilter === 'all') || (itemType === currentFilter);

    const matchesSearch =
      !query ||
      (item.name && item.name.toLowerCase().includes(query)) ||
      (item.setName && item.setName.toLowerCase().includes(query)) ||
      (item.releaseEvent && item.releaseEvent.toLowerCase().includes(query));

    return matchesType && matchesSearch;
  });

  // 2. Sort items (taking into account their active shiny values if toggled)
  filtered.sort((a, b) => {
    const valA = getItemActiveValue(a, !!shinyState[a.id]);
    const valB = getItemActiveValue(b, !!shinyState[b.id]);

    if (currentSort === 'val-desc') {
      return valB - valA;
    } else if (currentSort === 'val-asc') {
      return valA - valB;
    } else if (currentSort === 'dem-desc') {
      return b.demandTier - a.demandTier;
    } else if (currentSort === 'name-asc') {
      return a.name.localeCompare(b.name);
    }
    return 0;
  });

  renderItems(filtered);
}

// Setup Event Listeners safely
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
  if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
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
}

// Fetch spreadsheet data
async function loadData() {
  const statusEl = document.getElementById('status');
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Could not load CSV`);

    const csvText = await response.text();
    allItems = parseCSV(csvText);

    if (statusEl) {
      statusEl.textContent = `Loaded ${allItems.length} items successfully.`;
    }
    populateDropdowns(allItems);
    setupEventListeners();
    applyFilters();
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `Error: ${error.message}. Please refresh or check sheet permissions.`;
    }
    console.error(error);
  }
}

// Start loading
loadData();
