const HarmonyImportSpecifierDependency = require('webpack/lib/dependencies/HarmonyImportSpecifierDependency');
const acorn = require('acorn');
const acornWalk = require('acorn-walk');

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

  addMapping(loaderContext, classes) {
    this.mappings.set(loaderContext.request, classes);
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
          const { mappings } = this;

          const data = compilation.modules
            .map((module) => {
              const mapping = mappings.get(module.request);
              return mapping ? { module, mapping } : null;
            })
            .filter(Boolean);

          data.forEach((item) => {
            const { module: cssModule, mapping } = item;
            const parents = getCssModuleParents(cssModule, compilation.modules);

            parents.forEach(parentModule => {
              const deps = parentModule.dependencies
                .filter(dep => dep.module && dep instanceof HarmonyImportSpecifierDependency && dep.module === cssModule);

              const replaceSource = getModuleReplaceSource(parentModule, compilation);
              const parentSource = parentModule.originalSource().source();
              const ast = acorn.parse(parentSource, {
                ecmaVersion: 2019,
                sourceType: "module",
                onComment: null
              });

              acornWalk.simple(ast, {
                MemberExpression(node) {
                  const { object, property } = node;
                  const dep = deps.find(d => d.name === object.name && d.range[0] === object.start && d.range[1] === object.end);
                  const replaceTo = dep && mapping[property.name];

                  if (replaceTo) {
                    // replaceSource.replace(node.start, node.end, JSON.stringify(replaceTo));
                    const replaceValue = JSON.stringify(replaceTo);
                    const varName = dep.getImportVar();
                    const r = replaceSource.replacements.find(r => r.content.startsWith(varName) && r.start === node.start);
                    r.start = node.start;
                    r.end = node.end - 1;
                    r.content = replaceValue;
                  }
                }
              });

              void 0;
            });
          });

          // const s = modules[0].source(
          //   compilation.dependencyTemplates,
          //   compilation.runtimeTemplate
          // );

          void 0;

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
    })
  }

  addCssImport(module, data) {
    const id = module.request;
    const existing = this.cssImports.get(id);

    if (!existing) {
      this.cssImports.set(id, [data]);
      return;
    }

    existing.push(data);
  }

  handler(parser) {
    parser.hooks.importSpecifier.tap(NAMESPACE, (expr, request, exportName, identifier) => {
      if (request.endsWith('.css')) {
        this.addCssImport(parser.state.module, {
          range: expr.range,
          request,
          identifier,
          usages: []
        });
      }
    });

    parser.hooks.expressionAnyMember
      .for('imported var')
      .tap(NAMESPACE, (expr) => {
        const varName = expr.object.name;
        const imports = this.cssImports.get(parser.state.module.request);
        const data = imports
          ? imports.find(item => item.identifier === varName)
          : null;

        if (data) {
          data.usages.push({
            range: expr.range,
            prop: expr.property.name || expr.property.value
          });
          void 0;
        }
      });

    parser.hooks.import.tap(NAMESPACE, (expr) => {
      const currentModule = parser.state.module;

      const isCssModuleImport =
        expr.source.value.endsWith('.css') &&
        expr.specifiers.length > 0;

      if (isCssModuleImport) {
        void 0;
      }
    });

    parser.hooks.expression
      .for("imported var")
      .tap(NAMESPACE, (expr) => {
        const p1 = parser;
        void 0;
      });

    parser.hooks.program.tap(NAMESPACE, ast => {
      const p3 = parser;
      acornWalk.simple(ast, {
        MemberExpression(node) {
          void 0;
        }
      });
    });
  }
}

module.exports = Plugin;
module.exports.NAMESPACE = NAMESPACE;
