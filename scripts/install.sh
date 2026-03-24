#!/bin/bash
set -euo pipefail

# Butter installer
# Usage: curl -fsSL https://raw.githubusercontent.com/wess/butter/main/scripts/install.sh | bash

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

info() { echo -e "${BOLD}$1${NC}"; }
success() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
error() { echo -e "${RED}$1${NC}" >&2; }

# Check for Bun
if ! command -v bun &> /dev/null; then
    error "Bun is required but not installed."
    echo ""
    info "Install Bun first:"
    echo "  curl -fsSL https://bun.sh/install | bash"
    echo ""
    exit 1
fi

BUN_VERSION=$(bun --version)
info "Found Bun v${BUN_VERSION}"

# Install Butter globally via Bun
info "Installing Butter..."
bun add -g butterframework

# Verify installation
if command -v butter &> /dev/null; then
    echo ""
    success "Butter installed successfully!"
    echo ""
    butter doctor
    echo ""
    info "Get started:"
    echo "  butter init myapp"
    echo "  cd myapp"
    echo "  bun install"
    echo "  bun run dev"
else
    error "Installation failed. Try installing manually:"
    echo "  bun add -g butterframework"
    exit 1
fi
