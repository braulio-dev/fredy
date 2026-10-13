/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// US/MX support added in the braulio-dev/fredy fork of Fredy.

/**
 * Craigslist housing (apartments, rooms, sublets, real estate for sale), read through the same
 * `sapi.craigslist.org` JSON endpoint the site's own search page calls.
 *
 * The user pastes an ordinary search URL - `https://sandiego.craigslist.org/search/apa?max_price=3000`
 * - and every query parameter on it is forwarded untouched, so any filter the site offers (price,
 * bedrooms, sqft, pets, postal + distance, keywords) works without this module knowing about it.
 *
 * The response is compact: each item is a positional array whose first fields are offsets from
 * `decode.minPostingId` / `decode.minPostedDate`, followed by tagged sub-arrays
 * (`[4, ...images]`, `[5, beds, sqft]`, `[6, slug]`, `[10, priceText]`) and the title as a bare
 * string. {@link decodeItem} unpacks one into a plain object.
 */

import { buildHash, isOneOf } from '../utils.js';
import logger from '../services/logger.js';
import { getJson, toNumber } from '../services/us/http.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const SAPI = 'https://sapi.craigslist.org/web/v8/postings/search/full';
const AREAS_ENDPOINT = 'https://reference.craigslist.org/Areas';

/**
 * The page size the sapi expects. Any other value - tried 120 - answers 400, so this is not a
 * tuning knob. `batch` must also be the first query parameter.
 */
const BATCH_SIZE = 360;

/**
 * Area ids for the hostnames most likely to be searched from here, so the common case needs no
 * second request. Anything else is looked up once in Craigslist's public area reference.
 *
 * @type {Record<string, number>}
 */
const KNOWN_AREAS = {
  sandiego: 8,
  tijuana: 181,
  losangeles: 7,
  sfbay: 1,
  seattle: 2,
  newyork: 3,
  boston: 4,
};

/** @type {Promise<Record<string, number>>|null} Static reference data, not run state. */
let areaTable = null;

/**
 * @param {string} hostname e.g. `tijuana`
 * @returns {Promise<number|null>}
 */
async function areaIdFor(hostname) {
  if (KNOWN_AREAS[hostname] != null) return KNOWN_AREAS[hostname];
  if (areaTable == null) {
    areaTable = getJson(AREAS_ENDPOINT, 'the Craigslist area list').then((rows) => {
      /** @type {Record<string, number>} */
      const table = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.Hostname && row?.AreaID != null) table[String(row.Hostname).toLowerCase()] = Number(row.AreaID);
      }
      if (Object.keys(table).length === 0) areaTable = null; // retry next run
      return table;
    });
  }
  const table = await areaTable;
  return table[hostname] ?? null;
}

/**
 * Splits a pasted search URL into what the sapi wants.
 *
 * @param {string} url
 * @returns {{hostname: string, searchPath: string, params: URLSearchParams}|null}
 */
export function parseSearchUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const hostMatch = /^([a-z0-9-]+)\.craigslist\.org$/i.exec(parsed.hostname);
  if (!hostMatch || hostMatch[1].toLowerCase() === 'www') return null;
  const pathMatch = /^\/search\/(.+?)\/?$/.exec(parsed.pathname);
  return {
    hostname: hostMatch[1].toLowerCase(),
    searchPath: pathMatch ? pathMatch[1] : 'apa',
    params: new URLSearchParams(parsed.search),
  };
}

/**
 * Unpacks one positional sapi item.
 *
 * @param {any[]} item
 * @param {any} decode `data.decode` of the same response.
 * @param {string} category e.g. `apa`
 * @returns {Object|null}
 */
