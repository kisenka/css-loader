const HarmonyImportSpecifierDependency = require.main.require('webpack/lib/dependencies/HarmonyImportSpecifierDependency');
const HarmonyImportSideEffectDependency = require.main.require('webpack/lib/dependencies/HarmonyImportSideEffectDependency');

const NAMESPACE = __filename;

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

  /**
   * @param {NormalModule} cssModule
   * @param {Compilation} compilation
   * @return {NormalModule[]}
   */
  getModuleJsParents(cssModule, compilation) {
    const isChildCompiler = compilation.compiler.isChild();

    const allModules = [].concat(
      compilation.modules,
      isChildCompiler ? compilation.compiler.parentCompilation.modules : []
    )
    .filter(module => this.cssImports.has(module.request));

    const parents = allModules.filter(module => {
      const cssModuleDep = module.dependencies
        .filter(d => d instanceof HarmonyImportSideEffectDependency)
        .find(d => d.module.resource === cssModule.resource);

      return !!cssModuleDep;
    });

    return parents;
  }

  addCssImport(module, data) {
    const existing = this.getCssImportsForModule(module);

    if (!existing) {
      this.cssImports.set(module.request, [data]);
      return;
    }

    existing.push(data);
  }

  getCssImportsForModule(module) {
    return this.cssImports.get(module.request);
  }

  /**
   * @param {NormalModule} cssModule
   * @param {NormalModule[]} parents
   * @return {Array<{ prop: string, range: number[], objectRange: number[] }>}
   */
  findCssModuleUsagesInParents(cssModule, parents) {
    const usages = [];

    parents.forEach((parentModule) => {
      const cssImportsUsages = this.getCssImportsForModule(parentModule)
        .reduce((acc, i) => acc.concat(i.usages), []);

      parentModule.dependencies
        .filter(d => d instanceof HarmonyImportSpecifierDependency)
        .filter(d => d.module.resource === cssModule.resource)
        .forEach(d => {
          const usage = cssImportsUsages
            .find(usage => usage.objectRange.toString() === d.range.toString());

          usages.push(usage);
        });
    });

    return usages;
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
          this.addCssImport(parser.state.module, {
            request,
            name: identifier,
            usages: [],
          });
        }
      }
    );

    parser.hooks.expressionAnyMember
      .for('imported var')
      .tap(NAMESPACE, (expr) => {
        const varName = expr.object.name;
        const imports = this.getCssImportsForModule(parser.state.module);
        const data = imports
          ? imports.find((item) => item.name === varName)
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
    compilation.modules.forEach((module) => {
      const imports = this.getCssImportsForModule(module);
      if (!imports) {
        return;
      }

      const usages = imports.reduce((acc, i) => acc.concat(i.usages), []);

      // TODO clarify
      const replaceSource = module
        .source(compilation.dependencyTemplates, compilation.runtimeTemplate)
        ._source;

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
