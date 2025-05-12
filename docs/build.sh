#! /bin/bash

set -euo pipefail

echo '<!DOCTYPE html><html lang="en">' > docs/index.html
cat docs/head.html >> docs/index.html
bun run marked --gfm < README.md >> docs/index.html
cat docs/tail.html >> docs/index.html
echo '</html>' >> docs/index.html