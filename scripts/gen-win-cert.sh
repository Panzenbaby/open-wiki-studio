#!/usr/bin/env bash
#
# Generates a self-signed Authenticode code-signing certificate for
# "Open Wiki Studio" using OpenSSL (works on macOS, Linux, and
# Windows Git-Bash). Prints the base64-encoded p12 to stdout so you
# can paste it into the GitHub secret WIN_CSC_LINK.
#
# This is the 0-EUR Windows equivalent of the self-signed macOS signing
# identity. The produced certificate is self-signed, so the signed
# binaries are Authenticode-signed but Windows SmartScreen still shows
# "Unknown publisher" until reputation is built up. Real OV/EV
# certificates (~100-200 USD/year) would be required to avoid that —
# intentionally out of scope here.
#
# Why OpenSSL and not PowerShell New-SelfSignedCertificate:
#   New-SelfSignedCertificate is a Windows-only cmdlet (Windows PKI
#   module). OpenSSL runs everywhere and produces a p12 with the
#   Authenticode Code Signing EKU (1.3.6.1.5.5.7.3.3) that signtool
#   accepts. The end result is equivalent.
#
# Usage:
#   bash scripts/gen-win-cert.sh
#
# Then create two GitHub repository secrets:
#   WIN_CSC_LINK          <- the printed base64 line (---- WIN_CSC_LINK ----)
#   WIN_CSC_KEY_PASSWORD  <- the password you entered at the prompt
#
# The certificate is NOT committed. No secrets are written to the
# repository by this script.

set -euo pipefail

SUBJECT="Open Wiki Studio"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

read -rsp "Export password for p12 (this becomes WIN_CSC_KEY_PASSWORD): " PASSWORD
echo
echo

KEY="$TMP/ows.key"
CERT="$TMP/ows.crt"
P12="$TMP/ows.p12"
CNF="$TMP/ows.cnf"

# Single config so this also works on LibreSSL (macOS system openssl)
# which lacks the -addext flag.
cat > "$CNF" <<EOF
[req]
distinguished_name = req_dn
prompt = no
[req_dn]
CN = $SUBJECT
[v3_cs]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
EOF

echo "Generating 4096-bit RSA key + self-signed code-signing certificate (5y)..."
openssl req -x509 -newkey rsa:4096 -sha256 -days 1825 \
    -keyout "$KEY" -out "$CERT" \
    -config "$CNF" \
    -extensions v3_cs \
    -nodes 2>/dev/null

# Confirm the Code Signing EKU is present.
EKU="$(openssl x509 -in "$CERT" -noout -text)"
if ! printf '%s' "$EKU" | grep -qi 'Code Signing'; then
    echo "ERROR: certificate is missing the Code Signing EKU — aborting." >&2
    exit 1
fi
echo "Verified: Extended Key Usage = Code Signing"

# Package cert + private key into a p12 protected by the password.
openssl pkcs12 -export -out "$P12" \
    -inkey "$KEY" -in "$CERT" \
    -name "$SUBJECT" \
    -passout pass:"$PASSWORD" 2>/dev/null

B64="$(openssl base64 -A -in "$P12")"

echo
echo "---- WIN_CSC_LINK (base64, single line) ----"
echo "$B64"
echo "---- end ----"
echo
echo "WIN_CSC_KEY_PASSWORD = the password you entered above."
echo
echo "Copy the base64 line (without the ---- markers) into the GitHub"
echo "secret WIN_CSC_LINK, and the password into WIN_CSC_KEY_PASSWORD."