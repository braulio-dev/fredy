#!/usr/bin/env bash
# Runs the live smoke test against a handful of San Diego / Tijuana searches.
cd "$(dirname "$0")/../.."
run() { echo "=== $1  $2"; timeout 90 node tools/us/smoke.mjs "$@" 2>&1 | tail -8; }
run craigslist 'https://sandiego.craigslist.org/search/apa?max_price=3500&min_bedrooms=1'
run craigslist 'https://tijuana.craigslist.org/search/apa'
run craigslist 'https://sandiego.craigslist.org/search/rea?max_price=900000'
run redfin 'https://www.redfin.com/city/16904/CA/San-Diego/apartments-for-rent/filter/max-price=3k,min-beds=1'
run redfin 'https://www.redfin.com/city/16904/CA/San-Diego/filter/max-price=900k,min-beds=2'
run redfin 'https://www.redfin.com/neighborhood/4519/CA/San-Diego/North-Park/apartments-for-rent'
run zillow 'https://www.zillow.com/san-diego-ca/rentals/'
run zillow 'https://www.zillow.com/san-diego-ca/'
