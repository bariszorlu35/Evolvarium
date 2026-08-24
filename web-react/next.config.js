const path = require('path')

// The site is served at bariszorlu.com/Evolvarium, proxied there from this
// app's own Vercel deployment. `basePath` has to match the sub-path the
// visitor actually sees, otherwise the client bundle would ask for /_next/...
// and hit the parent site instead of this one. It is inlined at build time,
// so it is also exported to the client for the handful of URLs Next does not
// prefix on its own — plain fetch() calls and metadata assets, mainly.
const basePath = '/Evolvarium'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // the repo root sits above this app; pin the workspace so Turbopack does not
  // walk up into ~/ looking for a lockfile
  turbopack: { root: __dirname },
}

module.exports = nextConfig
