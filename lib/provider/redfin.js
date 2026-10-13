/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// US/MX support added in the braulio-dev/fredy fork of Fredy.

/**
 * Redfin, for both homes for sale and rentals, through the `stingray` JSON API its own map calls.
 *
 * The user pastes a Redfin search URL such as
 * `https://www.redfin.com/city/16904/CA/San-Diego/apartments-for-rent/filter/max-price=3k,min-beds=1`
 * and {@link parseSearchUrl} turns its region and `/filter/` segment into API parameters:
 *
 * - region: `/city/<id>/…` (type 6), `/neighborhood/<id>/…` (1), `/county/<id>/…` (5). Zip code URLs
 *   (`/zipcode/92108`) are not supported: the API wants Redfin's internal region id, and both ways
 *   of resolving one (autocomplete, the zip page) are blocked for datacenter IPs.
 * - mode: rentals when the path says `apartments-for-rent` or `rentals`, otherwise for sale
 * - filters: min/max price (`3k`, `1.2M`), min/max beds, min baths, min/max sqft, property type
 *
 * Sale listings come from `/stingray/api/gis`, rentals from `/stingray/api/v1/search/rentals`. Both
 * are asked for newest first.
 */

import { buildHash, isOneOf } from '../utils.js';
import logger from '../services/logger.js';
import { getJson, toNumber } from '../services/us/http.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.redfin.com';
const SALE_ENDPOINT = `${BASE_URL}/stingray/api/gis`;
const RENT_ENDPOINT = `${BASE_URL}/stingray/api/v1/search/rentals`;
const NUM_HOMES = 100;

const REGION_TYPES = { neighborhood: 1, county: 5, city: 6 };
const PROPERTY_TYPES = { house: 1, condo: 2, townhouse: 3, 'multi-family': 4, multifamily: 4, land: 5, other: 6 };

/**
 * `3k` → 3000, `1.25M` → 1250000, `750-sqft` → 750.
 *
 * @param {string|undefined} value
 * @returns {number|null}
 */
export function filterNumber(value) {
  if (value == null) return null;
  const match = /^([\d.]+)\s*([kKmM])?/.exec(String(value));
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const unit = (match[2] || '').toLowerCase();
  return Math.round(base * (unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : 1));
}

/**
 * @param {string} url
 * @returns {{rentals: boolean, regionId: string, regionType: number, filters: Record<string,string>}|null}
 */
export function parseSearchUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const kindIndex = segments.findIndex((s) => REGION_TYPES[s] != null);
  if (kindIndex === -1 || segments[kindIndex + 1] == null) return null;

  const kind = segments[kindIndex];
  const regionId = segments[kindIndex + 1];
  const rentals = segments.some((s) => s === 'apartments-for-rent' || s === 'rentals' || s === 'houses-for-rent');

  /** @type {Record<string,string>} */
  const filters = {};
  const filterIndex = segments.indexOf('filter');
  if (filterIndex !== -1 && segments[filterIndex + 1]) {
    for (const pair of decodeURIComponent(segments[filterIndex + 1]).split(',')) {
      const [key, value] = pair.split('=');
      if (key && value != null) filters[key] = value;
    }
  }

  return { rentals, regionId, regionType: REGION_TYPES[kind], filters };
}

/**
 * The API parameters for one parsed search.
 *
 * @param {NonNullable<ReturnType<typeof parseSearchUrl>>} search
 * @returns {URLSearchParams}
 */
export function apiParams(search) {
  const { filters } = search;
  const params = new URLSearchParams({
    al: '1',
    num_homes: String(NUM_HOMES),
    ord: 'days-on-redfin-asc',
    page_number: '1',
    region_id: search.regionId,
    region_type: String(search.regionType),
    status: '9',
    v: '8',
  });

  const types = (filters['property-type'] || '')
    .split('+')
    .map((t) => PROPERTY_TYPES[t])
    .filter((t) => t != null);
  params.set('uipt', types.length > 0 ? types.join(',') : '1,2,3,4');

  const set = (name, value) => value != null && params.set(name, String(value));
  set('min_price', filterNumber(filters['min-price']));
  set('max_price', filterNumber(filters['max-price']));
  set('num_beds', filterNumber(filters['min-beds']));
  set('max_num_beds', filterNumber(filters['max-beds']));
  set('num_baths', filterNumber(filters['min-baths']));
  set('min_listing_approx_size', filterNumber(filters['min-sqft']));
  set('max_listing_approx_size', filterNumber(filters['max-sqft']));

  if (search.rentals) {
    params.set('isRentals', 'true');
    params.set('use_max_rentals', 'true');
    params.set('sf', '1,2,3,5,6,7');
    params.set('start', '0');
    params.set('page', '1');
  }
  return params;
}

/**
 * Applies the URL's filters to a flattened home.
 *
 * The rentals endpoint honours `min_price`/`max_price`/`num_beds` itself, but the sale endpoint was
 * seen ignoring them (a 900k ceiling answered with 2.75M homes), so both are filtered here as well.
 * A home missing a figure is kept - Redfin leaves sqft off plenty of rentals.
 *
 * @param {Object} home
 * @param {Record<string,string>} filters
 * @returns {boolean}
 */
export function matchesFilters(home, filters) {
  const within = (value, min, max) =>
    value == null || ((min == null || value >= min) && (max == null || value <= max));
  return (
    within(home.price, filterNumber(filters['min-price']), filterNumber(filters['max-price'])) &&
    within(home.beds, filterNumber(filters['min-beds']), filterNumber(filters['max-beds'])) &&
    within(home.baths, filterNumber(filters['min-baths']), null) &&
    within(home.sqft, filterNumber(filters['min-sqft']), filterNumber(filters['max-sqft']))
  );
}

