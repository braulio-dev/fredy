/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Tests for the fork's US/MX providers. The parsers are exercised against trimmed copies of real
// responses captured in October 2026; `tools/us/smoke.mjs` covers the live endpoints.

import { describe, it, expect } from 'vitest';
import * as craigslist from '../../lib/provider/craigslist.js';
import * as redfin from '../../lib/provider/redfin.js';
import * as zillow from '../../lib/provider/zillow.js';
import { usNumber } from '../../lib/services/us/http.js';

describe('usNumber', () => {
  it('reads US-formatted figures, not German ones', () => {
    expect(usNumber('$2,995')).toBe(2995);
    expect(usNumber('$2,722+')).toBe(2722);
    expect(usNumber('1,024 sqft')).toBe(1024);
    expect(usNumber('$1,250.50/mo')).toBe(1250.5);
    expect(usNumber(2600)).toBe(2600);
    expect(usNumber('Contact for price')).toBeNull();
    expect(usNumber(null)).toBeNull();
  });
});

describe('craigslist', () => {
  const decode = {
    locations: [0, [8, 'sandiego', 'csd'], [8, 'sandiego', 'nsd']],
    locationDescriptions: [0, 'San Diego', 'North Park'],
    minPostedDate: 1791844793,
    minPostingId: 7966008012,
  };
  const item = [
    51918,
    19249,
    1,
    3195,
    '1:2~32.7465~-117.1319',
    '0ak07K',
    [13, '4hYVXQ172VQW6EVzVes6bu'],
    [4, '3:00w0w_ahVhrJ2ya9d_0ak07K', '3:00O0O_9F2No8nRNRK_0ak07K'],
    [6, 'san-diego-north-park-amazing-bedroom'],
    [10, '$3,195'],
    'North Park amazing 2 bedroom 2 baths garage walk to restaurants',
    [5, 2, 950],
  ];

  it('parses a pasted search URL', () => {
    expect(
      craigslist.parseSearchUrl('https://sandiego.craigslist.org/search/apa?max_price=3000#search=1~gallery'),
    ).toMatchObject({
      hostname: 'sandiego',
      searchPath: 'apa',
    });
    expect(craigslist.parseSearchUrl('https://tijuana.craigslist.org/search/csd/apa').searchPath).toBe('csd/apa');
    expect(craigslist.parseSearchUrl('https://www.craigslist.org/about')).toBeNull();
    expect(craigslist.parseSearchUrl('not a url')).toBeNull();
  });

  it('decodes a positional sapi item into a listing', () => {
    const decoded = craigslist.decodeItem(item, decode, 'apa');
    expect(decoded).toMatchObject({
      postingId: '7966059930',
      price: 3195,
      beds: 2,
      sqft: 950,
      hostname: 'sandiego',
      subarea: 'csd',
      locationText: 'North Park',
      latitude: 32.7465,
      longitude: -117.1319,
    });
    expect(decoded.postedAt).toBe((1791844793 + 19249) * 1000);

    const listing = craigslist.config.normalize(decoded);
    expect(listing.link).toBe(
      'https://sandiego.craigslist.org/csd/apa/d/san-diego-north-park-amazing-bedroom/7966059930.html',
    );
    expect(listing.image).toBe('https://images.craigslist.org/00w0w_ahVhrJ2ya9d_0ak07K_600x450.jpg');
    expect(listing).toMatchObject({ price: 3195, size: 950, rooms: 2, address: 'North Park' });
  });

  it('tolerates items without photos, beds or sqft', () => {
    const bare = [5, 6, 1, 0, '1:1~32.7~-117.1', 'x', [6, 'slug'], 'Room for rent'];
    const decoded = craigslist.decodeItem(bare, decode, 'roo');
    expect(decoded).toMatchObject({ price: null, beds: null, sqft: null, title: 'Room for rent' });
    expect(craigslist.config.normalize(decoded).image).toBeNull();
  });
});