export function decodeItem(item, decode, category) {
  if (!Array.isArray(item) || item.length < 5) return null;

  const postingId = toNumber(decode?.minPostingId) + toNumber(item[0]);
  const postedSeconds = toNumber(decode?.minPostedDate) + toNumber(item[1]);

  const out = {
    postingId: Number.isFinite(postingId) ? String(postingId) : null,
    postedAt: Number.isFinite(postedSeconds) ? postedSeconds * 1000 : null,
    price: toNumber(item[3]) > 0 ? toNumber(item[3]) : null,
    title: null,
    slug: null,
    beds: null,
    sqft: null,
    images: [],
    hostname: null,
    subarea: null,
    locationText: null,
    latitude: null,
    longitude: null,
    category,
  };

  // "locIdx:descIdx~lat~lon"
  const loc = /^(\d+):(\d+)~(-?[\d.]+)~(-?[\d.]+)$/.exec(String(item[4] ?? ''));
  if (loc) {
    const area = decode?.locations?.[Number(loc[1])];
    if (Array.isArray(area)) {
      out.hostname = area[1] ?? null;
      out.subarea = area[2] ?? null;
    }
    const description = decode?.locationDescriptions?.[Number(loc[2])];
    out.locationText = typeof description === 'string' ? description : null;
    out.latitude = toNumber(loc[3]);
    out.longitude = toNumber(loc[4]);
  }

  for (const field of item.slice(5)) {
    if (typeof field === 'string') {
      out.title = field;
    } else if (Array.isArray(field)) {
      const [tag, ...rest] = field;
      if (tag === 4) out.images = rest.filter((x) => typeof x === 'string');
      else if (tag === 5) {
        out.beds = toNumber(rest[0]);
        out.sqft = toNumber(rest[1]) > 0 ? toNumber(rest[1]) : null;
      } else if (tag === 6) out.slug = rest[0] ?? null;
      else if (tag === 10 && out.price == null) out.price = toNumber(String(rest[0] ?? '').replace(/[$,]/g, ''));
    }
  }

  return out;
}

/**
 * `"3:00w0w_ahVhrJ2ya9d_0ak07K"` → a 600x450 thumbnail URL.
 *
 * @param {string|undefined} ref
 * @returns {string|null}
 */
export function imageUrl(ref) {
  if (!ref) return null;
  const key = String(ref).replace(/^\d+:/, '');
  return `https://images.craigslist.org/${key}_600x450.jpg`;
}

/**
 * @param {string} url The job's search URL.
 * @returns {Promise<Object[]>}
 */
async function getListings(url) {
  const search = parseSearchUrl(url);
  if (search == null) {
    logger.error(`Not a Craigslist search URL: ${url}`);
    return [];
  }
  const areaId = await areaIdFor(search.hostname);
  if (areaId == null) {
    logger.error(`Unknown Craigslist area '${search.hostname}'.`);
    return [];
  }

  const params = new URLSearchParams({
    batch: `${areaId}-0-${BATCH_SIZE}-0-0`,
    cc: 'US',
    lang: 'en',
    searchPath: search.searchPath,
  });
  for (const [key, value] of search.params) {
    if (!params.has(key)) params.append(key, value);
  }
  // The sapi rejects `sort` (400) and answers newest first by default; the pasted URL's own sort
  // parameter, if any, is dropped for the same reason. Ordering is enforced again below.
  params.delete('sort');

  const origin = `https://${search.hostname}.craigslist.org`;
  const response = await getJson(`${SAPI}?${params}`, 'Craigslist search results', {
    Origin: origin,
    Referer: `${origin}/`,
  });
  const data = response?.data;
  if (!data || !Array.isArray(data.items)) return [];

  const category = data.categoryAbbr || search.searchPath.split('/').pop() || 'apa';
  return data.items
    .map((item) => decodeItem(item, data.decode, category))
    .filter((o) => o != null && o.postingId != null)
    .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
}

/**
 * @param {any} o A decoded item.
 * @returns {ParsedListing}
 */
function normalize(o) {
  const host = o.hostname || 'www';
  const sub = o.subarea ? `${o.subarea}/` : '';
  const slug = o.slug || 'listing';
  const bedsText = o.beds != null ? `${o.beds}br` : null;
  const sqftText = o.sqft != null ? `${o.sqft} sq ft` : null;
  return {
    id: buildHash(o.postingId, o.price),
    title: o.title,
    link: `https://${host}.craigslist.org/${sub}${o.category}/d/${slug}/${o.postingId}.html`,
    price: o.price,
    size: o.sqft,
    rooms: o.beds,
    address: o.locationText,
    description: [bedsText, sqftText, o.locationText].filter(Boolean).join(' · ') || null,
    image: imageUrl(o.images?.[0]),
    publishedAt: o.postedAt ?? undefined,
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

/** @type {ProviderConfig} */
const config = {
  url: null,
  requiredFieldNames: ['id', 'title', 'link', 'price', 'size', 'rooms', 'address', 'image'],
  crawlContainer: null,
  crawlFields: {},
  sortByDateParam: null,
  // ?min_price=1500&max_price=3000
  priceRangeParams: { min: 'min_price', max: 'max_price' },
  getListings,
  normalize,
};

export const metaInformation = {
  countries: ['us', 'mx'],
  name: 'Craigslist',
  baseUrl: 'https://www.craigslist.org/',
  id: 'craigslist',
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
