module.exports = function getCssModuleParents(cssModule, compilation, parentModule) {
  const isChildCompiler = compilation.compiler.isChild();

  const modulesToSearchIn = [].concat(
    compilation.modules,
    isChildCompiler ? compilation.compiler.parentCompilation.modules : []
  );

  const isExtractPlugin =
    compilation.name &&
    compilation.name.startsWith('mini-css-extract-plugin');

  const res = modulesToSearchIn
    .map((module) => {
      const depModules = module.dependencies
        .filter((d) => d.module)
        .map(({ module }) => module)
        .filter((m, index, self) => self.indexOf(m) === index);

      if (depModules.length === 0) {
        return null;
      } else if (depModules.includes(cssModule)) {
        return parentModule || module;
      } else if (isExtractPlugin) {
        const cssModuleDepModule = depModules
          .filter((m) => m.request)
          .map((m) => {
            const parts = m.request.split('!');
            parts.shift();
            return parts.join('!');
          })
          .find((r) => r === cssModule.request);

        return cssModuleDepModule ? parentModule || module : null;
      }

      const parents = getCssModuleParents(
        cssModule,
        compilation,
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
};
