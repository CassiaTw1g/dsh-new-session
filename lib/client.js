/**
 * dsh-new-session — browser half.
 *
 * 两件事：
 *   1. 给 `new_conversation` 这次工具调用画一张卡（新对话标题 / session id / 打开按钮）。
 *   2. 结果落地后调 `uiWorkspace.openSession(sessionId)`，把主视图切到新对话 ——
 *      codex 里“说一句就新开一段”的手感就是这一步。
 *
 * 加载方式：浏览器模块表按 package.json 的 `dsh.client` 找到本文件，执行
 * `window.__ModuleLoader__.load({ id, factory })` 只是登记工厂，函数体在首次 require 时跑。
 * 这里只 require 平台种子模块（react / react/jsx-runtime），不再依赖任何其它插件包。
 */

window.__ModuleLoader__.load({
	id: 'dsh-new-session',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const react = require('react');
		const { jsx, jsxs } = require('react/jsx-runtime');

		/** locale 命名空间。 */
		const NS = 'newSession';

		/** 简体中文词典（键集基准）。 */
		const zh = {
			'row.title': '新开对话',
			'row.running': '正在新开对话…',
			'row.switching': '已创建，正在切换',
			'row.switched': '已切换',
			'row.open': '打开',
			'row.failed': '新开对话失败',
			'row.workspace': '工作区',
		};

		/** English dictionary, key-for-key with zh. */
		const en = {
			'row.title': 'New conversation',
			'row.running': 'Opening a new conversation…',
			'row.switching': 'Created — switching over',
			'row.switched': 'Opened',
			'row.open': 'Open',
			'row.failed': 'Could not open a new conversation',
			'row.workspace': 'Workspace',
		};

		/** 只依赖槽位与语言包；uiWorkspace 按需读取，缺了也不阻断加载。 */
		const inject = ['slots', 'locale'];

		/** 已经自动跳过的会话 id，刷新后也不该再把用户拽走。 */
		const STORAGE_PREFIX = 'dsh-new-session:opened:';

		/** 自动切换的时间窗：翻历史记录时旧卡片不许再把当前视图抢走。 */
		const AUTO_SWITCH_MAX_AGE_MS = 3 * 60 * 1000;

		function readSkipped(sessionId) {
			try {
				return window.localStorage.getItem(STORAGE_PREFIX + sessionId) === '1';
			} catch {
				return false;
			}
		}

		function markSkipped(sessionId) {
			try {
				window.localStorage.setItem(STORAGE_PREFIX + sessionId, '1');
			} catch {
				/* 隐私模式下 localStorage 可能不可写，忽略 */
			}
		}

		function isPlainObject(value) {
			return value !== null && typeof value === 'object' && !Array.isArray(value);
		}

		/** 结果节点里取纯文本，失败时用来显示原因。 */
		function resultText(node) {
			if (node === null || typeof node !== 'object' || !Array.isArray(node.content)) return '';
			return node.content
				.map((part) => (isPlainObject(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
				.filter((text) => text !== '')
				.join('\n');
		}

		/** 唯一可信的身份来源：宿主写进 tool/result 的 presentationMeta。 */
		function readCreated(block) {
			if (!isPlainObject(block) || block.kind !== 'tool-result' || block.isError === true) return undefined;
			const meta = block.meta;
			if (!isPlainObject(meta) || typeof meta.sessionId !== 'string' || meta.sessionId === '') return undefined;
			return {
				sessionId: meta.sessionId,
				title: typeof meta.title === 'string' && meta.title !== '' ? meta.title : undefined,
				workspacePath: typeof meta.workspacePath === 'string' ? meta.workspacePath : undefined,
				createdAt: Number.isFinite(meta.createdAt) ? meta.createdAt : undefined,
				autoSwitch: meta.autoSwitch !== false,
				switchDelayMs: Number.isFinite(meta.switchDelayMs) ? Math.max(0, meta.switchDelayMs) : 900,
			};
		}

		/** 小图标：一个对话气泡，避免依赖 primitives 包的图标集。 */
		function BubbleIcon() {
			return jsxs('svg', {
				width: 14,
				height: 14,
				viewBox: '0 0 16 16',
				fill: 'none',
				'aria-hidden': 'true',
				style: { flex: 'none', color: 'var(--dsw-alias-label-secondary, #666)' },
				children: [
					jsx('path', {
						d: 'M2.5 3.2h11a1 1 0 0 1 1 1v6.1a1 1 0 0 1-1 1H7.9L4.6 14v-2.7H2.5a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1Z',
						stroke: 'currentColor',
						strokeWidth: 1.1,
						strokeLinejoin: 'round',
					}),
					jsx('path', { d: 'M5 6.4h6M5 8.7h3.6', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' }),
				],
			});
		}

		/**
		 * 一张卡：结果前显示进行中，结果后显示新对话身份并提供“打开”。
		 * 自动切换只发生一次：成功后写 localStorage，重挂载 / 刷新都不会再抢视图。
		 */
		function NewSessionRow(props) {
			const block = props.block;
			const t = props.t;
			const openSession = typeof props.openSession === 'function'
				? props.openSession
				: typeof props.slot?.injected?.openSession === 'function'
					? props.slot.injected.openSession
					: undefined;

			const created = readCreated(block);
			const failed = isPlainObject(block) && block.kind === 'tool-result' && block.isError === true;
			const running = !isPlainObject(block) || block.kind !== 'tool-result';

			const sessionId = created === undefined ? undefined : created.sessionId;
			const fresh = created === undefined || created.createdAt === undefined
				? false
				: Date.now() - created.createdAt <= AUTO_SWITCH_MAX_AGE_MS;
			const autoSwitch = created === undefined ? false : created.autoSwitch && fresh;
			const delayMs = created === undefined ? 0 : created.switchDelayMs;
			const [opened, setOpened] = react.useState(false);

			react.useEffect(() => {
				if (sessionId === undefined || !autoSwitch || opened) return undefined;
				if (typeof openSession !== 'function') return undefined;
				if (readSkipped(sessionId)) {
					setOpened(true);
					return undefined;
				}
				let cancelled = false;
				let timer;
				let attempts = 0;
				const tick = () => {
					if (cancelled) return;
					try {
						openSession(sessionId);
						markSkipped(sessionId);
						setOpened(true);
					} catch (error) {
						// 客户端会话表还没收到 api-session/added 时 retain 会抛；短退避重试几次。
						attempts += 1;
						if (attempts <= 4) timer = setTimeout(tick, 400);
					}
				};
				timer = setTimeout(tick, delayMs);
				return () => {
					cancelled = true;
					if (timer !== undefined) clearTimeout(timer);
				};
			}, [sessionId, autoSwitch, delayMs, opened, openSession]);

			const onOpen = () => {
				if (sessionId === undefined || typeof openSession !== 'function') return;
				try {
					openSession(sessionId);
					markSkipped(sessionId);
					setOpened(true);
				} catch (error) {
					/* 会话还没进表时按钮点一下没反应，比抛出去好 */
				}
			};

			const title = created?.title ?? t('row.title');
			const status = failed
				? t('row.failed')
				: running
					? t('row.running')
					: opened
						? t('row.switched')
						: autoSwitch
							? t('row.switching')
							: t('row.open');

			const detail = failed
				? resultText(block).trim()
				: created === undefined
					? ''
					: [created.workspacePath === undefined ? '' : `${t('row.workspace')}: ${created.workspacePath}`, created.sessionId]
						.filter((part) => part !== '')
						.join(' · ');

			return jsxs('div', {
				style: {
					display: 'flex',
					alignItems: 'center',
					gap: '8px',
					margin: '2px 0 2px 4px',
					padding: '7px 10px',
					border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
					borderRadius: '10px',
					background: 'var(--dsw-alias-bg-base, transparent)',
					minWidth: 0,
				},
				'data-tool': 'new_conversation',
				'data-state': failed ? 'error' : running ? 'running' : 'ok',
				children: [
					jsx(BubbleIcon, {}),
					jsxs('div', {
						style: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: 'auto' },
						children: [
							jsx('span', {
								style: {
									fontSize: '13px',
									color: failed ? 'var(--dsw-alias-state-error-primary, #c33)' : 'var(--dsw-alias-label-primary, inherit)',
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
								},
								children: title,
							}),
							detail === ''
								? null
								: jsx('span', {
									style: {
										fontSize: '11px',
										color: 'var(--dsw-alias-label-caption, #888)',
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
									},
									children: detail,
								}),
						],
					}),
					sessionId === undefined || opened
						? jsx('span', {
							style: { fontSize: '11px', color: 'var(--dsw-alias-label-caption, #888)', flex: 'none' },
							children: status,
						})
						: jsx('button', {
							type: 'button',
							onClick: onOpen,
							style: {
								flex: 'none',
								fontSize: '12px',
								lineHeight: '18px',
								padding: '1px 9px',
								borderRadius: '999px',
								border: '0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.45))',
								background: 'transparent',
								color: 'var(--dsw-alias-label-secondary, inherit)',
								cursor: 'pointer',
							},
							children: status,
						}),
				],
			});
		}

		/**
		 * 客户端插件入口：词典 + 工具行槽位。
		 * @param {object} ctx - 浏览器侧 cordis 根上下文。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'new-session: dictionaries');
			const openSession = (sessionId) => {
				const uiWorkspace = ctx.get('uiWorkspace');
				if (uiWorkspace === undefined || typeof uiWorkspace.openSession !== 'function') {
					throw new Error('uiWorkspace.openSession is unavailable');
				}
				uiWorkspace.openSession(sessionId);
			};
			ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
				name: 'tool.call.toolview',
				key: 'new_conversation',
				locale: NS,
				inject: () => ({ openSession }),
			}, NewSessionRow));
			ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
				name: 'tool.call.toolview',
				key: 'new_session',
				locale: NS,
				inject: () => ({ openSession }),
			}, NewSessionRow));
		}

		exports.NewSessionRow = NewSessionRow;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
