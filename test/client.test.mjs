import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/** 浏览器模块表的替代品：截获 load() 的工厂，再用假 React 跑一遍。 */
function loadClient() {
  const storage = new Map();
  const window = {
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    __ModuleLoader__: {
      load(definition) {
        window.__captured = definition;
      },
    },
  };
  const effects = [];
  const react = {
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: (effect) => {
      effects.push(effect);
    },
  };
  const jsxRuntime = {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
  };
  // 只给两种种子模块；其它 require 一律失败，保证插件不偷偷依赖别的包。
  const requireStub = (specifier) => {
    if (specifier === 'react') return react;
    if (specifier === 'react/jsx-runtime') return jsxRuntime;
    throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
  };

  // eslint-disable-next-line no-new-func
  new Function('window', 'setTimeout', 'clearTimeout', SOURCE)(window, setTimeout, clearTimeout);
  const definition = window.__captured;
  const exports = definition.factory(requireStub);
  return { definition, exports, effects, storage, window };
}

/** 收集 JSX 桩树里的所有文字。 */
function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === 'object' && node.props !== undefined) {
    collectText(node.props.children, out);
  }
  return out;
}

function makeApplyContext() {
  const registered = [];
  const dictionaries = [];
  const opened = [];
  const ctx = {
    effect: (fn) => {
      fn();
      return () => {};
    },
    locale: {
      register: (namespace, dicts) => {
        dictionaries.push({ namespace, dicts });
        return () => {};
      },
    },
    slots: {
      inject: (name, factory) => factory(),
      register: (definition, component) => {
        registered.push({ definition, component });
        return () => {};
      },
    },
    get: (name) => (name === 'uiWorkspace' ? { openSession: (id) => opened.push(id) } : undefined),
  };
  return { ctx, registered, dictionaries, opened };
}

test('client: 以 dsh-new-session 注册模块，导出 apply/inject', () => {
  const { definition, exports } = loadClient();
  assert.equal(definition.id, 'dsh-new-session');
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(exports.inject, ['slots', 'locale']);
});

test('client: apply 注册两种工具名的行 + 中英词典', () => {
  const { exports } = loadClient();
  const { ctx, registered, dictionaries } = makeApplyContext();
  exports.apply(ctx);
  assert.deepEqual(registered.map((entry) => entry.definition.key), ['new_conversation', 'new_session']);
  for (const entry of registered) {
    assert.equal(entry.definition.name, 'tool.call.toolview');
    assert.equal(entry.definition.locale, 'newSession');
    assert.equal(typeof entry.component, 'function');
  }
  assert.equal(dictionaries.length, 1);
  assert.equal(dictionaries[0].namespace, 'newSession');
  assert.deepEqual(Object.keys(dictionaries[0].dicts.zh).sort(), Object.keys(dictionaries[0].dicts.en).sort());
});

test('client: 运行中显示“正在新开对话”，结果落地后自动打开新会话', async () => {
  const { exports, effects, storage } = loadClient();
  const { ctx, opened } = makeApplyContext();
  exports.apply(ctx);
  const t = (key) => key;

  const running = exports.NewSessionRow({ block: { kind: 'tool-call-start', name: 'new_conversation' }, t });
  assert.match(collectText(running).join(' '), /row\.running/u);

  effects.length = 0;
  const settled = exports.NewSessionRow({
    block: {
      kind: 'tool-result',
      isError: false,
      content: [],
      meta: { sessionId: 'session-new', title: '方案比较', workspacePath: 'D:/proj', autoSwitch: true, switchDelayMs: 0, createdAt: Date.now() },
    },
    t,
    openSession: (id) => opened.push(id),
  });
  const text = collectText(settled).join(' ');
  assert.match(text, /方案比较/u);
  assert.match(text, /session-new/u);
  assert.equal(effects.length, 1);
  const cleanup = effects[0]();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(opened, ['session-new']);
  assert.equal(storage.get('dsh-new-session:opened:session-new'), '1');
  cleanup?.();
});

test('client: 已经自动跳过一次后，重新挂载不会再抢视图', async () => {
  const { exports, effects, storage } = loadClient();
  const { ctx, opened } = makeApplyContext();
  exports.apply(ctx);
  storage.set('dsh-new-session:opened:session-old', '1');
  exports.NewSessionRow({
    block: { kind: 'tool-result', isError: false, content: [], meta: { sessionId: 'session-old', autoSwitch: true, switchDelayMs: 0, createdAt: Date.now() } },
    t: (key) => key,
    openSession: (id) => opened.push(id),
  });
  const cleanup = effects[0]();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(opened, []);
  cleanup?.();
});

test('client: 旧卡片（createdAt 超过时间窗）不自动抢视图', async () => {
  const { exports, effects } = loadClient();
  const { ctx, opened } = makeApplyContext();
  exports.apply(ctx);
  const row = exports.NewSessionRow({
    block: {
      kind: 'tool-result',
      isError: false,
      content: [],
      meta: { sessionId: 'session-2024', autoSwitch: true, switchDelayMs: 0, createdAt: Date.now() - 60 * 60 * 1000 },
    },
    t: (key) => key,
    openSession: (id) => opened.push(id),
  });
  const button = findButton(row);
  assert.ok(button, 'expected an open button for an old card');
  effects[0]();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(opened, []);
});

test('client: 关掉自动切换时只给“打开”按钮，点击才跳', () => {
  const { exports, effects } = loadClient();
  const { ctx, opened } = makeApplyContext();
  exports.apply(ctx);
  const row = exports.NewSessionRow({
    block: { kind: 'tool-result', isError: false, content: [], meta: { sessionId: 'session-new', autoSwitch: false } },
    t: (key) => key,
    openSession: (id) => opened.push(id),
  });
  const button = findButton(row);
  assert.ok(button, 'expected an open button');
  button.props.onClick();
  assert.deepEqual(opened, ['session-new']);
  assert.equal(effects[0](), undefined);
});

test('client: 失败结果只报错，不跳转', () => {
  const { exports, effects } = loadClient();
  const { ctx, opened } = makeApplyContext();
  exports.apply(ctx);
  const row = exports.NewSessionRow({
    block: {
      kind: 'tool-result',
      isError: true,
      content: [{ type: 'text', text: 'new_conversation: boom' }],
      meta: { sessionId: 'session-new', autoSwitch: true, createdAt: Date.now() },
    },
    t: (key) => key,
    openSession: (id) => opened.push(id),
  });
  assert.match(collectText(row).join(' '), /row\.failed/u);
  assert.match(collectText(row).join(' '), /boom/u);
  effects[0]();
  assert.deepEqual(opened, []);
});

/** 在 JSX 桩树里找第一个 <button>。 */
function findButton(node) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node.type === 'button') return node;
  return findButton(node.props?.children);
}
