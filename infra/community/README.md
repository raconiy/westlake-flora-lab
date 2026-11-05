# Shared community API

worker/index.js is a dependency-free Cloudflare Worker. Bind a D1 database as DB, apply the checked-in Drizzle migration, and configure COMMUNITY_RELAY_TOKEN as a server-side secret. Never put this secret into the public frontend.

The existing hosted deployment is operated through Sites. These files are a sanitized source export, not credentials or ownership of that deployment. Each independent deployment must provision its own identity, database and secret. Keep the GitHub Pages frontend API base and both origin allowlists consistent when changing hosts.

Test with Node 24: `node --test infra/community/test/community.test.mjs` from the repository root.
