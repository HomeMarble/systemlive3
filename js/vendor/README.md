# Supabase browser client

`supabase-2.119.0.js` is the unmodified `package/dist/umd/supabase.js` from the
published npm package `@supabase/supabase-js@2.119.0`. The upstream MIT license
is in `supabase-LICENSE.txt`. It is served from the same Pages origin as the ERP;
login does not fetch executable code from a third-party CDN.

To reproduce, use `npm pack @supabase/supabase-js@2.119.0` in a temporary
directory and extract the bundle and `package/LICENSE`. Bundle SHA-256:
`a867edbcfb029370aeec7223dd6180b560b621fbe3bc64c6584fb0369d1b7bce`.
For an upgrade, change the versioned filename in `index.html`, verify the new
upstream license/hash and run `npm ci && npm test` before publishing. These
tests cover method-specific retries with the actual bundled SDK and fake HTTP.
