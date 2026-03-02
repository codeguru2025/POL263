#!/bin/bash
# Run this on your VPS (Ubuntu/Debian) to install and configure PostgreSQL for POL263.
# Usage: sudo POL263_DB_PASSWORD='your_password' ./script/setup-postgres-vps.sh
# Or:    export POL263_DB_PASSWORD='your_password'; sudo -E ./script/setup-postgres-vps.sh

set -e

if [ -z "$POL263_DB_PASSWORD" ]; then
  echo "Error: Set the database password first:"
  echo "  export POL263_DB_PASSWORD='YourSecurePassword123'"
  echo "  sudo -E ./script/setup-postgres-vps.sh"
  echo ""
  echo "Or in one line:"
  echo "  sudo POL263_DB_PASSWORD='YourSecurePassword123' ./script/setup-postgres-vps.sh"
  exit 1
fi

echo "Installing PostgreSQL..."
apt-get update -qq
apt-get install -y postgresql postgresql-contrib

echo "Starting PostgreSQL..."
systemctl start postgresql
systemctl enable postgresql

echo "Creating database and user..."
# Escape single quotes in password for use in SQL
SAFE_PASS=$(echo "$POL263_DB_PASSWORD" | sed "s/'/''/g")
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '"$SAFE_PASS"';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE pol263;" 2>/dev/null || echo "Database pol263 already exists."

echo ""
echo "PostgreSQL is ready."
echo ""
echo "Use this in your .env on the VPS:"
echo "  DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/pol263"
echo ""
echo "Replace YOUR_PASSWORD with the same password you set for POL263_DB_PASSWORD."
echo ""
