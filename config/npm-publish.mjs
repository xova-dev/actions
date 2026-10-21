import { fileURLToPath } from 'node:url'

export default {
  git: false,
  github: false,
  gitlab: false,
  hooks: false,
  npm: {
    publishPath: process.env.TARBALL,
    tag: process.env.NPM_TAG,
    skipChecks: true,
    publishArgs: ['--access', 'public', '--provenance', '--ignore-scripts'],
  },
  plugins: { [fileURLToPath(new URL('../lib/npm-release.mjs', import.meta.url))]: {} },
}
