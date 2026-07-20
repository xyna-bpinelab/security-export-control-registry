import { fetchDatasources, fetchEntityManifest, fetchEntities, fetchEntityCountHistory } from './api.js';
import { renderTrendChart } from './trendChart.js';

// Application State
let currentCountry = 'jp';
let allDatasources = [];

let currentMode = 'laws';
let entitySelectedCountries = new Set(['us', 'jp', 'cn']);
let entityQuery = '';
let entityViewMode = 'list'; // 'card' | 'list'
let entitySummaryExpanded = true; // global toggle for all countries' meta + trend chart panels
let entityManifest = null;
let entityCountHistory = null; // list_id -> Array of {date, record_count}
const entitiesCache = {}; // country -> Array of entity records
let entityById = new Map(); // id -> entity, rebuilt on every render (list-view row -> modal lookup)
const ENTITY_RESULTS_LIMIT = 200;
const ENTITY_MIN_QUERY_LENGTH = 2;
const ENTITY_COUNTRIES = ['us', 'jp', 'cn'];
const COUNTRY_LABELS = {
  us: '🇺🇸 米国',
  jp: '🇯🇵 日本',
  cn: '🇨🇳 中国',
};

// DOM Elements
const registryContainer = document.getElementById('registry-container');
const tabButtons = document.querySelectorAll('.tab-btn');

const modeButtons = document.querySelectorAll('.mode-btn');
const lawsView = document.getElementById('laws-view');
const entitiesView = document.getElementById('entities-view');
const entitySearchInput = document.getElementById('entity-search-input');
const entityCountryCheckboxes = document.querySelectorAll('.entity-country-checkbox');
const entityCountryAllCheckbox = document.getElementById('entity-country-all');
const entityViewToggleButtons = document.querySelectorAll('#entity-view-toggle .view-toggle-btn');
const entitySummaryToggleBtn = document.getElementById('entity-summary-toggle');
const entitySummaryPanelsEl = document.getElementById('entity-summary-panels');
const entityResultsEl = document.getElementById('entity-results');
const entityModalOverlay = document.getElementById('entity-modal-overlay');
const entityModalContent = document.getElementById('entity-modal-content');
const entityModalCloseBtn = document.getElementById('entity-modal-close');

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

  // Entity Country Checkboxes (multi-select: search spans every checked country)
  entityCountryCheckboxes.forEach(cb => {
    cb.addEventListener('change', (e) => {
      const country = e.target.getAttribute('data-country');
      if (e.target.checked) {
        entitySelectedCountries.add(country);
      } else {
        entitySelectedCountries.delete(country);
      }
      syncEntityCountryAllCheckbox();
      onEntitySelectedCountriesChanged();
    });
  });

  entityCountryAllCheckbox.addEventListener('change', (e) => {
    const checked = e.target.checked;
    entityCountryCheckboxes.forEach(cb => {
      cb.checked = checked;
    });
    entitySelectedCountries = new Set(checked ? ENTITY_COUNTRIES : []);
    onEntitySelectedCountriesChanged();
  });

  // Entity View Toggle (card <-> list)
  entityViewToggleButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const mode = e.currentTarget.getAttribute('data-view');
      if (mode === entityViewMode) return;

      entityViewToggleButtons.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');

      entityViewMode = mode;
      renderEntityResults();
    });
  });

  // Entity Summary Toggle (accordion: shows/hides every selected country's
  // meta info + trend chart together, as one unit rather than per-country)
  entitySummaryToggleBtn.addEventListener('click', () => {
    entitySummaryExpanded = !entitySummaryExpanded;
    applyEntitySummaryExpandedState();
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

  // Entity Detail Modal (list-view row click opens it; see renderEntityResultsAsList)
  entityResultsEl.addEventListener('click', (e) => {
    const row = e.target.closest('.entity-list-row');
    if (!row) return;
    const ent = entityById.get(row.dataset.entityId);
    if (ent) openEntityModal(ent);
  });
  entityResultsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.entity-list-row');
    if (!row) return;
    e.preventDefault();
    const ent = entityById.get(row.dataset.entityId);
    if (ent) openEntityModal(ent);
  });
  entityModalCloseBtn.addEventListener('click', closeEntityModal);
  entityModalOverlay.addEventListener('click', (e) => {
    if (e.target === entityModalOverlay) closeEntityModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !entityModalOverlay.classList.contains('hidden')) closeEntityModal();
  });
}

