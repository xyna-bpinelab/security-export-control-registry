import { fetchDatasources, fetchEntityManifest, fetchEntities } from './api.js';

// Application State
let currentCountry = 'jp';
let allDatasources = [];
let searchQuery = '';

let currentMode = 'laws';
let entityCountry = 'us';
let entityQuery = '';
let entityManifest = null;
const entitiesCache = {}; // country -> Array of entity records
const ENTITY_RESULTS_LIMIT = 200;
const ENTITY_MIN_QUERY_LENGTH = 2;

// DOM Elements
const registryContainer = document.getElementById('registry-container');
const searchInput = document.getElementById('search-input');
const tabButtons = document.querySelectorAll('.tab-btn');

const modeButtons = document.querySelectorAll('.mode-btn');
const lawsView = document.getElementById('laws-view');
const entitiesView = document.getElementById('entities-view');
const entitySearchInput = document.getElementById('entity-search-input');
const entityTabButtons = document.querySelectorAll('#entities-view .tab-btn');
const entityMetaEl = document.getElementById('entity-meta');
const entityResultsEl = document.getElementById('entity-results');

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  loadRegistry(currentCountry);
  setupEventListeners();
});

// Load data from API
async function loadRegistry(country) {
  showLoading();
  try {
    allDatasources = await fetchDatasources(country);
    renderRegistry();
  } catch (error) {
    showError(error.message);
  }
}

function showLoading() {
  registryContainer.innerHTML = `<div class="loading-spinner">データを読み込んでいます...</div>`;
}

function showError(message) {
  registryContainer.innerHTML = `
    <div class="no-results">
      <p style="color: #ef4444; font-weight: 600;">データの読み込みに失敗しました</p>
      <p style="font-size: 0.9rem; margin-top: 0.5rem;">${message}</p>
    </div>
  `;
}

// Set up event handlers
function setupEventListeners() {
  // Tab Switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const country = e.currentTarget.getAttribute('data-country');
      if (country === currentCountry) return;
      
      tabButtons.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      
      currentCountry = country;
      loadRegistry(currentCountry);
    });
  });

  // Search Input Handler
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderRegistry();
  });

  // Mode Switching (Laws <-> Entities)
  modeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const mode = e.currentTarget.getAttribute('data-mode');
      if (mode === currentMode) return;

      modeButtons.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');

      currentMode = mode;
      lawsView.classList.toggle('hidden', mode !== 'laws');
      entitiesView.classList.toggle('hidden', mode !== 'entities');

      if (mode === 'entities') {
        initEntityView();
      }
    });
  });

  // Entity Country Tabs
  entityTabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (btn.disabled) return;
      const country = e.currentTarget.getAttribute('data-country');
      if (country === entityCountry) return;

      entityTabButtons.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');

      entityCountry = country;
      loadEntities(entityCountry);
    });
  });

  // Entity Search Input (debounced; the underlying dataset can be tens of
  // thousands of records, so we avoid re-filtering on every keystroke)
  let entitySearchDebounce;
  entitySearchInput.addEventListener('input', (e) => {
    clearTimeout(entitySearchDebounce);
    entitySearchDebounce = setTimeout(() => {
      entityQuery = e.target.value.toLowerCase().trim();
      renderEntityResults();
    }, 200);
  });
}

// Lazily loads the entity manifest + the currently selected country's
// entity dataset the first time the Entities view is opened.
let entityInitStarted = false;
async function initEntityView() {
  if (entityInitStarted) return;
  entityInitStarted = true;

  try {
    entityManifest = await fetchEntityManifest();
  } catch (error) {
    console.error('[ENTITY API ERROR] Failed to fetch manifest:', error);
  }
  renderEntityMeta();
  loadEntities(entityCountry);
}

async function loadEntities(country) {
  if (entitiesCache[country]) {
    renderEntityResults();
    return;
  }

  entityResultsEl.innerHTML = `<div class="loading-spinner">${country.toUpperCase()}のデータを読み込んでいます（初回は数秒〜十数秒かかる場合があります）...</div>`;
  try {
    entitiesCache[country] = await fetchEntities(country);
  } catch (error) {
    entityResultsEl.innerHTML = `
      <div class="no-results">
        <p style="color: #ef4444; font-weight: 600;">データの読み込みに失敗しました</p>
        <p style="font-size: 0.9rem; margin-top: 0.5rem;">${error.message}</p>
      </div>
    `;
    return;
  }
  renderEntityMeta();
  renderEntityResults();
}

