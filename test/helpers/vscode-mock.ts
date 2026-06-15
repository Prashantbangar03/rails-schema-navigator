import { EventEmitter as NodeEventEmitter } from 'node:events';
import * as path from 'node:path';

export interface MockFileStat {
  mtime: number;
}

export interface MockState {
  workspaceFolders: Array<{ uri: { fsPath: string }; name: string; index: number }>;
  config: Record<string, boolean>;
  files: Map<string, string>;
  fileStats: Map<string, MockFileStat>;
  findFilesByPattern: Array<{ pattern: string; uris: string[] }>;
  activeEditor: MockTextEditor | null;
  colorThemeKind: number;
  quickPickResult: unknown;
  warningMessages: string[];
  postedMessages: unknown[];
  clipboardText: string;
  terminalCommands: string[];
  statusBarText: string | null;
  configChangeListeners: Array<(event: { affectsConfiguration: (section: string) => boolean }) => void>;
  editorChangeListeners: Array<(editor: MockTextEditor | undefined) => void>;
  themeChangeListeners: Array<() => void>;
  registeredCommands: Map<string, (...args: unknown[]) => void>;
  webviewPanels: MockWebviewPanel[];
  webviewSerializer?: { deserializeWebviewPanel: (panel: MockWebviewPanel) => Promise<void> };
  fileWatcherCallbacks: Array<{ pattern: string; change: Array<() => void> }>;
}

export interface MockTextEditor {
  document: MockTextDocument;
  viewColumn: number;
  selection: { active: { line: number; character: number } };
}

export interface MockTextDocument {
  uri: { fsPath: string };
  fileName: string;
  getText: () => string;
  lineAt: (line: number) => { text: string };
  getWordRangeAtPosition: (
    position: { line: number; character: number },
    regex?: RegExp
  ) => { start: { character: number }; end: { character: number } } | undefined;
}

export interface MockWebviewPanel {
  title: string;
  webview: {
    html: string;
    cspSource: string;
    postMessage: (message: unknown) => Promise<boolean>;
    onDidReceiveMessage: (cb: (msg: unknown) => void) => { dispose: () => void };
  };
  reveal: (column?: number) => void;
  onDidDispose: (cb: () => void) => { dispose: () => void };
  dispose: () => void;
}

class MockDisposable {
  constructor(private readonly disposeFn?: () => void) {}
  dispose(): void {
    this.disposeFn?.();
  }
}

export const mockState: MockState = {
  workspaceFolders: [{ uri: { fsPath: '/workspace/rails-app' }, name: 'rails-app', index: 0 }],
  config: { followEditor: true, showStatusBar: true },
  files: new Map(),
  fileStats: new Map(),
  findFilesByPattern: [],
  activeEditor: null,
  colorThemeKind: 2,
  quickPickResult: undefined,
  warningMessages: [],
  postedMessages: [],
  clipboardText: '',
  terminalCommands: [],
  statusBarText: null,
  configChangeListeners: [],
  editorChangeListeners: [],
  themeChangeListeners: [],
  registeredCommands: new Map(),
  webviewPanels: [],
  fileWatcherCallbacks: [],
};

export function resetMockState(): void {
  mockState.workspaceFolders = [{ uri: { fsPath: '/workspace/rails-app' }, name: 'rails-app', index: 0 }];
  mockState.config = { followEditor: true, showStatusBar: true };
  mockState.files.clear();
  mockState.fileStats.clear();
  mockState.findFilesByPattern = [];
  mockState.activeEditor = null;
  mockState.colorThemeKind = 2;
  mockState.quickPickResult = undefined;
  mockState.warningMessages = [];
  mockState.postedMessages = [];
  mockState.clipboardText = '';
  mockState.terminalCommands = [];
  mockState.statusBarText = null;
  mockState.configChangeListeners = [];
  mockState.editorChangeListeners = [];
  mockState.themeChangeListeners = [];
  mockState.registeredCommands.clear();
  mockState.webviewPanels = [];
  mockState.webviewSerializer = undefined;
  mockState.fileWatcherCallbacks = [];
}