function syncEntityCountryAllCheckbox() {
  entityCountryAllCheckbox.checked = entitySelectedCountries.size === ENTITY_COUNTRIES.length;
  entityCountryAllCheckbox.indeterminate =
    entitySelectedCountries.size > 0 && entitySelectedCountries.size < ENTITY_COUNTRIES.length;
}

function onEntitySelectedCountriesChanged() {
  renderEntitySummaryPanels();
  ensureSelectedCountriesLoaded();
}

function openEntityModal(ent) {
  entityModalContent.innerHTML = createEntityCardHtml(ent);
  entityModalOverlay.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeEntityModal() {
  entityModalOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

// Lazily loads the entity manifest + the currently selected countries'
// entity datasets the first time the Entities view is opened.
let entityInitStarted = false;
async function initEntityView() {
  if (entityInitStarted) return;
  entityInitStarted = true;

  try {
    entityManifest = await fetchEntityManifest();
  } catch (error) {
    console.error('[ENTITY API ERROR] Failed to fetch manifest:', error);
  }
  try {
    entityCountHistory = await fetchEntityCountHistory();
  } catch (error) {
    console.error('[ENTITY API ERROR] Failed to fetch count history:', error);
  }
  renderEntitySummaryPanels();
  ensureSelectedCountriesLoaded();
}

// Fetches (and caches) every currently-checked country's entity dataset,
// then re-renders results. Countries already in entitiesCache are skipped.
async function ensureSelectedCountriesLoaded() {
  if (entitySelectedCountries.size === 0) {
    renderEntityResults();
    return;
  }

  const toLoad = [...entitySelectedCountries].filter(c => !entitiesCache[c]);
  if (toLoad.length === 0) {
    renderEntityResults();
    return;
  }

  entityResultsEl.innerHTML = `<div class="loading-spinner">${toLoad.map(c => c.toUpperCase()).join(' / ')}のデータを読み込んでいます（初回は数秒〜十数秒かかる場合があります）...</div>`;
  try {
    await Promise.all(toLoad.map(async country => {
      entitiesCache[country] = await fetchEntities(country);
    }));
  } catch (error) {
    entityResultsEl.innerHTML = `
      <div class="no-results">
        <p style="color: #ef4444; font-weight: 600;">データの読み込みに失敗しました</p>
        <p style="font-size: 0.9rem; margin-top: 0.5rem;">${error.message}</p>
      </div>
    `;
    return;
  }
  renderEntityResults();
}

// Reflects entitySummaryExpanded onto the toggle button + panels container.
// Applied to the button separately from renderEntitySummaryPanels() because
// clicking the toggle doesn't rebuild the panels, only shows/hides them.
function applyEntitySummaryExpandedState() {
  entitySummaryToggleBtn.setAttribute('aria-expanded', String(entitySummaryExpanded));
  entitySummaryToggleBtn.classList.toggle('open', entitySummaryExpanded);
  entitySummaryPanelsEl.classList.toggle('collapsed', !entitySummaryExpanded);
}

// Renders one summary panel (collection size + trend chart) per selected
// country. Kept as separate small-multiple panels rather than one shared
// chart because record counts differ by orders of magnitude across
// countries (US ~26k vs. JP ~800 vs. CN ~240) — a single shared axis would
// flatten the smaller series.
function renderEntitySummaryPanels() {
  applyEntitySummaryExpandedState();
  if (!entityManifest || entitySelectedCountries.size === 0) {
    entitySummaryPanelsEl.innerHTML = '';
    return;
  }

  const selected = ENTITY_COUNTRIES.filter(c => entitySelectedCountries.has(c));
  entitySummaryPanelsEl.innerHTML = selected.map(c => `
    <div class="entity-summary-panel">
      <p class="entity-meta" id="entity-meta-${c}"></p>
      <div class="trend-chart-card" id="entity-trend-chart-${c}"></div>
    </div>
  `).join('');

  selected.forEach(country => {
    const listInfo = entityManifest.lists?.find(l => l.country === country);
    const metaEl = document.getElementById(`entity-meta-${country}`);
    const chartEl = document.getElementById(`entity-trend-chart-${country}`);
    if (!listInfo) return;

    metaEl.innerHTML = `
      ${COUNTRY_LABELS[country] || country}　収録件数: <strong>${listInfo.record_count.toLocaleString()}件</strong>
      ｜ 最終更新: ${listInfo.last_updated}
      ｜ 更新頻度: ${listInfo.update_frequency}
      ｜ <a href="${listInfo.source_url}" target="_blank" rel="noopener">出典: ${listInfo.name_en}</a>
    `;

    const series = entityCountHistory?.[listInfo.list_id] || [];
    renderTrendChart(chartEl, series, listInfo.name_en);
  });
}

function renderEntityResults() {
  if (entitySelectedCountries.size === 0) {
    entityResultsEl.innerHTML = `<div class="no-results">検索対象の国を1つ以上選択してください。</div>`;
    return;
  }

  // Still waiting on a fetch for one of the selected countries; the
  // in-flight ensureSelectedCountriesLoaded() call will re-render when done.
  const stillLoading = [...entitySelectedCountries].some(c => !entitiesCache[c]);
  if (stillLoading) return;

  if (entityQuery.length < ENTITY_MIN_QUERY_LENGTH) {
    entityResultsEl.innerHTML = `<div class="loading-spinner">検索語を入力してください（${ENTITY_MIN_QUERY_LENGTH}文字以上）</div>`;
    return;
  }

  const entities = [...entitySelectedCountries].flatMap(c => entitiesCache[c] || []);
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
  entityById = new Map(shown.map(ent => [ent.id, ent]));

  const countHtml = `<p class="entity-result-count">${matches.length.toLocaleString()}件中 ${shown.length.toLocaleString()}件を表示</p>`;
  entityResultsEl.innerHTML = countHtml + (entityViewMode === 'list'
    ? renderEntityResultsAsList(shown)
    : renderEntityResultsAsCards(shown));
}

function renderEntityResultsAsCards(shown) {
  return `
    <div class="registry-grid">
      ${shown.map(createEntityCardHtml).join('')}
    </div>
  `;
}

function renderEntityResultsAsList(shown) {
  const rowsHtml = shown.map(ent => {
    const aliases = ent.aliases && ent.aliases.length > 0 ? ent.aliases.join(' / ') : '';
    return `
      <tr class="entity-list-row" data-entity-id="${ent.id}" tabindex="0">
        <td><span class="badge badge-country">${COUNTRY_LABELS[ent.country] || ent.country}</span></td>
        <td>${ent.entity_type || ''}</td>
        <td class="entity-list-name">${ent.entity_name}</td>
        <td class="entity-list-aliases">${aliases}</td>
        <td class="entity-list-reason">${ent.reason || ''}</td>
        <td>${ent.last_verified || ''}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="entity-list-table-wrapper">
      <table class="entity-list-table">
        <thead>
          <tr>
            <th>国・リスト</th>
            <th>種別</th>
            <th>名称</th>
            <th>別名</th>
            <th>事由</th>
            <th>最終確認</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
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
          <span class="badge badge-country">${COUNTRY_LABELS[ent.country] || ent.country}</span>
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
  if (allDatasources.length === 0) {
    registryContainer.innerHTML = `<div class="no-results">データソースが見つかりませんでした。</div>`;
    return;
  }

  registryContainer.innerHTML = '';
  allDatasources.forEach(ds => {
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
    const itemsHtml = ds.summary_tree.map(item => `
      <div class="accordion-item">
        <button class="accordion-header">
          <span class="accordion-title-span">
            <span class="accordion-section-code">${item.section}</span>
            <strong>${item.title || ''}</strong>
          </span>
          <span class="accordion-arrow">▶</span>
        </button>
        <div class="accordion-content">
          <p>${item.summary}</p>
          ${item.url ? `
            <a href="${item.url}" target="_blank" rel="noopener" class="accordion-link">
              原典を確認 ↗
            </a>
          ` : ''}
        </div>
      </div>
    `).join('');

    // Collapsed by default, toggled independently per card.
    summaryTreeHtml = `
      <div class="card-summary-section">
        <button class="card-summary-toggle" type="button" aria-expanded="false">
          <span class="section-label">規制コンテンツ要約 (SUMMARY)</span>
          <span class="accordion-arrow">▶</span>
        </button>
        <div class="accordion-container collapsed">
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
    international_regime: '国際レジーム (International Regime)',
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

  // Per-card "規制コンテンツ要約" toggle: shows/hides that card's whole
  // accordion list at once, independent of every other card.
  const summaryToggles = registryContainer.querySelectorAll('.card-summary-toggle');
  summaryToggles.forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      const container = e.currentTarget.nextElementSibling;
      const isOpen = e.currentTarget.classList.toggle('open');
      container.classList.toggle('collapsed', !isOpen);
      e.currentTarget.setAttribute('aria-expanded', String(isOpen));
    });
  });
}
