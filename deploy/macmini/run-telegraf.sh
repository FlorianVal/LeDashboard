#!/bin/zsh
set -euo pipefail

readonly CREDENTIALS_FILE="/Users/florianvalade/homelab/telegraf/credentials.env"

if [[ ! -f "${CREDENTIALS_FILE}" ]]; then
  print -u2 "Missing Telegraf credentials: ${CREDENTIALS_FILE}"
  exit 1
fi

if [[ "$(stat -f '%Lp' "${CREDENTIALS_FILE}")" != "600" ]]; then
  print -u2 "Telegraf credentials must have mode 600: ${CREDENTIALS_FILE}"
  exit 1
fi

set -a
source "${CREDENTIALS_FILE}"
set +a

exec /opt/homebrew/bin/telegraf \
  --config /Users/florianvalade/homelab/telegraf/telegraf.conf
