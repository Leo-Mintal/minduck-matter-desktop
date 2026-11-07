// click-helper.js
// This script is injected into the page to handle click operations

if (window.__CLICK_HELPER_INITIALIZED__) {
  // Already initialized, skip
} else {
  window.__CLICK_HELPER_INITIALIZED__ = true;
  /**
   * Click on an element matching the selector or at specific coordinates
   * @param {string} selector - CSS selector for the element to click
   * @param {boolean} waitForNavigation - Whether to wait for navigation to complete after click
   * @param {number} timeout - Timeout in milliseconds for waiting for the element or navigation
   * @param {Object} coordinates - Optional coordinates for clicking at a specific position
   * @param {number} coordinates.x - X coordinate relative to the viewport
   * @param {number} coordinates.y - Y coordinate relative to the viewport
   * @returns {Promise<Object>} - Result of the click operation
   */
  async function clickElement(
    selector,
    waitForNavigation = false,
    timeout = 5000,
    coordinates = null,
    ref = null,
    double = false,
    options = {},
  ) {
    try {
      let element = null;
      let elementInfo = null;
      let clickX, clickY;

      if (ref && typeof ref === 'string') {
        // Resolve element from weak map
        let target = null;
        try {
          const map = window.__claudeElementMap;
          const weak = map && map[ref];
          target = weak && typeof weak.deref === 'function' ? weak.deref() : null;
        } catch (e) {
          // ignore
        }

        if (!target || !(target instanceof Element)) {
          return {
            error: `Element ref "${ref}" not found. Please call chrome_read_page first and ensure the ref is still valid.`,
          };
        }

        element = target;
        element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        await new Promise((resolve) => setTimeout(resolve, 80));

        const rect = element.getBoundingClientRect();
        clickX = rect.left + rect.width / 2;
        clickY = rect.top + rect.height / 2;
        elementInfo = {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          text: element.textContent?.trim().substring(0, 100) || '',
          href: element.href || null,
          type: element.type || null,
          isVisible: true,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
          },
          clickMethod: 'ref',
          ref,
        };
      } else if (
        coordinates &&
        typeof coordinates.x === 'number' &&
        typeof coordinates.y === 'number'
      ) {
        clickX = coordinates.x;
        clickY = coordinates.y;

        element = document.elementFromPoint(clickX, clickY);

        if (element) {
          const rect = element.getBoundingClientRect();
          elementInfo = {
            tagName: element.tagName,
            id: element.id,
            className: element.className,
            text: element.textContent?.trim().substring(0, 100) || '',
            href: element.href || null,
            type: element.type || null,
            isVisible: true,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
            },
            clickMethod: 'coordinates',
            clickPosition: { x: clickX, y: clickY },
          };
        } else {
          elementInfo = {
            clickMethod: 'coordinates',
            clickPosition: { x: clickX, y: clickY },
            warning: 'No element found at the specified coordinates',
          };
        }
      } else {
        element = document.querySelector(selector);
        if (!element) {
          return {
            error: `Element with selector "${selector}" not found`,
          };
        }

        const rect = element.getBoundingClientRect();
        elementInfo = {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          text: element.textContent?.trim().substring(0, 100) || '',
          href: element.href || null,
          type: element.type || null,
          isVisible: true,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
          },
          clickMethod: 'selector',
        };

        // First sroll so that the element is in view, then check visibility.
        element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        elementInfo.isVisible = isElementVisible(element);
        if (!elementInfo.isVisible) {
          return {
            error: `Element with selector "${selector}" is not visible`,
            elementInfo,
          };
        }

        const updatedRect = element.getBoundingClientRect();
        clickX = updatedRect.left + updatedRect.width / 2;
        clickY = updatedRect.top + updatedRect.height / 2;
      }

      let navigationPromise;
      if (waitForNavigation) {
        navigationPromise = new Promise((resolve) => {
          const beforeUnloadListener = () => {
            window.removeEventListener('beforeunload', beforeUnloadListener);
            resolve(true);
          };
          window.addEventListener('beforeunload', beforeUnloadListener);

          setTimeout(() => {
            window.removeEventListener('beforeunload', beforeUnloadListener);
            resolve(false);
          }, timeout);
        });
      }

      if (
        element &&
        (elementInfo.clickMethod === 'selector' || elementInfo.clickMethod === 'ref')
      ) {
        if (double) {
          dispatchClickSequence(element, clickX, clickY, options, true);
        } else {
          dispatchClickSequence(element, clickX, clickY, options, false);
        }
      } else {
        if (double) simulateDoubleClick(clickX, clickY, options);
        else simulateClick(clickX, clickY, options);
      }

      // Wait for navigation if needed
      let navigationOccurred = false;
      if (waitForNavigation) {
        navigationOccurred = await navigationPromise;
      }

      return {
        success: true,
        message: 'Element clicked successfully',
        elementInfo,
        navigationOccurred,
      };
    } catch (error) {
      return {
        error: `Error clicking element: ${error.message}`,
      };
    }
  }

  /**
   * Simulate a mouse click at specific coordinates
   * @param {number} x - X coordinate relative to the viewport
   * @param {number} y - Y coordinate relative to the viewport
   */
  function simulateClick(x, y, options = {}) {
    const element = document.elementFromPoint(x, y);
    if (!element) return;
    dispatchClickSequence(element, x, y, options, false);
  }

  /**
   * Simulate a double click sequence at specific coordinates
   */
  function simulateDoubleClick(x, y, options = {}) {
    const element = document.elementFromPoint(x, y);
    if (!element) return;
    dispatchClickSequence(element, x, y, options, true);
  }

  /**
   * Simulate double click using element when available
   */
  function simulateDomDoubleClick(element, x, y, options) {
    dispatchClickSequence(element, x, y, options, true);
  }

  function normalizeMouseOpts(x, y, options = {}) {
    const bubbles = options.bubbles !== false; // default true
    const cancelable = options.cancelable !== false; // default true
    const altKey = !!(options.modifiers && options.modifiers.altKey);
    const ctrlKey = !!(options.modifiers && options.modifiers.ctrlKey);
    const metaKey = !!(options.modifiers && options.modifiers.metaKey);
    const shiftKey = !!(options.modifiers && options.modifiers.shiftKey);
    const btn = String(options.button || 'left');
    const button = btn === 'right' ? 2 : btn === 'middle' ? 1 : 0;
    const buttons = btn === 'right' ? 2 : btn === 'middle' ? 4 : 1;
    return {
      bubbles,
      cancelable,
      altKey,
      ctrlKey,
      metaKey,
      shiftKey,
      button,
      buttons,
      clientX: x,
      clientY: y,
      view: window,
    };
  }

  function dispatchClickSequence(element, x, y, options = {}, isDouble = false) {
    const base = normalizeMouseOpts(x, y, options);
    const down = new MouseEvent('mousedown', base);
    const up = new MouseEvent('mouseup', base);
    const click = new MouseEvent('click', base);
    try {
      element.dispatchEvent(down);
    } catch {}
    try {
      element.dispatchEvent(up);
    } catch {}
    try {
      element.dispatchEvent(click);
    } catch {}
    if (base.button === 2) {
      // right button contextmenu
      const ctx = new MouseEvent('contextmenu', base);
      try {
        element.dispatchEvent(ctx);
      } catch {}
    }
    if (isDouble) {
      // second sequence + dblclick
      setTimeout(() => {
        try {
          element.dispatchEvent(new MouseEvent('mousedown', base));
        } catch {}
        try {
          element.dispatchEvent(new MouseEvent('mouseup', base));
        } catch {}
        try {
          element.dispatchEvent(new MouseEvent('click', base));
        } catch {}
        try {
          element.dispatchEvent(new MouseEvent('dblclick', base));
        } catch {}
      }, 30);
    }
  }

  /**
   * 点击前的可操作性检查（Playwright 的 actionability 那一套的最小可用子集）。
   *
   * 解析目标 → 滚进视口 → 等一小下让滚动稳定 → 量中心点 → 查遮挡 → 取指纹。
   * 任何一步不过就**如实报错并说清原因**，绝不再返回一个 success 让模型以为点到了。
   */
  async function prepareClick(selector, ref, coordinates) {
    let element = null;

    if (ref && typeof ref === 'string') {
      try {
        const map = window.__claudeElementMap;
        const weak = map && map[ref];
        element = weak && typeof weak.deref === 'function' ? weak.deref() : null;
      } catch (_) {
        element = null;
      }
      if (!element || !(element instanceof Element)) {
        return {
          error: `Element ref "${ref}" not found. Please call chrome_read_page first and ensure the ref is still valid.`,
        };
      }
    } else if (selector) {
      element = document.querySelector(selector);
      if (!element) return { error: `Element with selector "${selector}" not found` };
    } else if (coordinates && typeof coordinates.x === 'number') {
      // 纯坐标：没有目标元素可查遮挡，只记指纹。
      return {
        success: true,
        x: coordinates.x,
        y: coordinates.y,
        fingerprint: pageFingerprint(),
        elementInfo: { clickMethod: 'coordinates', clickPosition: coordinates },
      };
    } else {
      return { error: 'Provide ref or selector or coordinates' };
    }

    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
    await new Promise((r) => setTimeout(r, 80));

    if (!isElementVisible(element)) {
      return {
        error: '目标元素不可见（可能被隐藏、尺寸为 0，或滚动后仍不在视口内）',
        elementInfo: describeNodeBriefly(element),
      };
    }

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const blocker = describeClickBlocker(element, x, y);
    if (blocker) {
      return {
        error: `目标被挡住了：点击位置上是 ${blocker}。先把它关掉/移开再点，或者换一个入口。`,
        blocked: true,
        blocker,
        elementInfo: describeNodeBriefly(element),
      };
    }

    return {
      success: true,
      x,
      y,
      fingerprint: pageFingerprint(),
      elementInfo: {
        tagName: element.tagName,
        id: element.id,
        className: typeof element.className === 'string' ? element.className : '',
        text: (element.textContent || '').trim().substring(0, 100),
        clickMethod: ref ? 'ref' : 'selector',
        ref: ref || undefined,
      },
    };
  }

  // #region actionability —— tests/click-actionability.test.ts 按这两行标记取它们出来跑
  /**
   * 点击点上真正会收到事件的是谁——挡住了就说出挡住它的是什么。
   *
   * 浏览器按命中测试派发事件：坐标上最顶层的那个元素收到点击，跟你「想点谁」无关。
   * 此前 ref 那条路直接写死 isVisible=true 就派发，于是飞书把 AI 助手面板叠在视图
   * 标签上时，我们照样报 success，而那一下什么也没发生。26-09-09 实测：模型连点
   * 十几次、每次都拿到 success，把 40 步的预算耗光后放弃，回头让用户自己去点。
   *
   * 判据取 Playwright 的 receives-events：命中的必须是目标本身、目标的后代，或者
   * 目标的祖先。前两种是同一个东西；祖先那种是目标自己 pointer-events:none 之类，
   * 事件落在包着它的容器上——事件委托照样成立，不该报错。除此之外都是**别的东西
   * 盖在上面**，也就是我们要抓的那一种。
   */
  function describeClickBlocker(element, x, y) {
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      return '目标不在可视区域内（页面可能需要先滚动）';
    }
    const top = document.elementFromPoint(x, y);
    if (!top) return '点击位置上没有任何元素';
    if (top === element || element.contains(top) || top.contains(element)) return null;
    return describeNodeBriefly(top);
  }

  /** 把挡路的那个元素说成人话，让模型知道该先关掉什么。 */
  function describeNodeBriefly(el) {
    try {
      const name = (
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        (el.textContent || '').trim().slice(0, 40)
      ).trim();
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
      const tag = el.tagName.toLowerCase();
      return `<${tag}${cls ? '.' + cls : ''}>${name ? ' 「' + name + '」' : ''}`;
    } catch (_) {
      return '一个无法描述的元素';
    }
  }

  /** FNV-1a：只用来比「变没变」，不需要抗碰撞。 */
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }

  /**
   * 页面此刻的指纹：地址 + 标题 + 视口内可交互元素的名字与位置。
   *
   * 用来回答「刚才那一下到底起没起作用」。不取正文是因为富前端的正文在画布上、取不到，
   * 而**工具栏与标签栏是 DOM**：飞书从表格视图切到甘特图，工具栏会从「分组依据/卡片
   * 配置」变成「甘特图配置」——这个信号足够，而且便宜。
   */
  function pageFingerprint() {
    const parts = [location.href, document.title];
    let n = 0;
    const nodes = document.querySelectorAll(
      'a,button,input,select,textarea,[role],[onclick],[tabindex]',
    );
    for (const el of nodes) {
      if (n >= 300) break;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const name = (el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40))
        .replace(/\s+/g, ' ')
        .trim();
      parts.push(`${el.tagName}|${name}|${Math.round(r.left)},${Math.round(r.top)}`);
      n++;
    }
    return hashString(parts.join('\n'));
  }

  /**
   * 等页面安静下来：DOM 连续 quietMs 没有变更就算稳，最多等 maxMs。
   *
   * 少了这一步，动作刚发出去就取指纹，拿到的还是旧状态——模型据此判定「没生效」再点
   * 一次，一次点击变成两次。等待上限是硬的：有些页面（轮播、计时器）永远不会安静。
   */
  function waitForSettle(quietMs, maxMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      let timer = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          obs.disconnect();
        } catch (_) {}
        clearTimeout(timer);
        clearTimeout(hard);
        resolve(Date.now() - start);
      };
      const bump = () => {
        clearTimeout(timer);
        timer = setTimeout(finish, quietMs);
      };
      const obs = new MutationObserver(bump);
      try {
        obs.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
      } catch (_) {}
      const hard = setTimeout(finish, maxMs);
      bump();
    });
  }
  // #endregion actionability

  /**
   * Check if an element is visible
   * @param {Element} element - The element to check
   * @returns {boolean} - Whether the element is visible
   */
  function isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      return false;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const elementAtPoint = document.elementFromPoint(centerX, centerY);
    if (!elementAtPoint) return false;

    return element === elementAtPoint || element.contains(elementAtPoint);
  }

  // Listen for messages from the extension
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'clickElement') {
      clickElement(
        request.selector,
        request.waitForNavigation,
        request.timeout,
        request.coordinates,
        request.ref,
        !!request.double,
        {
          button: request.button,
          bubbles: request.bubbles,
          cancelable: request.cancelable,
          modifiers: request.modifiers,
        },
      )
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            error: `Unexpected error: ${error.message}`,
          });
        });
      return true; // Indicates async response
    } else if (request.action === 'prepareClick') {
      // 动手之前：把 ref/selector 解析成坐标，滚进视口，查有没有被挡，并记下页面指纹。
      // 真正的点击由 background 用 CDP 按坐标发（可信事件，走浏览器自己的命中测试）。
      prepareClick(request.selector, request.ref, request.coordinates)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: `prepareClick failed: ${error.message}` }));
      return true;
    } else if (request.action === 'observeAfterAction') {
      // 动作之后：等页面安静，再比一次指纹，回答「这一下到底起没起作用」。
      waitForSettle(request.quietMs || 300, request.maxMs || 2000)
        .then((settleMs) => {
          const after = pageFingerprint();
          sendResponse({
            success: true,
            settleMs,
            changed: after !== request.fingerprint,
            fingerprint: after,
            url: location.href,
            title: document.title,
          });
        })
        .catch((error) => sendResponse({ error: `observeAfterAction failed: ${error.message}` }));
      return true;
    } else if (request.action === 'chrome_click_element_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });
}
