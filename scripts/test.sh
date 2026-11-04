#!/usr/bin/env bash
#
# npm test: the full suite against a throwaway data dir.
#
#   npm test                                   # every test file
#   npm test -- --test-name-pattern=profile    # extra node:test flags
#
# `npm run dev` keeps its records in the repo's data/. Once a profile
# exists there (data/users.json), learner paths need a signed-in profile,
# so tests that write the default data dir would refuse. The suite gets
# its own LH_DATA_DIR, removed when it exits. Tests that set LH_DATA_DIR
# themselves still win.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lh-test-XXXXXX")"
trap 'rm -rf "$DATA_DIR"' EXIT

export LH_DATA_DIR="$DATA_DIR"
# NODE_ENV=test keeps this suite on the throwaway directory.
# Hosted runs with MONGODB_URI use the learner-records collection unless LH_STORE=file.
export NODE_ENV=test

cd "$ROOT"
# product-tour-mount.test.tsx mocks next/navigation and nextstepjs. That API
# is still behind Node's experimental test-module-mocks flag, which NODE_OPTIONS
# refuses, so the suite invokes node with the flag instead of the tsx wrapper.
node --experimental-test-module-mocks --disable-warning=ExperimentalWarning --import tsx --test tests/*.test.ts tests/*.test.tsx "$@"