/**
 * Sale homes and rentals come back in different shapes; both are flattened into one.
 *
 * @param {any} home A `payload.homes[]` entry from the sale endpoint.
 * @returns {Object}
 */
export function flattenSaleHome(home) {
  const mlsId = home?.mlsId?.value ?? null;
  const dataSourceId = home?.dataSourceId;
  const photo =
    mlsId && dataSourceId != null
      ? `https://ssl.cdn-redfin.com/photo/${dataSourceId}/bigphoto/${String(mlsId).slice(-3)}/${mlsId}_0.jpg`
      : null;
  const street = home?.streetLine?.value;
  const unit = home?.unitNumber?.value;
  return {
    key: String(home?.listingId ?? home?.propertyId ?? ''),
    url: home?.url ?? null,
    price: toNumber(home?.price?.value),
    beds: toNumber(home?.beds),
    baths: toNumber(home?.baths),
    sqft: toNumber(home?.sqFt?.value),
    yearBuilt: toNumber(home?.yearBuilt?.value),
    address: [[street, unit].filter(Boolean).join(' '), home?.city, [home?.state, home?.zip].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
    latitude: toNumber(home?.latLong?.value?.latitude),
    longitude: toNumber(home?.latLong?.value?.longitude),
    // `timeOnRedfin` is milliseconds since the listing went up.
    publishedAt: toNumber(home?.timeOnRedfin?.value) != null ? Date.now() - toNumber(home.timeOnRedfin.value) : null,
    description: (home?.listingRemarks || (home?.listingTags || []).join(', ').toLowerCase() || null) ?? null,
    image: photo,
    rental: false,
  };
}

/**
 * @param {any} home A `homes[]` entry from the rentals endpoint.
 * @returns {Object}
 */
export function flattenRentalHome(home) {
  const data = home?.homeData ?? {};
  const rental = home?.rentalExtension ?? {};
  const address = data.addressInfo ?? {};
  const centroid = address.centroid?.centroid ?? {};
  const photo = rental.rentalId ? `https://ssl.cdn-redfin.com/photo/rent/${rental.rentalId}/islphoto/genIsl.0_1.jpg` : null;
  const lastUpdated = rental.freshnessTimestamp || rental.lastUpdated;
  return {
    key: String(rental.rentalId ?? data.propertyId ?? ''),
    url: data.url ?? null,
    price: toNumber(rental.rentPriceRange?.min),
    beds: toNumber(rental.bedRange?.min),
    baths: toNumber(rental.bathRange?.min),
    sqft: toNumber(rental.sqftRange?.min) || null,
    yearBuilt: null,
    address: [address.formattedStreetLine, address.city, [address.state, address.zip].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
    latitude: toNumber(centroid.latitude),
    longitude: toNumber(centroid.longitude),
    publishedAt: lastUpdated ? Date.parse(lastUpdated) || null : null,
    description: rental.description ?? null,
    image: photo,
    rental: true,
    units: toNumber(rental.numAvailableUnits),
  };
}

/**
 * @param {string} url
 * @returns {Promise<Object[]>}
 */
async function getListings(url) {
  const search = parseSearchUrl(url);
  if (search == null) {
    logger.error(`Not a Redfin search URL Fredy understands (needs /city/<id>/, /neighborhood/<id>/ or /county/<id>/): ${url}`);
    return [];
  }
  const params = apiParams(search);
  const headers = { Referer: url };

  if (search.rentals) {
    const response = await getJson(`${RENT_ENDPOINT}?${params}`, 'Redfin rentals', headers);
    return (response?.homes ?? [])
      .map(flattenRentalHome)
      .filter((h) => h.key && h.url && matchesFilters(h, search.filters));
  }
  const response = await getJson(`${SALE_ENDPOINT}?${params}`, 'Redfin homes for sale', headers);
  return (response?.payload?.homes ?? [])
    .map(flattenSaleHome)
    .filter((h) => h.key && h.url && matchesFilters(h, search.filters));
}

/**
 * @param {any} o A flattened home.
 * @returns {ParsedListing}
 */
function normalize(o) {
  const beds = o.beds != null ? `${o.beds} bd` : null;
  const baths = o.baths != null ? `${o.baths} ba` : null;
  const kind = o.rental ? 'for rent' : 'for sale';
  return {
    id: buildHash(o.key, o.price),
    title: [beds, baths, kind].filter(Boolean).join(' · ') + (o.address ? ` - ${o.address.split(',')[0]}` : ''),
    link: `${BASE_URL}${o.url}`,
    price: o.price,
    size: o.sqft,
    rooms: o.beds,
    address: o.address || null,
    description: o.description,
    image: o.image,
    buildYear: o.yearBuilt ?? undefined,
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

/** @type {ProviderConfig} */
const config = {
  url: null,
  requiredFieldNames: ['id', 'title', 'link', 'price', 'size', 'rooms', 'address', 'image'],
  crawlContainer: null,
  crawlFields: {},
  sortByDateParam: null,
  priceRangeParams: {
    parse: (url) => {
      const search = parseSearchUrl(url);
      return { min: filterNumber(search?.filters?.['min-price']), max: filterNumber(search?.filters?.['max-price']) };
    },
  },
  getListings,
  normalize,
};

export const metaInformation = {
  countries: ['us'],
  name: 'Redfin',
  baseUrl: `${BASE_URL}/`,
  id: 'redfin',
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