function renderEntityMeta() {
  if (!entityManifest) {
    entityMetaEl.textContent = '';
    return;
  }
  const listInfo = entityManifest.lists?.find(l => l.country === entityCountry);
  if (!listInfo) {
    entityMetaEl.textContent = '';
    return;
  }
  entityMetaEl.innerHTML = `
    収録件数: <strong>${listInfo.record_count.toLocaleString()}件</strong>
    ｜ 最終更新: ${listInfo.last_updated}
    ｜ 更新頻度: ${listInfo.update_frequency}
    ｜ <a href="${listInfo.source_url}" target="_blank" rel="noopener">出典: ${listInfo.name_en}</a>
  `;
}

function renderEntityResults() {
  const entities = entitiesCache[entityCountry];
  if (!entities) return;

  if (entityQuery.length < ENTITY_MIN_QUERY_LENGTH) {
    entityResultsEl.innerHTML = `<div class="loading-spinner">検索語を入力してください（${ENTITY_MIN_QUERY_LENGTH}文字以上）</div>`;
    return;
  }

  const matches = entities.filter(ent => {
    const nameMatch = ent.entity_name?.toLowerCase().includes(entityQuery);
    const aliasMatch = ent.aliases?.some(a => a.toLowerCase().includes(entityQuery));
    const listMatch = ent.source_list_name?.toLowerCase().includes(entityQuery);
    const reasonMatch = ent.reason?.toLowerCase().includes(entityQuery);
    return nameMatch || aliasMatch || listMatch || reasonMatch;
  });

  if (matches.length === 0) {
    entityResultsEl.innerHTML = `<div class="no-results">検索条件に一致するエンティティが見つかりませんでした。</div>`;
    return;
  }

  const shown = matches.slice(0, ENTITY_RESULTS_LIMIT);
  entityResultsEl.innerHTML = `
    <p class="entity-result-count">${matches.length.toLocaleString()}件中 ${shown.length.toLocaleString()}件を表示</p>
    <div class="registry-grid">
      ${shown.map(createEntityCardHtml).join('')}
    </div>
  `;
}

function createEntityCardHtml(ent) {
  const aliasesHtml = ent.aliases && ent.aliases.length > 0
    ? `<p class="entity-aliases">別名: ${ent.aliases.join(' / ')}</p>`
    : '';
  const addressesHtml = ent.addresses && ent.addresses.length > 0
    ? `<p class="entity-address">${ent.addresses.join('<br>')}</p>`
    : '';

  return `
    <article class="registry-card">
      <div class="card-header">
        <div class="card-badges">
          <span class="badge" style="background-color: var(--color-list); color: #fff;">${ent.entity_type}</span>
          <span class="badge badge-frequency">${ent.source_list_name || ''}</span>
          <span class="badge badge-checked">最終確認: ${ent.last_verified}</span>
        </div>
        <div class="card-title-group">
          <h2>${ent.entity_name}</h2>
        </div>
        ${aliasesHtml}
      </div>
      <p class="card-desc">${ent.reason || ''}</p>
      ${addressesHtml}
      <div class="card-actions">
        <a href="${ent.source_url}" target="_blank" rel="noopener" class="btn-primary">
          <span>原典を確認</span>
          <span>↗</span>
        </a>
      </div>
    </article>
  `;
}

// Render Registry Cards to DOM
function renderRegistry() {
  const filtered = allDatasources.filter(ds => {
    if (!searchQuery) return true;
    
    // Check main text fields
    const nameMatch = ds.name?.toLowerCase().includes(searchQuery);
    const nameEnMatch = ds.name_en?.toLowerCase().includes(searchQuery);
    const descMatch = ds.description?.toLowerCase().includes(searchQuery);
    const authMatch = ds.authority?.toLowerCase().includes(searchQuery);
    const catMatch = ds.category?.toLowerCase().includes(searchQuery);
    
    if (nameMatch || nameEnMatch || descMatch || authMatch || catMatch) return true;
    
    // Check summary tree items
    if (ds.summary_tree) {
      return ds.summary_tree.some(item => {
        return item.section?.toLowerCase().includes(searchQuery) ||
               (item.title && item.title.toLowerCase().includes(searchQuery)) ||
               item.summary?.toLowerCase().includes(searchQuery);
      });
    }
    
    return false;
  });

  if (filtered.length === 0) {
    registryContainer.innerHTML = `<div class="no-results">検索条件に一致するデータソースが見つかりませんでした。</div>`;
    return;
  }

  registryContainer.innerHTML = '';
  filtered.forEach(ds => {
    const card = createCardElement(ds);
    registryContainer.appendChild(card);
  });

  // Setup accordion clicks
  setupAccordions();
}

