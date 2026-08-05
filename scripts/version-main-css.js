const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const styleInputs = [
  '_config.next.yml',
  'source/_data/styles.styl'
];

const hash = crypto.createHash('sha256');
for (const input of styleInputs) {
  hash.update(fs.readFileSync(path.join(hexo.base_dir, input)));
}

const assetVersion = hash.digest('hex').slice(0, 10);

hexo.extend.filter.register('after_render:html', html => {
  return html.replace(
    /(\/css\/main\.css)(?=["'])/g,
    `$1?v=${assetVersion}`
  );
});
