import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  apply,
  buildTool,
  composePrompt,
  normalizeConfig,
  resolveTarget,
  sessionReferenceUri,
} from '../lib/index.js';

/** 一个够用的假上下文：工具表 + 按名字取服务。 */
function makeContext(services = {}, config = {}) {
  const registered = [];
  const logs = [];
  const ctx = {
    logger: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
    },
    get(name) {
      return services[name];
    },
    tools: {
      register(tool) {
        registered.push(tool);
        return () => {};
      },
    },
  };
  const options = normalizeConfig(config);
  return { ctx, registered, logs, options };
}

/** 当前会话与执行环境。 */
function execFor(sessionId = 'session-cur', cwd = 'D:/proj') {
  return {
    agent: { session: { header: { id: sessionId, cwd } } },
    signal: new AbortController().signal,
  };
}

/** 记录调用参数的假 session controller。 */
function makeController({ create, prompt, failCreateOnce = false } = {}) {
  const calls = { create: [], prompt: [], resolve: [] };
  let createAttempts = 0;
  const controller = {
    commands: {
      async create(request) {
        calls.create.push(request);
        createAttempts += 1;
        if (failCreateOnce && createAttempts === 1) throw new Error('agent-preset/not-found');
        return create === undefined ? { sessionId: 'session-new' } : create(request);
      },
      async prompt(request, source) {
        calls.prompt.push({ request, source });
        if (prompt !== undefined) return prompt(request, source);
        return { accepted: true };
      },
      async resolveAgent(sessionId) {
        calls.resolve.push(sessionId);
        return { agent: { session: { header: { id: sessionId } } } };
      },
    },
  };
  return { controller, calls };
}

const workspaceRegistry = {
  list: () => [
    { id: 'ws-1', path: 'D:/proj', title: 'proj', sessionIds: ['session-cur'] },
    { id: 'ws-2', path: 'D:/other', title: 'other', sessionIds: ['session-x'] },
  ],
};

test('normalizeConfig: 默认值、显式关闭、坏值回落', () => {
  assert.deepEqual(normalizeConfig(undefined), { ...DEFAULT_CONFIG });
  assert.equal(normalizeConfig({ autoSwitch: false }).autoSwitch, false);
  assert.equal(normalizeConfig({ autoSwitch: 'no' }).autoSwitch, true);
  assert.equal(normalizeConfig({ switchDelayMs: -5 }).switchDelayMs, DEFAULT_CONFIG.switchDelayMs);
  assert.equal(normalizeConfig({ switchDelayMs: 12 }).switchDelayMs, 12);
  assert.equal(normalizeConfig({ toolName: 'bad name' }).toolName, DEFAULT_CONFIG.toolName);
  assert.equal(normalizeConfig({ toolName: 'open_thread' }).toolName, 'open_thread');
});

test('resolveTarget: 当前会话的工作区优先，其次显式参数', () => {
  assert.deepEqual(resolveTarget(workspaceRegistry, undefined, 'session-cur', 'D:/proj'), {
    workspaceId: 'ws-1',
    workspacePath: 'D:/proj',
    cwd: 'D:/proj',
  });
  assert.deepEqual(resolveTarget(workspaceRegistry, 'ws-2', 'session-cur', 'D:/proj'), {
    workspaceId: 'ws-2',
    workspacePath: 'D:/other',
    cwd: 'D:/other',
  });
  assert.equal(resolveTarget(workspaceRegistry, 'd:/OTHER', 'session-cur', 'D:/proj').workspaceId, 'ws-2');
  assert.deepEqual(resolveTarget(workspaceRegistry, undefined, 'session-ungrouped', 'D:/other'), {
    workspaceId: 'ws-2',
    workspacePath: 'D:/other',
    cwd: 'D:/other',
  });
  assert.throws(
    () => resolveTarget(workspaceRegistry, undefined, 'session-ungrouped', undefined),
    /no working directory/u,
  );
  assert.throws(
    () => resolveTarget(workspaceRegistry, 'D:/nope', 'session-cur', 'D:/proj'),
    /no workspace matches .*proj/su,
  );
});

test('composePrompt: 只有开了引用、且知道来源会话时才拼引用块', () => {
  assert.equal(composePrompt('  继续做 B  ', { sessionId: 'session-cur', reference: false }), '继续做 B');
  const withRef = composePrompt('继续做 B', { sessionId: 'session-cur', reference: true });
  assert.match(withRef, /^继续做 B\n/);
  assert.match(withRef, /@\[previous conversation\]\(dsh-session:[A-Za-z0-9_-]+\)$/);
  const uri = withRef.match(/dsh-session:([A-Za-z0-9_-]+)\)$/)[1];
  assert.equal(Buffer.from(uri, 'base64url').toString('utf8'), JSON.stringify('session-cur'));
  assert.equal(sessionReferenceUri('session-x'), `dsh-session:${Buffer.from('"session-x"').toString('base64url')}`);
});

