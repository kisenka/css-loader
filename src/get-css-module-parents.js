module.exports = function getCssModuleParents(opts) {
  const { cssModule, modules, parentModule, isExtractPlugin = false } = opts;

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

      const parents = getCssModuleParents({
        cssModule,
        modules: depModules,
        parentModule: parentModule || module,
      });

      if (!parents || parents.length === 0) {
        return null;
      }

      return parentModule || module;
    })
    .filter(Boolean)
    .filter((m) => m.type.startsWith('javascript/'));

  return res;
};
