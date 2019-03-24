const NAMESPACE = __filename;

function getCssModuleParents(cssModule, modules, parentModule) {
  const res = modules
    .map((module) => {
      const depModules = module.dependencies
        .filter((d) => d.module)
        .map(({ module }) => module)
        .filter((m, index, self) => self.indexOf(m) === index);

      if (depModules.length === 0) {
        return null;
      } else if (depModules.includes(cssModule)) {
        return parentModule || module;
      }

      const parents = getCssModuleParents(
        cssModule,
        depModules,
        parentModule || module
      );
      if (!parents || parents.length === 0) {
        return null;
      }

      return parentModule || module;
    })
    .filter(Boolean)
    .filter((m) => m.type.startsWith('javascript/'));

  return res;
}

class Plugin {
  constructor() {
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

  addMapping(loaderContext, classes) {
    const { request: file } = loaderContext;
    this.mappings.set(file, classes);
  }

  apply(compiler) {
    const { NAMESPACE } = this;

    // FIXME thisCompilation
    compiler.hooks.thisCompilation.tap(
      NAMESPACE,
      (compilation, { normalModuleFactory }) => {
        compilation.hooks.normalModuleLoader.tap(NAMESPACE, (loaderCtx) => {
          loaderCtx[NAMESPACE] = this;
        });

        normalModuleFactory.hooks.parser
          .for('javascript/auto')
          .tap(NAMESPACE, this.handler.bind(this));

        compilation.hooks.afterOptimizeModules.tap(NAMESPACE, (modules) => {
          const { mappings } = this;

          const data = modules
            .map((module) => {
              const mapping = mappings.get(module.request);
              return mapping ? { module, mapping } : null;
            })
            .filter(Boolean);

          data.forEach((item) => {
            const { module: cssModule } = item;
            item.parents = getCssModuleParents(cssModule, modules);
          });
        });
      }
    );
  }

  handler(parser) {
    parser.hooks.program.tap(NAMESPACE, (ast) => {
      const a = 1;
    });
  }
}

module.exports = Plugin;
module.exports.NAMESPACE = NAMESPACE;
