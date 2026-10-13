/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Fork: FREDY_REGION switches presentation between upstream's euros/m² and dollars/sq ft.

import { describe, it, expect } from 'vitest';
import { resolveRegion, withCurrencySymbol, region } from '../../lib/utils/region.js';

describe('region', () => {
  it('defaults to upstream behaviour', () => {
    expect(resolveRegion(undefined).currency).toBe('EUR');
    expect(resolveRegion('nonsense').areaUnit).toBe('m²');
    expect(region.id).toBe('de');
  });

  it('switches to dollars and square feet for us', () => {
    const us = resolveRegion(' US ');
    expect(us).toMatchObject({ currency: 'USD', areaUnit: 'sq ft', locale: 'en-US' });
    expect(withCurrencySymbol('1,000', us)).toBe('$1,000');
    expect(withCurrencySymbol('1.000', resolveRegion('de'))).toBe('1.000 €');
  });
});
