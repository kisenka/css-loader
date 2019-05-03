const NAMESPACE = __filename;

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
        normalModuleFactory.hooks.parser
          .for('javascript/auto')
          .tap(NAMESPACE, this.extractCssImportsHook.bind(this));

        compilation.hooks.normalModuleLoader.tap(NAMESPACE, (loaderCtx) => {
          loaderCtx[NAMESPACE] = this;
        });

        compilation.hooks.beforeModuleAssets
          .tap(NAMESPACE, () => this.replaceInModulesHook(compilation));
      }
    );
  }

  extractCssImportsHook(parser) {
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

  replaceInModulesHook(compilation) {
    const { cssImports } = this;

    compilation.modules.forEach((module) => {
      if (!cssImports.has(module.request)) {
        return;
      }

      const usages = cssImports.get(module.request)
        .reduce((acc, i) => acc.concat(i.usages), []);

      const replaceSource = getModuleReplaceSource(
        module,
        compilation
      );

      usages
        .filter(usage => !!usage.value)
        .forEach(usage => {
          const replacement = replaceSource.replacements.find(
            (r) =>
              r.start === usage.objectRange[0] &&
              r.end === usage.objectRange[1] - 1
          );

          if (!replacement) {
            return;
          }

          replacement.end = usage.range[1] - 1;
          replacement.content = JSON.stringify(usage.value);
        });
    });
  }
}

module.exports = Plugin;
module.exports.NAMESPACE = NAMESPACE;
