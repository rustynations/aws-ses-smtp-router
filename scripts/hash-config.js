#!/usr/bin/env node
const { createHash } = require('crypto');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const configPath = join(__dirname, '..', 'config.json');
const hashPath = `${configPath}.sha256`;

const config = readFileSync(configPath, 'utf-8');
const hash = createHash('sha256').update(config).digest('hex');

writeFileSync(hashPath, hash);
console.log(`SHA-256: ${hash}`);
console.log(`Written to: ${hashPath}`);