test('apply: 注册 new_conversation，参数与输出 schema 都是合法 JSON Schema', () => {
  const { ctx, registered } = makeContext({});
  apply(ctx, {});
  assert.equal(registered.length, 1);
  const tool = registered[0];
  assert.equal(tool.name, 'new_conversation');
  assert.equal(tool.parameters.type, 'object');
  assert.deepEqual(tool.parameters.required, ['prompt']);
  assert.equal(tool.parameters.properties.prompt.type, 'string');
  assert.deepEqual(tool.output.schema.required, ['sessionId']);
  assert.equal(typeof tool.execute, 'function');
  assert.equal(typeof tool.output.render, 'function');
  assert.equal(typeof tool.output.presentationMeta, 'function');
});

test('execute: 建会话 → 投递交接消息 → 带引用、透传 preset 和标题', async () => {
  const { controller, calls } = makeController();
  const services = {
    sessionController: controller,
    workspaceRegistry,
    sessionProjections: { stateOf: () => 'preset-a' },
    sessionReferenceResolver: {},
    sessionTitle: { rename: () => ({ title: '方案比较' }) },
  };
  const { ctx } = makeContext(services);
  const tool = buildTool(ctx, normalizeConfig({}));

  const result = await tool.execute({ prompt: '继续做方案比较', title: '方案比较' }, execFor());

  assert.equal(result.sessionId, 'session-new');
  assert.equal(result.workspaceId, 'ws-1');
  assert.equal(result.workspacePath, 'D:/proj');
  assert.equal(result.referenced, true);
  assert.equal(result.title, '方案比较');
  assert.deepEqual(calls.create[0], { workspaceId: 'ws-1', agentPreset: 'preset-a' });
  assert.equal(calls.prompt[0].request.sessionId, 'session-new');
  assert.equal(calls.prompt[0].source.kind, 'user');
  assert.match(calls.prompt[0].request.content[0].text, /继续做方案比较/);
  assert.match(calls.prompt[0].request.content[0].text, /dsh-session:/);
  assert.equal(typeof calls.prompt[0].request.requestId, 'string');

  const meta = tool.output.presentationMeta({}, result);
  assert.equal(meta.sessionId, 'session-new');
  assert.equal(meta.autoSwitch, true);
  assert.match(tool.output.render({}, result)[0].text, /session-new/);
});

test('execute: referenceCurrent=false 或宿主没有 resolver 时不加引用', async () => {
  const { controller, calls } = makeController();
  const services = { sessionController: controller, workspaceRegistry, sessionReferenceResolver: {} };
  const { ctx } = makeContext(services, { referenceCurrent: false });
  const tool = buildTool(ctx, normalizeConfig({ referenceCurrent: false }));
  const result = await tool.execute({ prompt: '继续' }, execFor());
  assert.equal(result.referenced, false);
  assert.doesNotMatch(calls.prompt[0].request.content[0].text, /dsh-session:/);

  const bare = makeController();
  const { ctx: ctx2 } = makeContext({ sessionController: bare.controller, workspaceRegistry });
  const tool2 = buildTool(ctx2, normalizeConfig({}));
  const result2 = await tool2.execute({ prompt: '继续' }, execFor());
  assert.equal(result2.referenced, false);
  assert.doesNotMatch(bare.calls.prompt[0].request.content[0].text, /dsh-session:/);
});

test('execute: preset 失效时退回默认 preset 再建一次', async () => {
  const { controller, calls } = makeController({ failCreateOnce: true });
  const { ctx } = makeContext({
    sessionController: controller,
    workspaceRegistry,
    sessionProjections: { stateOf: () => 'gone-preset' },
  });
  const tool = buildTool(ctx, normalizeConfig({}));
  const result = await tool.execute({ prompt: '继续' }, execFor());
  assert.equal(result.sessionId, 'session-new');
  assert.deepEqual(calls.create[0], { workspaceId: 'ws-1', agentPreset: 'gone-preset' });
  assert.deepEqual(calls.create[1], { workspaceId: 'ws-1' });
});

test('execute: 参数与宿主能力缺失时给出可读错误', async () => {
  const { controller, calls } = makeController();
  const services = { sessionController: controller, workspaceRegistry };
  const { ctx } = makeContext(services);
  const tool = buildTool(ctx, normalizeConfig({}));

  await assert.rejects(() => tool.execute({ prompt: '   ' }, execFor()), /non-empty `prompt`/u);
  assert.equal(calls.create.length, 0);

  await assert.rejects(() => tool.execute({ prompt: '继续' }, { agent: undefined }), /inside an agent session/u);

  const noController = buildTool(makeContext({ workspaceRegistry }).ctx, normalizeConfig({}));
  await assert.rejects(() => noController.execute({ prompt: '继续' }, execFor()), /session controller/u);
});

test('execute: 首条消息被拒时保留会话 id，提示手动发送', async () => {
  const { controller } = makeController({ prompt: async () => { throw new Error('session/agent-busy'); } });
  const { ctx } = makeContext({ sessionController: controller, workspaceRegistry });
  const tool = buildTool(ctx, normalizeConfig({}));
  await assert.rejects(
    () => tool.execute({ prompt: '继续' }, execFor()),
    /session session-new was created but its first message was rejected \(session\/agent-busy\)/u,
  );
});
