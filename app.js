const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSidb2RfYHa6ffWiale6czVqih6e7BrrZ-ZmRdnT10WTsS5M1ZJF9-jKSvcpyyrv5imytQ9lZsvL8su/pub?gid=0&single=true&output=csv';

let allItems = [];
let sideA = [];
let sideB = [];

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

// Populate dropdown selectors for trade calculator
function populateDropdowns(items) {
  const selectA = document.getElementById('select-a');
  const selectB = document.getElementById('select-b');

  // Sort alphabetically by name
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
      totalValue += item.baseValue;
    }
    totalDemandTier += item.demandTier;
  });

  const avgDemand = items.length > 0 ? (totalDemandTier / items.length).toFixed(1) : '-';
  return { totalValue, hasNil, avgDemand };
}

// Trade comparison logic
function updateTradeVerdict() {
  const dataA = calculateSide(sideA);
  const dataB = calculateSide(sideB);

  document.getElementById('total-val-a').textContent = dataA.hasNil
    ? `${dataA.totalValue} + Nil`
    : dataA.totalValue;
  document.getElementById('avg-dem-a').textContent = dataA.avgDemand;

  document.getElementById('total-val-b').textContent = dataB.hasNil
    ? `${dataB.totalValue} + Nil`
    : dataB.totalValue;
  document.getElementById('avg-dem-b').textContent = dataB.avgDemand;

  const verdictEl = document.getElementById('verdict-text');
  const detailsEl = document.getElementById('verdict-details');

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

  // Value difference from perspective of Side A (giving A, getting B)
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

// Render selected items list
function renderTradeList(side, listElementId) {
  const ul = document.getElementById(listElementId);
  ul.innerHTML = '';

  side.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'trade-item';
    const valText = item.isNilValue ? 'Nil' : item.baseValue;
    li.innerHTML = `
      <span>${item.name} (${item.type}) - Val: <b>${valText}</b></span>
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

// Catalog Grid Render
function renderItems(items) {
  const grid = document.getElementById('items-grid');
  grid.innerHTML = '';

  if (items.length === 0) {
    grid.innerHTML = '<p>No items found.</p>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'card';

    const isGem = item.type.toLowerCase() === 'gem';
    const displayValue = item.isNilValue ? 'Indefinite' : item.baseValue;

    card.innerHTML = `
      <span class="badge ${isGem ? 'badge-gem' : ''}">${item.type}</span>
      <h3 class="card-title">${item.name}</h3>
      <div class="row">
        <span>Set / Event:</span>
        <span>${item.releaseEvent || item.setName}</span>
      </div>
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
    `;
    grid.appendChild(card);
  });
}

// Initialize and Fetch
async function loadData() {
  const statusEl = document.getElementById('status');
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error('Could not download spreadsheet data');

    const csvText = await response.text();
    allItems = parseCSV(csvText);

    statusEl.textContent = `Loaded ${allItems.length} items successfully.`;
    populateDropdowns(allItems);
    renderItems(allItems);
  } catch (error) {
    statusEl.textContent = 'Failed to load items. Check internet connection or sheet permissions.';
    console.error(error);
  }
}

// Event Listeners for Adding Items
document.getElementById('btn-add-a').addEventListener('click', () => {
  const id = document.getElementById('select-a').value;
  if (!id) return;
  const item = allItems.find((i) => i.id === id);
  if (item) {
    sideA.push(item);
    renderTradeList(sideA, 'list-a');
    updateTradeVerdict();
  }
});

document.getElementById('btn-add-b').addEventListener('click', () => {
  const id = document.getElementById('select-b').value;
  if (!id) return;
  const item = allItems.find((i) => i.id === id);
  if (item) {
    sideB.push(item);
    renderTradeList(sideB, 'list-b');
    updateTradeVerdict();
  }
});

document.getElementById('btn-reset').addEventListener('click', () => {
  sideA = [];
  sideB = [];
  renderTradeList(sideA, 'list-a');
  renderTradeList(sideB, 'list-b');
  updateTradeVerdict();
});

// Search filter
document.getElementById('search').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const filtered = allItems.filter(
    (item) =>
      item.name.toLowerCase().includes(query) ||
      item.setName.toLowerCase().includes(query) ||
      item.releaseEvent.toLowerCase().includes(query)
  );
  renderItems(filtered);
});

loadData();
