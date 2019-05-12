const Dependency = require('webpack/lib/Dependency');

class MyDependency extends Dependency {
  // Use the constructor to save any information you need for later
  constructor(module, usage) {
    super();
    this.module = module;
    this.usage = usage;
  }
}

MyDependency.Template = class MyDependencyTemplate {
  apply(dep, source) {
    const usage = dep.usage;
    source.replace(
      usage.range[0],
      usage.range[1] - 1,
      JSON.stringify(usage.value)
    )
  }
};

module.exports = MyDependency;
