const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
const files = [
  'index.html',
  'about.html',
  'affiliate.html',
  'cookies.html',
  'privacy.html',
  'terms.html',
  'favicon.svg',
  'manifest.json',
  'opendomain-share-image.png',
  'webapp-icon.png',
];

// Recreate only the generated output directory, so stale files cannot be served.
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output);
for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
console.log(`Prepared ${files.length} public files.`);
