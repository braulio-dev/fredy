/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// US/MX support added in the braulio-dev/fredy fork of Fredy.

/**
 * The UI half of `lib/utils/region.js`: which currency and area unit to show. Chosen at build time
 * with `VITE_FREDY_REGION` (the Docker build sets it from the `FREDY_REGION` build arg). Unset means
 * `de`, upstream Fredy's euros and square metres.
 */

const REGIONS = Object.freeze({
  de: Object.freeze({ id: 'de', currency: 'EUR', areaUnit: 'm²', symbolFirst: false, symbol: '€' }),
  us: Object.freeze({ id: 'us', currency: 'USD', areaUnit: 'sq ft', symbolFirst: true, symbol: '$' }),
});

/**
 * @param {string|undefined} value
 * @returns {typeof REGIONS.de}
 */
export function resolveRegion(value) {
  return (
    REGIONS[
      String(value ?? '')
        .trim()
        .toLowerCase()
    ] ?? REGIONS.de
  );
}

let configured;
try {
  configured = import.meta.env?.VITE_FREDY_REGION;
} catch {
  configured = undefined;
}

export const region = resolveRegion(configured);

/**
 * `1.000 €` or `$1,000`.
 *
 * @param {string|number} amount Already formatted.
 * @returns {string}
 */
export function withCurrencySymbol(amount) {
  return region.symbolFirst ? `${region.symbol}${amount}` : `${amount} ${region.symbol}`;
}

/**
 * Props for a Semi `InputNumber` that shows the currency on the side the region writes it.
 *
 * @returns {{prefix: string}|{suffix: string}}
 */
export function currencyAffix() {
  return region.symbolFirst ? { prefix: region.symbol } : { suffix: region.symbol };
}

/**
 * Rewrites a translation string's euro signs and square metres for the configured region. Applied
 * once to every loaded locale, so the JSON files stay upstream's.
 *
 * @param {string} text
 * @returns {string}
 */
export function localizeUnits(text) {
  if (region.id === 'de' || typeof text !== 'string') return text;
  return text.replace(/€/g, region.symbol).replace(/m²/g, region.areaUnit);
}
