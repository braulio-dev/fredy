/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// US/MX support added in the braulio-dev/fredy fork of Fredy.

import logger from '../logger.js';

/**
 * Shared request plumbing for the US portals (Craigslist, Redfin, Zillow).
 *
 * All three answer a plain `fetch` from a datacenter IP as long as the request looks like a
 * browser's, which is why none of them goes through the Puppeteer extractor: a JSON endpoint or an
 * embedded `__NEXT_DATA__` blob is both cheaper and steadier than a rendered page.
 */
export const BROWSER_HEADERS = Object.freeze({
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
});

/**
 * @param {string} url
 * @param {string} what Named in the log line on failure.
 * @param {Record<string,string>} [headers]
 * @returns {Promise<string|null>} The body, or null on any failure (never throws).
 */
export async function getText(url, what, headers = {}) {
  try {
    const response = await fetch(url, {
      headers: { ...BROWSER_HEADERS, ...headers },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      logger.error(`Error fetching ${what}: ${response.status} ${response.statusText}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    logger.error(`Error fetching ${what}: ${error?.message || error}`);
    return null;
  }
}

/**
 * Like {@link getText}, parsed as JSON. Strips the `{}&&` anti-hijacking prefix Redfin puts in
 * front of its stingray responses.
 *
 * @param {string} url
 * @param {string} what
 * @param {Record<string,string>} [headers]
 * @returns {Promise<any|null>}
 */
export async function getJson(url, what, headers = {}) {
  const text = await getText(url, what, { Accept: 'application/json', ...headers });
  if (text == null) return null;
  try {
    return JSON.parse(text.replace(/^\s*\{\}&&/, ''));
  } catch {
    logger.error(`Error parsing ${what}: response was not JSON`);
    return null;
  }
}

/**
 * A number from a US-formatted value: `"$2,995"`, `"$2,722+"`, `"1,024 sqft"`, `2600`.
 *
 * Deliberately not `extractNumber`, which reads German formatting and takes the comma in `2,995`
 * for a decimal separator.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function usNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = /-?\d[\d,]*(?:\.\d+)?/.exec(String(value));
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function toNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
