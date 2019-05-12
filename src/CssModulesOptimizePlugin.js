const HarmonyImportSpecifierDependency = require.main.require(
  'webpack/lib/dependencies/HarmonyImportSpecifierDependency'
);
const HarmonyImportSideEffectDependency = require.main.require(
  'webpack/lib/dependencies/HarmonyImportSideEffectDependency'
);

const NAMESPACE = __filename;

const CustomDependency = require('./CustomDependency');

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

    const allModules = []
      .concat(
        compilation.modules,
        isChildCompiler ? compilation.compiler.parentCompilation.modules : []
      )
      .filter((module) => this.cssImports.has(module.request));

    const parents = allModules.filter((module) => {
      const cssModuleDep = module.dependencies
        .filter((d) => d instanceof HarmonyImportSideEffectDependency)
        .find((d) => d.module.resource === cssModule.resource);

      return !!cssModuleDep;
    });

    return parents;
  }

  addCssImport(module, data) {
    const existing = this.getModuleImports(module);

    if (!existing) {
      this.cssImports.set(module.request, [data]);
      return;
    }

    existing.push(data);
  }

  getModuleImports(module) {
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
      const cssImportsUsages = this.getModuleImports(parentModule).reduce(
        (acc, i) => acc.concat(i.usages),
        []
      );

      parentModule.dependencies
        .filter((d) => d instanceof HarmonyImportSpecifierDependency)
        .filter((d) => d.module.resource === cssModule.resource)
        .forEach((d) => {
          const usage = cssImportsUsages.find(
            (usage) => usage.objectRange.toString() === d.range.toString()
          );

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
        compilation.dependencyTemplates.set(
          CustomDependency,
          new CustomDependency.Template()
        );

        normalModuleFactory.hooks.parser
          .for('javascript/auto')
          .tap(NAMESPACE, this.extractCssImportsHook.bind(this));

        compilation.hooks.normalModuleLoader.tap(NAMESPACE, (loaderCtx) => {
          loaderCtx[NAMESPACE] = this;
        });

        compilation.hooks.afterOptimizeDependencies.tap(
          NAMESPACE,
          (modules) => {
            modules
              .filter((module) => this.cssImports.has(module.request))
              .forEach((module) => {
                const imports = this.cssImports.get(module.request);
                const usages = imports.reduce(
                  (acc, i) => acc.concat(i.usages),
                  []
                );

                module.dependencies
                  .filter((d) => d instanceof HarmonyImportSpecifierDependency)
                  .forEach((d) => {
                    const usage = usages.find(
                      (u) => u.objectRange.toString() === d.range.toString()
                    );

                    if (!usage || !usage.value) {
                      return;
                    }

                    module.removeDependency(d);

                    const dep = new CustomDependency(module, usage);
                    module.addDependency(dep);

                    void 0;
                  });
              });
          }
        );

        // compilation.hooks.beforeModuleAssets
        //   .tap(NAMESPACE, () => this.replaceInModulesHook(compilation));
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
        const imports = this.getModuleImports(parser.state.module);
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

  optimizeCssTree(ast, usages, exportMessages) {
    root.walkRules((rule) => {
      const hashedClassName = rule.selector.substr(1);
      const exportMsg = exportMessages.find(
        (msg) => msg.item.value === hashedClassName
      );
      const prop = exportMsg && exportMsg.item.key;
      const isUsed = !!usages.find((usage) => usage.prop === prop);

      // TODO add support for at-rules
      // TODO add support for multiselectors with CSSTree
      if (exportMsg && !isUsed && rule.parent.type === 'root') {
        rule.remove();

        // Remove export msg
        exportMessages.splice(exportMessages.indexOf(exportMsg), 1);
      }
    });
  }

  replaceInModulesHook(compilation) {
    compilation.modules.forEach((module) => {
      const imports = this.getModuleImports(module);
      if (!imports) {
        return;
      }

      const usages = imports.reduce((acc, i) => acc.concat(i.usages), []);

      // TODO clarify
      const replaceSource = module.source(
        compilation.dependencyTemplates,
        compilation.runtimeTemplate
      )._source;

      usages
        .filter((usage) => !!usage.value)
        .forEach((usage) => {
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
