const NAMESPACE = __filename;

const getCssModuleParents = require('./get-css-module-parents');

function getModuleReplaceSource(module, compilation) {
  const webpackVersion = 4;

  const args = [compilation.dependencyTemplates];

  // eslint-disable-next-line no-magic-numbers
  if (webpackVersion <= 3) {
    args.push(compilation.outputOptions);
    args.push(compilation.requestShortener);
  } else if (webpackVersion >= 4) {
    args.push(compilation.runtimeTemplate);
  }

  const cachedSource = module.source(...args);

  return typeof cachedSource.replace === 'function'
    ? cachedSource
    : cachedSource._source;
}

class Plugin {
  constructor() {
    this.cssImports = new Map();
    this.mappings = new Map();
  }

  static getPluginFromLoaderContext(loaderContext) {
    const { _compiler: compiler } = loaderContext;

    const parentCompiler = compiler.isChild()
      ? compiler.parentCompilation.compiler
      : null;

    return parentCompiler
      ? parentCompiler.options.plugins.find(
          (p) => p.NAMESPACE && p.NAMESPACE === NAMESPACE
        )
      : loaderContext[NAMESPACE];
  }

  get NAMESPACE() {
    return NAMESPACE;
  }

  addMapping(module, classes) {
    this.mappings.set(module.request, classes);
  }

  addCssImport(key, data) {
    const existing = this.cssImports.get(key);

    if (!existing) {
      this.cssImports.set(key, [data]);
      return;
    }

    existing.push(data);
  }

  apply(compiler) {
    const { NAMESPACE } = this;

    compiler.hooks.thisCompilation.tap(
      NAMESPACE,
      (compilation, { normalModuleFactory }) => {
        compilation.hooks.normalModuleLoader.tap(NAMESPACE, (loaderCtx) => {
          loaderCtx[NAMESPACE] = this;
        });

        normalModuleFactory.hooks.parser
          .for('javascript/auto')
          .tap(NAMESPACE, this.handler.bind(this));

        compilation.hooks.beforeModuleAssets.tap(NAMESPACE, () => {
          const { mappings, cssImports } = this;

          compilation.modules.forEach((module) => {
            const r = getModuleReplaceSource;

            if (!mappings.has(module.request)) {
              return;
            }

            const mapping = mappings.get(module.request);

            const isExtractPlugin =
              compilation.name &&
              compilation.name.startsWith('mini-css-extract-plugin');

            const modulesToSearchIn = [].concat(
              compilation.modules,
              isExtractPlugin
                ? compilation.compiler.parentCompilation.modules
                : []
            );

            const parents = getCssModuleParents({
              cssModule: module,
              modules: modulesToSearchIn,
              isExtractPlugin,
            });

            parents.forEach((parentModule) => {
              if (!cssImports.has(parentModule.request)) {
                return;
              }

              cssImports.get(parentModule.request).forEach((data) => {
                data.usages
                  .filter((usage) => !!mapping[usage.prop])
                  .forEach((usage) => {
                    const replaceSource = getModuleReplaceSource(
                      parentModule,
                      compilation
                    );

                    const replacement = replaceSource.replacements.find(
                      (r) =>
                        r.start === usage.objectRange[0] &&
                        r.end === usage.objectRange[1] - 1
                    );

                    if (!replacement) {
                      return;
                    }

                    replacement.end = usage.range[1] - 1;
                    replacement.content = JSON.stringify(mapping[usage.prop]);
                    void 0;
                  });
              });
            });
          });
        });
      }
    );

    compiler.hooks.emit.tapAsync(NAMESPACE, (compilation, done) => {
      const { modules } = compilation;

      const s = modules[0].source(
        compilation.dependencyTemplates,
        compilation.runtimeTemplate
      );

      done();
    });
  }

  handler(parser) {
    parser.hooks.importSpecifier.tap(
      NAMESPACE,
      (expr, request, exportName, identifier) => {
        if (request.endsWith('.css')) {
          this.addCssImport(parser.state.module.request, {
            request,
            identifier,
            usages: [],
          });
        }
      }
    );

    parser.hooks.expressionAnyMember
      .for('imported var')
      .tap(NAMESPACE, (expr) => {
        const varName = expr.object.name;
        const imports = this.cssImports.get(parser.state.module.request);
        const data = imports
          ? imports.find((item) => item.identifier === varName)
          : null;

        if (data) {
          data.usages.push({
            objectRange: expr.object.range,
            range: expr.range,
            prop: expr.property.name || expr.property.value,
          });
        }
      });
  }
}

module.exports = Plugin;
module.exports.NAMESPACE = NAMESPACE;