describe('redfin', () => {
  it('reads region, mode and filters from a search URL', () => {
    const rent = redfin.parseSearchUrl(
      'https://www.redfin.com/city/16904/CA/San-Diego/apartments-for-rent/filter/max-price=3k,min-beds=1,min-sqft=750-sqft',
    );
    expect(rent).toMatchObject({ rentals: true, regionId: '16904', regionType: 6 });
    const params = redfin.apiParams(rent);
    expect(params.get('max_price')).toBe('3000');
    expect(params.get('num_beds')).toBe('1');
    expect(params.get('min_listing_approx_size')).toBe('750');
    expect(params.get('isRentals')).toBe('true');

    const sale = redfin.parseSearchUrl('https://www.redfin.com/city/16904/CA/San-Diego/filter/max-price=1.25M');
    expect(sale.rentals).toBe(false);
    expect(redfin.apiParams(sale).get('max_price')).toBe('1250000');

    expect(redfin.parseSearchUrl('https://www.redfin.com/zipcode/92108')).toBeNull();
  });

  it('filters client-side because the sale endpoint ignores the price ceiling', () => {
    const filters = { 'max-price': '900k', 'min-beds': '2' };
    expect(redfin.matchesFilters({ price: 750000, beds: 3 }, filters)).toBe(true);
    expect(redfin.matchesFilters({ price: 1479500, beds: 4 }, filters)).toBe(false);
    expect(redfin.matchesFilters({ price: 500000, beds: 1 }, filters)).toBe(false);
    expect(redfin.matchesFilters({ price: 500000, beds: null }, filters)).toBe(true);
  });

  it('flattens a rental', () => {
    const home = redfin.flattenRentalHome({
      homeData: {
        propertyId: '5255704',
        url: '/CA/San-Diego/7988-Mission-Center-Ct-92108/unit-C/home/5255704',
        addressInfo: {
          centroid: { centroid: { latitude: 32.7730476, longitude: -117.1509951 } },
          formattedStreetLine: '7988 Mission Center Ct Unit C',
          city: 'San Diego',
          state: 'CA',
          zip: '92108',
        },
      },
      rentalExtension: {
        rentalId: '3ac65967-f13d-44a0-a2ca-4f5f2b252222',
        bedRange: { min: 2, max: 2 },
        bathRange: { min: 2, max: 2 },
        sqftRange: { min: 894, max: 894 },
        rentPriceRange: { min: 2600, max: 2600 },
        freshnessTimestamp: '2026-10-13T02:34:23.698Z',
        description: 'Live in the heart of Mission Valley',
      },
    });
    const listing = redfin.config.normalize(home);
    expect(listing).toMatchObject({
      price: 2600,
      size: 894,
      rooms: 2,
      address: '7988 Mission Center Ct Unit C, San Diego, CA 92108',
      link: 'https://www.redfin.com/CA/San-Diego/7988-Mission-Center-Ct-92108/unit-C/home/5255704',
    });
    expect(listing.publishedAt).toBe(Date.parse('2026-10-13T02:34:23.698Z'));
  });

  it('flattens a home for sale, including its photo URL', () => {
    const home = redfin.flattenSaleHome({
      mlsId: { value: '260024490' },
      price: { value: 750000 },
      sqFt: { value: 1399 },
      beds: 3,
      baths: 2,
      streetLine: { value: '5627 Shaw St' },
      unitNumber: {},
      city: 'San Diego',
      state: 'CA',
      zip: '92139',
      latLong: { value: { latitude: 32.67, longitude: -117.06 } },
      yearBuilt: { value: 1948 },
      listingId: 224248426,
      dataSourceId: 48,
      url: '/CA/San-Diego/5627-Shaw-St-92139/home/6044602',
    });
    expect(home.image).toBe('https://ssl.cdn-redfin.com/photo/48/bigphoto/490/260024490_0.jpg');
    expect(redfin.config.normalize(home)).toMatchObject({
      price: 750000,
      size: 1399,
      rooms: 3,
      buildYear: 1948,
      address: '5627 Shaw St, San Diego, CA 92139',
    });
  });
});

describe('zillow', () => {
  it('builds a newest-first URL from the resolved query state', () => {
    const url = zillow.newestFirstUrl('https://www.zillow.com/san-diego-ca/rentals/', {
      regionSelection: [{ regionId: 54296, regionType: 6 }],
      filterState: { isForRent: { value: true }, sortSelection: { value: 'priorityscore' } },
    });
    const state = JSON.parse(new URL(url).searchParams.get('searchQueryState'));
    expect(state.filterState.sort).toEqual({ value: 'days' });
    expect(state.filterState.sortSelection).toBeUndefined();
    expect(state.filterState.isForRent).toEqual({ value: true });
    expect(state.regionSelection).toEqual([{ regionId: 54296, regionType: 6 }]);

    expect(
      zillow.newestFirstUrl('https://www.zillow.com/x/', { filterState: { sortSelection: { value: 'days' } } }),
    ).toBeNull();
  });

  it('reads the list results out of __NEXT_DATA__', () => {
    const state = { cat1: { searchResults: { listResults: [{ zpid: '1' }] } } };
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { searchPageState: state } },
    })}</script></html>`;
    expect(zillow.listResultsOf(zillow.extractPageState(html))).toEqual([{ zpid: '1' }]);
    expect(zillow.extractPageState('<html>blocked</html>')).toBeNull();
  });

  it('prices an apartment building at its cheapest unit', () => {
    const building = zillow.flattenResult({
      zpid: '32.76007--117.18123',
      detailUrl: '/apartments/san-diego-ca/broadstone-mission-valley/Cq8ym3/',
      statusType: 'FOR_RENT',
      address: '1908 Hotel Cir N, San Diego, CA',
      buildingName: 'Broadstone Mission Valley',
      imgSrc: 'https://photos.zillowstatic.com/fp/dd13-p_e.jpg',
      units: [
        { price: '$2,722+', beds: '0' },
        { price: '$3,043+', beds: '1' },
      ],
      latLong: { latitude: 32.76007, longitude: -117.18123 },
    });
    const listing = zillow.config.normalize(building);
    expect(listing).toMatchObject({ price: 2722, rooms: 0, size: null });
    expect(listing.title).toBe('Broadstone Mission Valley - 1908 Hotel Cir N');
    expect(listing.link).toBe('https://www.zillow.com/apartments/san-diego-ca/broadstone-mission-valley/Cq8ym3/');
    expect(listing.description).toContain('Studio $2,722+');
  });

  it('reads an individual home from hdpData', () => {
    const home = zillow.flattenResult({
      zpid: '17081112',
      detailUrl: 'https://www.zillow.com/homedetails/1649-Pentecost-Way-UNIT-2-San-Diego-CA-92105/17081112_zpid/',
      statusType: 'FOR_SALE',
      address: '1649 Pentecost Way Unit 2, San Diego, CA 92105',
      price: '$288,000',
      hdpData: { homeInfo: { price: 288000, bedrooms: 1, bathrooms: 1, livingArea: 668, daysOnZillow: 0 } },
    });
    expect(zillow.config.normalize(home)).toMatchObject({ price: 288000, rooms: 1, size: 668 });
  });
});