function createTextDocument(fsPath: string, content?: string): MockTextDocument {
  const text = content ?? mockState.files.get(fsPath) ?? '';
  const lines = text.split('\n');
  return {
    uri: { fsPath },
    fileName: path.basename(fsPath),
    getText: () => text,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
    getWordRangeAtPosition: (position, regex) => {
      const line = lines[position.line] ?? '';
      const pattern = regex ?? /\S+/;
      const match = line.match(pattern);
      if (!match || match.index === undefined) {
        return undefined;
      }
      const start = match.index;
      const end = start + match[0].length;
      if (position.character < start || position.character > end) {
        return undefined;
      }
      return { start: { character: start }, end: { character: end } };
    },
  };
}

const Uri = {
  file: (fsPath: string) => ({ fsPath: path.normalize(fsPath), toString: () => fsPath }),
  joinPath: (base: { fsPath: string }, ...parts: string[]) =>
    Uri.file(path.join(base.fsPath, ...parts)),
};

class RelativePattern {
  constructor(public base: { fsPath: string }, public pattern: string) {}
}

class MockEventEmitter<T> {
  private readonly emitter = new NodeEventEmitter();
  event = (listener: (value: T) => void) => {
    this.emitter.on('event', listener);
    return new MockDisposable(() => this.emitter.off('event', listener));
  };
  fire = (value: T) => {
    this.emitter.emit('event', value);
  };
  dispose = () => {
    this.emitter.removeAllListeners();
  };
}

function matchPattern(pattern: string, normalized: string): boolean {
  const glob = pattern
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '(?:[^/]+/)*')
    .replace(/\./g, '\\.');
  return new RegExp(`^${glob}$`).test(normalized) || new RegExp(`(^|/)${glob}$`).test(normalized);
}

async function findFiles(
  include: string | RelativePattern,
  exclude?: string,
  _limit?: number
): Promise<Array<{ fsPath: string }>> {
  const excluded = (fsPath: string): boolean => {
    if (!exclude) {
      return false;
    }
    const normalized = fsPath.replace(/\\/g, '/');
    return matchPattern(exclude, normalized) || normalized.includes('/concerns/');
  };

  if (include instanceof RelativePattern) {
    const base = include.base.fsPath.replace(/\\/g, '/').replace(/\/$/, '');
    const pattern = include.pattern;
    const all = [...new Set([...mockState.files.keys(), ...mockState.fileStats.keys()])];
    const fromFiles = all
      .filter((uri) => {
        if (excluded(uri)) {
          return false;
        }
        const normalized = uri.replace(/\\/g, '/');
        if (!normalized.startsWith(`${base}/`) && normalized !== base) {
          return false;
        }
        const rel = normalized === base ? '' : normalized.slice(base.length + 1);
        return matchPattern(pattern, rel) || matchPattern(pattern, normalized);
      })
      .map((uri) => Uri.file(uri));

    const configured = mockState.findFilesByPattern.find((entry) => entry.pattern === pattern);
    if (configured) {
      for (const uri of configured.uris) {
        if (!excluded(uri) && uri.replace(/\\/g, '/').startsWith(`${base}/`)) {
          fromFiles.push(Uri.file(uri));
        }
      }
    }

    return [...new Map(fromFiles.map((uri) => [uri.fsPath, uri])).values()];
  }

  const pattern = include;
  const configured = mockState.findFilesByPattern.find((entry) => entry.pattern === pattern);
  if (configured) {
    return configured.uris.map((uri) => Uri.file(uri));
  }
  const all = [...mockState.files.keys(), ...mockState.fileStats.keys()];
  const unique = [...new Set(all)];
  return unique.filter((uri) => matchPattern(pattern, uri)).map((uri) => Uri.file(uri));
}

function createWebviewPanel(): MockWebviewPanel {
  let messageHandler: ((msg: unknown) => void) | undefined;
  let disposeHandler: (() => void) | undefined;
  const panel: MockWebviewPanel = {
    title: 'Rails Schema Navigator',
    webview: {
      html: '',
      cspSource: 'vscode-webview://mock',
      postMessage: async (message: unknown) => {
        mockState.postedMessages.push(message);
        return true;
      },
      onDidReceiveMessage: (cb) => {
        messageHandler = cb;
        return new MockDisposable();
      },
    },
    reveal: () => undefined,
    onDidDispose: (cb) => {
      disposeHandler = cb;
      return new MockDisposable();
    },
    dispose: () => {
      disposeHandler?.();
    },
  };
  (panel as { _receiveMessage?: (msg: unknown) => void })._receiveMessage = (msg: unknown) => {
    messageHandler?.(msg);
  };
  mockState.webviewPanels.push(panel);
  return panel;
}

