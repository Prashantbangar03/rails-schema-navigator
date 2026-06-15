import Module from 'node:module';

const originalRequire = Module.prototype.require;

Module.prototype.require = function (this: NodeModule, id: string) {
  if (id === 'vscode') {
    return require('./vscode-mock');
  }
  return originalRequire.apply(this, arguments as unknown as [string]);
};
