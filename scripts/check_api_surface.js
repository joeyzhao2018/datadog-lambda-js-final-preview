'use strict'

// Fails if the packed package stops exporting anything api-surface.json pins.
// Runs against dist/, i.e. what customers actually resolve — not against src/.

const assert = require('node:assert/strict')
const path = require('node:path')

const expected = require(path.join(__dirname, '..', 'api-surface.json'))
const actual = require(path.join(__dirname, '..', 'dist', 'index.js'))

const problems = []

for (const [name, type] of Object.entries(expected.exports)) {
  const found = typeof actual[name]
  if (found === 'undefined') {
    problems.push(`MISSING export "${name}" (expected ${type})`)
  } else if (found !== type) {
    problems.push(`export "${name}" changed type: ${type} -> ${found}`)
  }
}

for (const name of Object.keys(expected.intentionallyRemoved)) {
  if (name in actual) {
    problems.push(`export "${name}" is back, but api-surface.json records it as removed`)
  }
}

if (problems.length > 0) {
  console.error('API surface check failed:\n' + problems.map((p) => '  - ' + p).join('\n'))
  process.exit(1)
}

const added = Object.keys(actual).filter((name) => !(name in expected.exports))
if (added.length > 0) {
  console.log(`note: ${added.length} export(s) added since the pin: ${added.join(', ')}`)
}

assert.ok(Object.keys(expected.exports).length > 0)
console.log(`API surface OK: ${Object.keys(expected.exports).length} exports verified against dist/`)
