const NAMESPACE = __filename;

class Plugin {
  constructor() {
    this.files = new Map();
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

  apply(compiler) {
    const { NAMESPACE } = this;

    // FIXME thisCompilation
    compiler.hooks.thisCompilation.tap(
      NAMESPACE,
      (compilation, { normalModuleFactory }) => {
        compilation.hooks.normalModuleLoader.tap(NAMESPACE, (loaderCtx) => {
          loaderCtx[NAMESPACE] = this;
        });

        // normalModuleFactory.hooks.parser
        //   .for("javascript/auto")
        //   .tap(NAMESPACE, this.handler.bind(this));

        compilation.hooks.afterOptimizeModules.tap(NAMESPACE, (modules) => {
          const { files: classesByRequest } = this;

          const styleModules = modules
            .map((module) => {
              const classes = classesByRequest.get(module.request);
              return classes ? { classes, module } : null;
            })
            .filter(Boolean);

          styleModules.forEach(({ module }) => {
            const parentModule = modules.find(
              (m) =>
                m.dependencies
                  .map((d) => d.module)
                  .filter(Boolean)
                  .filter((m) => m === module).length > 0
            );

            if (parentModule) {
              module.parentModule = parentModule;
            }
          });

          debugger;
        });
      }
    );
  }

  handler(parser) {
    parser.hooks.program.tap(NAMESPACE, (ast) => {
      debugger;
    });
  }
}

module.exports = Plugin;
module.exports.NAMESPACE = NAMESPACE;