// Create a DOM Card Element for a datasource
function createCardElement(ds) {
  const card = document.createElement('article');
  card.className = 'registry-card';

  // Badges
  const badgesHtml = `
    <div class="card-badges">
      <span class="badge" style="background-color: var(--color-${ds.category || 'other'}); color: #fff;">
        ${getCategoryLabel(ds.category)}
      </span>
      <span class="badge badge-frequency">更新: ${ds.frequency}</span>
      <span class="badge badge-checked">最終確認: ${ds.last_checked}</span>
    </div>
  `;

  // Title Area
  const titleHtml = `
    <div class="card-title-group">
      <h2>${ds.name}</h2>
      ${ds.name_en ? `<div class="card-title-en">${ds.name_en}</div>` : ''}
    </div>
    <div class="card-authority">
      <span>🏛️</span>
      <span>${ds.authority} ${ds.authority_en ? `(${ds.authority_en})` : ''}</span>
    </div>
  `;

  // Summary Tree Accordion HTML
  let summaryTreeHtml = '';
  if (ds.summary_tree && ds.summary_tree.length > 0) {
    const itemsHtml = ds.summary_tree.map(item => {
      const matchSearch = searchQuery && (
        item.section?.toLowerCase().includes(searchQuery) ||
        (item.title && item.title.toLowerCase().includes(searchQuery)) ||
        item.summary?.toLowerCase().includes(searchQuery)
      );

      const highlightClass = matchSearch ? 'open' : '';

      return `
        <div class="accordion-item ${highlightClass}">
          <button class="accordion-header">
            <span class="accordion-title-span">
              <span class="accordion-section-code">${item.section}</span>
              <strong>${item.title || ''}</strong>
            </span>
            <span class="accordion-arrow">▶</span>
          </button>
          <div class="accordion-content" style="${highlightClass ? 'max-height: 500px; padding-bottom: 0.8rem;' : ''}">
            <p>${item.summary}</p>
            ${item.url ? `
              <a href="${item.url}" target="_blank" rel="noopener" class="accordion-link">
                原典を確認 ↗
              </a>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    summaryTreeHtml = `
      <div class="card-summary-section">
        <h3 class="section-label">規制コンテンツ要約 (Summary)</h3>
        <div class="accordion-container">
          ${itemsHtml}
        </div>
      </div>
    `;
  }

  // Card Content Assembly
  card.innerHTML = `
    <div class="card-header">
      ${badgesHtml}
      ${titleHtml}
    </div>
    <p class="card-desc">${ds.description || ''}</p>
    ${summaryTreeHtml}
    <div class="card-actions">
      <a href="${ds.url}" target="_blank" rel="noopener" class="btn-primary">
        <span>原典トップへ</span>
        <span>↗</span>
      </a>
    </div>
  `;

  return card;
}

// Simple label helper
function getCategoryLabel(cat) {
  const labels = {
    law: '法律 (Law)',
    cabinet_order: '政令 (Cabinet Order)',
    ministerial_order: '省令 (Ministerial Order)',
    circular: '通達 (Circular)',
    sanction_list: '規制リスト (Sanction List)',
    other: 'その他 (Other)'
  };
  return labels[cat] || cat;
}

// Add event handlers to accordion items
function setupAccordions() {
  const headers = registryContainer.querySelectorAll('.accordion-header');
  headers.forEach(header => {
    header.addEventListener('click', (e) => {
      const item = e.currentTarget.closest('.accordion-item');
      const content = item.querySelector('.accordion-content');
      
      const isOpen = item.classList.contains('open');
      
      if (isOpen) {
        item.classList.remove('open');
        content.style.maxHeight = null;
        content.style.paddingBottom = null;
      } else {
        item.classList.add('open');
        content.style.maxHeight = content.scrollHeight + 'px';
        content.style.paddingBottom = '0.8rem';
      }
    });
  });
}
