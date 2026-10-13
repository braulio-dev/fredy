/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Live smoke test for the fork's US/MX providers. Usage:
//   node tools/us/smoke.mjs <providerId> <searchUrl> [--raw]
// Prints how many listings came back and the first few normalised ones.

const [, , id, url, flag] = process.argv;
if (!id || !url) {
  console.error('usage: node tools/us/smoke.mjs <providerId> <searchUrl> [--raw]');
  process.exit(2);
}
const provider = await import(`../../lib/provider/${id}.js`);
const cfg = provider.createConfig({ url, enabled: true }, []);
const started = Date.now();
const raw = await cfg.getListings(url);
const listings = raw.map(cfg.normalize).filter(cfg.filter);
console.log(`${id}: ${raw.length} raw, ${listings.length} kept in ${Date.now() - started} ms`);
const missing = {};
for (const l of listings) for (const f of cfg.requiredFieldNames) if (l[f] == null) missing[f] = (missing[f] || 0) + 1;
console.log('missing fields:', JSON.stringify(missing));
for (const l of listings.slice(0, 4)) {
  console.log(JSON.stringify(flag === '--raw' ? l : { ...l, description: l.description?.slice(0, 80) }));
}
