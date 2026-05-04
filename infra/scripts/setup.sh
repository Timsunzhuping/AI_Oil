#!/bin/bash

set -e

echo "FluidMind Platform Setup Script"
echo "==============================="

# Check for pnpm
if ! command -v pnpm &> /dev/null; then
  echo "Installing pnpm..."
  npm install -g pnpm
fi

echo "Installing dependencies..."
pnpm install

echo "Building packages..."
pnpm build

echo "Checking TypeScript..."
pnpm type-check

echo "Linting code..."
pnpm lint

echo "Setup completed successfully!"
echo ""
echo "Next steps:"
echo "  - Copy .env.example to .env and configure"
echo "  - Run 'docker-compose up' to start services"
echo "  - Or run 'pnpm dev' to start in development mode"
