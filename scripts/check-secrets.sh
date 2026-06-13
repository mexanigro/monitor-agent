#!/usr/bin/env bash
# Scan staged (or all tracked) files for potential secrets before committing.
#
# Usage:
#   bash scripts/check-secrets.sh           # scan all tracked files
#   bash scripts/check-secrets.sh --staged  # scan only staged changes (for pre-commit use)
#
# To install as a git pre-commit hook:
#   cp scripts/check-secrets.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
set -euo pipefail

STAGED_ONLY=false
[[ "${1:-}" == "--staged" ]] && STAGED_ONLY=true

echo "[secrets-check] Scanning for exposed secrets..."

if command -v gitleaks &>/dev/null; then
  if $STAGED_ONLY; then
    gitleaks protect --staged --redact --no-git
  else
    gitleaks detect --source . --redact
  fi
  echo "[secrets-check] gitleaks: no secrets detected."
  exit 0
fi

if command -v detect-secrets &>/dev/null; then
  echo "[secrets-check] Using detect-secrets..."
  if $STAGED_ONLY; then
    git diff --cached | detect-secrets scan --stdin-type git_diff
  else
    detect-secrets scan . | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('results', {})
if results:
    for path, findings in results.items():
        for f in findings:
            print(f'  POTENTIAL SECRET: {path}:{f[\"line_number\"]}')
    sys.exit(1)
"
  fi
  echo "[secrets-check] detect-secrets: no secrets detected."
  exit 0
fi

echo "[secrets-check] WARNING: neither gitleaks nor detect-secrets is installed."
echo "  Install gitleaks (recommended): https://github.com/gitleaks/gitleaks"
echo "  Or:  pip install detect-secrets"
echo ""
echo "[secrets-check] Falling back to basic regex scan on staged diff..."

PATTERNS=(
  "BEGIN (RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY"
  "sk-ant-api"
  "ghp_[0-9A-Za-z]{36}"
  "AKIA[0-9A-Z]{16}"
  "postgresql://[^:]+:[^@]+@"
  "mysql://[^:]+:[^@]+@"
)

FOUND=0
DIFF=$(git diff --cached --unified=0 2>/dev/null || git diff HEAD --unified=0 2>/dev/null || true)

for pattern in "${PATTERNS[@]}"; do
  if echo "$DIFF" | grep -E "^\+.*$pattern" &>/dev/null; then
    echo "  BLOCKED — potential secret pattern matched: $pattern"
    FOUND=1
  fi
done

if [[ $FOUND -eq 1 ]]; then
  echo "[secrets-check] Commit aborted. Review the diff and ensure no secrets are staged."
  exit 1
fi

echo "[secrets-check] Basic scan passed. Install gitleaks for thorough coverage."
exit 0
