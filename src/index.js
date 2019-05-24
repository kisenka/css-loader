/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
const validateOptions = require('schema-utils');
const postcss = require('postcss');
const postcssPkg = require('postcss/package.json');
const localByDefault = require('postcss-modules-local-by-default');
const extractImports = require('postcss-modules-extract-imports');
const modulesScope = require('postcss-modules-scope');
const modulesValues = require('postcss-modules-values');

const {
  getOptions,
  isUrlRequest,
  urlToRequest,
  getRemainingRequest,
  getCurrentRequest,
  stringifyRequest,
} = require('loader-utils');
const camelCase = require('lodash/camelCase');

const schema = require('./options.json');
const { importParser, icssParser, urlParser } = require('./plugins');
const {
  getLocalIdent,
  getImportPrefix,
  placholderRegExps,
  dashesCamelCase,
  getFilter,
} = require('./utils');
const Warning = require('./Warning');
const CssSyntaxError = require('./CssSyntaxError');

function loader(content, map, meta) {
  const options = getOptions(this) || {};

  validateOptions(schema, options, 'CSS Loader');

  const callback = this.async();
  const sourceMap = options.sourceMap || false;

  /* eslint-disable no-param-reassign */
  if (sourceMap) {
    if (map) {
      if (typeof map === 'string') {
        map = JSON.stringify(map);
      }

      if (map.sources) {
        map.sources = map.sources.map((source) => source.replace(/\\/g, '/'));
        map.sourceRoot = '';
      }
    }
  } else {
    // Some loaders (example `"postcss-loader": "1.x.x"`) always generates source map, we should remove it
    map = null;
  }
  /* eslint-enable no-param-reassign */

  // Reuse CSS AST (PostCSS AST e.g 'postcss-loader') to avoid reparsing
  if (meta) {
    const { ast } = meta;

    if (ast && ast.type === 'postcss' && ast.version === postcssPkg.version) {
      // eslint-disable-next-line no-param-reassign
      content = ast.root;
    }
  }

  const plugins = [];

  if (options.modules) {
    const loaderContext = this;
    const mode =
      typeof options.modules === 'boolean' ? 'local' : options.modules;

    plugins.push(
      modulesValues,
      localByDefault({ mode }),
      extractImports(),
      modulesScope({
        generateScopedName: function generateScopedName(exportName) {
          const localIdentName = options.localIdentName || '[hash:base64]';
          const customGetLocalIdent = options.getLocalIdent || getLocalIdent;

          return customGetLocalIdent(
            loaderContext,
            localIdentName,
            exportName,
            {
              regExp: options.localIdentRegExp,
              hashPrefix: options.hashPrefix || '',
              context: options.context,
            }
          );
        },
      })
    );
  }

  if (options.import !== false) {
    plugins.push(
      importParser({
        filter: getFilter(options.import, this.resourcePath),
      })
    );
  }

  if (options.url !== false) {
    plugins.push(
      urlParser({
        filter: getFilter(options.url, this.resourcePath, (value) =>
          isUrlRequest(value)
        ),
      })
    );
  }

  plugins.push(icssParser());

  postcss(plugins)
    .process(content, {
      // we need a prefix to avoid path rewriting of PostCSS
      from: `/css-loader!${getRemainingRequest(this)
        .split('!')
        .pop()}`,
      to: getCurrentRequest(this)
        .split('!')
        .pop(),
      map: options.sourceMap
        ? {
            prev: map,
            sourcesContent: true,
            inline: false,
            annotation: false,
          }
        : null,
    })
    .then((result) => {
      result
        .warnings()
        .forEach((warning) => this.emitWarning(new Warning(warning)));

      const messages = result.messages || [];

      // Get plugin from loader context
      // const plugin = this['OptimizeCssModulesPlugin'];

      // if (plugin) {
        // Get CSS parent modules
        // const parents = plugin.getModuleParents(
        //   this._module,
        //   this._compilation
        // );

        // Save final classnames
        // plugin.saveFinalClassNames(
        //   this._module,
        //   parents,
        //   messages
        // );

        // Remove unused selectors
        // const allUsages = plugin.getAllUsages();
        // result.root.walkRules(rule => {
        //   const isRuleUsed = !!allUsages
        //     .find(usage => rule.selector.substr(1) === usage.value);
        //
        //   if (!isRuleUsed) {
        //     rule.remove();
        //   }
        // });
      // }

      // Run other loader (`postcss-loader`, `sass-loader` and etc) for importing CSS
      const importUrlPrefix = getImportPrefix(this, options.importLoaders);

      // Prepare replacer to change from `___CSS_LOADER_IMPORT___INDEX___` to `require('./file.css').locals`
      const importItemReplacer = (placeholder) => {
        const match = placholderRegExps.importItem.exec(placeholder);
        const idx = Number(match[1]);

        const message = messages.find(
          // eslint-disable-next-line no-shadow
          (message) =>
            message.type === 'icss-import' &&
            message.item &&
            message.item.index === idx
        );

        if (!message) {
          return placeholder;
        }

        const { item } = message;
        const importUrl = importUrlPrefix + urlToRequest(item.url);

        if (options.exportOnlyLocals) {
          return `" + require(${stringifyRequest(
            this,
            importUrl
          )})[${JSON.stringify(item.export)}] + "`;
        }

        return `" + require(${stringifyRequest(
          this,
          importUrl
        )}).locals[${JSON.stringify(item.export)}] + "`;
      };

      const exports = messages
        .filter((message) => message.type === 'export')
        .reduce((accumulator, message) => {
          const { key, value } = message.item;

          let valueAsString = JSON.stringify(value);

          valueAsString = valueAsString.replace(
            placholderRegExps.importItemG,
            importItemReplacer
          );

          function addEntry(k) {
            accumulator.push(`\t${JSON.stringify(k)}: ${valueAsString}`);
          }

          let targetKey;

          switch (options.camelCase) {
            case true:
              addEntry(key);
              targetKey = camelCase(key);

              if (targetKey !== key) {
                addEntry(targetKey);
              }
              break;
            case 'dashes':
              addEntry(key);
              targetKey = dashesCamelCase(key);

              if (targetKey !== key) {
                addEntry(targetKey);
              }
              break;
            case 'only':
              addEntry(camelCase(key));
              break;
            case 'dashesOnly':
              addEntry(dashesCamelCase(key));
              break;
            default:
              addEntry(key);
              break;
          }

          return accumulator;
        }, []);

      if (options.exportOnlyLocals) {
        return callback(
          null,
          exports.length > 0
            ? `module.exports = {\n${exports.join(',\n')}\n};`
            : ''
        );
      }

      const imports = messages
        .filter((message) => message.type === 'import')
        .map((message) => {
          const { url } = message.item;
          const media = message.item.media || '';

          if (!isUrlRequest(url)) {
            return `exports.push([module.id, ${JSON.stringify(
              `@import url(${url});`
            )}, ${JSON.stringify(media)}]);`;
          }

          const importUrl = importUrlPrefix + urlToRequest(url);

          return `exports.i(require(${stringifyRequest(
            this,
            importUrl
          )}), ${JSON.stringify(media)});`;
        }, this);

      // let cssAsString = JSON.stringify(result.root.toString()).replace(
      let cssAsString = JSON.stringify(result.css).replace(
        placholderRegExps.importItemG,
        importItemReplacer
      );

      // Helper for ensuring valid CSS strings from requires
      let hasUrlEscapeHelper = false;

      messages
        .filter((message) => message.type === 'url')
        .forEach((message) => {
          if (!hasUrlEscapeHelper) {
            imports.push(
              `var urlEscape = require(${stringifyRequest(
                this,
                require.resolve('./runtime/url-escape.js')
              )});`
            );

            hasUrlEscapeHelper = true;
          }

          const { item } = message;
          const { url, placeholder, needQuotes } = item;
          // Remove `#hash` and `?#hash` from `require`
          const [normalizedUrl, singleQuery, hashValue] = url.split(/(\?)?#/);
          const hash =
            singleQuery || hashValue
              ? `"${singleQuery ? '?' : ''}${hashValue ? `#${hashValue}` : ''}"`
              : '';

          imports.push(
            `var ${placeholder} = urlEscape(require(${stringifyRequest(
              this,
              urlToRequest(normalizedUrl)
            )})${hash ? ` + ${hash}` : ''}${needQuotes ? ', true' : ''});`
          );

          cssAsString = cssAsString.replace(
            new RegExp(placeholder, 'g'),
            () => `" + ${placeholder} + "`
          );
        });

      let newMap = result.map;

      if (sourceMap && newMap) {
        // Add a SourceMap
        newMap = newMap.toJSON();

        if (newMap.sources) {
          newMap.sources = newMap.sources.map(
            (source) =>
              source
                .split('!')
                .pop()
                .replace(/\\/g, '/'),
            this
          );
          newMap.sourceRoot = '';
        }

        newMap.file = newMap.file
          .split('!')
          .pop()
          .replace(/\\/g, '/');
        newMap = JSON.stringify(newMap);
      }

      const runtimeCode = `exports = module.exports = require(${stringifyRequest(
        this,
        require.resolve('./runtime/api')
      )})(${!!sourceMap});\n`;
      const importCode =
        imports.length > 0 ? `// Imports\n${imports.join('\n')}\n\n` : '';
      const moduleCode = `// Module\nexports.push([module.id, ${cssAsString}, ""${
        newMap ? `,${newMap}` : ''
      }]);\n\n`;
      const exportsCode =
        exports.length > 0
          ? `// Exports\nexports.locals = {\n${exports.join(',\n')}\n};`
          : '';

      // Embed runtime
      return callback(
        null,
        runtimeCode + importCode + moduleCode + exportsCode
      );
    })
    .catch((error) => {
      callback(
        error.name === 'CssSyntaxError' ? new CssSyntaxError(error) : error
      );
    });
}

module.exports = loader;
module.exports.default = loader;
