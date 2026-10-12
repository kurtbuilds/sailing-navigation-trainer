# Sailing Navigation Trainer — run `just` to list recipes.

repo := "kurtbuilds/sailing-navigation-trainer"
site := "https://kurtbuilds.github.io/sailing-navigation-trainer/"

default:
    @just --list

# Install dependencies
install:
    pnpm install

# Run the dev server with hot reload
dev:
    pnpm dev

# Run the rules-engine and generator tests
test:
    pnpm test

# Type-check and build the static site into dist/
build:
    pnpm build

# Serve the production build locally
preview: build
    pnpm preview

# Test, build, and publish dist/ to the gh-pages branch (GitHub Pages serves it)
deploy: test build
    #!/usr/bin/env bash
    set -euo pipefail
    remote=$(git remote get-url origin)
    rev=$(git rev-parse --short HEAD)
    cd dist
    touch .nojekyll
    rm -rf .git
    git init -q -b gh-pages
    git add -A
    git commit -q -m "Deploy ${rev}"
    git push -q -f "${remote}" gh-pages
    rm -rf .git
    echo "Deployed ${rev} -> {{site}} (allow a minute for Pages to update)"

# One-time: point GitHub Pages at the gh-pages branch (safe to re-run)
setup-pages:
    gh api -X POST repos/{{repo}}/pages -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null 2>&1 \
      || gh api -X PUT repos/{{repo}}/pages -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null
    @echo "Pages source: gh-pages -> {{site}}"

# Show the status of the latest Pages build
status:
    gh api repos/{{repo}}/pages/builds/latest --jq '"\(.status)  \(.created_at)  \(.error.message // "")"'

# Open the live site
open:
    open {{site}}
