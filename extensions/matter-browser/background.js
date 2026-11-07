var background = (function() {
	//#region \0rolldown/runtime.js
	var __defProp = Object.defineProperty;
	var __esmMin = (fn, res, err) => () => {
		if (err) throw err[0];
		try {
			return fn && (res = fn(fn = 0)), res;
		} catch (e) {
			throw err = [e], e;
		}
	};
	var __exportAll = (all, no_symbols) => {
		let target = {};
		for (var name in all) __defProp(target, name, {
			get: all[name],
			enumerable: true
		});
		if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
		return target;
	};
	//#endregion
	//#region ../../node_modules/.pnpm/wxt@0.20.27_eslint@9.39.5_jiti@2.7.0__jiti@2.7.0_rolldown@1.2.7_rollup@4.63.1_yaml@2.9.0/node_modules/wxt/dist/utils/define-background.mjs
	function defineBackground(arg) {
		if (arg == null || typeof arg === "function") return { main: arg };
		return arg;
	}
	//#endregion
	//#region entrypoints/background/link/config.ts
	/**
	* 连接配置：这台浏览器认哪个 Matter、拿的是哪把钥匙。
	*
	* 令牌只存 chrome.storage.local，不进日志、不进任何 UI 文本框（弹窗只显示
	* 「已配对」与设备名）。它是「谁拿到谁就能驱动这台浏览器」的凭证——把它显示
	* 出来方便调试的代价，是用户随手截个图就把浏览器交出去了。
	*/
	var STORAGE_KEY = "matter.link";
	var DEFAULT_API_BASE = "https://matter.minduck.com";
	function emptyConfig() {
		return {
			apiBase: DEFAULT_API_BASE,
			allowedSites: []
		};
	}
	async function loadConfig() {
		try {
			const raw = (await chrome.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY];
			if (!raw || typeof raw !== "object") return emptyConfig();
			return {
				...emptyConfig(),
				...raw
			};
		} catch {
			return emptyConfig();
		}
	}
	async function saveConfig(patch) {
		const next = {
			...await loadConfig(),
			...patch
		};
		await chrome.storage.local.set({ [STORAGE_KEY]: next });
		return next;
	}
	async function clearPairing() {
		const cur = await loadConfig();
		const next = {
			apiBase: cur.apiBase,
			allowedSites: cur.allowedSites
		};
		await chrome.storage.local.set({ [STORAGE_KEY]: next });
		return next;
	}
	function isPaired(cfg) {
		return !!cfg.deviceToken && !!cfg.deviceId && !cfg.revoked;
	}
	/** 把 http(s) 基址换成 ws(s) 的连接地址。 */
	function wsURL(apiBase) {
		const base = apiBase.trim().replace(/\/+$/, "");
		return `${base.startsWith("https://") ? `wss://${base.slice(8)}` : base.startsWith("http://") ? `ws://${base.slice(7)}` : base}/api/extensions/device-link/ws`;
	}
	//#endregion
	//#region entrypoints/background/link/presence.ts
	/**
	* 在 Matter 网页上留一个「你现在坐在哪台电脑前」的标记。
	*
	* # 要解决的问题
	*
	* 一个人常有两台配过对的浏览器（公司一台、家里一台）。两台都在线时，服务端没有
	* 任何依据知道该用哪一台——模型看到两组同构工具，只能挑一个，而用户可能正坐在
	* 另一台前面：他说「打开这个网页」，页面在另一座城市的电脑上弹了出来。
	*
	* # 为什么这条信息只有扩展答得出
	*
	* 用户是**在某个浏览器里**跟 Matter 说话的。那个浏览器如果就是配过对的某一台，
	* 它自己知道自己是谁。服务端从 HTTP 请求上看不出来：IP 会被 NAT 合并，User-Agent
	* 在两台 Mac 上一模一样，都不足以区分。所以让扩展把设备 id 写进它自己那个浏览器
	* 打开的 Matter 页面里，请求带上来即可——**这不是推断，是那台机器自报家门**。
	*
	* # 为什么不是改请求头
	*
	* declarativeNetRequest 能给出站请求自动加头，不用网页配合。但那要多申请一个
	* 「读取并修改你的网络请求」权限——装的时候那句话比现在整份权限清单都吓人，而
	* 「权限只减不增」是这个扩展的卖点。写一个 DOM 属性不需要任何新权限。
	*
	* # 安全边界
	*
	* 只在服务端指定的那个源上写（web_origin 随 auth_ok 下发，不是扩展自己猜的），
	* 所以别的网站读不到这个 id、也无从知道你装了 Matter。而 id 本身不是凭证：拿到它
	* 也驱动不了这台浏览器（那需要设备令牌），服务端还会核对这台确实属于请求者。
	*/
	var SCRIPT_ID = "matter-presence";
	/** 记下服务端指定的 Matter 网页地址，并按它重新登记标记脚本。 */
	async function setWebOrigin(webBase) {
		const origin = normalizeOrigin(webBase);
		if ((await loadConfig()).webOrigin !== origin) await saveConfig({ webOrigin: origin });
		await syncPresenceScript();
	}
	/**
	* 把一个源变成 Chrome 的 match pattern。
	*
	* **不能带端口**——Chrome 的 match pattern 规范里 host 不允许出现端口号，带了
	* 整个模式非法，registerContentScripts 直接抛错。实测就是这么坏的：
	* `http://localhost:3001/*` 登记失败，标记一直没写上，而错误被吞在 catch 里，
	* 表面上一切正常。
	*
	* 少了端口这道限制，模式会匹配到同一主机的其他端口（本机开发时尤其容易撞上）。
	* 所以真正的判定不在这里：内容脚本把自己的 location.origin 报上来，后台核对
	* 完整相等才给设备 id。模式只负责「让脚本有机会跑」，给不给答案是另一道。
	*/
	function matchPatternFor(origin) {
		const u = parseWebURL(origin);
		return u ? `${u.protocol}//${u.hostname}/*` : "";
	}
	/**
	* 解析成 http(s) 地址；不是就回 null。
	*
	* 不能只靠 `new URL()` 不抛：`new URL("localhost:3001")` 是**合法**的——它把
	* localhost 当协议、3001 当路径，于是拼出 `localhost:///*` 这种同样非法、同样
	* 被 catch 吞掉的模式。必须显式核对协议与主机名。
	*/
	function parseWebURL(raw) {
		const s = (raw ?? "").trim();
		if (!s) return null;
		try {
			const u = new URL(s);
			if (u.protocol !== "http:" && u.protocol !== "https:" || !u.hostname) return null;
			return u;
		} catch {
			return null;
		}
	}
	/** 配对状态或 web 地址变化后调用：登记、更新或撤掉标记脚本。 */
	async function syncPresenceScript() {
		const cfg = await loadConfig();
		const want = cfg.webOrigin && cfg.deviceId && !cfg.revoked ? matchPatternFor(cfg.webOrigin) : "";
		let existing;
		try {
			existing = (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }))?.[0];
		} catch {
			existing = void 0;
		}
		if (!want) {
			if (existing) try {
				await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
			} catch {}
			return;
		}
		const spec = {
			id: SCRIPT_ID,
			matches: [want],
			js: ["/content-scripts/presence.js"],
			runAt: "document_start",
			persistAcrossSessions: true
		};
		try {
			if (existing) await chrome.scripting.updateContentScripts([spec]);
			else await chrome.scripting.registerContentScripts([spec]);
		} catch {}
		await injectIntoOpenTabs(want);
	}
	/**
	* 往**已经开着的** Matter 页面补注入一次。
	*
	* registerContentScripts 只对**之后的导航**生效。而用户配对的那一刻，Matter 页面
	* 正开在眼前——那一页永远等不到标记，除非他自己刷新。而他不会刷新：页面看上去
	* 一切正常。
	*
	* 后果不是「少个默认值」：服务端见不到标记，就判定「这个人不在任何一台配过的机器
	* 上」，于是把浏览器工具全部摘掉，并告诉他「你这台电脑上还没装 Matter 浏览器助手」
	* ——而他刚刚配对成功，屏幕上就写着「在线」。26-09-09 实测：用户连说三轮
	* 「我给你配置了 chrome 啊 你怎么不能用」，前两轮 Matter 一次浏览器都没碰。
	*
	* 补注入失败不做任何补救：那一页刷新一次就好了，而这里再重试也只是重复同一个失败。
	*/
	async function injectIntoOpenTabs(matchPattern) {
		if (!matchPattern) return;
		let tabs = [];
		try {
			tabs = await chrome.tabs.query({ url: matchPattern });
		} catch {
			return;
		}
		for (const t of tabs) {
			if (typeof t.id !== "number") continue;
			try {
				await chrome.scripting.executeScript({
					target: { tabId: t.id },
					files: ["/content-scripts/presence.js"]
				});
			} catch {}
		}
	}
	/**
	* 内容脚本问「我该写哪个 id」时的答案。未配对时回空，脚本据此把标记清掉。
	*
	* origin 非空时必须与服务端指定的那个**完整相等**（含端口）才给。match pattern
	* 带不了端口，所以这一道才是真正的门：没有它，本机上跑在别的端口的任意页面都能
	* 读到设备 id。
	*/
	async function presenceDeviceID(origin) {
		const cfg = await loadConfig();
		if (!cfg.deviceId || cfg.revoked) return "";
		if (origin !== void 0 && origin !== cfg.webOrigin) return "";
		return cfg.deviceId;
	}
	/** 取源部分；给的不是个合法地址就当没有。 */
	function normalizeOrigin(raw) {
		const u = parseWebURL(raw ?? "");
		return u ? u.origin : void 0;
	}
	//#endregion
	//#region entrypoints/background/link/pairing.ts
	/**
	* 配对：用户在网页拿到一串一次性配对码，粘到弹窗里核销，换回设备令牌。
	*
	* 为什么是复制粘贴而不是「网页一键唤起扩展」：后者要求扩展在清单里声明
	* externally_connectable 并写死我们的域名——把一个可以被任何页面探测的入口
	* 装进每个用户的浏览器，只为省掉一次 Ctrl+V。
	*/
	/** 服务端的稳定分类码 → 用户读得懂的一句话。 */
	var MESSAGES = {
		pairing_code_invalid: "配对码不正确，请回到 Matter 网页重新获取。",
		pairing_code_expired: "配对码已过期，请回到 Matter 网页重新获取。",
		pairing_code_used: "这个配对码已经用过了，请重新获取一个。",
		rate_limited: "尝试太频繁，请过一会儿再试。"
	};
	function pairingErrorMessage(code, fallback) {
		return MESSAGES[code] || fallback || "连接失败，请检查服务器地址是否正确。";
	}
	async function redeem(input) {
		const apiBase = input.apiBase.trim().replace(/\/+$/, "");
		const previous = await loadConfig();
		const res = await fetch(`${apiBase}/api/extensions/device-link/redeem`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				code: input.code.trim(),
				device_name: input.deviceName.trim(),
				browser: browserLabel(),
				user_agent: navigator.userAgent,
				extension_version: chrome.runtime.getManifest().version,
				previous_device_token: previous.deviceToken || void 0
			})
		});
		if (!res.ok) {
			let code = "pairing_code_invalid";
			let message = "";
			try {
				const body = await res.json();
				code = body?.error?.code || code;
				message = body?.error?.message || "";
			} catch {
				throw new Error("连接失败，请检查服务器地址是否正确。");
			}
			throw new Error(pairingErrorMessage(code, message));
		}
		const data = await res.json();
		return saveConfig({
			apiBase,
			deviceId: data.device_id,
			deviceToken: data.device_token,
			deviceName: data.device_name,
			revoked: false
		});
	}
	/** 扩展侧「断开并解除配对」：告诉服务端把这台设备撤销，再清掉本地令牌。 */
	async function unpair() {
		const cfg = await loadConfig();
		if (cfg.apiBase && cfg.deviceToken) try {
			await fetch(`${cfg.apiBase}/api/extensions/device-link/self`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${cfg.deviceToken}` }
			});
		} catch {}
	}
	function browserLabel() {
		const m = navigator.userAgent.match(/Chrome\/([\d.]+)/);
		return m ? `Chrome/${m[1]}` : "Chrome";
	}
	/** 默认设备名。用户在弹窗里可以改。 */
	function defaultDeviceName() {
		const platform = /Mac/.test(navigator.userAgent) ? "Mac" : /Windows/.test(navigator.userAgent) ? "Windows" : /Linux/.test(navigator.userAgent) ? "Linux" : "";
		return platform ? `${platform} 上的 Chrome` : "我的 Chrome";
	}
	//#endregion
	//#region entrypoints/background/link/transport.ts
	/**
	* 到 Matter 的链路：一条 WebSocket，扩展主动拨出。
	*
	* # 为什么是扩展拨出去
	*
	* 浏览器装在用户自己的电脑上，没有公网地址可连。方向反过来之后，服务端只需要
	* 一个公开的 WS 端点，用户这边不用开端口、不用装本机程序（上游那个 Node 桥就此
	* 删掉）、公司网络也不必放行入站。
	*
	* # 保活
	*
	* Chrome 116+ 起 WebSocket 收发会重置 service worker 的空闲计时器，而服务端每
	* 20 秒发一次 ping——连接本身就是保活，不需要 offscreen 文档（上游那套连同它的
	* offscreen 权限一并删了）。真掉线时靠 chrome.alarms 每分钟一次的 ensure 唤醒重连。
	*/
	/** 关闭码与后续动作的对照表（服务端 §5.3 的另一半，改一边就是断链）。 */
	var CLOSE = {
		AUTH_TIMEOUT: 4e3,
		INVALID_TOKEN: 4001,
		REPLACED: 4002,
		REVOKED: 4003,
		PROTOCOL_ERROR: 4004
	};
	CLOSE.INVALID_TOKEN, CLOSE.REPLACED, CLOSE.REVOKED;
	var RECONNECT_BASE_MS = 500;
	var RECONNECT_MAX_MS = 6e4;
	var RECONNECT_FAST_ATTEMPTS = 8;
	var RECONNECT_COOLDOWN_MS = 3e5;
	var socket = null;
	var status = {
		state: "unpaired",
		attempts: 0
	};
	var reconnectTimer = null;
	var manualStop = false;
	var onMessage = () => {};
	var listeners = /* @__PURE__ */ new Set();
	function onMcpMessage(handler) {
		onMessage = handler;
	}
	function getStatus() {
		return { ...status };
	}
	function subscribe(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}
	function setStatus(patch) {
		status = {
			...status,
			...patch
		};
		for (const fn of listeners) fn({ ...status });
		chrome.runtime.sendMessage({
			type: "matter.link.status",
			payload: status
		}).catch(() => {});
	}
	/** 把一条 MCP 消息发出去。没连上时静默丢弃——调用方是应答，没有重发的意义。 */
	function send(payload) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
	}
	/** 已连接就直接返回；否则拨一条。SW 每次醒来都会调它。 */
	async function ensureConnected() {
		if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
		const cfg = await loadConfig();
		if (!isPaired(cfg)) {
			setStatus({ state: cfg.revoked ? "revoked" : "unpaired" });
			return;
		}
		manualStop = false;
		connect(cfg);
	}
	function disconnect() {
		manualStop = true;
		clearReconnect();
		if (socket) {
			try {
				socket.close(1e3, "client disconnect");
			} catch {}
			socket = null;
		}
		setStatus({
			state: "unpaired",
			attempts: 0
		});
	}
	function clearReconnect() {
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	function connect(cfg) {
		clearReconnect();
		setStatus({
			state: "connecting",
			deviceName: cfg.deviceName
		});
		let ws;
		try {
			ws = new WebSocket(wsURL(cfg.apiBase));
		} catch {
			scheduleReconnect("地址不对，连不上");
			return;
		}
		socket = ws;
		ws.onopen = () => {
			ws.send(JSON.stringify({
				type: "auth",
				token: cfg.deviceToken,
				device_id: cfg.deviceId,
				extension_version: chrome.runtime.getManifest().version,
				browser: browserLabel(),
				capabilities: { tab_groups: true }
			}));
		};
		ws.onmessage = (ev) => handleFrame(String(ev.data));
		ws.onclose = (ev) => {
			socket = null;
			handleClose(ev.code, ev.reason);
		};
		ws.onerror = () => {};
	}
	function handleFrame(raw) {
		let probe;
		try {
			probe = JSON.parse(raw);
		} catch {
			return;
		}
		if (probe.jsonrpc) {
			onMessage(raw);
			return;
		}
		switch (probe.type) {
			case "auth_ok":
				status.attempts = 0;
				setStatus({
					state: "online",
					deviceName: probe.device_name,
					lastReason: void 0,
					latestVersion: probe.latest_version
				});
				setWebOrigin(probe.web_origin);
				if (probe.device_name) saveConfig({ deviceName: probe.device_name });
				break;
			case "auth_error": break;
			case "ping": send({ type: "pong" });
		}
	}
	async function handleClose(code, reason) {
		if (manualStop) return;
		if (code === CLOSE.REVOKED) {
			await saveConfig({
				deviceToken: void 0,
				revoked: true
			});
			setStatus({
				state: "revoked",
				lastReason: "这台浏览器的授权已在 Matter 网页里撤销"
			});
			return;
		}
		if (code === CLOSE.INVALID_TOKEN) {
			await saveConfig({ revoked: true });
			setStatus({
				state: "revoked",
				lastReason: "登录凭证已失效，请重新配对"
			});
			return;
		}
		if (code === CLOSE.REPLACED) {
			setStatus({
				state: "replaced",
				lastReason: "这台浏览器已在另一处接管"
			});
			return;
		}
		scheduleReconnect(closeReason(code, reason));
	}
	function closeReason(code, reason) {
		switch (code) {
			case CLOSE.AUTH_TIMEOUT: return "认证超时";
			case CLOSE.PROTOCOL_ERROR: return "协议错误";
			case 1001: return "服务端断开（心跳超时或重启）";
			case 1006: return "网络断开";
			case 1013: return "服务端连接数已满";
			default: return reason || `连接关闭（${code}）`;
		}
	}
	function scheduleReconnect(reason) {
		const attempts = status.attempts + 1;
		setStatus({
			state: "offline",
			lastReason: reason,
			attempts
		});
		clearReconnect();
		reconnectTimer = setTimeout(() => void ensureConnected(), reconnectDelay(attempts - 1));
	}
	/** 500ms 起指数退避到 60s，带抖动；8 次快速重试后进入 5 分钟一次的冷却。 */
	function reconnectDelay(attempt) {
		const base = attempt >= RECONNECT_FAST_ATTEMPTS ? RECONNECT_COOLDOWN_MS : Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
		const jitter = .7 + Math.random() * .6;
		return Math.max(0, Math.round(base * jitter));
	}
	//#endregion
	//#region ../../packages/shared/dist/index.mjs
	var TOOL_NAMES = { BROWSER: {
		GET_WINDOWS_AND_TABS: "get_windows_and_tabs",
		NAVIGATE: "chrome_navigate",
		READ_PAGE: "chrome_read_page",
		WEB_FETCHER: "chrome_get_web_content",
		GET_INTERACTIVE_ELEMENTS: "chrome_get_interactive_elements",
		CLICK: "chrome_click_element",
		FILL: "chrome_fill_or_select",
		KEYBOARD: "chrome_keyboard",
		COMPUTER: "chrome_computer",
		SCREENSHOT: "chrome_screenshot",
		SWITCH_TAB: "chrome_switch_tab",
		CLOSE_TABS: "chrome_close_tabs",
		HANDLE_DIALOG: "chrome_handle_dialog",
		FILE_UPLOAD: "chrome_upload_file",
		JAVASCRIPT: "chrome_javascript"
	} };
	TOOL_NAMES.BROWSER.FILE_UPLOAD, TOOL_NAMES.BROWSER.JAVASCRIPT;
	var TOOL_SCHEMAS = [
		{
			name: TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
			description: "Get all currently open browser windows and tabs",
			inputSchema: {
				type: "object",
				properties: {},
				required: []
			},
			annotations: { readOnlyHint: true }
		},
		{
			name: TOOL_NAMES.BROWSER.NAVIGATE,
			description: "Navigate to a URL, refresh the current tab, or navigate browser history (back/forward)",
			inputSchema: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "URL to navigate to. Special values: \"back\" or \"forward\" to navigate browser history in the target tab."
					},
					newWindow: {
						type: "boolean",
						description: "Create a new window to navigate to the URL or not. Defaults to false"
					},
					tabId: {
						type: "number",
						description: "Target an existing tab by ID (if provided, navigate/refresh/back/forward that tab instead of the active tab)."
					},
					windowId: {
						type: "number",
						description: "Target an existing window by ID (when creating a new tab in existing window, or picking active tab if tabId is not provided)."
					},
					background: {
						type: "boolean",
						description: "Perform the operation without stealing focus (do not activate the tab or focus the window). Default: false"
					},
					width: {
						type: "number",
						description: "Window width in pixels (default: 1280). When width or height is provided, a new window will be created."
					},
					height: {
						type: "number",
						description: "Window height in pixels (default: 720). When width or height is provided, a new window will be created."
					},
					refresh: {
						type: "boolean",
						description: "Refresh the current active tab instead of navigating to a URL. When true, the url parameter is ignored. Defaults to false"
					}
				},
				required: []
			},
			annotations: {
				destructiveHint: false,
				idempotentHint: false
			}
		},
		{
			name: TOOL_NAMES.BROWSER.READ_PAGE,
			description: `Get an accessibility tree representation of visible elements on the page. Only returns elements that are visible in the viewport. Optionally filter for only interactive elements.
Tip: If the returned elements do not include the specific element you need, use the computer tool's screenshot (action="screenshot") to capture the element's on-screen coordinates, then operate by coordinates.`,
			inputSchema: {
				type: "object",
				properties: {
					filter: {
						type: "string",
						description: "Filter elements: \"interactive\" for such as  buttons/links/inputs only (default: all visible elements)"
					},
					depth: {
						type: "number",
						description: "Maximum DOM depth to traverse (integer >= 0). Lower values reduce output size and can improve performance."
					},
					refId: {
						type: "string",
						description: "Focus on the subtree rooted at this element refId (e.g., \"ref_12\"). The refId must come from a recent chrome_read_page response in the same tab (refs may expire)."
					},
					tabId: {
						type: "number",
						description: "Target an existing tab by ID (default: active tab)."
					},
					windowId: {
						type: "number",
						description: "Target window ID to pick active tab when tabId is omitted."
					}
				},
				required: []
			},
			annotations: { readOnlyHint: true }
		},
		{
			name: TOOL_NAMES.BROWSER.WEB_FETCHER,
			description: "Fetch content from a web page",
			inputSchema: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "URL to fetch content from. If not provided, uses the current active tab"
					},
					tabId: {
						type: "number",
						description: "Target an existing tab by ID (default: active tab)."
					},
					background: {
						type: "boolean",
						description: "Do not activate tab/focus window while fetching (default: false)"
					},
					htmlContent: {
						type: "boolean",
						description: "Get the visible HTML content of the page. If true, textContent will be ignored (default: false)"
					},
					textContent: {
						type: "boolean",
						description: "Get the visible text content of the page with metadata. Ignored if htmlContent is true (default: true)"
					},
					selector: {
						type: "string",
						description: "CSS selector to get content from a specific element. If provided, only content from this element will be returned"
					}
				},
				required: []
			},
			annotations: { readOnlyHint: true }
		},
		{
			name: TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS,
			description: "List the interactive elements (buttons, links, inputs) on the current page. Prefer chrome_read_page: it returns refs you can act on directly.",
			inputSchema: {
				type: "object",
				properties: {
					textQuery: {
						type: "string",
						description: "Fuzzy-match element text"
					},
					selector: {
						type: "string",
						description: "CSS selector to filter elements"
					},
					includeCoordinates: {
						type: "boolean",
						description: "Include coordinates (default true)"
					},
					types: {
						type: "array",
						items: { type: "string" },
						description: "Element types to include; omit for all"
					}
				},
				required: []
			},
			annotations: { readOnlyHint: true }
		},
		{
			name: TOOL_NAMES.BROWSER.CLICK,
			description: "Click on an element in a web page. Supports multiple targeting methods: CSS selector, XPath, element ref (from chrome_read_page), or viewport coordinates. More focused than chrome_computer for simple click operations.",
			inputSchema: {
				type: "object",
				properties: {
					selector: {
						type: "string",
						description: "CSS selector or XPath for the element to click."
					},
					selectorType: {
						type: "string",
						enum: ["css", "xpath"],
						description: "Type of selector (default: \"css\")."
					},
					ref: {
						type: "string",
						description: "Element ref from chrome_read_page (takes precedence over selector)."
					},
					coordinates: {
						type: "object",
						description: "Viewport coordinates to click at.",
						properties: {
							x: { type: "number" },
							y: { type: "number" }
						},
						required: ["x", "y"]
					},
					double: {
						type: "boolean",
						description: "Perform double click when true (default: false)."
					},
					button: {
						type: "string",
						enum: [
							"left",
							"right",
							"middle"
						],
						description: "Mouse button to click (default: \"left\")."
					},
					modifiers: {
						type: "object",
						description: "Modifier keys to hold during click.",
						properties: {
							altKey: { type: "boolean" },
							ctrlKey: { type: "boolean" },
							metaKey: { type: "boolean" },
							shiftKey: { type: "boolean" }
						}
					},
					waitForNavigation: {
						type: "boolean",
						description: "Wait for navigation to complete after click (default: false)."
					},
					timeout: {
						type: "number",
						description: "Timeout in milliseconds for waiting (default: 5000)."
					},
					tabId: {
						type: "number",
						description: "Target tab ID. If omitted, uses the current active tab."
					},
					windowId: {
						type: "number",
						description: "Window ID to select active tab from (when tabId is omitted)."
					},
					frameId: {
						type: "number",
						description: "Target frame ID for iframe support."
					}
				},
				required: []
			},
			annotations: { destructiveHint: false }
		},
		{
			name: TOOL_NAMES.BROWSER.FILL,
			description: "Fill or select a form element on a web page. Supports input, textarea, select, checkbox, and radio elements. Use CSS selector, XPath, or element ref to target the element.",
			inputSchema: {
				type: "object",
				properties: {
					selector: {
						type: "string",
						description: "CSS selector or XPath for the form element."
					},
					selectorType: {
						type: "string",
						enum: ["css", "xpath"],
						description: "Type of selector (default: \"css\")."
					},
					ref: {
						type: "string",
						description: "Element ref from chrome_read_page (takes precedence over selector)."
					},
					value: {
						type: [
							"string",
							"number",
							"boolean"
						],
						description: "Value to fill. For text inputs: string. For checkboxes/radios: boolean. For selects: option value or text."
					},
					tabId: {
						type: "number",
						description: "Target tab ID. If omitted, uses the current active tab."
					},
					windowId: {
						type: "number",
						description: "Window ID to select active tab from (when tabId is omitted)."
					},
					frameId: {
						type: "number",
						description: "Target frame ID for iframe support."
					}
				},
				required: ["value"]
			},
			annotations: { destructiveHint: false }
		},
		{
			name: TOOL_NAMES.BROWSER.KEYBOARD,
			description: "Simulate keyboard input on a web page. Supports single keys (Enter, Tab, Escape), key combinations (Ctrl+C, Ctrl+V), and text input. Can target a specific element or send to the focused element.",
			inputSchema: {
				type: "object",
				properties: {
					keys: {
						type: "string",
						description: "Keys or key combinations to simulate. Examples: \"Enter\", \"Tab\", \"Ctrl+C\", \"Shift+Tab\", \"Hello World\"."
					},
					selector: {
						type: "string",
						description: "CSS selector or XPath for target element to receive keyboard events."
					},
					selectorType: {
						type: "string",
						enum: ["css", "xpath"],
						description: "Type of selector (default: \"css\")."
					},
					delay: {
						type: "number",
						description: "Delay between keystrokes in milliseconds (default: 50)."
					},
					tabId: {
						type: "number",
						description: "Target tab ID. If omitted, uses the current active tab."
					},
					windowId: {
						type: "number",
						description: "Window ID to select active tab from (when tabId is omitted)."
					},
					frameId: {
						type: "number",
						description: "Target frame ID for iframe support."
					}
				},
				required: ["keys"]
			},
			annotations: { destructiveHint: false }
		},
		{
			name: TOOL_NAMES.BROWSER.COMPUTER,
			description: "Use a mouse and keyboard to interact with a web browser, and take screenshots.\n* Whenever you intend to click on an element like an icon, you should consult a read_page to determine the ref of the element before moving the cursor.\n* If you tried clicking on a program or link but it failed to load, even after waiting, try screenshot and then adjusting your click location so that the tip of the cursor visually falls on the element that you want to click.\n* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.",
			inputSchema: {
				type: "object",
				properties: {
					tabId: {
						type: "number",
						description: "Target tab ID (default: active tab)"
					},
					background: {
						type: "boolean",
						description: "Avoid focusing/activating tab/window for certain operations (best-effort). Default: false"
					},
					action: {
						type: "string",
						description: "Action to perform: left_click | right_click | double_click | triple_click | left_click_drag | scroll | scroll_to | type | key | fill | fill_form | hover | wait | resize_page | zoom | screenshot"
					},
					ref: {
						type: "string",
						description: "Element ref from chrome_read_page. For click/scroll/scroll_to/key/type and drag end when provided; takes precedence over coordinates."
					},
					coordinates: {
						type: "object",
						properties: {
							x: {
								type: "number",
								description: "X coordinate"
							},
							y: {
								type: "number",
								description: "Y coordinate"
							}
						},
						description: "Coordinates for actions (in screenshot space if a recent screenshot was taken, otherwise viewport). Required for click/scroll and as end point for drag."
					},
					startCoordinates: {
						type: "object",
						properties: {
							x: { type: "number" },
							y: { type: "number" }
						},
						description: "Starting coordinates for drag action"
					},
					startRef: {
						type: "string",
						description: "Drag start ref from chrome_read_page (alternative to startCoordinates)."
					},
					scrollDirection: {
						type: "string",
						description: "Scroll direction: up | down | left | right"
					},
					scrollAmount: {
						type: "number",
						description: "Scroll ticks (1-10), default 3"
					},
					text: {
						type: "string",
						description: "Text to type (for action=type) or keys/chords separated by space (for action=key, e.g. \"Backspace Enter\" or \"cmd+a\")"
					},
					repeat: {
						type: "number",
						description: "For action=key: number of times to repeat the key sequence (integer 1-100, default 1)."
					},
					modifiers: {
						type: "object",
						description: "Modifier keys for click actions (left_click/right_click/double_click/triple_click).",
						properties: {
							altKey: { type: "boolean" },
							ctrlKey: { type: "boolean" },
							metaKey: { type: "boolean" },
							shiftKey: { type: "boolean" }
						}
					},
					region: {
						type: "object",
						description: "For action=zoom: rectangular region to capture (x0,y0)-(x1,y1) in viewport pixels (or screenshot-space if a recent screenshot context exists).",
						properties: {
							x0: { type: "number" },
							y0: { type: "number" },
							x1: { type: "number" },
							y1: { type: "number" }
						},
						required: [
							"x0",
							"y0",
							"x1",
							"y1"
						]
					},
					selector: {
						type: "string",
						description: "CSS selector for fill (alternative to ref)."
					},
					value: {
						oneOf: [
							{ type: "string" },
							{ type: "boolean" },
							{ type: "number" }
						],
						description: "Value to set for action=fill (string | boolean | number)"
					},
					elements: {
						type: "array",
						description: "For action=fill_form: list of elements to fill (ref + value)",
						items: {
							type: "object",
							properties: {
								ref: {
									type: "string",
									description: "Element ref from chrome_read_page"
								},
								value: {
									type: "string",
									description: "Value to set (stringified if non-string)"
								}
							},
							required: ["ref", "value"]
						}
					},
					width: {
						type: "number",
						description: "For action=resize_page: viewport width"
					},
					height: {
						type: "number",
						description: "For action=resize_page: viewport height"
					},
					appear: {
						type: "boolean",
						description: "For action=wait with text: whether to wait for the text to appear (true, default) or disappear (false)"
					},
					timeout: {
						type: "number",
						description: "For action=wait with text: timeout in milliseconds (default 10000, max 120000)"
					},
					duration: {
						type: "number",
						description: "Seconds to wait for action=wait (max 30s)"
					}
				},
				required: ["action"]
			},
			annotations: { destructiveHint: false }
		},
		{
			name: TOOL_NAMES.BROWSER.SCREENSHOT,
			description: "Take a screenshot of the current page or a specific element. The image is saved and shown to the user; you will not see it, so use chrome_read_page to locate elements. Prefer chrome_computer with action=\"screenshot\" unless you need the advanced options here.",
			inputSchema: {
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "Name for the screenshot (used in the saved filename)"
					},
					selector: {
						type: "string",
						description: "CSS selector for element to screenshot"
					},
					tabId: {
						type: "number",
						description: "Target tab ID to capture from (default: active tab)."
					},
					windowId: {
						type: "number",
						description: "Target window ID to pick active tab from when tabId is not provided."
					},
					background: {
						type: "boolean",
						description: "Attempt capture without bringing tab/window to foreground. CDP-based capture is used for simple viewport captures. For element/full-page capture, the tab may still be made active in its window without focusing the window. Default: false"
					},
					width: {
						type: "number",
						description: "Width in pixels (default: 800)"
					},
					height: {
						type: "number",
						description: "Height in pixels (default: 600)"
					},
					fullPage: {
						type: "boolean",
						description: "Capture the entire scrollable page instead of just the viewport (default: false)"
					}
				},
				required: []
			},
			annotations: { readOnlyHint: true }
		},
		{
			name: TOOL_NAMES.BROWSER.SWITCH_TAB,
			description: "Switch to a specific browser tab",
			inputSchema: {
				type: "object",
				properties: {
					tabId: {
						type: "number",
						description: "The ID of the tab to switch to."
					},
					windowId: {
						type: "number",
						description: "The ID of the window where the tab is located."
					}
				},
				required: ["tabId"]
			},
			annotations: { readOnlyHint: true }
		},
		{
			name: TOOL_NAMES.BROWSER.CLOSE_TABS,
			description: "Close one or more browser tabs",
			inputSchema: {
				type: "object",
				properties: {
					tabIds: {
						type: "array",
						items: { type: "number" },
						description: "Array of tab IDs to close. If not provided, will close the active tab."
					},
					url: {
						type: "string",
						description: "Close tabs matching this URL. Can be used instead of tabIds."
					}
				},
				required: []
			},
			annotations: { destructiveHint: false }
		},
		{
			name: TOOL_NAMES.BROWSER.HANDLE_DIALOG,
			description: "Handle JavaScript dialogs (alert/confirm/prompt) via CDP",
			inputSchema: {
				type: "object",
				properties: {
					action: {
						type: "string",
						description: "accept | dismiss"
					},
					promptText: {
						type: "string",
						description: "Optional prompt text when accepting a prompt"
					}
				},
				required: ["action"]
			},
			annotations: { destructiveHint: false }
		},
		{
			name: TOOL_NAMES.BROWSER.FILE_UPLOAD,
			description: "Put a file that is already stored in Matter into a page's file input. Only /media/... paths are accepted — arbitrary local paths, external URLs and inline data are rejected. If the user has not put the file into the conversation yet, ask them to do that first.",
			inputSchema: {
				type: "object",
				properties: {
					tabId: {
						type: "number",
						description: "Target tab ID (default: the Matter tab group target)"
					},
					windowId: {
						type: "number",
						description: "Target window ID to pick active tab when tabId is omitted"
					},
					selector: {
						type: "string",
						description: "CSS selector for the file input element (input[type=\"file\"])"
					},
					mediaUrl: {
						type: "string",
						description: "Matter-stored file to upload, e.g. \"/media/<user>/<file>.pdf\" as returned by an attachment, a deliverable or a generated image. Nothing else is accepted."
					},
					fileName: {
						type: "string",
						description: "Name the page should see (default: the last segment of mediaUrl)"
					}
				},
				required: ["selector", "mediaUrl"]
			},
			annotations: { destructiveHint: true }
		},
		{
			name: TOOL_NAMES.BROWSER.JAVASCRIPT,
			description: "Execute JavaScript code in a browser tab and return the result. Uses CDP Runtime.evaluate with awaitPromise and returnByValue; automatically falls back to chrome.scripting.executeScript if the debugger is busy. Output is sanitized (sensitive data redacted) and truncated by default.",
			inputSchema: {
				type: "object",
				properties: {
					code: {
						type: "string",
						description: "JavaScript code to execute. Runs inside an async function body, so top-level await and \"return ...\" are supported."
					},
					tabId: {
						type: "number",
						description: "Target tab ID. If omitted, uses the current active tab."
					},
					timeoutMs: {
						type: "number",
						description: "Execution timeout in milliseconds (default: 15000)."
					},
					maxOutputBytes: {
						type: "number",
						description: "Maximum output size in bytes after sanitization (default: 51200). Output exceeding this limit will be truncated."
					}
				},
				required: ["code"]
			},
			annotations: { destructiveHint: true }
		}
	];
	//#endregion
	//#region common/tool-handler.ts
	var createErrorResponse = (message = "Unknown error, please try again") => {
		return {
			content: [{
				type: "text",
				text: message
			}],
			isError: true
		};
	};
	//#endregion
	//#region common/constants.ts
	var TIMEOUTS = {
		DEFAULT_WAIT: 1e3,
		NETWORK_CAPTURE_MAX: 3e4,
		NETWORK_CAPTURE_IDLE: 3e3,
		SCREENSHOT_DELAY: 100,
		KEYBOARD_DELAY: 50,
		CLICK_DELAY: 100
	};
	var ERROR_MESSAGES = {
		NATIVE_CONNECTION_FAILED: "Failed to connect to native host",
		NATIVE_DISCONNECTED: "Native connection disconnected",
		SERVER_STATUS_LOAD_FAILED: "Failed to load server status",
		SERVER_STATUS_SAVE_FAILED: "Failed to save server status",
		TOOL_EXECUTION_FAILED: "Tool execution failed",
		INVALID_PARAMETERS: "Invalid parameters provided",
		PERMISSION_DENIED: "Permission denied",
		TAB_NOT_FOUND: "Tab not found",
		ELEMENT_NOT_FOUND: "Element not found",
		NETWORK_ERROR: "Network error occurred"
	};
	//#endregion
	//#region entrypoints/background/tools/base-browser.ts
	var PING_TIMEOUT_MS = 300;
	/**
	* 每个内容脚本各自应答的探测动作。
	*
	* # 为什么不能用工具名探测
	*
	* 原来这里发的是 `${this.name}_ping`——**工具名**。只要一个工具只注入一个脚本，
	* 它碰巧是对的；而 `chrome_read_page` 要注入两个（无障碍树 helper，稀疏时再补
	* 可交互元素 helper）。第二次注入前发出的仍是 `chrome_read_page_ping`，
	* 而那个 ping 被**第一个** helper 应答了——于是探测认为「已注入」直接返回，
	* 第二个脚本从来没被注入过，紧接着的 sendMessage 找不到监听器。
	*
	* 后果不是偶发：`read_page` 的稀疏页 fallback 在**任何**页面上都不可能成功
	* （26-09-09 真机验收，example.com 上稳定复现「Accessibility tree is too sparse
	* and fallback failed」）。
	*
	* 探测必须认脚本，不能认工具。映射写死是有意的：这几个 ping 名字硬编码在各
	* helper 里，靠命名约定推导只会在下一次改名时静默退回到今天这个 bug。
	*/
	var SCRIPT_PING_ACTIONS = {
		"accessibility-tree-helper.js": "chrome_read_page_ping",
		"interactive-elements-helper.js": "chrome_get_interactive_elements_ping",
		"click-helper.js": "chrome_click_element_ping",
		"fill-helper.js": "chrome_fill_or_select_ping",
		"keyboard-helper.js": "chrome_keyboard_ping",
		"screenshot-helper.js": "chrome_screenshot_ping",
		"web-fetcher-helper.js": "chrome_web_fetcher_ping",
		"dom-observer.js": "dom_observer_ping",
		"wait-helper.js": "wait_helper_ping"
	};
	/**
	* 这批脚本该用哪个探测动作。认不出来就返回 null —— 调用方据此**跳过探测直接注入**。
	* 每个 helper 顶部都有 `__X_INITIALIZED__` 重复注入守卫，多注入一次的代价只是一次
	* executeScript，而探测错的代价是脚本根本没进去。
	*/
	function pingActionForScripts(files) {
		const actions = /* @__PURE__ */ new Set();
		for (const f of files) {
			const action = SCRIPT_PING_ACTIONS[f.split("/").pop() || f];
			if (!action) return null;
			actions.add(action);
		}
		return actions.size === 1 ? [...actions][0] : null;
	}
	var BaseBrowserToolExecutor = class {
		/**
		* Inject content script into tab
		*/
		async injectContentScript(tabId, files, injectImmediately = false, world = "ISOLATED", allFrames = false, frameIds) {
			console.log(`Injecting ${files.join(", ")} into tab ${tabId}`);
			const pingAction = pingActionForScripts(files);
			if (pingAction) try {
				const pingFrameId = frameIds?.[0];
				const response = await Promise.race([typeof pingFrameId === "number" ? chrome.tabs.sendMessage(tabId, { action: pingAction }, { frameId: pingFrameId }) : chrome.tabs.sendMessage(tabId, { action: pingAction }), new Promise((_, reject) => setTimeout(() => reject(/* @__PURE__ */ new Error(`${pingAction} to tab ${tabId} timed out`)), PING_TIMEOUT_MS))]);
				if (response && response.status === "pong") {
					console.log(`pong for '${pingAction}' in tab ${tabId}; script already active.`);
					return;
				}
			} catch {}
			try {
				const target = { tabId };
				if (frameIds && frameIds.length > 0) target.frameIds = frameIds;
				else if (allFrames) target.allFrames = true;
				await chrome.scripting.executeScript({
					target,
					files,
					injectImmediately,
					world
				});
				console.log(`'${files.join(", ")}' injection successful for tab ${tabId}`);
			} catch (injectionError) {
				const errorMessage = injectionError instanceof Error ? injectionError.message : String(injectionError);
				console.error(`Content script '${files.join(", ")}' injection failed for tab ${tabId}: ${errorMessage}`);
				throw new Error(`${ERROR_MESSAGES.TOOL_EXECUTION_FAILED}: Failed to inject content script in tab ${tabId}: ${errorMessage}`);
			}
		}
		/**
		* Send message to tab
		*/
		async sendMessageToTab(tabId, message, frameId) {
			try {
				const response = typeof frameId === "number" ? await chrome.tabs.sendMessage(tabId, message, { frameId }) : await chrome.tabs.sendMessage(tabId, message);
				if (response && response.error) throw new Error(String(response.error));
				return response;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Error sending message to tab ${tabId} for action ${message?.action || "unknown"}: ${errorMessage}`);
				if (error instanceof Error) throw error;
				throw new Error(errorMessage);
			}
		}
		/**
		* Resolve an explicit tab or fail. Only an omitted id returns null.
		*/
		async tryGetTab(tabId) {
			if (typeof tabId !== "number") return null;
			return await chrome.tabs.get(tabId);
		}
		/**
		* Get the active tab in the current window. Throws when not found.
		*/
		async getActiveTabOrThrow() {
			const [active] = await chrome.tabs.query({
				active: true,
				currentWindow: true
			});
			if (!active || !active.id) throw new Error("Active tab not found");
			return active;
		}
		/**
		* Optionally focus window and/or activate tab. Defaults preserve current behavior
		* when caller sets activate/focus flags explicitly.
		*/
		async ensureFocus(tab, options = {}) {
			const activate = options.activate === true;
			if (options.focusWindow === true && typeof tab.windowId === "number") await chrome.windows.update(tab.windowId, { focused: true });
			if (activate && typeof tab.id === "number") await chrome.tabs.update(tab.id, { active: true });
		}
		/**
		* Get the active tab. When windowId provided, search within that window; otherwise currentWindow.
		*/
		async getActiveTabInWindow(windowId) {
			if (typeof windowId === "number") {
				const tabs = await chrome.tabs.query({
					active: true,
					windowId
				});
				return tabs && tabs[0] ? tabs[0] : null;
			}
			const tabs = await chrome.tabs.query({
				active: true,
				currentWindow: true
			});
			return tabs && tabs[0] ? tabs[0] : null;
		}
		/**
		* Same as getActiveTabInWindow, but throws if not found.
		*/
		async getActiveTabOrThrowInWindow(windowId) {
			const tab = await this.getActiveTabInWindow(windowId);
			if (!tab || !tab.id) throw new Error("Active tab not found");
			return tab;
		}
	};
	//#endregion
	//#region entrypoints/background/link/scope.ts
	var scope_exports = /* @__PURE__ */ __exportAll({
		OUT_OF_SCOPE_MESSAGE: () => OUT_OF_SCOPE_MESSAGE,
		SITE_BLOCKED_MESSAGE: () => SITE_BLOCKED_MESSAGE,
		adoptTab: () => adoptTab,
		assertTabAllowed: () => assertTabAllowed,
		findGroup: () => findGroup,
		getScope: () => getScope,
		getWorkingTab: () => getWorkingTab,
		groupTabs: () => groupTabs,
		isInScope: () => isInScope,
		setScope: () => setScope,
		setWorkingTab: () => setWorkingTab,
		siteAllowed: () => siteAllowed,
		targetTab: () => targetTab,
		watchGroupMembership: () => watchGroupMembership
	});
	function setScope(next) {
		scope = { allowedSites: (next.allowedSites || []).map((s) => s.trim().toLowerCase()).filter(Boolean) };
	}
	function getScope() {
		return scope;
	}
	/** 找当前窗口的 Minduck Matter 组，没有则返回 null。 */
	async function findGroup(windowId) {
		const query = { title: GROUP_TITLE };
		if (windowId !== void 0) query.windowId = windowId;
		return (await chrome.tabGroups.query(query))[0] ?? null;
	}
	/**
	* 把一个标签页放进它**所在窗口**的 Minduck Matter 组（该窗口还没有就建一个）。
	*
	* 两处都是按窗口来的，缺一不可（26-09-14 实机验收 W-01 时撞到）：
	*  - `chrome.tabs.group` 不带 `createProperties.windowId` 时，新组建在**当前窗口**，
	*    别的窗口里的页会被整个挪过来——`chrome_navigate` 的 newWindow / width / height 于是
	*    被吃掉：新窗口一闪即逝，页出现在另一个窗口里。
	*  - 每次都新建一组，导航五次就有五个都叫「Minduck Matter」的组；而且新组要先分组、
	*    再起名，中间那一刻 `watchGroupMembership` 按标题查会判成「不是我们的页」。加进已经
	*    起好名的组就没有这道缝。
	*/
	async function adoptTab(tabId) {
		adopting.add(tabId);
		try {
			const tab = await chrome.tabs.get(tabId);
			const existing = await findGroup(tab.windowId);
			if (existing) {
				await chrome.tabs.group({
					tabIds: [tabId],
					groupId: existing.id
				});
				return;
			}
			const groupId = await chrome.tabs.group({
				tabIds: [tabId],
				createProperties: { windowId: tab.windowId }
			});
			await chrome.tabGroups.update(groupId, {
				title: GROUP_TITLE,
				color: "blue"
			});
		} finally {
			adopting.delete(tabId);
		}
	}
	/** Minduck Matter 组内的全部标签页。 */
	async function groupTabs() {
		const groups = await chrome.tabGroups.query({ title: GROUP_TITLE });
		if (!groups.length) return [];
		const out = [];
		for (const g of groups) out.push(...await chrome.tabs.query({ groupId: g.id }));
		return out;
	}
	/** 记下这一次操作作用在哪一页。调用点在工具分发处（每次调用只经过一次）。 */
	function setWorkingTab(tabId) {
		workingTabId = typeof tabId === "number" ? tabId : void 0;
	}
	/** 只读，供测试与调试。 */
	function getWorkingTab() {
		return workingTabId;
	}
	function watchGroupMembership() {
		if (!chrome.tabs?.onUpdated) return;
		chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
			const groupId = changeInfo.groupId;
			if (groupId === void 0) return;
			if (adopting.has(tabId)) return;
			(async () => {
				if (groupId === TAB_GROUP_ID_NONE) {
					if (workingTabId === tabId) setWorkingTab(void 0);
					return;
				}
				const title = await groupTitle(groupId);
				if (title === GROUP_TITLE) setWorkingTab(tabId);
				else if (title && workingTabId === tabId) setWorkingTab(void 0);
			})();
		});
	}
	/** 组的标题；组刚被 tabs.group 建出来、还没 update 之前是空串。查不到当作没有标题。 */
	async function groupTitle(groupId) {
		try {
			return (await chrome.tabGroups.get(groupId)).title ?? "";
		} catch {
			return "";
		}
	}
	/**
	* 工具默认作用的标签页：**Matter 自己上一次操作的那一个**，不是用户当前看着的
	* 那一个，也不是「组内碰巧 active 的那一个」。
	*
	* 这条区别就是标签组隔离的全部意义。返回 null 时调用方应当明确地报
	* 「Matter 还没有可操作的页面」，而不是退回 activeTab——那正是要挡住的行为。
	*/
	async function targetTab() {
		const tabs = await groupTabs();
		if (!tabs.length) return null;
		const working = tabs.find((t) => t.id === workingTabId);
		if (working) return working;
		const active = tabs.find((t) => t.active);
		if (active) return active;
		return [...tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0] ?? tabs[tabs.length - 1];
	}
	/** 这个标签页归 Matter 管吗。 */
	async function isInScope(tabId) {
		return (await groupTabs()).some((t) => t.id === tabId);
	}
	/** 清单为空允许所有 HTTP(S) 主机；普通条目精确匹配，子域必须显式使用通配。 */
	function siteAllowed(url) {
		let host;
		try {
			const parsed = new URL(url);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
			host = parsed.hostname.toLowerCase().replace(/\.$/, "");
		} catch {
			return false;
		}
		const list = scope.allowedSites;
		if (!list.length) return true;
		return list.some((entry) => {
			const pattern = entry.replace(/\.$/, "");
			if (pattern.startsWith("*.")) {
				const base = pattern.slice(2);
				return host === base || host.endsWith(`.${base}`);
			}
			return host === pattern;
		});
	}
	/** 默认、显式及批量目标都检查同一份最新标签信息，按组归属、协议、站点依次拒绝。 */
	async function assertTabAllowed(tab) {
		if (typeof tab.id !== "number") throw new Error(OUT_OF_SCOPE_MESSAGE);
		const groups = await chrome.tabGroups.query({ title: GROUP_TITLE });
		const current = await chrome.tabs.get(tab.id);
		if (!groups.some((group) => group.id === current.groupId)) throw new Error(OUT_OF_SCOPE_MESSAGE);
		if (!siteAllowed(current.url ?? "") || current.pendingUrl && !siteAllowed(current.pendingUrl)) throw new Error(SITE_BLOCKED_MESSAGE);
		return current;
	}
	var GROUP_TITLE, scope, adopting, workingTabId, TAB_GROUP_ID_NONE, OUT_OF_SCOPE_MESSAGE, SITE_BLOCKED_MESSAGE;
	var init_scope = __esmMin((() => {
		GROUP_TITLE = "Minduck Matter";
		scope = { allowedSites: [] };
		adopting = /* @__PURE__ */ new Set();
		TAB_GROUP_ID_NONE = -1;
		OUT_OF_SCOPE_MESSAGE = "这个标签页不归 Minduck Matter 管。用 chrome_navigate 打开新页面，或者让用户把它拖进「Minduck Matter」标签组。";
		SITE_BLOCKED_MESSAGE = "站点不在允许清单内，或不是 HTTP(S) 页面。让用户在扩展弹窗里添加完整主机名；如需子域，显式填写 *.example.com。清空清单允许所有 HTTP(S) 站点。";
	}));
	//#endregion
	//#region \0@oxc-project+runtime@0.148.0/helpers/esm/typeof.js
	function _typeof(o) {
		"@babel/helpers - typeof";
		return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
			return typeof o;
		} : function(o) {
			return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
		}, _typeof(o);
	}
	var init_typeof = __esmMin((() => {}));
	//#endregion
	//#region \0@oxc-project+runtime@0.148.0/helpers/esm/toPrimitive.js
	function toPrimitive(t, r) {
		if ("object" != _typeof(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	var init_toPrimitive = __esmMin((() => {
		init_typeof();
	}));
	//#endregion
	//#region \0@oxc-project+runtime@0.148.0/helpers/esm/toPropertyKey.js
	function toPropertyKey(t) {
		var i = toPrimitive(t, "string");
		return "symbol" == _typeof(i) ? i : i + "";
	}
	var init_toPropertyKey = __esmMin((() => {
		init_typeof();
		init_toPrimitive();
	}));
	//#endregion
	//#region \0@oxc-project+runtime@0.148.0/helpers/esm/defineProperty.js
	function _defineProperty(e, r, t) {
		return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
			value: t,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : e[r] = t, e;
	}
	var init_defineProperty = __esmMin((() => {
		init_toPropertyKey();
	}));
	//#endregion
	//#region entrypoints/background/tools/browser/common.ts
	init_scope();
	init_defineProperty();
	/** 只收编本次新建的页；复用页必须已经在组里，不能把用户的页面悄悄接管。 */
	async function adoptCreatedTabs(tabs) {
		if (!tabs.length) throw new Error("New window did not return any tabs");
		for (const tab of tabs) {
			if (typeof tab.id !== "number") throw new Error("New tab has no ID");
			await adoptTab(tab.id);
		}
	}
	var DEFAULT_WINDOW_WIDTH = 1280;
	var DEFAULT_WINDOW_HEIGHT = 720;
	/**
	* Tool for navigating to URLs in browser tabs or windows
	*/
	var NavigateTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.NAVIGATE);
		}
		async execute(args) {
			const { newWindow = false, width, height, url, refresh = false, tabId, background, windowId } = args;
			console.log(`Attempting to ${refresh ? "refresh current tab" : `open URL: ${url}`} with options:`, args);
			try {
				if (refresh) {
					console.log("Refreshing current active tab");
					const targetTab = await this.tryGetTab(tabId) || await this.getActiveTabOrThrowInWindow(windowId);
					if (!targetTab.id) return createErrorResponse("No target tab found to refresh");
					await chrome.tabs.reload(targetTab.id);
					console.log(`Refreshed tab ID: ${targetTab.id}`);
					const updatedTab = await chrome.tabs.get(targetTab.id);
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: true,
								message: "Successfully refreshed current tab",
								tabId: updatedTab.id,
								windowId: updatedTab.windowId,
								url: updatedTab.url
							})
						}],
						isError: false
					};
				}
				if (!url) return createErrorResponse("URL parameter is required when refresh is not true");
				if (url === "back" || url === "forward") {
					const targetTab = await this.tryGetTab(tabId) || await this.getActiveTabOrThrowInWindow(windowId);
					if (!targetTab.id) return createErrorResponse("No target tab found for history navigation");
					await this.ensureFocus(targetTab, {
						activate: background !== true,
						focusWindow: background !== true
					});
					if (url === "forward") {
						await chrome.tabs.goForward(targetTab.id);
						console.log(`Navigated forward in tab ID: ${targetTab.id}`);
					} else {
						await chrome.tabs.goBack(targetTab.id);
						console.log(`Navigated back in tab ID: ${targetTab.id}`);
					}
					const updatedTab = await chrome.tabs.get(targetTab.id);
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: true,
								message: `Successfully navigated ${url} in browser history`,
								tabId: updatedTab.id,
								windowId: updatedTab.windowId,
								url: updatedTab.url
							})
						}],
						isError: false
					};
				}
				console.log(`Checking if URL is already open: ${url}`);
				const buildUrlPatterns = (input) => {
					const patterns = /* @__PURE__ */ new Set();
					try {
						if (!input.includes("*")) {
							const u = new URL(input);
							const pathWildcard = "/*";
							const hostNoWww = u.host.replace(/^www\./, "");
							const hostWithWww = hostNoWww.startsWith("www.") ? hostNoWww : `www.${hostNoWww}`;
							patterns.add(`${u.protocol}//${u.host}${pathWildcard}`);
							patterns.add(`${u.protocol}//${hostNoWww}${pathWildcard}`);
							patterns.add(`${u.protocol}//${hostWithWww}${pathWildcard}`);
							const altProtocol = u.protocol === "https:" ? "http:" : "https:";
							patterns.add(`${altProtocol}//${u.host}${pathWildcard}`);
							patterns.add(`${altProtocol}//${hostNoWww}${pathWildcard}`);
							patterns.add(`${altProtocol}//${hostWithWww}${pathWildcard}`);
						} else patterns.add(input);
					} catch {
						patterns.add(input.endsWith("/") ? `${input}*` : `${input}/*`);
					}
					return Array.from(patterns);
				};
				const urlPatterns = buildUrlPatterns(url);
				const inGroup = new Set((await groupTabs()).map((tab) => tab.id));
				const candidateTabs = (await chrome.tabs.query({ url: urlPatterns })).filter((tab) => inGroup.has(tab.id) && siteAllowed(tab.url ?? "") && (!tab.pendingUrl || siteAllowed(tab.pendingUrl)));
				console.log(`Found ${candidateTabs.length} matching tabs with patterns:`, urlPatterns);
				const pickBestMatch = (target, tabsToPick) => {
					let targetUrl;
					try {
						targetUrl = new URL(target);
					} catch {
						return tabsToPick[0];
					}
					const normalizePath = (p) => {
						if (!p) return "/";
						const withLeading = p.startsWith("/") ? p : `/${p}`;
						return withLeading !== "/" && withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
					};
					const hostBase = (h) => h.replace(/^www\./, "").toLowerCase();
					normalizePath(targetUrl.pathname) === "/" && targetUrl.search;
					const targetPath = normalizePath(targetUrl.pathname);
					const targetSearch = targetUrl.search || "";
					const targetHostBase = hostBase(targetUrl.host);
					let best = { score: -1 };
					for (const tab of tabsToPick) {
						const tabUrlStr = tab.url || "";
						let tabUrl;
						try {
							tabUrl = new URL(tabUrlStr);
						} catch {
							continue;
						}
						if (hostBase(tabUrl.host) !== targetHostBase) continue;
						const tabPath = normalizePath(tabUrl.pathname);
						const tabSearch = tabUrl.search || "";
						let score = -1;
						const pathEqual = tabPath === targetPath;
						if (pathEqual && (targetSearch ? tabSearch === targetSearch : true)) score = 3;
						else if (pathEqual && !targetSearch) score = 2;
						if (score > best.score) {
							best = {
								tab,
								score
							};
							if (score === 3) break;
						}
					}
					return best.tab;
				};
				const explicitTab = await this.tryGetTab(tabId);
				const existingTab = explicitTab || pickBestMatch(url, candidateTabs);
				if (existingTab?.id !== void 0) {
					await assertTabAllowed(existingTab);
					console.log(`URL already open in Tab ID: ${existingTab.id}, Window ID: ${existingTab.windowId}`);
					if (explicitTab && typeof explicitTab.id === "number") await chrome.tabs.update(explicitTab.id, { url });
					await this.ensureFocus(existingTab, {
						activate: background !== true,
						focusWindow: background !== true
					});
					console.log(`Activated existing Tab ID: ${existingTab.id}`);
					const updatedTab = await chrome.tabs.get(existingTab.id);
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: true,
								message: "Activated existing tab",
								tabId: updatedTab.id,
								windowId: updatedTab.windowId,
								url: updatedTab.url
							})
						}],
						isError: false
					};
				}
				if (newWindow || typeof width === "number" || typeof height === "number") {
					console.log("Opening URL in a new window.");
					const newWindow = await chrome.windows.create({
						url,
						width: typeof width === "number" ? width : DEFAULT_WINDOW_WIDTH,
						height: typeof height === "number" ? height : DEFAULT_WINDOW_HEIGHT,
						focused: background === false
					});
					if (newWindow && newWindow.id !== void 0) {
						await adoptCreatedTabs(newWindow.tabs ?? []);
						console.log(`URL opened in new Window ID: ${newWindow.id}`);
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									message: "Opened URL in new window",
									windowId: newWindow.id,
									tabs: newWindow.tabs ? newWindow.tabs.map((tab) => ({
										tabId: tab.id,
										url: tab.url
									})) : []
								})
							}],
							isError: false
						};
					}
				} else {
					console.log("Opening URL in the last active window.");
					let targetWindow = null;
					if (typeof windowId === "number") targetWindow = await chrome.windows.get(windowId, { populate: false });
					if (!targetWindow) targetWindow = await chrome.windows.getLastFocused({ populate: false });
					if (targetWindow && targetWindow.id !== void 0) {
						console.log(`Found target Window ID: ${targetWindow.id}`);
						const newTab = await chrome.tabs.create({
							url,
							windowId: targetWindow.id,
							active: background === false
						});
						await adoptCreatedTabs([newTab]);
						if (background === false) await chrome.windows.update(targetWindow.id, { focused: true });
						console.log(`URL opened in new Tab ID: ${newTab.id} in existing Window ID: ${targetWindow.id}`);
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									message: "Opened URL in new tab in existing window",
									tabId: newTab.id,
									windowId: targetWindow.id,
									url: newTab.url
								})
							}],
							isError: false
						};
					} else {
						console.warn("No last focused window found, falling back to creating a new window.");
						const fallbackWindow = await chrome.windows.create({
							url,
							width: DEFAULT_WINDOW_WIDTH,
							height: DEFAULT_WINDOW_HEIGHT,
							focused: true
						});
						if (fallbackWindow && fallbackWindow.id !== void 0) {
							await adoptCreatedTabs(fallbackWindow.tabs ?? []);
							console.log(`URL opened in fallback new Window ID: ${fallbackWindow.id}`);
							return {
								content: [{
									type: "text",
									text: JSON.stringify({
										success: true,
										message: "Opened URL in new window",
										windowId: fallbackWindow.id,
										tabs: fallbackWindow.tabs ? fallbackWindow.tabs.map((tab) => ({
											tabId: tab.id,
											url: tab.url
										})) : []
									})
								}],
								isError: false
							};
						}
					}
				}
				return createErrorResponse("Failed to open URL: Unknown error occurred");
			} catch (error) {
				if (chrome.runtime.lastError) {
					console.error(`Chrome API Error: ${chrome.runtime.lastError.message}`, error);
					return createErrorResponse(`Chrome API Error: ${chrome.runtime.lastError.message}`);
				} else {
					console.error("Error in navigate:", error);
					return createErrorResponse(`Error navigating to URL: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}
	};
	var navigateTool = new NavigateTool();
	/**
	* Tool for closing browser tabs
	*/
	var CloseTabsTool = class extends BaseBrowserToolExecutor {
		constructor(..._args2) {
			super(..._args2);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.CLOSE_TABS);
		}
		async execute(args) {
			const { tabIds, url } = args;
			let urlPattern = url;
			console.log(`Attempting to close tabs with options:`, args);
			try {
				if (urlPattern) {
					console.log(`Searching for tabs with URL: ${url}`);
					try {
						if (!urlPattern.includes("*")) try {
							const u = new URL(urlPattern);
							const basePath = u.pathname || "/";
							const pathWithWildcard = basePath.endsWith("/") ? `${basePath}*` : `${basePath}/*`;
							urlPattern = `${u.protocol}//${u.host}${pathWithWildcard}`;
						} catch {
							urlPattern = urlPattern.endsWith("/") ? `${urlPattern}*` : `${urlPattern}/*`;
						}
					} catch {
						urlPattern = urlPattern.endsWith("*") ? urlPattern : urlPattern.endsWith("/") ? `${urlPattern}*` : `${urlPattern}/*`;
					}
					const tabs = await chrome.tabs.query({ url: urlPattern });
					if (!tabs || tabs.length === 0) {
						console.log(`No tabs found with URL pattern: ${urlPattern}`);
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: false,
									message: `No tabs found with URL pattern: ${urlPattern}`,
									closedCount: 0
								})
							}],
							isError: false
						};
					}
					console.log(`Found ${tabs.length} tabs with URL pattern: ${urlPattern}`);
					const tabIdsToClose = tabs.map((tab) => tab.id).filter((id) => id !== void 0);
					if (tabIdsToClose.length === 0) return createErrorResponse("Found tabs but could not get their IDs");
					for (const tab of tabs) await assertTabAllowed(tab);
					await chrome.tabs.remove(tabIdsToClose);
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: true,
								message: `Closed ${tabIdsToClose.length} tabs with URL: ${url}`,
								closedCount: tabIdsToClose.length,
								closedTabIds: tabIdsToClose
							})
						}],
						isError: false
					};
				}
				if (tabIds && tabIds.length > 0) {
					console.log(`Closing tabs with IDs: ${tabIds.join(", ")}`);
					const existingTabs = await Promise.all(tabIds.map((tabId) => chrome.tabs.get(tabId)));
					for (const tab of existingTabs) await assertTabAllowed(tab);
					const validTabIds = existingTabs.filter((tab) => tab !== null).map((tab) => tab.id).filter((id) => id !== void 0);
					if (validTabIds.length === 0) return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: false,
								message: "None of the provided tab IDs exist",
								closedCount: 0
							})
						}],
						isError: false
					};
					await chrome.tabs.remove(validTabIds);
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: true,
								message: `Closed ${validTabIds.length} tabs`,
								closedCount: validTabIds.length,
								closedTabIds: validTabIds,
								invalidTabIds: tabIds.filter((id) => !validTabIds.includes(id))
							})
						}],
						isError: false
					};
				}
				const activeTab = await this.tryGetTab(args.tabId);
				if (!activeTab || !activeTab.id) return createErrorResponse("No target tab found");
				await assertTabAllowed(activeTab);
				await chrome.tabs.remove(activeTab.id);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							message: "Closed active tab",
							closedCount: 1,
							closedTabIds: [activeTab.id]
						})
					}],
					isError: false
				};
			} catch (error) {
				console.error("Error in CloseTabsTool.execute:", error);
				return createErrorResponse(`Error closing tabs: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	var closeTabsTool = new CloseTabsTool();
	/**
	* Tool for switching the active tab
	*/
	var SwitchTabTool = class extends BaseBrowserToolExecutor {
		constructor(..._args3) {
			super(..._args3);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.SWITCH_TAB);
		}
		async execute(args) {
			const { tabId, windowId } = args;
			console.log(`Attempting to switch to tab ID: ${tabId} in window ID: ${windowId}`);
			try {
				const updatedTab = await chrome.tabs.get(tabId);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							message: `Successfully switched to tab ID: ${tabId}`,
							tabId: updatedTab.id,
							windowId: updatedTab.windowId,
							url: updatedTab.url
						})
					}],
					isError: false
				};
			} catch (error) {
				if (chrome.runtime.lastError) {
					console.error(`Chrome API Error: ${chrome.runtime.lastError.message}`, error);
					return createErrorResponse(`Chrome API Error: ${chrome.runtime.lastError.message}`);
				} else {
					console.error("Error in SwitchTabTool.execute:", error);
					return createErrorResponse(`Error switching tab: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}
	};
	var switchTabTool = new SwitchTabTool();
	//#endregion
	//#region entrypoints/background/tools/browser/window.ts
	init_defineProperty();
	var WindowTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS);
		}
		async execute() {
			try {
				const windows = await chrome.windows.getAll({ populate: true });
				let tabCount = 0;
				const structuredWindows = windows.map((window) => {
					const tabs = window.tabs?.map((tab) => {
						tabCount++;
						return {
							tabId: tab.id || 0,
							url: tab.url || "",
							title: tab.title || "",
							active: tab.active || false
						};
					}) || [];
					return {
						windowId: window.id || 0,
						tabs
					};
				});
				const result = {
					windowCount: windows.length,
					tabCount,
					windows: structuredWindows
				};
				return {
					content: [{
						type: "text",
						text: JSON.stringify(result)
					}],
					isError: false
				};
			} catch (error) {
				console.error("Error in WindowTool.execute:", error);
				return createErrorResponse(`Error getting windows and tabs information: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	var windowTool = new WindowTool();
	//#endregion
	//#region common/message-types.ts
	/**
	* 内容脚本与 background 之间的动作名。
	*
	* 只保留白名单工具用得上的那些——上游那份还带着录制回放、快捷面板、元素标记、
	* 可视化编辑的几十个动作，而它们对应的代码已经删了。留着一份「有名字没实现」
	* 的清单，下一个读代码的人会以为那些功能还在。
	*/
	var TOOL_MESSAGE_TYPES = {
		CLICK_ELEMENT: "clickElement",
		PREPARE_CLICK: "prepareClick",
		OBSERVE_AFTER_ACTION: "observeAfterAction",
		DISPATCH_HOVER_FOR_REF: "dispatchHoverForRef",
		ENSURE_REF_FOR_SELECTOR: "ensureRefForSelector",
		FILL_ELEMENT: "fillElement",
		GENERATE_ACCESSIBILITY_TREE: "generateAccessibilityTree",
		GET_INTERACTIVE_ELEMENTS: "getInteractiveElements",
		RESOLVE_REF: "resolveRef",
		SCREENSHOT_GET_ELEMENT_DETAILS: "getElementDetails",
		SCREENSHOT_GET_PAGE_DETAILS: "getPageDetails",
		SCREENSHOT_PREPARE_PAGE_FOR_CAPTURE: "preparePageForCapture",
		SCREENSHOT_RESET_PAGE_AFTER_CAPTURE: "resetPageAfterCapture",
		SCREENSHOT_SCROLL_PAGE: "scrollPage",
		SIMULATE_KEYBOARD: "simulateKeyboard",
		WAIT_FOR_TEXT: "waitForText",
		WEB_FETCHER_GET_HTML_CONTENT: "getHtmlContent",
		WEB_FETCHER_GET_TEXT_CONTENT: "getTextContent"
	};
	//#endregion
	//#region utils/image-utils.ts
	/**
	* Image processing utility functions
	*/
	/**
	* Create ImageBitmap from data URL (for OffscreenCanvas)
	* @param dataUrl Image data URL
	* @returns Created ImageBitmap object
	*/
	async function createImageBitmapFromUrl(dataUrl) {
		const blob = await (await fetch(dataUrl)).blob();
		return await createImageBitmap(blob);
	}
	/**
	* Compresses an image by scaling it and converting it to a target format with a specific quality.
	* This is the most effective way to reduce image data size for transport or storage.
	*
	* @param {string} imageDataUrl - The original image data URL (e.g., from captureVisibleTab).
	* @param {object} options - Compression options.
	* @param {number} [options.scale=1.0] - The scaling factor for dimensions (e.g., 0.7 for 70%).
	* @param {number} [options.quality=0.8] - The quality for lossy formats like JPEG (0.0 to 1.0).
	* @param {string} [options.format='image/jpeg'] - The target image format.
	* @returns {Promise<{dataUrl: string, mimeType: string}>} A promise that resolves to the compressed image data URL and its MIME type.
	*/
	async function compressImage(imageDataUrl, options) {
		const { scale = 1, quality = .8, format = "image/jpeg" } = options;
		const imageBitmap = await createImageBitmapFromUrl(imageDataUrl);
		const newWidth = Math.round(imageBitmap.width * scale);
		const newHeight = Math.round(imageBitmap.height * scale);
		const canvas = new OffscreenCanvas(newWidth, newHeight);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Failed to get 2D context from OffscreenCanvas");
		ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
		const compressedDataUrl = await canvas.convertToBlob({
			type: format,
			quality
		});
		return {
			dataUrl: await new Promise((resolve) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result);
				reader.readAsDataURL(compressedDataUrl);
			}),
			mimeType: format
		};
	}
	//#endregion
	//#region utils/screenshot-context.ts
	var TTL_MS = 3e5;
	var contexts = /* @__PURE__ */ new Map();
	var screenshotContextManager = {
		setContext(tabId, ctx) {
			contexts.set(tabId, {
				...ctx,
				timestamp: Date.now()
			});
		},
		getContext(tabId) {
			const ctx = contexts.get(tabId);
			if (!ctx) return void 0;
			if (Date.now() - ctx.timestamp > TTL_MS) {
				contexts.delete(tabId);
				return;
			}
			return ctx;
		},
		clear(tabId) {
			contexts.delete(tabId);
		}
	};
	function scaleCoordinates(x, y, ctx) {
		if (!ctx.screenshotWidth || !ctx.screenshotHeight || !ctx.viewportWidth || !ctx.viewportHeight) return {
			x,
			y
		};
		const sx = x / ctx.screenshotWidth * ctx.viewportWidth;
		const sy = y / ctx.screenshotHeight * ctx.viewportHeight;
		return {
			x: Math.round(sx),
			y: Math.round(sy)
		};
	}
	//#endregion
	//#region utils/cdp-session-manager.ts
	var cdp_session_manager_exports = /* @__PURE__ */ __exportAll({ cdpSessionManager: () => cdpSessionManager });
	var DEBUGGER_PROTOCOL_VERSION, CDPSessionManager, cdpSessionManager;
	var init_cdp_session_manager = __esmMin((() => {
		init_defineProperty();
		DEBUGGER_PROTOCOL_VERSION = "1.3";
		CDPSessionManager = class {
			constructor() {
				_defineProperty(this, "sessions", /* @__PURE__ */ new Map());
			}
			getState(tabId) {
				return this.sessions.get(tabId);
			}
			setState(tabId, state) {
				this.sessions.set(tabId, state);
			}
			async attach(tabId, owner = "unknown") {
				const state = this.getState(tabId);
				if (state && state.attachedByUs) {
					state.refCount += 1;
					state.owners.add(owner);
					return;
				}
				const existing = (await chrome.debugger.getTargets()).find((t) => t.tabId === tabId && t.attached);
				if (existing) {
					if (existing.extensionId === chrome.runtime.id) {
						this.setState(tabId, {
							refCount: state ? state.refCount + 1 : 1,
							owners: /* @__PURE__ */ new Set([...state?.owners || [], owner]),
							attachedByUs: true
						});
						return;
					}
					throw new Error(`Debugger is already attached to tab ${tabId} by another client (e.g., DevTools/extension)`);
				}
				await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
				this.setState(tabId, {
					refCount: 1,
					owners: /* @__PURE__ */ new Set([owner]),
					attachedByUs: true
				});
			}
			async detach(tabId, owner = "unknown") {
				const state = this.getState(tabId);
				if (!state) return;
				if (state.owners.has(owner)) state.owners.delete(owner);
				state.refCount = Math.max(0, state.refCount - 1);
				if (state.refCount > 0) return;
				try {
					if (state.attachedByUs) await chrome.debugger.detach({ tabId });
				} catch (e) {} finally {
					this.sessions.delete(tabId);
				}
			}
			/**
			* Convenience wrapper: ensures attach before fn, and balanced detach after.
			*/
			async withSession(tabId, owner, fn) {
				await this.attach(tabId, owner);
				try {
					return await fn();
				} finally {
					await this.detach(tabId, owner);
				}
			}
			/**
			* Send a CDP command. Requires that this manager has attached to the tab.
			* If not attached by us, will attempt a one-shot attach around the call.
			*/
			async sendCommand(tabId, method, params) {
				const state = this.getState(tabId);
				if (state && state.attachedByUs) return await chrome.debugger.sendCommand({ tabId }, method, params);
				return await this.withSession(tabId, `send:${method}`, async () => {
					return await chrome.debugger.sendCommand({ tabId }, method, params);
				});
			}
		};
		cdpSessionManager = new CDPSessionManager();
	}));
	//#endregion
	//#region entrypoints/background/tools/browser/screenshot.ts
	init_defineProperty();
	var SCREENSHOT_CONSTANTS = {
		SCROLL_DELAY_MS: 350,
		CAPTURE_STITCH_DELAY_MS: 50,
		MAX_CAPTURE_PARTS: 50,
		MAX_CAPTURE_HEIGHT_PX: 5e4,
		PIXEL_TOLERANCE: 1,
		SCRIPT_INIT_DELAY: 100
	};
	var __MAX_CAP_RATE = chrome.tabs?.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND;
	if (typeof __MAX_CAP_RATE === "number" && __MAX_CAP_RATE > 0) {
		const minIntervalMs = Math.ceil(1e3 / __MAX_CAP_RATE);
		const requiredExtraDelay = Math.max(0, minIntervalMs - SCREENSHOT_CONSTANTS.SCROLL_DELAY_MS);
		SCREENSHOT_CONSTANTS.CAPTURE_STITCH_DELAY_MS = Math.max(requiredExtraDelay, SCREENSHOT_CONSTANTS.CAPTURE_STITCH_DELAY_MS);
	}
	/**
	* Tool for capturing screenshots of web pages
	*/
	var ScreenshotTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.SCREENSHOT);
		}
		/**
		* Execute screenshot operation
		*/
		async execute(args) {
			const { name = "screenshot", selector, fullPage = false } = args;
			console.log(`Starting screenshot with options:`, args);
			const tab = await this.tryGetTab(args.tabId) || await this.getActiveTabOrThrowInWindow(args.windowId);
			if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://") || tab.url?.startsWith("https://chrome.google.com/webstore") || tab.url?.startsWith("https://microsoftedge.microsoft.com/")) return createErrorResponse("Cannot capture special browser pages or web store pages due to security restrictions.");
			let finalImageDataUrl;
			let finalImageWidthCss;
			let finalImageHeightCss;
			try {
				const { cdpSessionManager } = await Promise.resolve().then(() => (init_cdp_session_manager(), cdp_session_manager_exports));
				const tabId = tab.id;
				let viewportCss;
				let clip;
				if (selector) {
					await this.injectContentScript(tabId, ["inject-scripts/screenshot-helper.js"]);
					await new Promise((r) => setTimeout(r, SCREENSHOT_CONSTANTS.SCRIPT_INIT_DELAY));
					const details = await this.sendMessageToTab(tabId, {
						action: TOOL_MESSAGE_TYPES.SCREENSHOT_GET_ELEMENT_DETAILS,
						selector
					});
					const rect = details?.rect;
					if (!rect || !(rect.width > 0) || !(rect.height > 0)) return createErrorResponse(`Element not found or has zero size: ${selector}`);
					clip = {
						x: rect.x + (details.currentScrollX ?? 0),
						y: rect.y + (details.currentScrollY ?? 0),
						width: rect.width,
						height: rect.height,
						scale: 1
					};
				}
				await cdpSessionManager.withSession(tabId, "screenshot", async () => {
					const metrics = await cdpSessionManager.sendCommand(tabId, "Page.getLayoutMetrics", {});
					const viewport = metrics?.cssLayoutViewport || metrics?.layoutViewport || {
						clientWidth: 800,
						clientHeight: 600
					};
					const content = metrics?.cssContentSize || metrics?.contentSize || viewport;
					viewportCss = {
						w: Math.round(viewport.clientWidth || 800),
						h: Math.round(viewport.clientHeight || 600)
					};
					const shot = await cdpSessionManager.sendCommand(tabId, "Page.captureScreenshot", {
						format: "png",
						...fullPage && !clip ? { captureBeyondViewport: true } : {},
						...clip ? {
							clip,
							captureBeyondViewport: true
						} : {}
					});
					const base64Data = typeof shot?.data === "string" ? shot.data : "";
					if (!base64Data) throw new Error("CDP Page.captureScreenshot returned empty data");
					finalImageDataUrl = `data:image/png;base64,${base64Data}`;
					if (clip) {
						finalImageWidthCss = Math.round(args.width || clip.width);
						finalImageHeightCss = Math.round(args.height || clip.height);
					} else if (fullPage) {
						finalImageWidthCss = Math.round(args.width || content.width || viewport.clientWidth);
						finalImageHeightCss = Math.round(args.height || content.height || viewport.clientHeight);
					} else {
						finalImageWidthCss = Math.round(viewport.clientWidth || 800);
						finalImageHeightCss = Math.round(viewport.clientHeight || 600);
					}
				});
				if (!finalImageDataUrl) throw new Error("Failed to capture image data");
				try {
					if (typeof finalImageWidthCss === "number" && typeof finalImageHeightCss === "number") {
						let hostname = "";
						try {
							hostname = tab.url ? new URL(tab.url).hostname : "";
						} catch {}
						screenshotContextManager.setContext(tab.id, {
							screenshotWidth: finalImageWidthCss,
							screenshotHeight: finalImageHeightCss,
							viewportWidth: viewportCss?.w ?? finalImageWidthCss,
							viewportHeight: viewportCss?.h ?? finalImageHeightCss,
							hostname
						});
					}
				} catch (e) {
					console.warn("Failed to set screenshot context:", e);
				}
				const compressed = await compressImage(finalImageDataUrl, {
					scale: .7,
					quality: .8,
					format: "image/jpeg"
				});
				const base64Data = compressed.dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							base64Data,
							mimeType: compressed.mimeType
						})
					}],
					isError: false
				};
			} catch (error) {
				console.error("Error during screenshot execution:", error);
				return createErrorResponse(`Screenshot error: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
			}
		}
		/**
		* Log information
		*/
		logInfo(message) {
			console.log(`[Screenshot Tool] ${message}`);
		}
	};
	var screenshotTool = new ScreenshotTool();
	//#endregion
	//#region entrypoints/background/tools/browser/web-fetcher.ts
	init_defineProperty();
	var WebFetcherTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.WEB_FETCHER);
		}
		/**
		* Execute web fetcher operation
		*/
		async execute(args) {
			const htmlContent = args.htmlContent === true;
			const textContent = htmlContent ? false : args.textContent !== false;
			const url = args.url;
			const selector = args.selector;
			const explicitTabId = args.tabId;
			const background = args.background === true;
			const windowId = args.windowId;
			console.log(`Starting web fetcher with options:`, {
				htmlContent,
				textContent,
				url,
				selector
			});
			try {
				let tab;
				if (typeof explicitTabId === "number") tab = await chrome.tabs.get(explicitTabId);
				else if (url) {
					console.log(`Checking if URL is already open: ${url}`);
					const matchingTabs = (await chrome.tabs.query({})).filter((t) => {
						return (t.url?.endsWith("/") ? t.url.slice(0, -1) : t.url) === (url.endsWith("/") ? url.slice(0, -1) : url);
					});
					if (matchingTabs.length > 0) {
						tab = matchingTabs[0];
						console.log(`Found existing tab with URL: ${url}, tab ID: ${tab.id}`);
					} else {
						console.log(`No existing tab found with URL: ${url}, creating new tab`);
						tab = await chrome.tabs.create({
							url,
							active: background ? false : true
						});
						console.log("Waiting for page to load...");
						await new Promise((resolve) => setTimeout(resolve, 3e3));
					}
				} else {
					const tabs = typeof windowId === "number" ? await chrome.tabs.query({
						active: true,
						windowId
					}) : await chrome.tabs.query({
						active: true,
						currentWindow: true
					});
					if (!tabs[0]) return createErrorResponse("No active tab found");
					tab = tabs[0];
				}
				if (!tab.id) return createErrorResponse("Tab has no ID");
				if (!background) {
					await chrome.tabs.update(tab.id, { active: true });
					await chrome.windows.update(tab.windowId, { focused: true });
				}
				const result = {
					success: true,
					url: tab.url,
					title: tab.title
				};
				await this.injectContentScript(tab.id, ["inject-scripts/web-fetcher-helper.js"]);
				if (htmlContent) {
					const htmlResponse = await this.sendMessageToTab(tab.id, {
						action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_HTML_CONTENT,
						selector
					});
					if (htmlResponse.success) result.htmlContent = htmlResponse.htmlContent;
					else {
						console.error("Failed to get HTML content:", htmlResponse.error);
						result.htmlContentError = htmlResponse.error;
					}
				}
				if (textContent) {
					const textResponse = await this.sendMessageToTab(tab.id, {
						action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_TEXT_CONTENT,
						selector
					});
					if (textResponse.success) {
						result.textContent = textResponse.textContent;
						if (textResponse.article) result.article = {
							title: textResponse.article.title,
							byline: textResponse.article.byline,
							siteName: textResponse.article.siteName,
							excerpt: textResponse.article.excerpt,
							lang: textResponse.article.lang
						};
						if (textResponse.metadata) result.metadata = textResponse.metadata;
					} else {
						console.error("Failed to get text content:", textResponse.error);
						result.textContentError = textResponse.error;
					}
				}
				return {
					content: [{
						type: "text",
						text: JSON.stringify(result)
					}],
					isError: false
				};
			} catch (error) {
				console.error("Error in web fetcher:", error);
				return createErrorResponse(`Error fetching web content: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	var webFetcherTool = new WebFetcherTool();
	var GetInteractiveElementsTool = class extends BaseBrowserToolExecutor {
		constructor(..._args2) {
			super(..._args2);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS);
		}
		/**
		* Execute get interactive elements operation
		*/
		async execute(args) {
			const { textQuery, selector, includeCoordinates = true, types } = args;
			console.log(`Starting get interactive elements with options:`, args);
			try {
				const tab = await this.tryGetTab(args.tabId);
				if (!tab) return createErrorResponse("No target tab found");
				if (!tab.id) return createErrorResponse("Active tab has no ID");
				await this.injectContentScript(tab.id, ["inject-scripts/interactive-elements-helper.js"]);
				const result = await this.sendMessageToTab(tab.id, {
					action: TOOL_MESSAGE_TYPES.GET_INTERACTIVE_ELEMENTS,
					textQuery,
					selector,
					includeCoordinates,
					types
				});
				if (!result.success) return createErrorResponse(result.error || "Failed to get interactive elements");
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							elements: result.elements,
							count: result.elements.length,
							query: {
								textQuery,
								selector,
								types: types || "all"
							}
						})
					}],
					isError: false
				};
			} catch (error) {
				console.error("Error in get interactive elements operation:", error);
				return createErrorResponse(`Error getting interactive elements: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	var getInteractiveElementsTool = new GetInteractiveElementsTool();
	//#endregion
	//#region entrypoints/background/tools/browser/interaction.ts
	init_defineProperty();
	/** CDP 的修饰键位掩码（Alt=1 / Ctrl=2 / Meta=4 / Shift=8）。 */
	function modifierMask(m) {
		if (!m) return 0;
		return (m.altKey ? 1 : 0) | (m.ctrlKey ? 2 : 0) | (m.metaKey ? 4 : 0) | (m.shiftKey ? 8 : 0);
	}
	/**
	* 用 CDP 发一次**可信**点击。
	*
	* 与 `element.dispatchEvent(new MouseEvent(...))` 的区别不是风格问题：
	*  - 合成事件 `isTrusted=false`，且只有 mouse 系列没有 pointer 系列；
	*  - 合成事件直接派给你指名的那个元素，**绕过浏览器的命中测试**——被别的东西盖住
	*    照样"点得中"，于是我们报 success 而页面纹丝不动。
	*
	* `Input.dispatchMouseEvent` 走的是浏览器自己那条路：先命中测试，再派 pointer +
	* mouse 两套事件，和真人点一模一样。mouseMoved 先行是因为不少控件靠 hover 才挂上
	* 真正的点击处理器（菜单项、表格行内按钮）。
	*/
	async function dispatchTrustedClick(tabId, x, y, opts = {}) {
		const { cdpSessionManager } = await Promise.resolve().then(() => (init_cdp_session_manager(), cdp_session_manager_exports));
		const button = opts.button === "right" ? "right" : opts.button === "middle" ? "middle" : "left";
		const buttons = button === "right" ? 2 : button === "middle" ? 4 : 1;
		const modifiers = modifierMask(opts.modifiers);
		const at = Math.round(x);
		const ay = Math.round(y);
		await cdpSessionManager.withSession(tabId, "click", async () => {
			const send = (params) => cdpSessionManager.sendCommand(tabId, "Input.dispatchMouseEvent", params);
			await send({
				type: "mouseMoved",
				x: at,
				y: ay,
				modifiers,
				buttons: 0
			});
			for (let i = 1; i <= (opts.double ? 2 : 1); i++) {
				await send({
					type: "mousePressed",
					x: at,
					y: ay,
					button,
					clickCount: i,
					modifiers,
					buttons
				});
				await send({
					type: "mouseReleased",
					x: at,
					y: ay,
					button,
					clickCount: i,
					modifiers,
					buttons: 0
				});
			}
		});
	}
	/**
	* Tool for clicking elements on web pages
	*/
	var ClickTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.CLICK);
		}
		/**
		* Execute click operation
		*/
		async execute(args) {
			const { selector, selectorType = "css", coordinates, waitForNavigation = false, timeout = TIMEOUTS.DEFAULT_WAIT * 5, frameId, button, bubbles, cancelable, modifiers } = args;
			console.log(`Starting click operation with options:`, args);
			if (!selector && !coordinates && !args.ref) return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ": Provide ref or selector or coordinates");
			try {
				const tab = await this.tryGetTab(args.tabId) || await this.getActiveTabOrThrowInWindow(args.windowId);
				if (!tab.id) return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ": Active tab has no ID");
				let finalRef = args.ref;
				let finalSelector = selector;
				if (selector && selectorType === "xpath") {
					await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"]);
					try {
						const resolved = await this.sendMessageToTab(tab.id, {
							action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
							selector,
							isXPath: true
						}, frameId);
						if (resolved && resolved.success && resolved.ref) {
							finalRef = resolved.ref;
							finalSelector = void 0;
						} else return createErrorResponse(`Failed to resolve XPath selector: ${resolved?.error || "unknown error"}`);
					} catch (error) {
						return createErrorResponse(`Error resolving XPath: ${error instanceof Error ? error.message : String(error)}`);
					}
				}
				await this.injectContentScript(tab.id, ["inject-scripts/click-helper.js"]);
				const prep = await this.sendMessageToTab(tab.id, {
					action: TOOL_MESSAGE_TYPES.PREPARE_CLICK,
					selector: finalSelector,
					ref: finalRef,
					coordinates
				}, frameId);
				if (!prep || prep.error) return createErrorResponse(prep?.error || "Failed to prepare click");
				let dispatchedVia = frameId ? "synthetic" : "cdp";
				try {
					if (frameId) throw new Error("frame-scoped click: use synthetic dispatch");
					await dispatchTrustedClick(tab.id, prep.x, prep.y, {
						double: args.double === true,
						button,
						modifiers
					});
				} catch (e) {
					dispatchedVia = "synthetic";
					await this.sendMessageToTab(tab.id, {
						action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
						selector: finalSelector,
						coordinates: {
							x: prep.x,
							y: prep.y
						},
						ref: finalRef,
						waitForNavigation,
						timeout,
						double: args.double === true,
						button,
						bubbles,
						cancelable,
						modifiers
					}, frameId);
				}
				let observed = null;
				try {
					observed = await this.sendMessageToTab(tab.id, {
						action: TOOL_MESSAGE_TYPES.OBSERVE_AFTER_ACTION,
						fingerprint: prep.fingerprint,
						quietMs: 300,
						maxMs: 2e3
					}, frameId);
				} catch (_) {}
				const result = {
					elementInfo: prep.elementInfo,
					navigationOccurred: false
				};
				let clickMethod;
				if (coordinates) clickMethod = "coordinates";
				else if (finalRef) clickMethod = "ref";
				else if (finalSelector) clickMethod = "selector";
				else clickMethod = "unknown";
				const changed = observed ? observed.changed !== false : true;
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							changed,
							message: changed ? "点击已生效，页面有变化" : "点击发出去了，但页面没有任何变化——很可能点到了不响应的元素。先截图看看当前状态，再重新读页面拿新的 ref，不要拿同一个 ref 反复点。",
							elementInfo: result.elementInfo,
							url: observed?.url,
							title: observed?.title,
							dispatchedVia,
							clickMethod
						})
					}],
					isError: false
				};
			} catch (error) {
				console.error("Error in click operation:", error);
				return createErrorResponse(`Error performing click: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	var clickTool = new ClickTool();
	/**
	* Tool for filling form elements on web pages
	*/
	var FillTool = class extends BaseBrowserToolExecutor {
		constructor(..._args2) {
			super(..._args2);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.FILL);
		}
		/**
		* Execute fill operation
		*/
		async execute(args) {
			const { selector, selectorType = "css", ref, value, frameId } = args;
			console.log(`Starting fill operation with options:`, args);
			if (!selector && !ref) return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ": Provide ref or selector");
			if (value === void 0 || value === null) return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ": Value must be provided");
			try {
				const tab = await this.tryGetTab(args.tabId) || await this.getActiveTabOrThrowInWindow(args.windowId);
				if (!tab.id) return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ": Active tab has no ID");
				let finalRef = ref;
				let finalSelector = selector;
				if (selector && selectorType === "xpath") {
					await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"]);
					try {
						const resolved = await this.sendMessageToTab(tab.id, {
							action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
							selector,
							isXPath: true
						}, frameId);
						if (resolved && resolved.success && resolved.ref) {
							finalRef = resolved.ref;
							finalSelector = void 0;
						} else return createErrorResponse(`Failed to resolve XPath selector: ${resolved?.error || "unknown error"}`);
					} catch (error) {
						return createErrorResponse(`Error resolving XPath: ${error instanceof Error ? error.message : String(error)}`);
					}
				}
				await this.injectContentScript(tab.id, ["inject-scripts/fill-helper.js"]);
				const result = await this.sendMessageToTab(tab.id, {
					action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
					selector: finalSelector,
					ref: finalRef,
					value
				}, frameId);
				if (result && result.error) return createErrorResponse(result.error);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							message: result.message || "Fill operation successful",
							elementInfo: result.elementInfo
						})
					}],
					isError: false
				};
			} catch (error) {
				console.error("Error in fill operation:", error);
				return createErrorResponse(`Error filling element: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	var fillTool = new FillTool();
	//#endregion
	//#region entrypoints/background/tools/browser/keyboard.ts
	init_defineProperty();
	/**
	* Tool for simulating keyboard input on web pages
	*/
	var KeyboardTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.KEYBOARD);
		}
		/**
		* Execute keyboard operation
		*/
		async execute(args) {
			const { keys, selector, selectorType = "css", delay = TIMEOUTS.KEYBOARD_DELAY } = args;
			console.log(`Starting keyboard operation with options:`, args);
			if (!keys) return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ": Keys parameter must be provided");
			try {
				const tab = await this.tryGetTab(args.tabId) || await this.getActiveTabOrThrowInWindow(args.windowId);
				if (!tab.id) return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ": Active tab has no ID");
				let finalSelector = selector;
				let refForFocus = void 0;
				await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"]);
				if (selector && selectorType === "xpath") try {
					const ensured = await this.sendMessageToTab(tab.id, {
						action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
						selector,
						isXPath: true
					});
					if (!ensured || !ensured.success || !ensured.ref) return createErrorResponse(`Failed to resolve XPath selector: ${ensured?.error || "unknown error"}`);
					refForFocus = ensured.ref;
					const resolved = await this.sendMessageToTab(tab.id, {
						action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
						ref: ensured.ref
					});
					if (resolved && resolved.success && resolved.selector) {
						finalSelector = resolved.selector;
						refForFocus = void 0;
					}
				} catch (error) {
					return createErrorResponse(`Error resolving XPath: ${error instanceof Error ? error.message : String(error)}`);
				}
				if (refForFocus) {
					const focusResult = await this.sendMessageToTab(tab.id, {
						action: "focusByRef",
						ref: refForFocus
					});
					if (focusResult && !focusResult.success) return createErrorResponse(`Failed to focus element by ref: ${focusResult.error || "unknown error"}`);
					finalSelector = void 0;
				}
				const frameIds = typeof args.frameId === "number" ? [args.frameId] : void 0;
				await this.injectContentScript(tab.id, ["inject-scripts/keyboard-helper.js"], false, "ISOLATED", false, frameIds);
				const result = await this.sendMessageToTab(tab.id, {
					action: TOOL_MESSAGE_TYPES.SIMULATE_KEYBOARD,
					keys,
					selector: finalSelector,
					delay
				}, args.frameId);
				if (result.error) return createErrorResponse(result.error);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							message: result.message || "Keyboard operation successful",
							targetElement: result.targetElement,
							results: result.results
						})
					}],
					isError: false
				};
			} catch (error) {
				console.error("Error in keyboard operation:", error);
				return createErrorResponse(`Error simulating keyboard events: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	var keyboardTool = new KeyboardTool();
	//#endregion
	//#region utils/output-sanitizer.ts
	init_cdp_session_manager();
	/**
	* Output Sanitizer - 输出脱敏和限长工具
	*
	* 提供对 JavaScript 执行结果的安全处理：
	* 1. 敏感信息脱敏（cookie/token/password 等）
	* 2. 输出长度限制（默认 50KB）
	* 3. 深度对象序列化
	*/
	var DEFAULT_MAX_OUTPUT_BYTES = 51200;
	var DEFAULT_MAX_DEPTH = 6;
	var DEFAULT_MAX_ARRAY_LENGTH = 200;
	var DEFAULT_MAX_OBJECT_KEYS = 200;
	var DEFAULT_MAX_STRING_LENGTH = 1e4;
	var SENSITIVE_KEY_MARKERS = [
		"cookie",
		"setcookie",
		"authorization",
		"proxyauthorization",
		"bearer",
		"token",
		"accesstoken",
		"refreshtoken",
		"idtoken",
		"password",
		"passwd",
		"pwd",
		"secret",
		"clientsecret",
		"apikey",
		"session",
		"sessionid",
		"sid",
		"csrf",
		"xsrf",
		"credential",
		"privatekey",
		"accesskey",
		"auth",
		"oauth"
	];
	/**
	* 对任意值进行脱敏和限长处理
	*/
	function sanitizeAndLimitOutput(value, options = {}) {
		const maxBytes = normalizePositiveInt$1(options.maxBytes, DEFAULT_MAX_OUTPUT_BYTES);
		const { value: sanitizedValue, redacted } = sanitizeValue(value, {
			maxDepth: normalizePositiveInt$1(options.maxDepth, DEFAULT_MAX_DEPTH),
			maxArrayLength: normalizePositiveInt$1(options.maxArrayLength, DEFAULT_MAX_ARRAY_LENGTH),
			maxObjectKeys: normalizePositiveInt$1(options.maxObjectKeys, DEFAULT_MAX_OBJECT_KEYS),
			maxStringLength: normalizePositiveInt$1(options.maxStringLength, DEFAULT_MAX_STRING_LENGTH)
		});
		const truncated = truncateTextBytes(formatValueForOutput(sanitizedValue), maxBytes);
		return {
			text: truncated.text,
			truncated: truncated.truncated,
			redacted,
			originalBytes: truncated.originalBytes
		};
	}
	/**
	* 对字符串进行敏感信息脱敏
	* 参考 mcp-tools.js 的脱敏逻辑，增加 Base64/Hex/cookie-query 识别
	*/
	function sanitizeText(text) {
		let out = text;
		let redacted = false;
		const replace = (re, replacement) => {
			const next = out.replace(re, replacement);
			if (next !== out) {
				out = next;
				redacted = true;
			}
		};
		if (out.includes("=") && (out.includes(";") || out.includes("&"))) {
			if (looksLikeCookieString(out)) return {
				text: "[BLOCKED: Cookie/query string data]",
				redacted: true
			};
			if (looksLikeQueryString(out)) return {
				text: "[BLOCKED: Cookie/query string data]",
				redacted: true
			};
		}
		if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(out)) return {
			text: "[BLOCKED: Base64 encoded data]",
			redacted: true
		};
		if (/^[a-f0-9]{32,}$/i.test(out)) return {
			text: "[BLOCKED: Hex credential]",
			redacted: true
		};
		replace(/\bBearer\s+([A-Za-z0-9._~+/=-]+)\b/gi, "Bearer <redacted>");
		replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "<redacted_jwt>");
		replace(/(^|[?&])(access_token|refresh_token|id_token|token|api_key|apikey|password|passwd|pwd|secret|session|sid|credential|auth|oauth)=([^&#\s]+)/gi, (_m, p1, p2) => `${p1}${p2}=<redacted>`);
		replace(/\b(authorization|cookie|set-cookie|x-api-key|api_key|apikey|password|passwd|pwd|secret|token|access_token|refresh_token|id_token|session|sid|credential|private_key|oauth)\b\s*[:=]\s*([^\s,;"']+)/gi, (_m, key) => `${key}=<redacted>`);
		replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "<redacted_base64>");
		replace(/\b[a-f0-9]{40,}\b/gi, "<redacted_hex>");
		return {
			text: out,
			redacted
		};
	}
	/**
	* 检测字符串是否像 query string (key=value&key2=value2)
	*/
	function looksLikeQueryString(text) {
		const s = (text || "").trim();
		if (!s || !s.includes("=") || !s.includes("&")) return false;
		const parts = s.split("&");
		if (parts.length < 2) return false;
		let pairs = 0;
		for (const part of parts) if (part.indexOf("=") > 0) pairs += 1;
		return pairs >= 2;
	}
	function sanitizeValue(value, limits) {
		const { maxDepth, maxArrayLength, maxObjectKeys, maxStringLength } = limits;
		const seen = /* @__PURE__ */ new WeakMap();
		let redacted = false;
		const walk = (v, depth) => {
			if (depth < 0) return "[MaxDepth]";
			if (typeof v === "string") {
				const sanitized = sanitizeText(v);
				if (sanitized.redacted) redacted = true;
				let s = sanitized.text;
				if (s.length > maxStringLength) s = `${s.slice(0, maxStringLength)}... [truncated ${s.length - maxStringLength} chars]`;
				return s;
			}
			if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint" || typeof v === "undefined") return v;
			if (typeof v === "symbol") return v.toString();
			if (typeof v === "function") return `[Function${v.name ? `: ${v.name}` : ""}]`;
			if (typeof v !== "object") return String(v);
			const obj = v;
			if (seen.has(obj)) return "[Circular]";
			if (Array.isArray(obj)) {
				const out = [];
				seen.set(obj, out);
				const len = Math.min(obj.length, maxArrayLength);
				for (let i = 0; i < len; i++) out.push(walk(obj[i], depth - 1));
				if (obj.length > maxArrayLength) out.push("[...truncated]");
				return out;
			}
			const out = {};
			seen.set(obj, out);
			const keys = Object.keys(obj);
			const len = Math.min(keys.length, maxObjectKeys);
			for (let i = 0; i < len; i++) {
				const key = keys[i];
				if (isSensitiveKey(key)) {
					out[key] = "<redacted>";
					redacted = true;
					continue;
				}
				out[key] = walk(obj[key], depth - 1);
			}
			if (keys.length > maxObjectKeys) out.__truncated__ = true;
			return out;
		};
		return {
			value: walk(value, maxDepth),
			redacted
		};
	}
	function isSensitiveKey(key) {
		const normalized = normalizeKey(key);
		return SENSITIVE_KEY_MARKERS.some((marker) => normalized.includes(marker));
	}
	function normalizeKey(key) {
		return (key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
	}
	/**
	* 检测字符串是否像 cookie 字符串 (key=value; key2=value2)
	*/
	function looksLikeCookieString(text) {
		const s = (text || "").trim();
		if (!s) return false;
		if (!s.includes("=") || !s.includes(";")) return false;
		const parts = s.split(";");
		if (parts.length < 2) return false;
		let pairs = 0;
		for (const part of parts) if (part.indexOf("=") > 0) pairs += 1;
		return pairs >= 2;
	}
	function formatValueForOutput(value) {
		if (typeof value === "string") return value;
		if (typeof value === "undefined") return "undefined";
		try {
			return safeJsonStringify(value);
		} catch {
			return String(value);
		}
	}
	function safeJsonStringify(value) {
		const seen = /* @__PURE__ */ new WeakSet();
		return JSON.stringify(value, (_key, val) => {
			if (typeof val === "bigint") return `${val.toString()}n`;
			if (typeof val === "symbol") return val.toString();
			if (typeof val === "function") return `[Function${val.name ? `: ${val.name}` : ""}]`;
			if (val && typeof val === "object") {
				if (seen.has(val)) return "[Circular]";
				seen.add(val);
			}
			return val;
		});
	}
	function truncateTextBytes(text, maxBytes) {
		const originalBytes = byteLength(text);
		if (originalBytes <= maxBytes) return {
			text,
			truncated: false,
			originalBytes
		};
		const suffix = `\n... [truncated to ${maxBytes} bytes; original ${originalBytes} bytes]`;
		const suffixBytes = byteLength(suffix);
		const budget = Math.max(0, maxBytes - suffixBytes);
		let lo = 0;
		let hi = text.length;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (byteLength(text.slice(0, mid)) <= budget) lo = mid;
			else hi = mid - 1;
		}
		return {
			text: text.slice(0, lo) + suffix,
			truncated: true,
			originalBytes
		};
	}
	function byteLength(text) {
		try {
			return new TextEncoder().encode(text).length;
		} catch {
			return text.length;
		}
	}
	function normalizePositiveInt$1(value, fallback) {
		return Math.max(1, typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback);
	}
	//#endregion
	//#region entrypoints/background/tools/browser/javascript.ts
	/**
	* JavaScript Tool - CDP Runtime.evaluate with fallback
	*
	* Execute JavaScript in the browser tab and return the result.
	* - Primary: CDP Runtime.evaluate (supports awaitPromise + returnByValue)
	* - Fallback: chrome.scripting.executeScript (when debugger is busy)
	*
	* Features:
	* - Async code support (top-level await via async wrapper)
	* - Output sanitization (sensitive data redaction)
	* - Output truncation (configurable max bytes)
	* - Timeout handling
	* - Detailed error classification
	*/
	init_defineProperty();
	var DEFAULT_TIMEOUT_MS = 15e3;
	var CDP_SESSION_KEY = "javascript";
	var TimeoutError = class extends Error {
		constructor(timeoutMs) {
			super(`Execution timed out after ${timeoutMs}ms`);
			this.name = "TimeoutError";
		}
	};
	function normalizePositiveInt(value, fallback) {
		if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
		return Math.max(1, Math.floor(value));
	}
	function withTimeout(promise, timeoutMs) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new TimeoutError(timeoutMs));
			}, timeoutMs);
			promise.then(resolve).catch(reject).finally(() => clearTimeout(timer));
		});
	}
	function isTimeoutError(error) {
		return error instanceof Error && error.name === "TimeoutError";
	}
	function isDebuggerConflictError(error) {
		const message = error instanceof Error ? error.message : String(error);
		return /Debugger is already attached|Another debugger is already attached|Cannot attach to this target/i.test(message);
	}
	/**
	* Wrap user code in an async IIFE to support top-level await and return statements.
	*/
	function wrapUserCode(code) {
		return `(async () => {\n${code}\n})()`;
	}
	function extractReturnValue(remoteObject) {
		if (!remoteObject) return void 0;
		if ("value" in remoteObject) return remoteObject.value;
		if ("unserializableValue" in remoteObject) return remoteObject.unserializableValue;
		if (typeof remoteObject.description === "string") return remoteObject.description;
	}
	function parseExceptionDetails(details) {
		const exceptionClassName = details.exception?.className ?? "";
		const exceptionDescription = details.exception?.description ?? "";
		const exceptionValue = details.exception?.value ?? "";
		const text = details.text ?? "";
		const rawMessage = exceptionDescription || exceptionValue || text || "JavaScript execution failed";
		const message = sanitizeText(rawMessage).text;
		return {
			kind: exceptionClassName === "SyntaxError" || /SyntaxError/i.test(rawMessage) ? "syntax_error" : "runtime_error",
			message,
			details: {
				url: details.url,
				lineNumber: details.lineNumber,
				columnNumber: details.columnNumber
			}
		};
	}
	async function executeViaCdp(tabId, code, options) {
		try {
			const expression = wrapUserCode(code);
			const response = await withTimeout(cdpSessionManager.withSession(tabId, CDP_SESSION_KEY, async () => {
				return await cdpSessionManager.sendCommand(tabId, "Runtime.evaluate", {
					expression,
					returnByValue: true,
					awaitPromise: true,
					timeout: options.timeoutMs
				});
			}), options.timeoutMs + 1e3);
			if (response?.exceptionDetails) return {
				ok: false,
				engine: "cdp",
				error: parseExceptionDetails(response.exceptionDetails)
			};
			const sanitized = sanitizeAndLimitOutput(extractReturnValue(response?.result), { maxBytes: options.maxOutputBytes });
			return {
				ok: true,
				engine: "cdp",
				output: sanitized.text,
				truncated: sanitized.truncated,
				redacted: sanitized.redacted
			};
		} catch (error) {
			if (isTimeoutError(error)) return {
				ok: false,
				engine: "cdp",
				error: {
					kind: "timeout",
					message: error.message
				}
			};
			if (isDebuggerConflictError(error)) return {
				ok: false,
				engine: "cdp",
				error: {
					kind: "debugger_conflict",
					message: sanitizeText(error instanceof Error ? error.message : String(error)).text
				}
			};
			return {
				ok: false,
				engine: "cdp",
				error: {
					kind: "cdp_error",
					message: sanitizeText(error instanceof Error ? error.message : String(error)).text
				}
			};
		}
	}
	async function executeViaScripting(tabId, code, options) {
		const innerExecute = async () => {
			const result = ((await chrome.scripting.executeScript({
				target: { tabId },
				world: "ISOLATED",
				func: async (userCode) => {
					try {
						const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
						return {
							ok: true,
							value: await new AsyncFunction(userCode)()
						};
					} catch (err) {
						const error = err;
						return {
							ok: false,
							error: {
								name: error?.name ?? void 0,
								message: error?.message ?? String(err),
								stack: error?.stack ?? void 0
							}
						};
					}
				},
				args: [code]
			}))?.[0])?.result;
			if (!result || typeof result !== "object") return {
				ok: false,
				engine: "scripting",
				error: {
					kind: "scripting_error",
					message: "No result returned from executeScript"
				}
			};
			if (!result.ok) {
				const rawMessage = result.error?.message ?? "JavaScript execution failed";
				const rawStack = result.error?.stack;
				const message = sanitizeText(rawMessage).text;
				const sanitizedStack = rawStack ? sanitizeText(rawStack).text : void 0;
				return {
					ok: false,
					engine: "scripting",
					error: {
						kind: result.error?.name === "SyntaxError" || /SyntaxError/i.test(rawMessage) ? "syntax_error" : "runtime_error",
						message: sanitizedStack ? `${message}\n${sanitizedStack}` : message
					}
				};
			}
			const sanitized = sanitizeAndLimitOutput(result.value, { maxBytes: options.maxOutputBytes });
			return {
				ok: true,
				engine: "scripting",
				output: sanitized.text,
				truncated: sanitized.truncated,
				redacted: sanitized.redacted
			};
		};
		try {
			return await withTimeout(innerExecute(), options.timeoutMs);
		} catch (error) {
			if (isTimeoutError(error)) return {
				ok: false,
				engine: "scripting",
				error: {
					kind: "timeout",
					message: error.message
				}
			};
			return {
				ok: false,
				engine: "scripting",
				error: {
					kind: "scripting_error",
					message: sanitizeText(error instanceof Error ? error.message : String(error)).text
				}
			};
		}
	}
	var JavaScriptTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.JAVASCRIPT);
		}
		async execute(args) {
			const startTime = performance.now();
			try {
				const code = typeof args?.code === "string" ? args.code.trim() : "";
				if (!code) return createErrorResponse("Parameter [code] is required");
				const tab = await this.resolveTargetTab(args.tabId);
				if (!tab) return createErrorResponse(typeof args.tabId === "number" ? `Tab not found: ${args.tabId}` : "No active tab found");
				if (!tab.id) return createErrorResponse("Tab has no ID");
				const tabId = tab.id;
				const options = {
					timeoutMs: normalizePositiveInt(args.timeoutMs, DEFAULT_TIMEOUT_MS),
					maxOutputBytes: normalizePositiveInt(args.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)
				};
				const warnings = [];
				const cdpResult = await executeViaCdp(tabId, code, options);
				if (cdpResult.ok) return this.buildSuccessResponse(tabId, cdpResult, startTime);
				if (cdpResult.error.kind !== "debugger_conflict") return this.buildErrorResponse(tabId, cdpResult, startTime);
				warnings.push("Debugger is busy (DevTools or another extension attached). Falling back to chrome.scripting.executeScript (runs in ISOLATED world, not page context).");
				const scriptingResult = await executeViaScripting(tabId, code, options);
				if (scriptingResult.ok) return this.buildSuccessResponse(tabId, scriptingResult, startTime, warnings);
				return this.buildErrorResponse(tabId, scriptingResult, startTime, warnings);
			} catch (error) {
				console.error("JavaScriptTool.execute error:", error);
				return createErrorResponse(`JavaScript tool error: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		async resolveTargetTab(tabId) {
			if (typeof tabId === "number") return this.tryGetTab(tabId);
			try {
				return await this.getActiveTabOrThrow();
			} catch {
				return null;
			}
		}
		buildSuccessResponse(tabId, result, startTime, warnings) {
			const payload = {
				success: true,
				tabId,
				engine: result.engine,
				result: result.output,
				truncated: result.truncated || void 0,
				redacted: result.redacted || void 0,
				warnings: warnings?.length ? warnings : void 0,
				metrics: { elapsedMs: Math.round(performance.now() - startTime) }
			};
			return {
				content: [{
					type: "text",
					text: JSON.stringify(payload)
				}],
				isError: false
			};
		}
		buildErrorResponse(tabId, result, startTime, warnings) {
			const payload = {
				success: false,
				tabId,
				engine: result.engine,
				error: result.error,
				warnings: warnings?.length ? warnings : void 0,
				metrics: { elapsedMs: Math.round(performance.now() - startTime) }
			};
			return {
				content: [{
					type: "text",
					text: JSON.stringify(payload)
				}],
				isError: true
			};
		}
	};
	var javascriptTool = new JavaScriptTool();
	//#endregion
	//#region entrypoints/background/tools/browser/file-upload.ts
	init_defineProperty();
	/**
	* 往网页的文件输入框投放一个**站内**文件。
	*
	* # 为什么只认 /media
	*
	* 上游那版接三种来源：`filePath`（本机任意路径）、`fileUrl`（任意地址）、
	* `base64Data`。第一种是真能用的——`DOM.setFileInputFiles` 直接吃磁盘路径，于是
	* 一句模型生成的参数就能把用户电脑上任意一个文件传到任意网页上。那不是「上传文件」
	* 这件事需要的权限，是「读你整块硬盘」。
	*
	* 本期只留一条来源：Matter 自己存着的那些文件（`/media/...`，用户上传的附件、
	* 执行产出的交付、生成的图片）。它们本来就是这次任务的材料，用户在会话里看得见；
	* 而「哪些文件属于这次任务」这个判断在服务端，不在模型的参数里。
	*
	* 另外两种来源直接删掉而不是留着不用：`fileUrl`/`base64Data` 上游是转给本机
	* Node 桥落成临时文件的，而那个桥已经随 fork 删了——留着只会挂满 30 秒再报
	* 「准备文件失败」，比明确说「这条路不支持」糟得多。
	*
	* # 为什么不再用 CDP
	*
	* `DOM.setFileInputFiles` 要的是磁盘路径，而我们手上只有字节。改成在页面里用
	* `DataTransfer` 造一个 `File` 赋给 `input.files`——这条路不需要落盘、不需要
	* `downloads` 权限、也不必 attach debugger。
	*/
	/** 单个文件上限。service worker 要把它整份读进内存再传给页面。 */
	var MAX_UPLOAD_BYTES = 20971520;
	var FileUploadTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.FILE_UPLOAD);
		}
		async execute(args) {
			const { selector, mediaUrl, fileName } = args ?? {};
			if (!selector) return createErrorResponse("Selector is required for file upload");
			if (!mediaUrl) return createErrorResponse("mediaUrl is required: only files already stored in Matter (/media/...) can be uploaded. Ask the user to upload the file into the conversation first, then use the /media path it returns.");
			const resolved = resolveMediaURL(mediaUrl, (await loadConfig()).apiBase);
			if (!resolved.ok) return createErrorResponse(resolved.error);
			try {
				const tab = await this.tryGetTab(args.tabId) || await this.getActiveTabOrThrowInWindow(args.windowId);
				if (!tab.id) return createErrorResponse("No active tab found");
				const fetched = await fetchMediaFile(resolved.url);
				if (!fetched.ok) return createErrorResponse(fetched.error);
				const name = (fileName || resolved.defaultName || "uploaded-file").trim();
				const [injected] = await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					func: setFileInput,
					args: [
						selector,
						fetched.base64,
						name,
						fetched.mimeType
					]
				});
				const outcome = injected?.result;
				if (!outcome?.ok) return createErrorResponse(outcome?.error || "Failed to set the file on the input element");
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							message: "File uploaded to the input element",
							selector,
							fileName: name,
							bytes: fetched.bytes,
							source: resolved.url
						})
					}],
					isError: false
				};
			} catch (error) {
				console.error("Error in file upload operation:", error);
				return createErrorResponse(`Error uploading file: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	/**
	* 只放行站内 /media 文件。
	*
	* 两种写法都收：相对路径 `/media/...`，以及配置里那个 Matter 地址下的同一路径。
	* 其余一律拒——包括别的主机上的 /media（那只是路径长得像）、`file://`、
	* `data:`，以及带 `..` 想爬出 /media 的。
	*
	* 导出是为了能单测：这是这件工具的整道闸，判错一次就等于闸没装。
	*/
	function resolveMediaURL(input, apiBase) {
		const raw = String(input || "").trim();
		if (!raw) return {
			ok: false,
			error: "mediaUrl is empty"
		};
		const base = String(apiBase || "").trim().replace(/\/+$/, "");
		if (!base) return {
			ok: false,
			error: "This browser is not paired with a Matter server yet"
		};
		let url;
		try {
			url = new URL(raw, base + "/");
		} catch {
			return {
				ok: false,
				error: `mediaUrl is not a valid URL: ${raw}`
			};
		}
		let baseURL;
		try {
			baseURL = new URL(base);
		} catch {
			return {
				ok: false,
				error: "The configured Matter server address is not a valid URL"
			};
		}
		if (url.origin !== baseURL.origin) return {
			ok: false,
			error: `Only files stored in Matter can be uploaded. ${url.origin} is not this Matter server (${baseURL.origin}). Ask the user to put the file into the conversation first.`
		};
		let path;
		try {
			path = decodeURIComponent(url.pathname);
		} catch {
			return {
				ok: false,
				error: "mediaUrl has a malformed path"
			};
		}
		if (!path.startsWith("/media/") || path.includes("..")) return {
			ok: false,
			error: "Only files under /media/ can be uploaded. Local paths, arbitrary URLs and inline data are not accepted — ask the user to upload the file into the conversation first."
		};
		const defaultName = decodeURIComponent(path.split("/").pop() || "") || "uploaded-file";
		return {
			ok: true,
			url: url.origin + url.pathname,
			defaultName
		};
	}
	async function fetchMediaFile(url) {
		let res;
		try {
			res = await fetch(url);
		} catch (e) {
			return {
				ok: false,
				error: `Could not read the file from Matter: ${String(e)}`
			};
		}
		if (!res.ok) return {
			ok: false,
			error: `Could not read the file from Matter: HTTP ${res.status}`
		};
		const buf = await res.arrayBuffer();
		if (buf.byteLength > MAX_UPLOAD_BYTES) return {
			ok: false,
			error: `File is too large to upload (${buf.byteLength} bytes, limit ${MAX_UPLOAD_BYTES})`
		};
		return {
			ok: true,
			base64: bytesToBase64(new Uint8Array(buf)),
			mimeType: res.headers.get("content-type") || "application/octet-stream",
			bytes: buf.byteLength
		};
	}
	function bytesToBase64(bytes) {
		let binary = "";
		const chunk = 32768;
		for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
		return btoa(binary);
	}
	/**
	* 在页面里把字节变成一个 File 挂到 input 上。
	*
	* 这段会被序列化后注入页面执行，不能引用外层作用域的任何东西。
	*/
	function setFileInput(selector, base64, fileName, mimeType) {
		const el = document.querySelector(selector);
		if (!el) return {
			ok: false,
			error: `Element with selector "${selector}" not found`
		};
		const input = el;
		if (input.tagName !== "INPUT" || input.type !== "file") return {
			ok: false,
			error: `Element with selector "${selector}" is not a file input`
		};
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		const file = new File([bytes], fileName, { type: mimeType });
		const dt = new DataTransfer();
		dt.items.add(file);
		input.files = dt.files;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
		return { ok: true };
	}
	var fileUploadTool = new FileUploadTool();
	//#endregion
	//#region entrypoints/background/tools/browser/read-page.ts
	init_defineProperty();
	var ReadPageTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.READ_PAGE);
		}
		async execute(args) {
			const { filter, depth, refId } = args || {};
			const focusRefId = typeof refId === "string" ? refId.trim() : "";
			if (refId !== void 0 && !focusRefId) return createErrorResponse(`${ERROR_MESSAGES.INVALID_PARAMETERS}: refId must be a non-empty string`);
			const requestedDepth = depth === void 0 ? void 0 : Number(depth);
			if (requestedDepth !== void 0 && (!Number.isInteger(requestedDepth) || requestedDepth < 0)) return createErrorResponse(`${ERROR_MESSAGES.INVALID_PARAMETERS}: depth must be a non-negative integer`);
			const userControlled = requestedDepth !== void 0 || !!focusRefId;
			try {
				const standardTips = "If the specific element you need is missing from the returned data, use the 'screenshot' tool to capture the current viewport and confirm the element's on-screen coordinates. ";
				const tab = await this.tryGetTab(args?.tabId) || await this.getActiveTabOrThrowInWindow(args?.windowId);
				if (!tab.id) return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ": Active tab has no ID");
				const userMarkers = [];
				await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"], false, "ISOLATED", true);
				const resp = await this.sendMessageToTab(tab.id, {
					action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
					filter: filter || null,
					depth: requestedDepth,
					refId: focusRefId || void 0
				});
				const treeOk = resp && resp.success === true;
				const pageContent = resp && typeof resp.pageContent === "string" ? resp.pageContent : "";
				const stats = treeOk && resp?.stats ? {
					processed: resp.stats.processed ?? 0,
					included: resp.stats.included ?? 0,
					durationMs: resp.stats.durationMs ?? 0
				} : null;
				const lines = pageContent ? pageContent.split("\n").filter((l) => l.trim().length > 0).length : 0;
				const refCount = Array.isArray(resp?.refMap) ? resp.refMap.length : 0;
				const isSparse = !userControlled && lines < 10 && refCount < 3;
				const markedElements = userMarkers.map((m) => ({
					name: m.name,
					selector: m.selector,
					selectorType: m.selectorType || "css",
					urlMatch: {
						type: m.matchType,
						origin: m.origin,
						path: m.path
					},
					source: "marker",
					priority: "highest"
				}));
				const formatElementsAsPageContent = (elements) => {
					const out = [];
					for (const e of elements || []) {
						const type = typeof e?.type === "string" && e.type ? e.type : "element";
						const rawText = typeof e?.text === "string" ? e.text.trim() : "";
						const text = rawText.length > 0 ? ` "${rawText.replace(/\s+/g, " ").slice(0, 100).replace(/"/g, "\\\"")}"` : "";
						const selector = typeof e?.selector === "string" && e.selector ? ` selector="${e.selector}"` : "";
						const coords = e?.coordinates && Number.isFinite(e.coordinates.x) && Number.isFinite(e.coordinates.y) ? ` (x=${Math.round(e.coordinates.x)},y=${Math.round(e.coordinates.y)})` : "";
						out.push(`- ${type}${text}${selector}${coords}`);
						if (out.length >= 150) break;
					}
					return out.join("\n");
				};
				const basePayload = {
					success: true,
					filter: filter || "all",
					pageContent,
					tips: standardTips,
					viewport: treeOk ? resp.viewport : {
						width: null,
						height: null,
						dpr: null
					},
					stats: stats || {
						processed: 0,
						included: 0,
						durationMs: 0
					},
					refMapCount: refCount,
					sparse: treeOk ? isSparse : false,
					depth: requestedDepth ?? null,
					focus: focusRefId ? {
						refId: focusRefId,
						found: treeOk
					} : null,
					markedElements,
					elements: [],
					count: 0,
					fallbackUsed: false,
					fallbackSource: null,
					reason: null
				};
				if (treeOk && !isSparse) return {
					content: [{
						type: "text",
						text: JSON.stringify(basePayload)
					}],
					isError: false
				};
				if (focusRefId) return createErrorResponse(resp?.error || `refId "${focusRefId}" not found or expired`);
				if (requestedDepth !== void 0) return createErrorResponse(resp?.error || "Failed to generate accessibility tree");
				try {
					await this.injectContentScript(tab.id, ["inject-scripts/interactive-elements-helper.js"]);
					const fallback = await this.sendMessageToTab(tab.id, {
						action: TOOL_MESSAGE_TYPES.GET_INTERACTIVE_ELEMENTS,
						includeCoordinates: true
					});
					if (fallback && fallback.success && Array.isArray(fallback.elements)) {
						const limited = fallback.elements.slice(0, 150);
						const markerEls = userMarkers.map((m) => ({
							type: "marker",
							selector: m.selector,
							text: m.name,
							selectorType: m.selectorType || "css",
							isInteractive: true,
							source: "marker",
							priority: "highest"
						}));
						const seen = new Set(markerEls.map((e) => e.selector));
						const merged = [...markerEls, ...limited.filter((e) => !seen.has(e.selector))];
						basePayload.fallbackUsed = true;
						basePayload.fallbackSource = "get_interactive_elements";
						basePayload.reason = treeOk ? "sparse_tree" : resp?.error || "tree_failed";
						basePayload.elements = merged;
						basePayload.count = fallback.elements.length;
						if (!basePayload.pageContent) basePayload.pageContent = formatElementsAsPageContent(merged);
						return {
							content: [{
								type: "text",
								text: JSON.stringify(basePayload)
							}],
							isError: false
						};
					}
				} catch (fallbackErr) {
					console.warn("read_page fallback failed:", fallbackErr);
				}
				if (treeOk) {
					basePayload.reason = "sparse_tree_fallback_failed";
					return {
						content: [{
							type: "text",
							text: JSON.stringify(basePayload)
						}],
						isError: false
					};
				}
				return createErrorResponse(resp?.error || "Failed to generate accessibility tree and fallback failed");
			} catch (error) {
				console.error("Error in read page tool:", error);
				return createErrorResponse(`Error generating accessibility tree: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	var readPageTool = new ReadPageTool();
	//#endregion
	//#region entrypoints/background/link/activity.ts
	/**
	* 活动日志与「停止」。
	*
	* 用户把自己的浏览器交给一个 agent，最起码要能回答两件事：**它刚才做了什么**，
	* 以及**怎么让它立刻住手**。这两件都不该依赖网页那一端——网页可能没开着，
	* 而按下停止的那个人此刻正盯着浏览器。
	*/
	var MAX_ENTRIES = 50;
	var ring = [];
	function record(entry) {
		ring.push(entry);
		if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);
	}
	function recent(n = 10) {
		return ring.slice(-n).reverse();
	}
	/**
	* 在途调用的取消通道。
	*
	* 用 AbortController 而不是一个布尔标志：标志要靠调用方主动去轮询，而
	* 「谁记得去读」正是这类机制失效的地方——第一版就写了标志、没有任何工具读它，
	* 于是「停止」按下去什么也不会停（26-09-09 真机验收前自查发现）。signal 能被
	* `await` 直接竞速，等待中的代码不需要记得轮询。
	*/
	var inflight = /* @__PURE__ */ new Map();
	function beginCall(requestId) {
		const controller = new AbortController();
		inflight.set(requestId, controller);
		return controller;
	}
	function endCall(requestId) {
		inflight.delete(requestId);
	}
	function cancel(requestId) {
		inflight.get(requestId)?.abort(/* @__PURE__ */ new Error("已取消"));
	}
	function signalFor(requestId) {
		return inflight.get(requestId)?.signal;
	}
	/** 取消时抛出的错误。工具据此把这次调用如实报成「已取消」而不是失败。 */
	var CancelledError = class extends Error {
		constructor() {
			super("已取消");
			this.name = "CancelledError";
		}
	};
	/** 可被取消的等待。signal 缺省时退化成普通 sleep（行为与从前一致）。 */
	function abortableDelay(ms, signal) {
		if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
		if (signal.aborted) return Promise.reject(new CancelledError());
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			}, ms);
			const onAbort = () => {
				clearTimeout(timer);
				reject(new CancelledError());
			};
			signal.addEventListener("abort", onAbort, { once: true });
		});
	}
	/** 让一件等着别人回话的事也能被取消：谁先到算谁的。 */
	function abortable(promise, signal) {
		if (!signal) return promise;
		if (signal.aborted) return Promise.reject(new CancelledError());
		return new Promise((resolve, reject) => {
			const onAbort = () => reject(new CancelledError());
			signal.addEventListener("abort", onAbort, { once: true });
			promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
		});
	}
	//#endregion
	//#region entrypoints/background/tools/browser/computer.ts
	init_cdp_session_manager();
	init_defineProperty();
	var CDPHelper = class {
		static async attach(tabId) {
			await cdpSessionManager.attach(tabId, "computer");
		}
		static async detach(tabId) {
			await cdpSessionManager.detach(tabId, "computer");
		}
		static async send(tabId, method, params) {
			return await cdpSessionManager.sendCommand(tabId, method, params);
		}
		static async dispatchMouseEvent(tabId, opts) {
			const params = {
				type: opts.type,
				x: Math.round(opts.x),
				y: Math.round(opts.y),
				modifiers: opts.modifiers || 0
			};
			if (opts.type === "mousePressed" || opts.type === "mouseReleased" || opts.type === "mouseMoved") {
				params.button = opts.button || "none";
				if (opts.type === "mousePressed" || opts.type === "mouseReleased") params.clickCount = opts.clickCount || 1;
				params.buttons = opts.buttons !== void 0 ? opts.buttons : 0;
			}
			if (opts.type === "mouseWheel") {
				params.deltaX = opts.deltaX || 0;
				params.deltaY = opts.deltaY || 0;
			}
			await this.send(tabId, "Input.dispatchMouseEvent", params);
		}
		static async insertText(tabId, text) {
			await this.send(tabId, "Input.insertText", { text });
		}
		static modifierMask(mods) {
			const map = {
				alt: 1,
				ctrl: 2,
				control: 2,
				meta: 4,
				cmd: 4,
				command: 4,
				win: 4,
				windows: 4,
				shift: 8
			};
			let mask = 0;
			for (const m of mods) mask |= map[m] || 0;
			return mask;
		}
		static resolveKeyDef(token) {
			const t = (token || "").toLowerCase();
			if (this.KEY_ALIASES[t]) return this.KEY_ALIASES[t];
			if (/^f([1-9]|1[0-2])$/.test(t)) return {
				key: t.toUpperCase(),
				code: t.toUpperCase()
			};
			if (t.length === 1) {
				const upper = t.toUpperCase();
				return {
					key: upper,
					code: `Key${upper}`,
					text: t
				};
			}
			return { key: token };
		}
		static async dispatchSimpleKey(tabId, token) {
			const def = this.resolveKeyDef(token);
			if (def.text && def.text.length === 1) {
				await this.insertText(tabId, def.text);
				return;
			}
			await this.send(tabId, "Input.dispatchKeyEvent", {
				type: "rawKeyDown",
				key: def.key,
				code: def.code
			});
			await this.send(tabId, "Input.dispatchKeyEvent", {
				type: "keyUp",
				key: def.key,
				code: def.code
			});
		}
		static async dispatchKeyChord(tabId, chord) {
			const parts = chord.split("+");
			const modifiers = [];
			let keyToken = "";
			for (const pRaw of parts) {
				const p = pRaw.trim().toLowerCase();
				if ([
					"ctrl",
					"control",
					"alt",
					"shift",
					"cmd",
					"meta",
					"command",
					"win",
					"windows"
				].includes(p)) modifiers.push(p);
				else keyToken = pRaw.trim();
			}
			const mask = this.modifierMask(modifiers);
			const def = this.resolveKeyDef(keyToken);
			await this.send(tabId, "Input.dispatchKeyEvent", {
				type: "rawKeyDown",
				key: def.key,
				code: def.code,
				text: def.text,
				modifiers: mask
			});
			await this.send(tabId, "Input.dispatchKeyEvent", {
				type: "keyUp",
				key: def.key,
				code: def.code,
				modifiers: mask
			});
		}
	};
	_defineProperty(CDPHelper, "KEY_ALIASES", {
		enter: {
			key: "Enter",
			code: "Enter"
		},
		return: {
			key: "Enter",
			code: "Enter"
		},
		backspace: {
			key: "Backspace",
			code: "Backspace"
		},
		delete: {
			key: "Delete",
			code: "Delete"
		},
		tab: {
			key: "Tab",
			code: "Tab"
		},
		escape: {
			key: "Escape",
			code: "Escape"
		},
		esc: {
			key: "Escape",
			code: "Escape"
		},
		space: {
			key: " ",
			code: "Space",
			text: " "
		},
		pageup: {
			key: "PageUp",
			code: "PageUp"
		},
		pagedown: {
			key: "PageDown",
			code: "PageDown"
		},
		home: {
			key: "Home",
			code: "Home"
		},
		end: {
			key: "End",
			code: "End"
		},
		arrowup: {
			key: "ArrowUp",
			code: "ArrowUp"
		},
		arrowdown: {
			key: "ArrowDown",
			code: "ArrowDown"
		},
		arrowleft: {
			key: "ArrowLeft",
			code: "ArrowLeft"
		},
		arrowright: {
			key: "ArrowRight",
			code: "ArrowRight"
		}
	});
	var ComputerTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.COMPUTER);
		}
		async execute(args, ctx) {
			const params = args || {};
			if (!params.action) return createErrorResponse("Action parameter is required");
			try {
				const tab = await this.tryGetTab(args.tabId) || await this.getActiveTabOrThrowInWindow(args.windowId);
				if (!tab.id) return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ": Active tab has no ID");
				return await this.executeAction(params, tab, ctx);
			} catch (error) {
				if (error instanceof CancelledError) throw error;
				console.error("Error in computer tool:", error);
				return createErrorResponse(`Failed to execute action: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		async executeAction(params, tab, ctx) {
			if (!tab.id) return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ": Active tab has no ID");
			const project = (c) => {
				if (!c) return void 0;
				const ctx = screenshotContextManager.getContext(tab.id);
				if (!ctx) return c;
				const scaled = scaleCoordinates(c.x, c.y, ctx);
				return {
					x: scaled.x,
					y: scaled.y
				};
			};
			switch (params.action) {
				case "resize_page": {
					const width = Number(params.coordinates?.x || params.text);
					const height = Number(params.coordinates?.y || params.value);
					const w = Number(params.width ?? width);
					const h = Number(params.height ?? height);
					if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return createErrorResponse("Provide width and height for resize_page (positive numbers)");
					try {
						await CDPHelper.attach(tab.id);
						try {
							await CDPHelper.send(tab.id, "Emulation.setDeviceMetricsOverride", {
								width: Math.round(w),
								height: Math.round(h),
								deviceScaleFactor: 0,
								mobile: false,
								screenWidth: Math.round(w),
								screenHeight: Math.round(h)
							});
						} finally {
							await CDPHelper.detach(tab.id);
						}
					} catch (e) {
						if (tab.windowId !== void 0) await chrome.windows.update(tab.windowId, {
							width: Math.round(w),
							height: Math.round(h)
						});
						else return createErrorResponse(`Failed to resize via CDP and cannot determine windowId: ${e instanceof Error ? e.message : String(e)}`);
					}
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: true,
								action: "resize_page",
								width: w,
								height: h
							})
						}],
						isError: false
					};
				}
				case "hover": {
					let coord = void 0;
					let resolvedBy;
					try {
						if (params.ref) {
							await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"]);
							try {
								await this.sendMessageToTab(tab.id, {
									action: "focusByRef",
									ref: params.ref
								});
							} catch {}
							const resolved = await this.sendMessageToTab(tab.id, {
								action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
								ref: params.ref
							});
							if (resolved && resolved.success) {
								coord = project({
									x: resolved.center.x,
									y: resolved.center.y
								});
								resolvedBy = "ref";
							}
						} else if (params.selector) {
							await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"]);
							const selectorType = params.selectorType || "css";
							const ensured = await this.sendMessageToTab(tab.id, {
								action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
								selector: params.selector,
								isXPath: selectorType === "xpath"
							});
							if (ensured && ensured.success) {
								const resolvedRef = typeof ensured.ref === "string" ? ensured.ref : void 0;
								if (resolvedRef) {
									try {
										await this.sendMessageToTab(tab.id, {
											action: "focusByRef",
											ref: resolvedRef
										});
									} catch {}
									const reResolved = await this.sendMessageToTab(tab.id, {
										action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
										ref: resolvedRef
									});
									if (reResolved && reResolved.success) coord = project({
										x: reResolved.center.x,
										y: reResolved.center.y
									});
									else coord = project({
										x: ensured.center.x,
										y: ensured.center.y
									});
								} else coord = project({
									x: ensured.center.x,
									y: ensured.center.y
								});
								resolvedBy = "selector";
							}
						} else if (params.coordinates) {
							coord = project(params.coordinates);
							resolvedBy = "coordinates";
						}
					} catch (e) {}
					if (!coord) return createErrorResponse("Provide ref or selector or coordinates for hover, or failed to resolve target");
					{
						const stale = (() => {
							if (!params.coordinates) return null;
							const getHostname = (url) => {
								try {
									return new URL(url).hostname;
								} catch {
									return "";
								}
							};
							const currentHostname = getHostname(tab.url || "");
							const contextHostname = screenshotContextManager.getContext(tab.id)?.hostname;
							if (contextHostname && contextHostname !== currentHostname) return createErrorResponse(`Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during hover. Capture a new screenshot or use ref/selector.`);
							return null;
						})();
						if (stale) return stale;
					}
					try {
						await CDPHelper.attach(tab.id);
						try {
							await CDPHelper.dispatchMouseEvent(tab.id, {
								type: "mouseMoved",
								x: coord.x,
								y: coord.y,
								button: "none",
								buttons: 0
							});
						} finally {
							await CDPHelper.detach(tab.id);
						}
						const holdMs = Math.max(0, Math.min(params.duration ? params.duration * 1e3 : 400, 5e3));
						if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									action: "hover",
									coordinates: coord,
									resolvedBy,
									transport: "cdp"
								})
							}],
							isError: false
						};
					} catch (error) {
						console.warn("[ComputerTool] CDP hover failed, attempting DOM fallback", error);
						return await this.domHoverFallback(tab.id, coord, resolvedBy, params.ref);
					}
				}
				case "left_click":
				case "right_click": {
					const modifiersMask = CDPHelper.modifierMask([
						params.modifiers?.altKey ? "alt" : void 0,
						params.modifiers?.ctrlKey ? "ctrl" : void 0,
						params.modifiers?.metaKey ? "meta" : void 0,
						params.modifiers?.shiftKey ? "shift" : void 0
					].filter((v) => typeof v === "string"));
					if (params.ref) return await clickTool.execute({
						ref: params.ref,
						waitForNavigation: false,
						timeout: TIMEOUTS.DEFAULT_WAIT * 5,
						button: params.action === "right_click" ? "right" : "left",
						modifiers: params.modifiers
					});
					if (params.selector) return await clickTool.execute({
						selector: params.selector,
						selectorType: params.selectorType,
						frameId: params.frameId,
						waitForNavigation: false,
						timeout: TIMEOUTS.DEFAULT_WAIT * 5,
						button: params.action === "right_click" ? "right" : "left",
						modifiers: params.modifiers
					});
					if (!params.coordinates) return createErrorResponse("Provide ref, selector, or coordinates for click action");
					{
						const stale = (() => {
							const getHostname = (url) => {
								try {
									return new URL(url).hostname;
								} catch {
									return "";
								}
							};
							const currentHostname = getHostname(tab.url || "");
							const contextHostname = screenshotContextManager.getContext(tab.id)?.hostname;
							if (contextHostname && contextHostname !== currentHostname) return createErrorResponse(`Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during ${params.action}. Capture a new screenshot or use ref/selector.`);
							return null;
						})();
						if (stale) return stale;
					}
					const coord = project(params.coordinates);
					const domResult = await clickTool.execute({
						coordinates: coord,
						waitForNavigation: false,
						timeout: TIMEOUTS.DEFAULT_WAIT * 5,
						button: params.action === "right_click" ? "right" : "left",
						modifiers: params.modifiers
					});
					if (!domResult.isError) return domResult;
					try {
						await CDPHelper.attach(tab.id);
						const button = params.action === "right_click" ? "right" : "left";
						const clickCount = 1;
						await CDPHelper.dispatchMouseEvent(tab.id, {
							type: "mouseMoved",
							x: coord.x,
							y: coord.y,
							button: "none",
							buttons: 0,
							modifiers: modifiersMask
						});
						for (let i = 1; i <= clickCount; i++) {
							await CDPHelper.dispatchMouseEvent(tab.id, {
								type: "mousePressed",
								x: coord.x,
								y: coord.y,
								button,
								buttons: button === "left" ? 1 : 2,
								clickCount: i,
								modifiers: modifiersMask
							});
							await CDPHelper.dispatchMouseEvent(tab.id, {
								type: "mouseReleased",
								x: coord.x,
								y: coord.y,
								button,
								buttons: 0,
								clickCount: i,
								modifiers: modifiersMask
							});
						}
						await CDPHelper.detach(tab.id);
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									action: params.action,
									coordinates: coord
								})
							}],
							isError: false
						};
					} catch (e) {
						await CDPHelper.detach(tab.id);
						return createErrorResponse(`CDP click failed: ${e instanceof Error ? e.message : String(e)}`);
					}
				}
				case "double_click":
				case "triple_click": {
					const modifiersMask = CDPHelper.modifierMask([
						params.modifiers?.altKey ? "alt" : void 0,
						params.modifiers?.ctrlKey ? "ctrl" : void 0,
						params.modifiers?.metaKey ? "meta" : void 0,
						params.modifiers?.shiftKey ? "shift" : void 0
					].filter((v) => typeof v === "string"));
					if (!params.coordinates && !params.ref && !params.selector) return createErrorResponse("Provide ref, selector, or coordinates for double/triple click");
					let coord = params.coordinates ? project(params.coordinates) : void 0;
					if (params.ref) try {
						await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"]);
						const resolved = await this.sendMessageToTab(tab.id, {
							action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
							ref: params.ref
						});
						if (resolved && resolved.success) coord = project({
							x: resolved.center.x,
							y: resolved.center.y
						});
					} catch (e) {}
					else if (params.selector) try {
						await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"]);
						const selectorType = params.selectorType || "css";
						const ensured = await this.sendMessageToTab(tab.id, {
							action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
							selector: params.selector,
							isXPath: selectorType === "xpath"
						}, params.frameId);
						if (ensured && ensured.success) coord = project({
							x: ensured.center.x,
							y: ensured.center.y
						});
					} catch (e) {}
					if (!coord) return createErrorResponse("Failed to resolve coordinates from ref/selector");
					{
						const stale = (() => {
							if (!params.coordinates) return null;
							const getHostname = (url) => {
								try {
									return new URL(url).hostname;
								} catch {
									return "";
								}
							};
							const currentHostname = getHostname(tab.url || "");
							const contextHostname = screenshotContextManager.getContext(tab.id)?.hostname;
							if (contextHostname && contextHostname !== currentHostname) return createErrorResponse(`Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during ${params.action}. Capture a new screenshot or use ref/selector.`);
							return null;
						})();
						if (stale) return stale;
					}
					try {
						await CDPHelper.attach(tab.id);
						const button = "left";
						const clickCount = params.action === "double_click" ? 2 : 3;
						await CDPHelper.dispatchMouseEvent(tab.id, {
							type: "mouseMoved",
							x: coord.x,
							y: coord.y,
							button: "none",
							buttons: 0,
							modifiers: modifiersMask
						});
						for (let i = 1; i <= clickCount; i++) {
							await CDPHelper.dispatchMouseEvent(tab.id, {
								type: "mousePressed",
								x: coord.x,
								y: coord.y,
								button,
								buttons: 1,
								clickCount: i,
								modifiers: modifiersMask
							});
							await CDPHelper.dispatchMouseEvent(tab.id, {
								type: "mouseReleased",
								x: coord.x,
								y: coord.y,
								button,
								buttons: 0,
								clickCount: i,
								modifiers: modifiersMask
							});
						}
						await CDPHelper.detach(tab.id);
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									action: params.action,
									coordinates: coord
								})
							}],
							isError: false
						};
					} catch (e) {
						await CDPHelper.detach(tab.id);
						return createErrorResponse(`CDP ${params.action} failed: ${e instanceof Error ? e.message : String(e)}`);
					}
				}
				case "left_click_drag": {
					if (!params.startCoordinates && !params.startRef) return createErrorResponse("Provide startRef or startCoordinates for drag");
					if (!params.coordinates && !params.ref) return createErrorResponse("Provide ref or end coordinates for drag");
					let start = params.startCoordinates ? project(params.startCoordinates) : void 0;
					let end = params.coordinates ? project(params.coordinates) : void 0;
					{
						const stale = (() => {
							if (!params.startCoordinates && !params.coordinates) return null;
							const getHostname = (url) => {
								try {
									return new URL(url).hostname;
								} catch {
									return "";
								}
							};
							const currentHostname = getHostname(tab.url || "");
							const contextHostname = screenshotContextManager.getContext(tab.id)?.hostname;
							if (contextHostname && contextHostname !== currentHostname) return createErrorResponse(`Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during left_click_drag. Capture a new screenshot or use ref/selector.`);
							return null;
						})();
						if (stale) return stale;
					}
					if (params.startRef || params.ref) await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"]);
					if (params.startRef) try {
						const resolved = await this.sendMessageToTab(tab.id, {
							action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
							ref: params.startRef
						});
						if (resolved && resolved.success) start = project({
							x: resolved.center.x,
							y: resolved.center.y
						});
					} catch {}
					if (params.ref) try {
						const resolved = await this.sendMessageToTab(tab.id, {
							action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
							ref: params.ref
						});
						if (resolved && resolved.success) end = project({
							x: resolved.center.x,
							y: resolved.center.y
						});
					} catch {}
					if (!start || !end) return createErrorResponse("Failed to resolve drag coordinates");
					try {
						await CDPHelper.attach(tab.id);
						await CDPHelper.dispatchMouseEvent(tab.id, {
							type: "mouseMoved",
							x: start.x,
							y: start.y,
							button: "none",
							buttons: 0
						});
						await CDPHelper.dispatchMouseEvent(tab.id, {
							type: "mousePressed",
							x: start.x,
							y: start.y,
							button: "left",
							buttons: 1,
							clickCount: 1
						});
						await CDPHelper.dispatchMouseEvent(tab.id, {
							type: "mouseMoved",
							x: end.x,
							y: end.y,
							button: "left",
							buttons: 1
						});
						await CDPHelper.dispatchMouseEvent(tab.id, {
							type: "mouseReleased",
							x: end.x,
							y: end.y,
							button: "left",
							buttons: 0,
							clickCount: 1
						});
						await CDPHelper.detach(tab.id);
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									action: "left_click_drag",
									start,
									end
								})
							}],
							isError: false
						};
					} catch (e) {
						await CDPHelper.detach(tab.id);
						return createErrorResponse(`Drag failed: ${e instanceof Error ? e.message : String(e)}`);
					}
				}
				case "scroll": {
					if (!params.coordinates && !params.ref) return createErrorResponse("Provide ref or coordinates for scroll");
					let coord = params.coordinates ? project(params.coordinates) : void 0;
					if (params.ref) try {
						await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"]);
						const resolved = await this.sendMessageToTab(tab.id, {
							action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
							ref: params.ref
						});
						if (resolved && resolved.success) coord = project({
							x: resolved.center.x,
							y: resolved.center.y
						});
					} catch {}
					if (!coord) return createErrorResponse("Failed to resolve scroll coordinates");
					{
						const stale = (() => {
							if (!params.coordinates) return null;
							const getHostname = (url) => {
								try {
									return new URL(url).hostname;
								} catch {
									return "";
								}
							};
							const currentHostname = getHostname(tab.url || "");
							const contextHostname = screenshotContextManager.getContext(tab.id)?.hostname;
							if (contextHostname && contextHostname !== currentHostname) return createErrorResponse(`Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during scroll. Capture a new screenshot or use ref/selector.`);
							return null;
						})();
						if (stale) return stale;
					}
					const direction = params.scrollDirection || "down";
					const amount = Math.max(1, Math.min(params.scrollAmount || 3, 10));
					const unit = 100;
					let deltaX = 0, deltaY = 0;
					if (direction === "up") deltaY = -amount * unit;
					if (direction === "down") deltaY = amount * unit;
					if (direction === "left") deltaX = -amount * unit;
					if (direction === "right") deltaX = amount * unit;
					try {
						await CDPHelper.attach(tab.id);
						await CDPHelper.dispatchMouseEvent(tab.id, {
							type: "mouseWheel",
							x: coord.x,
							y: coord.y,
							deltaX,
							deltaY
						});
						await CDPHelper.detach(tab.id);
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									action: "scroll",
									coordinates: coord,
									deltaX,
									deltaY
								})
							}],
							isError: false
						};
					} catch (e) {
						await CDPHelper.detach(tab.id);
						return createErrorResponse(`Scroll failed: ${e instanceof Error ? e.message : String(e)}`);
					}
				}
				case "type":
					if (!params.text) return createErrorResponse("Text parameter is required for type action");
					try {
						if (params.ref) await clickTool.execute({
							ref: params.ref,
							waitForNavigation: false,
							timeout: TIMEOUTS.DEFAULT_WAIT * 5
						});
						await CDPHelper.attach(tab.id);
						await CDPHelper.insertText(tab.id, params.text);
						await CDPHelper.detach(tab.id);
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									action: "type",
									length: params.text.length
								})
							}],
							isError: false
						};
					} catch (e) {
						await CDPHelper.detach(tab.id);
						return await keyboardTool.execute({
							keys: params.text.split("").join(","),
							delay: 0,
							selector: void 0
						});
					}
				case "fill":
					if (!params.ref && !params.selector) return createErrorResponse("Provide ref or selector and a value for fill");
					return await fillTool.execute({
						selector: params.selector,
						selectorType: params.selectorType,
						ref: params.ref,
						value: params.value
					});
				case "fill_form": {
					const elements = params.elements;
					if (!Array.isArray(elements) || elements.length === 0) return createErrorResponse("elements must be a non-empty array for fill_form");
					const results = [];
					for (const item of elements) {
						if (!item || !item.ref) {
							results.push({
								ref: String(item?.ref || ""),
								ok: false,
								error: "missing ref"
							});
							continue;
						}
						try {
							const ok = !(await fillTool.execute({
								ref: item.ref,
								value: item.value
							})).isError;
							results.push({
								ref: item.ref,
								ok,
								error: ok ? void 0 : "failed"
							});
						} catch (e) {
							results.push({
								ref: item.ref,
								ok: false,
								error: String(e instanceof Error ? e.message : e)
							});
						}
					}
					const successCount = results.filter((r) => r.ok).length;
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: true,
								action: "fill_form",
								filled: successCount,
								total: results.length,
								results
							})
						}],
						isError: false
					};
				}
				case "key": {
					if (!params.text) return createErrorResponse("text is required for key action (e.g., \"Backspace Backspace Enter\" or \"cmd+a\")");
					const tokens = params.text.trim().split(/\s+/).filter(Boolean);
					const repeat = params.repeat ?? 1;
					if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) return createErrorResponse("repeat must be an integer between 1 and 100 for key action");
					try {
						if (params.ref) await clickTool.execute({
							ref: params.ref,
							waitForNavigation: false,
							timeout: TIMEOUTS.DEFAULT_WAIT * 5
						});
						await CDPHelper.attach(tab.id);
						for (let i = 0; i < repeat; i++) for (const t of tokens) if (t.includes("+")) await CDPHelper.dispatchKeyChord(tab.id, t);
						else await CDPHelper.dispatchSimpleKey(tab.id, t);
						await CDPHelper.detach(tab.id);
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									action: "key",
									keys: tokens,
									repeat
								})
							}],
							isError: false
						};
					} catch (e) {
						await CDPHelper.detach(tab.id);
						const keysStr = tokens.join(",");
						const repeatedKeys = repeat === 1 ? keysStr : Array.from({ length: repeat }, () => keysStr).join(",");
						return await keyboardTool.execute({ keys: repeatedKeys });
					}
				}
				case "wait": if (typeof params.text === "string" && params.text.trim().length > 0) try {
					await this.injectContentScript(tab.id, ["inject-scripts/wait-helper.js"], false, "ISOLATED", true);
					const appear = params.appear !== false;
					const timeoutMs = Math.max(0, Math.min(params.timeout || 1e4, 12e4));
					const resp = await abortable(this.sendMessageToTab(tab.id, {
						action: TOOL_MESSAGE_TYPES.WAIT_FOR_TEXT,
						text: params.text,
						appear,
						timeout: timeoutMs
					}), ctx?.signal);
					if (!resp || resp.success !== true) return createErrorResponse(resp && resp.reason === "timeout" ? `wait_for timed out after ${timeoutMs}ms for text: ${params.text}` : `wait_for failed: ${resp && resp.error ? resp.error : "unknown error"}`);
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: true,
								action: "wait_for",
								appear,
								text: params.text,
								matched: resp.matched || null,
								tookMs: resp.tookMs
							})
						}],
						isError: false
					};
				} catch (e) {
					if (e instanceof CancelledError) throw e;
					return createErrorResponse(`wait_for failed: ${e instanceof Error ? e.message : String(e)}`);
				}
				else {
					const seconds = Math.max(0, Math.min(params.duration || 0, 30));
					if (!seconds) return createErrorResponse("Duration parameter is required and must be > 0");
					await abortableDelay(seconds * 1e3, ctx?.signal);
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: true,
								action: "wait",
								duration: seconds
							})
						}],
						isError: false
					};
				}
				case "scroll_to":
					if (!params.ref) return createErrorResponse("ref is required for scroll_to action");
					try {
						await this.injectContentScript(tab.id, ["inject-scripts/accessibility-tree-helper.js"]);
						const resp = await this.sendMessageToTab(tab.id, {
							action: "focusByRef",
							ref: params.ref
						});
						if (!resp || resp.success !== true) return createErrorResponse(resp?.error || "scroll_to failed: element not found");
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									action: "scroll_to",
									ref: params.ref
								})
							}],
							isError: false
						};
					} catch (e) {
						return createErrorResponse(`scroll_to failed: ${e instanceof Error ? e.message : String(e)}`);
					}
				case "zoom": {
					const region = params.region;
					if (!region) return createErrorResponse("region is required for zoom action");
					const x0 = Number(region.x0);
					const y0 = Number(region.y0);
					const x1 = Number(region.x1);
					const y1 = Number(region.y1);
					if (![
						x0,
						y0,
						x1,
						y1
					].every(Number.isFinite)) return createErrorResponse("region must contain finite numbers (x0, y0, x1, y1)");
					if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0) return createErrorResponse("Invalid region: require x0>=0, y0>=0 and x1>x0, y1>y0");
					const p0 = project({
						x: x0,
						y: y0
					});
					const p1 = project({
						x: x1,
						y: y1
					});
					const rx0 = Math.min(p0.x, p1.x);
					const ry0 = Math.min(p0.y, p1.y);
					const rx1 = Math.max(p0.x, p1.x);
					const ry1 = Math.max(p0.y, p1.y);
					const w = rx1 - rx0;
					const h = ry1 - ry0;
					if (w <= 0 || h <= 0) return createErrorResponse("Invalid region after projection");
					{
						const getHostname = (url) => {
							try {
								return new URL(url).hostname;
							} catch {
								return "";
							}
						};
						const contextHostname = screenshotContextManager.getContext(tab.id)?.hostname;
						const currentHostname = getHostname(tab.url || "");
						if (contextHostname && contextHostname !== currentHostname) return createErrorResponse(`Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during zoom. Capture a new screenshot first.`);
					}
					try {
						await CDPHelper.attach(tab.id);
						const metrics = await CDPHelper.send(tab.id, "Page.getLayoutMetrics", {});
						const viewport = metrics?.layoutViewport || metrics?.visualViewport || {
							clientWidth: 800,
							clientHeight: 600,
							pageX: 0,
							pageY: 0
						};
						const vw = Math.round(Number(viewport.clientWidth || 800));
						const vh = Math.round(Number(viewport.clientHeight || 600));
						if (rx1 > vw || ry1 > vh) {
							await CDPHelper.detach(tab.id);
							return createErrorResponse(`Region exceeds viewport boundaries (${vw}x${vh}). Choose a region within the visible viewport.`);
						}
						const pageX = Number(viewport.pageX || 0);
						const pageY = Number(viewport.pageY || 0);
						const shot = await CDPHelper.send(tab.id, "Page.captureScreenshot", {
							format: "png",
							captureBeyondViewport: false,
							fromSurface: true,
							clip: {
								x: pageX + rx0,
								y: pageY + ry0,
								width: w,
								height: h,
								scale: 1
							}
						});
						await CDPHelper.detach(tab.id);
						const base64Data = String(shot?.data || "");
						if (!base64Data) return createErrorResponse("Failed to capture zoom screenshot via CDP");
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									action: "zoom",
									mimeType: "image/png",
									base64Data,
									region: {
										x0: rx0,
										y0: ry0,
										x1: rx1,
										y1: ry1
									}
								})
							}],
							isError: false
						};
					} catch (e) {
						await CDPHelper.detach(tab.id);
						return createErrorResponse(`zoom failed: ${e instanceof Error ? e.message : String(e)}`);
					}
				}
				case "screenshot": return await screenshotTool.execute({
					name: "computer",
					fullPage: false
				});
				default: return createErrorResponse(`Unsupported action: ${params.action}`);
			}
		}
		/**
		* DOM-based hover fallback when CDP is unavailable
		* Tries ref-based approach first (works with iframes), falls back to coordinates
		*/
		async domHoverFallback(tabId, coord, resolvedBy, ref) {
			if (ref) try {
				const resp = await this.sendMessageToTab(tabId, {
					action: TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
					ref
				});
				if (resp?.success) return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							action: "hover",
							resolvedBy: "ref",
							transport: "dom-ref",
							target: resp.target
						})
					}],
					isError: false
				};
			} catch (error) {
				console.warn("[ComputerTool] DOM ref hover failed, falling back to coordinates", error);
			}
			if (!coord) return createErrorResponse("Hover fallback requires coordinates or ref");
			try {
				const [injection] = await chrome.scripting.executeScript({
					target: { tabId },
					world: "MAIN",
					func: (point) => {
						const target = document.elementFromPoint(point.x, point.y);
						if (!target) return {
							success: false,
							error: "No element found at coordinates"
						};
						for (const type of [
							"mousemove",
							"mouseover",
							"mouseenter"
						]) target.dispatchEvent(new MouseEvent(type, {
							bubbles: true,
							cancelable: true,
							clientX: point.x,
							clientY: point.y,
							view: window
						}));
						return {
							success: true,
							target: {
								tagName: target.tagName,
								id: target.id,
								className: target.className,
								text: target.textContent?.trim()?.slice(0, 100) || ""
							}
						};
					},
					args: [coord]
				});
				const payload = injection?.result;
				if (!payload?.success) return createErrorResponse(payload?.error || "DOM hover fallback failed");
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							action: "hover",
							coordinates: coord,
							resolvedBy,
							transport: "dom",
							target: payload.target
						})
					}],
					isError: false
				};
			} catch (error) {
				return createErrorResponse(`DOM hover fallback failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	var computerTool = new ComputerTool();
	//#endregion
	//#region entrypoints/background/tools/browser/dialog.ts
	init_cdp_session_manager();
	init_defineProperty();
	/**
	* Handle JavaScript dialogs (alert/confirm/prompt) via CDP Page.handleJavaScriptDialog
	*/
	var HandleDialogTool = class extends BaseBrowserToolExecutor {
		constructor(..._args) {
			super(..._args);
			_defineProperty(this, "name", TOOL_NAMES.BROWSER.HANDLE_DIALOG);
		}
		async execute(args) {
			const { action, promptText } = args || {};
			if (!action || action !== "accept" && action !== "dismiss") return createErrorResponse("action must be \"accept\" or \"dismiss\"");
			try {
				let tabId = typeof args.tabId === "number" ? args.tabId : void 0;
				if (tabId === void 0) {
					const [activeTab] = await chrome.tabs.query({
						active: true,
						currentWindow: true
					});
					if (!activeTab?.id) return createErrorResponse("No active tab found");
					tabId = activeTab.id;
				}
				await cdpSessionManager.withSession(tabId, "dialog", async () => {
					await cdpSessionManager.sendCommand(tabId, "Page.enable");
					await cdpSessionManager.sendCommand(tabId, "Page.handleJavaScriptDialog", {
						accept: action === "accept",
						promptText: action === "accept" ? promptText : void 0
					});
				});
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							action,
							promptText: promptText || null
						})
					}],
					isError: false
				};
			} catch (error) {
				return createErrorResponse(`Failed to handle dialog: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	var handleDialogTool = new HandleDialogTool();
	//#endregion
	//#region entrypoints/background/tools/browser/index.ts
	var browser_exports = /* @__PURE__ */ __exportAll({
		clickTool: () => clickTool,
		closeTabsTool: () => closeTabsTool,
		computerTool: () => computerTool,
		fileUploadTool: () => fileUploadTool,
		fillTool: () => fillTool,
		getInteractiveElementsTool: () => getInteractiveElementsTool,
		handleDialogTool: () => handleDialogTool,
		javascriptTool: () => javascriptTool,
		keyboardTool: () => keyboardTool,
		navigateTool: () => navigateTool,
		readPageTool: () => readPageTool,
		screenshotTool: () => screenshotTool,
		switchTabTool: () => switchTabTool,
		webFetcherTool: () => webFetcherTool,
		windowTool: () => windowTool
	});
	//#endregion
	//#region entrypoints/background/tools/index.ts
	init_scope();
	var tools = { ...browser_exports };
	var toolsMap = new Map(Object.values(tools).map((tool) => [tool.name, tool]));
	/** 不作用于某一个页面的工具：作用域闸对它们没有意义。 */
	var TAB_AGNOSTIC = /* @__PURE__ */ new Set([TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS]);
	/**
	* 工具执行的**唯一入口**，作用域闸就装在这里。
	*
	* 装在这一处而不是十二个工具各写一遍：漏掉一处不会有任何症状——直到某次它去点了
	* 用户正在看的网银页面。同样的理由，服务端把 SSRF 守卫装在拨号层、把截图落盘装在
	* 传输层。
	*
	* 三件事：
	*  1. 目标页面永远是「Minduck Matter」标签组里的那一个，不是用户当前看着的那一个；
	*  2. 显式传进来的 tabId 必须在组里；
	*  3. 目标页面的站点必须在允许清单内（清单为空 = 全放行）。
	*/
	var handleCallTool = async (param) => {
		const tool = toolsMap.get(param.name);
		if (!tool) return createErrorResponse(`Tool ${param.name} not found`);
		try {
			const args = { ...param.args ?? {} };
			if (param.name === TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS) return await listGroupTabs();
			if (!TAB_AGNOSTIC.has(param.name)) {
				const gate = await resolveScope(param.name, args);
				if (gate.error) return createErrorResponse(gate.error);
				if (gate.tabId !== void 0) {
					args.tabId = gate.tabId;
					setWorkingTab(gate.tabId);
				}
			}
			const signal = signalFor(param.requestId ?? "");
			if (param.name === TOOL_NAMES.BROWSER.NAVIGATE) return await runNavigation(() => tool.execute(args, { signal }), args, signal);
			return await tool.execute(args, { signal });
		} catch (error) {
			console.error(`Tool execution failed for ${param.name}:`, error);
			return createErrorResponse(error instanceof Error ? error.message : ERROR_MESSAGES.TOOL_EXECUTION_FAILED);
		}
	};
	async function resolveScope(name, args) {
		const navigation = name === TOOL_NAMES.BROWSER.NAVIGATE;
		const url = typeof args.url === "string" ? args.url : "";
		const currentPageAction = args.refresh === true || url === "back" || url === "forward" || !url;
		if (name === TOOL_NAMES.BROWSER.CLOSE_TABS && (url || Array.isArray(args.tabIds) && args.tabIds.length > 0)) return {};
		let target = null;
		if (args.tabId !== void 0) {
			if (typeof args.tabId !== "number" || !Number.isInteger(args.tabId) || args.tabId < 0) return { error: OUT_OF_SCOPE_MESSAGE };
			target = await chrome.tabs.get(args.tabId);
		} else if (!navigation || currentPageAction) {
			target = await targetTab();
			if (!target) return { error: NO_PAGE_MESSAGE };
		}
		if (target) target = await assertTabAllowed(target);
		if (navigation && !currentPageAction && !siteAllowed(url)) return { error: SITE_BLOCKED_MESSAGE };
		return { tabId: target?.id };
	}
	var NO_PAGE_MESSAGE = "Minduck Matter 还没有可操作的页面。先用 chrome_navigate 打开一个，或者让用户把某个标签页拖进「Minduck Matter」标签组。";
	/** get_windows_and_tabs 只列 Minduck Matter 组内的页面。 */
	async function listGroupTabs() {
		const tabs = await groupTabs();
		return {
			content: [{
				type: "text",
				text: JSON.stringify({
					tabCount: tabs.length,
					note: "只列出「Minduck Matter」标签组内的页面；用户自己的其它标签页不在此列，也不可操作。",
					tabs: tabs.map((t) => ({
						tabId: t.id ?? 0,
						url: t.url ?? "",
						title: t.title ?? "",
						active: t.active ?? false
					}))
				})
			}],
			isError: false
		};
	}
	/**
	* 在导航开始前监听完成事件，避免 reload/back 的 API 返回时仍读到旧 URL。
	* 新页或单纯复用页可直接检查已完成状态；已有页的导航需等到本次更新。
	*/
	async function runNavigation(execute, args, signal) {
		const completed = /* @__PURE__ */ new Set();
		const onUpdated = (id, change, tab) => {
			if (change.status === "loading") completed.delete(id);
			if (change.status === "complete" || change.url && tab.status === "complete" && !tab.pendingUrl) completed.add(id);
		};
		chrome.tabs.onUpdated.addListener(onUpdated);
		try {
			if (signal?.aborted) throw new CancelledError();
			const result = await execute();
			if (result.isError) return result;
			const content = result.content?.find((item) => item.type === "text");
			if (!content?.text) throw new Error("Navigation did not return a target tab");
			const payload = JSON.parse(content.text);
			const targets = typeof payload.tabId === "number" ? [payload] : payload.tabs ?? [];
			if (!targets.length) throw new Error("Navigation did not return a target tab");
			const deadline = Date.now() + 3e4;
			for (const target of targets) {
				if (typeof target.tabId !== "number") throw new Error("Navigation returned an invalid tab ID");
				while (true) {
					if (signal?.aborted) throw new CancelledError();
					const tab = await chrome.tabs.get(target.tabId);
					const needsUpdate = typeof args.tabId === "number";
					if (tab.status === "complete" && !tab.pendingUrl && (!needsUpdate || completed.has(target.tabId))) {
						const checked = await assertTabAllowed(tab);
						if (checked.status === "complete" && !checked.pendingUrl) {
							target.url = checked.url;
							break;
						}
					}
					if (Date.now() >= deadline) throw new Error("Navigation did not finish within 30 seconds");
					await abortableDelay(100, signal);
				}
			}
			setWorkingTab(targets[0].tabId);
			return {
				...result,
				content: result.content.map((item) => item === content ? {
					...item,
					text: JSON.stringify(payload)
				} : item)
			};
		} finally {
			chrome.tabs.onUpdated.removeListener(onUpdated);
		}
	}
	//#endregion
	//#region entrypoints/background/link/mcp-server.ts
	/**
	* 在 service worker 里扮演一台 MCP server。
	*
	* 服务端是 client：它发 initialize / tools/list / tools/call，我们应答。JSON-RPC
	* 的帧走 transport.ts 那条 WebSocket。不用 SDK 的 Server 类是因为它的 Transport
	* 抽象要求我们把一条本来就只有四种消息的链路再包一层——直接按方法名分派更短，
	* 也让「我们只支持这四件事」这句话在代码里是看得见的。
	*/
	var PROTOCOL_VERSION = "2025-06-18";
	/** 服务端会依次尝试几个协议版本，我们照它提的那个回——都在支持之列。 */
	var SUPPORTED_VERSIONS = /* @__PURE__ */ new Set([
		"2025-06-18",
		"2025-11-25",
		"2025-03-26",
		"2024-11-05"
	]);
	/** 处理一帧 MCP 消息。导出是为了能脱离 WebSocket 单测。 */
	async function handleMcpFrame(raw, reply = send) {
		let msg;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}
		if (msg.jsonrpc !== "2.0") return;
		if (msg.id === void 0 || msg.id === null) {
			if (msg.method === "notifications/cancelled") {
				const requestId = msg.params?.requestId ?? "";
				if (requestId) cancel(String(requestId));
			}
			return;
		}
		const id = msg.id;
		switch (msg.method) {
			case "initialize": {
				const asked = String(msg.params?.protocolVersion || PROTOCOL_VERSION);
				reply({
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: SUPPORTED_VERSIONS.has(asked) ? asked : PROTOCOL_VERSION,
						capabilities: { tools: { listChanged: true } },
						serverInfo: {
							name: "matter-browser",
							version: chrome.runtime.getManifest().version
						}
					}
				});
				return;
			}
			case "ping":
				reply({
					jsonrpc: "2.0",
					id,
					result: {}
				});
				return;
			case "tools/list":
				reply({
					jsonrpc: "2.0",
					id,
					result: { tools: TOOL_SCHEMAS }
				});
				return;
			case "tools/call":
				await runTool(id, msg, reply);
				return;
			default: reply({
				jsonrpc: "2.0",
				id,
				error: {
					code: -32601,
					message: `method not found: ${msg.method}`
				}
			});
		}
	}
	async function runTool(id, msg, reply) {
		const name = String(msg.params?.name ?? "");
		const args = msg.params?.arguments ?? {};
		const requestId = String(id);
		const startedAt = Date.now();
		beginCall(requestId);
		try {
			const result = await handleCallTool({
				name,
				args,
				requestId
			});
			record({
				at: startedAt,
				tool: name,
				ms: Date.now() - startedAt,
				ok: !result?.isError,
				error: result?.isError ? firstText(result) : void 0,
				...await currentTarget()
			});
			reply({
				jsonrpc: "2.0",
				id,
				result
			});
		} catch (e) {
			const message = e instanceof CancelledError ? "已取消" : e instanceof Error ? e.message : String(e);
			record({
				at: startedAt,
				tool: name,
				ms: Date.now() - startedAt,
				ok: false,
				error: message
			});
			reply({
				jsonrpc: "2.0",
				id,
				result: {
					content: [{
						type: "text",
						text: message
					}],
					isError: true
				}
			});
		} finally {
			endCall(requestId);
		}
	}
	function firstText(result) {
		return result.content?.find((c) => c.type === "text")?.text;
	}
	async function currentTarget() {
		try {
			const { targetTab } = await Promise.resolve().then(() => (init_scope(), scope_exports));
			const tab = await targetTab();
			return tab ? {
				title: tab.title,
				url: tab.url
			} : {};
		} catch {
			return {};
		}
	}
	//#endregion
	//#region entrypoints/background/link/index.ts
	/**
	* 链路层入口：把配置、连接、MCP 应答与弹窗消息接在一起。
	*/
	init_scope();
	var ENSURE_ALARM = "matter.link.ensure";
	/** service worker 每次醒来都走这里。已连接则直接返回。 */
	async function initLink() {
		onMcpMessage((raw) => void handleMcpFrame(raw));
		setScope({ allowedSites: (await loadConfig()).allowedSites });
		watchGroupMembership();
		chrome.alarms.create(ENSURE_ALARM, { periodInMinutes: 1 });
		chrome.alarms.onAlarm.addListener((alarm) => {
			if (alarm.name === ENSURE_ALARM) ensureConnected();
		});
		chrome.runtime.onStartup.addListener(() => void ensureConnected());
		chrome.runtime.onInstalled.addListener(() => void ensureConnected());
		registerPopupBridge();
		await ensureConnected();
	}
	async function view() {
		const cfg = await loadConfig();
		const { deviceToken: _token, ...safe } = cfg;
		return {
			status: getStatus(),
			config: {
				...safe,
				paired: isPaired(cfg)
			},
			activity: recent(10),
			defaultName: cfg.deviceName || defaultDeviceName()
		};
	}
	function registerPopupBridge() {
		chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
			(async () => {
				try {
					switch (req?.type) {
						case "matter.presence.whoami":
							sendResponse({ deviceId: await presenceDeviceID(req.origin) });
							return;
						case "matter.link.view":
							sendResponse({
								ok: true,
								data: await view()
							});
							return;
						case "matter.link.pair":
							await redeem({
								apiBase: req.apiBase,
								code: req.code,
								deviceName: req.deviceName
							});
							await ensureConnected();
							await announcePresence();
							sendResponse({
								ok: true,
								data: await view()
							});
							return;
						case "matter.link.unpair":
							await unpair();
							disconnect();
							await clearPairing();
							await announcePresence();
							sendResponse({
								ok: true,
								data: await view()
							});
							return;
						case "matter.link.reconnect":
							await ensureConnected();
							sendResponse({
								ok: true,
								data: await view()
							});
							return;
						case "matter.link.rename":
							await saveConfig({ deviceName: req.deviceName });
							sendResponse({
								ok: true,
								data: await view()
							});
							return;
						case "matter.link.sites":
							setScope({ allowedSites: (await saveConfig({ allowedSites: req.sites })).allowedSites });
							sendResponse({
								ok: true,
								data: await view()
							});
							return;
						default: sendResponse({
							ok: false,
							error: "unknown request"
						});
					}
				} catch (e) {
					sendResponse({
						ok: false,
						error: e instanceof Error ? e.message : String(e)
					});
				}
			})();
			return true;
		});
		subscribe(() => {});
	}
	/**
	* 配对状态变了：重新登记标记脚本，并让已经打开着的 Matter 页面当场改过来。
	*
	* 不广播的话，用户解除配对之后那个页面上还挂着旧 id，直到他自己刷新——而他不会
	* 刷新，因为页面看上去一切正常。
	*/
	async function announcePresence() {
		await syncPresenceScript();
		const deviceId = await presenceDeviceID();
		const cfg = await loadConfig();
		if (!cfg.webOrigin) return;
		try {
			const tabs = await chrome.tabs.query({ url: `${cfg.webOrigin}/*` });
			for (const t of tabs) {
				if (typeof t.id !== "number") continue;
				chrome.tabs.sendMessage(t.id, {
					type: "matter.presence.changed",
					deviceId
				}).catch(() => {});
			}
		} catch {}
	}
	//#endregion
	//#region entrypoints/background/index.ts
	/**
	* Background service worker 入口。
	*
	* 它只做一件事：把到 Matter 的链路拉起来。上游那些录制回放、向量检索、元素标记、
	* 快捷面板的初始化全部随功能一起删了——每一条都是一个常驻监听器，而这个扩展要
	* 长在别人的电脑上，能少一条就少一条。
	*/
	var background_default = defineBackground(() => {
		initLink();
	});
	globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
	//#endregion
	//#region \0virtual:wxt-background-entrypoint?/private/tmp/claude-501/-Users-kilin-Dev-project-weave-init/703a2edc-79ce-4a22-a5c7-7c5dab4d6132/scratchpad/rel-ext/app/chrome-extension/entrypoints/background/index.ts
	/** Wrapper around `console` with a "[wxt]" prefix */
	var logger = {
		debug: (...args) => ([...args], void 0),
		log: (...args) => ([...args], void 0),
		warn: (...args) => ([...args], void 0),
		error: (...args) => ([...args], void 0)
	};
	var result;
	try {
		result = background_default.main();
		if (result instanceof Promise) console.warn("The background's main() function return a promise, but it must be synchronous");
	} catch (err) {
		logger.error("The background crashed on startup!");
		throw err;
	}
	//#endregion
	return result;
})();
