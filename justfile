set quiet

# Purview-Dev website — cross-platform task runner.
# Requires: Bun (>= 1.4.2), Just (>= 1.30). All heavy lifting lives in Bun scripts.

set shell := ["sh", "-cu"]
set windows-shell := ["pwsh", "-NoProfile", "-Command"]

[private]
default:
    just --list

# Install dependencies and install Git hooks.
install:
    bun install
    bunx lefthook install

# Install only the Git hooks.
install-hooks:
    bunx lefthook install

# Refresh docs mirrors and release data (cache-first).
data-sync:
    bun run data:sync

# Refresh docs mirrors and release data (live mode).
[env("DATA_MODE", "live")]
live-data-sync:
    bun run data:sync

# Start the dev server (runs data sync first so docs are available).
dev:
    bun run data:sync
    bun run dev

# Format all supported files and auto-fix lint issues.
format:
    bun run format
    bun run lint:fix

# Verify formatting without modifying files.
format-check:
    bun run format:check

# Lint all files.
lint:
    bun run lint

# Type-check the project (Astro check + strict TypeScript).
typecheck:
    bun run data:sync
    bun run typecheck

# Run the deterministic unit test suite.
test:
    bun run test

# Assert the built output (llms files, sitemap, robots, no secrets).
test-dist:
    bun run test:dist

# Produce a production build (runs data sync first).
build: live-data-sync
    bun run build

# Full CI validation chain used by the shared build pipeline (data sync → typecheck → build → checks).
ci-build:
    bun run ci:build

# Preview the production build locally.
preview:
    bun run preview

# Validate branding sources and generated public assets.
check-assets:
    bun run check:assets

# Validate internal links across the built site.
check-links:
    bun run check:links

# Validate generated data mirrors and caches are current and well-formed.
check-generated:
    bun run check:generated

# Refresh release data from live GitHub/NuGet sources.
fetch-releases:
    bun run fetch:releases

# Rebuild committed test fixtures from live sources.
refresh-fixtures:
    bun run refresh:fixtures

# Remove build output, caches, and generated mirrors.
clean:
    bun run clean

# Authoritative validation: run everything needed to prove the site is safe to merge.
validate: format-check lint typecheck test check-assets build check-links check-generated test-dist
    @echo "Validation passed."
