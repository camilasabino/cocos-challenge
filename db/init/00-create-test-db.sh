#!/bin/bash
# Creates the isolated `cocos_test` database with the schema only (no demo data).
# Runs before 01-schema.sql / 02-demo-seed.sql, which target the default
# database (`cocos`), so this script applies the schema to the test DB itself.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -c 'CREATE DATABASE cocos_test'

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname cocos_test \
  -f /docker-entrypoint-initdb.d/01-schema.sql
