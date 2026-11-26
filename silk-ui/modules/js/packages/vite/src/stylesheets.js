import { compileStylesheet } from './compiler.js';
import { reportDropped, standardize } from './report.js';

const CSS = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
const marker = /[?&]silk-sheet(?:&|$)/;
const passthrough = /[?&](?:inline|raw|url|direct|silk-css-module)(?:&|$)/;
const virtualPrefix = '\0silk:stylesheet:';

export function stylesheetDevPlugin({ strict = false } = {}) {
  const sources = new Map();
  let server;
  return [{
    name: 'silk:stylesheet-dev',
    apply: 'serve',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (this.environment.name !== 'silk' || !CSS.test(source) || passthrough.test(source) || marker.test(source)) return;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved || resolved.external) return;
      const id = virtualPrefix + Buffer.from(resolved.id).toString('base64url') + '.js';
      sources.set(id, resolved.id);
      return id;
    },
    load(id) {
      const source = sources.get(id);
      if (!source) return;
      const join = source.includes('?') ? '&' : '?';
      const inline = source + join + 'inline&silk-sheet';
      const key = JSON.stringify(source);
      const dependency = JSON.stringify(inline);
      const modules = /\.module\./.test(source)
        ? `export { default } from ${JSON.stringify(source + join + 'silk-css-module')};\nexport * from ${JSON.stringify(source + join + 'silk-css-module')};`
        : 'export default {};';
      return `import compiled from ${dependency};
import { updateStyleSheet } from '@silkui/core';
updateStyleSheet(${key}, compiled);
${modules}
if (import.meta.hot) {
  import.meta.hot.accept(${dependency}, updated => { if (updated) updateStyleSheet(${key}, updated.default); });
  import.meta.hot.prune(() => updateStyleSheet(${key}, null));
}`;
    },
  }, {
    name: 'silk:stylesheet-compile',
    configureServer(value) { server = value; },
    apply: 'serve',
    enforce: 'post',
    transform(code, id) {
      if (this.environment.name !== 'silk' || !marker.test(id)) return;
      const ast = this.parse(code);
      const expression = ast.body.find(node => node.type === 'ExportDefaultDeclaration')?.declaration;
      if (expression?.type !== 'Literal' || typeof expression.value !== 'string') {
        this.error('The CSS processor did not produce an inline stylesheet');
      }
      let result;
      try {
        result = compileStylesheet(standardize(expression.value), { strict, resolveUrl(url) {
          if (!url) return url;
          const origin = server?.config.server.origin ?? server?.resolvedUrls?.local[0] ?? server?.resolvedUrls?.network[0];
          try { return new URL(url, origin).href; }
          catch { throw new Error('Font URLs need a Vite server origin; set server.origin when using middleware mode'); }
        } });
      }
      catch (error) {
        const dropped = error.diagnostics?.map(item => `${item.kind}: ${item.feature} (${item.count})`).join("\n");
        this.error(error.message + (dropped ? `\n${dropped}` : ""));
      }
      reportDropped(message => this.warn(message), result.diagnostics);
      return { code: `export default ${JSON.stringify(Buffer.from(result.bytes).toString('base64'))};`, map: { mappings: '' } };
    },
  }];
}
