const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSidb2RfYHa6ffWiale6czVqih6e7BrrZ-ZmRdnT10WTsS5M1ZJF9-jKSvcpyyrv5imytQ9lZsvL8su/pub?gid=0&single=true&output=csv';

let allItems = [];

// Helper to cleanly parse CSV lines with commas inside quotes
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
        <span class="value">${displayValue}</span>
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

async function loadData() {
  const statusEl = document.getElementById('status');
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error('Could not download spreadsheet data');

    const csvText = await response.text();
    allItems = parseCSV(csvText);

    statusEl.textContent = `Loaded ${allItems.length} items successfully.`;
    renderItems(allItems);
  } catch (error) {
    statusEl.textContent = 'Failed to load items. Check internet connection or sheet permissions.';
    console.error(error);
  }
}

// Search bar filter
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
