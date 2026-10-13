/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// US/MX support added in the braulio-dev/fredy fork of Fredy.

/**
 * Zillow, for rentals and homes for sale, read from the `__NEXT_DATA__` blob its search page ships.
 *
 * The user pastes any Zillow search URL - with or without the `searchQueryState` parameter Zillow
 * adds once filters are touched - and the page is fetched as it is, so every filter Zillow's own UI
 * can set applies. The only thing changed is the sort, forced to "newest" so each run sees what was
 * listed since the last one.
 *
 * Apartment buildings come back as one card with a `units` array (one price per bedroom count);
 * those become one listing priced at the cheapest unit. Individual homes carry `hdpData.homeInfo`.
 */

import { buildHash, isOneOf } from '../utils.js';
import logger from '../services/logger.js';
import { getText, toNumber, usNumber } from '../services/us/http.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.zillow.com';

/**
 * Forces newest-first onto a pasted search URL.
 *
 * @param {string} url
 * @returns {string}
 */
export function withNewestFirst(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const raw = parsed.searchParams.get('searchQueryState');
  let state = {};
  if (raw) {
    try {
      state = JSON.parse(raw);
    } catch {
      return url;
    }
  }
  state.filterState = { ...(state.filterState || {}), sort: { value: 'days' } };
  delete state.filterState.sortSelection;
  state.pagination = {};
  parsed.searchParams.set('searchQueryState', JSON.stringify(state));
  return parsed.toString();
}

/**
 * @param {string} html
 * @returns {any[]} `cat1.searchResults.listResults`, or an empty array.
 */
export function extractListResults(html) {
  const match = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s.exec(html || '');
  if (!match) return [];
  try {
    const data = JSON.parse(match[1]);
    const results = data?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults;
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

/**
 * @param {any} r One `listResults` entry.
 * @returns {Object}
 */
export function flattenResult(r) {
  const info = r?.hdpData?.homeInfo ?? {};
  const units = Array.isArray(r?.units) ? r.units : [];
  const unitPrices = units.map((u) => usNumber(u?.price)).filter((p) => p != null && p > 0);
  const unitBeds = units.map((u) => toNumber(u?.beds)).filter((b) => b != null);

  const price = toNumber(info.price) ?? usNumber(r?.unformattedPrice) ?? usNumber(r?.price) ?? (unitPrices.length ? Math.min(...unitPrices) : null);
  const beds = toNumber(info.bedrooms) ?? toNumber(r?.beds) ?? (unitBeds.length ? Math.min(...unitBeds) : null);
  const sqft = toNumber(info.livingArea) ?? toNumber(r?.area) ?? null;

  const daysOn = toNumber(info.daysOnZillow);
  const unitSummary = units.length
    ? units.map((u) => `${toNumber(u?.beds) === 0 ? 'Studio' : `${u?.beds} bd`} ${u?.price ?? ''}`.trim()).join(', ')
    : null;

  return {
    key: String(r?.zpid ?? r?.id ?? r?.providerListingId ?? ''),
    url: r?.detailUrl ?? null,
    price,
    beds,
    baths: toNumber(info.bathrooms) ?? toNumber(r?.baths),
    sqft: sqft && sqft > 0 ? sqft : null,
    address: r?.address ?? null,
    building: r?.buildingName ?? null,
    status: r?.statusType ?? null,
    image: r?.imgSrc ?? null,
    latitude: toNumber(r?.latLong?.latitude),
    longitude: toNumber(r?.latLong?.longitude),
    publishedAt: daysOn != null ? Date.now() - daysOn * 86_400_000 : null,
    unitSummary,
    flex: r?.flexFieldText ?? null,
  };
}

/**
 * @param {string} url
 * @returns {Promise<Object[]>}
 */
async function getListings(url) {
  const html = await getText(withNewestFirst(url), 'Zillow search results', { Referer: `${BASE_URL}/` });
  if (html == null) return [];
  const results = extractListResults(html);
  if (results.length === 0) {
    logger.warn('Zillow answered, but the page carried no search results (bot wall or empty search).');
  }
  return results.map(flattenResult).filter((o) => o.key && o.url);
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const beds = o.beds != null ? (o.beds === 0 ? 'Studio' : `${o.beds} bd`) : null;
  const baths = o.baths != null ? `${o.baths} ba` : null;
  const kind = o.status === 'FOR_RENT' ? 'for rent' : o.status === 'FOR_SALE' ? 'for sale' : null;
  const lead = o.building || [beds, baths, kind].filter(Boolean).join(' · ');
  return {
    id: buildHash(o.key, o.price),
    title: `${lead}${o.address ? ` - ${o.address.split(',')[0]}` : ''}`,
    link: o.url.startsWith('http') ? o.url : `${BASE_URL}${o.url}`,
    price: o.price,
    size: o.sqft,
    rooms: o.beds,
    address: o.address,
    description: [o.unitSummary, o.flex].filter(Boolean).join(' · ') || null,
    image: o.image,
    publishedAt: o.publishedAt ?? undefined,
    latitude: o.latitude ?? undefined,
    longitude: o.longitude ?? undefined,
  };
}

/**
 * @param {ParsedListing} o
 * @param {string[]} blacklist
 * @returns {boolean}
 */
function applyBlacklist(o, blacklist) {
  return o.title != null && !isOneOf(o.title, blacklist) && !isOneOf(o.description, blacklist);
}

/**
 * Price bounds out of `searchQueryState.filterState` (`price` for sale, `mp` - monthly payment -
 * for rentals).
 *
 * @param {string} url
 * @returns {{min: number|null, max: number|null}}
 */
function parsePriceRange(url) {
  const raw = new URL(url).searchParams.get('searchQueryState');
  if (!raw) return { min: null, max: null };
  const fs = JSON.parse(raw)?.filterState ?? {};
  const range = fs.mp ?? fs.price ?? {};
  return { min: toNumber(range.min), max: toNumber(range.max) };
}

/** @type {ProviderConfig} */
const config = {
  url: null,
  requiredFieldNames: ['id', 'title', 'link', 'price', 'size', 'rooms', 'address', 'image'],
  crawlContainer: null,
  crawlFields: {},
  sortByDateParam: null,
  priceRangeParams: { parse: parsePriceRange },
  getListings,
  normalize,
};

export const metaInformation = {
  countries: ['us'],
  name: 'Zillow',
  baseUrl: `${BASE_URL}/`,
  id: 'zillow',
};

/**
 * @param {{url: string, enabled?: boolean}} sourceConfig
 * @param {string[]} [blacklist]
 * @returns {ProviderConfig}
 */
export const createConfig = (sourceConfig, blacklist = []) => ({
  ...config,
  enabled: sourceConfig.enabled,
  url: sourceConfig.url,
  filter: (listing) => applyBlacklist(listing, blacklist ?? []),
});

export { config };
