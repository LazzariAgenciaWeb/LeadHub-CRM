#!/bin/bash
export PATH="/usr/local/bin:$PATH"
# Sobe o dev server a partir da pasta do próprio script — antes o caminho era
# fixo e apontava pro snapshot no Google Drive, então `npm run dev` rodava
# código velho sem avisar.
cd "$(dirname "$0")"
exec npm run dev
