#! /bin/bash

set -euo pipefail

echo '<!DOCTYPE html><html lang="en">' > docs/index.html
cat docs/head.html >> docs/index.html
bun run marked --gfm < README.md | sed 's/ERRORS\.md/\.\/errors/' >> docs/index.html
cat docs/tail.html >> docs/index.html
echo '</html>' >> docs/index.html

echo '<!DOCTYPE html><html lang="en">' > docs/errors.html
cat docs/head.html | sed 's/<title>.*<\/title>/<title>List of comptime.ts errors<\/title>/' >> docs/errors.html
bun run marked --gfm < ERRORS.md >> docs/errors.html
cat docs/tail.html >> docs/errors.html
echo '</html>' >> docs/errors.html
