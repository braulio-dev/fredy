/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// US/MX support added in the braulio-dev/fredy fork of Fredy.

/**
 * Which currency and area unit this installation reports in, chosen once at startup with the
 * `FREDY_REGION` environment variable.
 *
 * `de` (the default) is upstream Fredy's behaviour - euros, square metres, German number
 * formatting - so an unset variable changes nothing. `us` switches notifications and other
 * server-rendered text to dollars and square feet; the UI follows the same choice through
 * `VITE_FREDY_REGION`, which the Docker build sets from the same value.
 *
 * Only presentation changes. Prices and sizes are stored as the plain numbers each provider
 * reports, so a US provider's `size` is square feet whatever the region says.
 */

const REGIONS = Object.freeze({
  de: Object.freeze({ id: 'de', currency: 'EUR', locale: 'de-DE', areaUnit: 'm²', symbolFirst: false, symbol: '€' }),
  us: Object.freeze({ id: 'us', currency: 'USD', locale: 'en-US', areaUnit: 'sq ft', symbolFirst: true, symbol: '$' }),
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

export const region = resolveRegion(process.env.FREDY_REGION);

/**
 * Puts the currency symbol on an already formatted amount the way the region writes it:
 * `1.000 €` or `$1,000`.
 *
 * @param {string} amount
 * @param {typeof REGIONS.de} [r]
 * @returns {string}
 */
export function withCurrencySymbol(amount, r = region) {
  return r.symbolFirst ? `${r.symbol}${amount}` : `${amount} ${r.symbol}`;
}
