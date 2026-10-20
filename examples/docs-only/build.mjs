import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('_site', { recursive: true })
writeFileSync('_site/index.html', '<!doctype html><title>Documentation</title><h1>Documentation</h1>\n')
mkdirSync('_site/.well-known', { recursive: true })
writeFileSync('_site/.well-known/security.txt', 'Contact: mailto:security@example.invalid\n')