const statusBarItem = {
  text: '',
  command: '',
  tooltip: '',
  show: () => {
    mockState.statusBarText = statusBarItem.text;
  },
  hide: () => {
    mockState.statusBarText = null;
  },
  dispose: () => undefined,
};

export const vscode = {
  Uri,
  RelativePattern,
  workspace: {
    get workspaceFolders() {
      return mockState.workspaceFolders;
    },
    getConfiguration: (section: string) => ({
      get: <T>(key: string, defaultValue: T): T => {
        const value = mockState.config[key];
        return (value === undefined ? defaultValue : value) as T;
      },
    }),
    findFiles,
    openTextDocument: async (uri: string | { fsPath: string }) => {
      const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
      if (!mockState.files.has(fsPath) && !mockState.fileStats.has(fsPath)) {
        throw new Error(`ENOENT: ${fsPath}`);
      }
      return createTextDocument(fsPath);
    },
    fs: {
      stat: async (uri: { fsPath: string }) => {
        const stat = mockState.fileStats.get(uri.fsPath);
        if (!stat) {
          throw new Error(`ENOENT: ${uri.fsPath}`);
        }
        return stat;
      },
    },
    getWorkspaceFolder: (uri: { fsPath: string }) => {
      for (const folder of mockState.workspaceFolders) {
        const root = folder.uri.fsPath;
        if (uri.fsPath === root || uri.fsPath.startsWith(`${root}${path.sep}`)) {
          return folder;
        }
      }
      return undefined;
    },
    onDidChangeConfiguration: (listener: (event: { affectsConfiguration: (section: string) => boolean }) => void) => {
      mockState.configChangeListeners.push(listener);
      return new MockDisposable();
    },
    createFileSystemWatcher: (pattern: string) => {
      const entry = { pattern, change: [] as Array<() => void> };
      mockState.fileWatcherCallbacks.push(entry);
      return {
        onDidChange: (cb: () => void) => {
          entry.change.push(cb);
          return new MockDisposable();
        },
        onDidCreate: (cb: () => void) => {
          entry.change.push(cb);
          return new MockDisposable();
        },
        onDidDelete: (cb: () => void) => {
          entry.change.push(cb);
          return new MockDisposable();
        },
        dispose: () => undefined,
      };
    },
  },
  window: {
    get activeTextEditor() {
      return mockState.activeEditor;
    },
    createWebviewPanel: () => createWebviewPanel(),
    showQuickPick: async <T>(_items: T[]) => mockState.quickPickResult as T | undefined,
    showWarningMessage: async (message: string) => {
      mockState.warningMessages.push(message);
      return undefined;
    },
    showTextDocument: async () => ({}),
    setStatusBarMessage: () => new MockDisposable(),
    createStatusBarItem: () => statusBarItem,
    createTerminal: () => ({
      show: () => undefined,
      sendText: (command: string) => {
        mockState.terminalCommands.push(command);
      },
    }),
    onDidChangeActiveTextEditor: (listener: (editor: MockTextEditor | undefined) => void) => {
      mockState.editorChangeListeners.push(listener);
      return new MockDisposable();
    },
    onDidChangeActiveColorTheme: (listener: () => void) => {
      mockState.themeChangeListeners.push(listener);
      return new MockDisposable();
    },
    registerWebviewPanelSerializer: (
      _id: string,
      serializer: { deserializeWebviewPanel: (panel: MockWebviewPanel) => Promise<void> }
    ) => {
      mockState.webviewSerializer = serializer;
      return new MockDisposable();
    },
    get activeColorTheme() {
      return { kind: mockState.colorThemeKind };
    },
  },
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => void) => {
      mockState.registeredCommands.set(id, handler);
      return new MockDisposable();
    },
  },
  env: {
    clipboard: {
      writeText: async (text: string) => {
        mockState.clipboardText = text;
      },
    },
  },
  EventEmitter: MockEventEmitter,
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { One: 1, Two: 2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  QuickPickItemKind: { Separator: -1 },
};

module.exports = vscode;
module.exports.vscode = vscode;
module.exports.mockState = mockState;
module.exports.resetMockState = resetMockState;
module.exports.createTextDocument = createTextDocument;
