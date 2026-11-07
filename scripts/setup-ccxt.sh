#!/usr/bin/env bash
# Optionally add the team's CCXT fork as a git submodule for reference.
# Hyper does not vendor the CCXT tree by default. Install the Python package instead:
#   pip install -r requirements.txt
# Exchange connectors in vendor/ccxt are CCXT code, not Hyper product code.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
url="https://github.com/dailyfundeyt-crypto/ccxt.git"
dest="vendor/ccxt"
if [[ -e "$dest" ]]; then
  echo "$dest already exists"
  exit 0
fi
git submodule add "$url" "$dest"
echo "Added $dest from $url for reference only."
echo "Upstream MIT source: https://github.com/ccxt/ccxt"
