#!/bin/sh
# Dumb corepack reimplementation. Workaround for chicken-and-egg
# problem of RH HI not including corepack or pnpm.
#
# Expected format: "pnpm@<version>+<algo>.<hex-digest>"
# Example: "pnpm@10.33.4+sha512.1c67b3b3..."
#
# Usage: install-pnpm.sh <path-to-package.json>
set -eu

PKG_JSON=${1:-./package.json}
case "$PKG_JSON" in /*|./*|../*) ;; *) PKG_JSON="./$PKG_JSON" ;; esac

PM=$(node -p "require('$PKG_JSON').packageManager")
case "$PM" in
  pnpm@*+*) ;;
  *)
    echo "install-pnpm: expected packageManager='pnpm@<version>+<algo>.<digest>', got: $PM" >&2
    exit 1
    ;;
esac

SPEC=${PM#pnpm@}            # 10.33.4+sha512.1c67...
VERSION=${SPEC%%+*}         # 10.33.4
HASH=${SPEC#*+}             # sha512.1c67...
ALGO=${HASH%%.*}            # sha512
EXPECTED=${HASH#*.}         # 1c67...

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
TGZ=$(npm pack "pnpm@$VERSION" --silent)

ACTUAL=$(node -e "
const fs = require('fs');
const crypto = require('crypto');
console.log(crypto.createHash('$ALGO').update(fs.readFileSync('$TGZ')).digest('hex'));
")

if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "install-pnpm: $ALGO mismatch for pnpm@$VERSION" >&2
  echo "  expected: $EXPECTED" >&2
  echo "  actual:   $ACTUAL" >&2
  exit 1
fi

npm install -g "./$TGZ"
