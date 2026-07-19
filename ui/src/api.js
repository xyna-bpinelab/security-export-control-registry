import jsYaml from 'js-yaml';

// 'local' during `vite dev` (reads ../countries via vite.config.js publicDir).
// 'remote' in production builds (reads from raw.githubusercontent.com), so the
// deployed site (e.g. GitHub Pages) always serves the latest data from main
// without needing countries/ copied into the build output.
const DATA_SOURCE_MODE = import.meta.env.PROD ? 'remote' : 'local';

const BASE_URLS = {
  local: '', // vite.config.js publicDir serves ../countries at the site root
  remote: 'https://raw.githubusercontent.com/xyna-bpinelab/security-export-control-registry/main/countries'
};

/**
 * Resolves the base URL for fetching datasource registry.
 */
function getBaseUrl() {
  return BASE_URLS[DATA_SOURCE_MODE] || BASE_URLS.local;
}

/**
 * Fetches and parses datasources.yaml for a given country code (e.g., 'jp', 'us')
 * @param {string} country - Country/region folder code (e.g., 'jp', 'us')
 * @returns {Promise<Array>} Array of parsed datasources conforming to JSON Schema
 */
export async function fetchDatasources(country) {
  // During production build, relative paths outside the root directory may fail 
  // depending on host. A robust fallback logic can fetch local files copied during build.
  const url = `${getBaseUrl()}/${country}/datasources.yaml`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} when fetching ${country} datasources.`);
    }
    const yamlText = await response.text();
    const data = jsYaml.load(yamlText);
    return data.datasources || [];
  } catch (error) {
    console.error(`[API ERROR] Failed to fetch datasources for country '${country}':`, error);
    throw error;
  }
}
