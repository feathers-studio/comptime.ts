#! /bin/bash

set -euo pipefail

printf '<!DOCTYPE html>\n<html lang="en">\n' > docs/index.html
cat docs/head.html >> docs/index.html
printf '<body>\n<main>\n' >> docs/index.html
npx -y marked --gfm < README.md | sed 's/ERRORS\.md/\.\/errors/' >> docs/index.html
printf '</main>\n' >> docs/index.html
cat docs/tail.html >> docs/index.html
printf '</body>\n</html>\n' >> docs/index.html

printf '<!DOCTYPE html>\n<html lang="en">\n' > docs/errors.html
cat docs/head.html | sed 's/<title>.*<\/title>/<title>List of comptime.ts errors<\/title>/' >> docs/errors.html
printf '<body>\n<main>\n' >> docs/errors.html
npx -y marked --gfm < ERRORS.md >> docs/errors.html
printf '</main>\n' >> docs/errors.html
cat docs/tail.html >> docs/errors.html
printf '</body>\n</html>\n' >> docs/errors.html
