/**
 * 「这台浏览器是哪一台」——写进 Matter 网页的一个 DOM 属性。
 *
 * 只在服务端指定的那个源上运行（登记逻辑见 background/link/presence.ts）。
 * 网页读 document.documentElement.dataset.matterDevice，随请求带给服务端，
 * 服务端核对这台确实属于请求者之后，把它当成「用户此刻坐在哪台电脑前」。
 *
 * 在 document_start 就写：页面的第一批请求（会话列表、发消息）常常在
 * DOMContentLoaded 之前就发出去了，晚一步这个默认值就对第一条消息不生效。
 */
(() => {
  const ATTR = 'matterDevice';

  const apply = (id) => {
    const el = document.documentElement;
    if (!el) return;
    if (id) el.dataset[ATTR] = id;
    else delete el.dataset[ATTR];
  };

  const ask = () => {
    try {
      // 带上自己的源：match pattern 带不了端口，所以「这一页算不算 Matter」
      // 由后台核对完整的 origin 说了算。
      chrome.runtime.sendMessage(
        { type: 'matter.presence.whoami', origin: location.origin },
        (res) => {
          // 后台还没起来时 lastError 会被置上；读一下避免控制台报“未处理”。
          void chrome.runtime.lastError;
          apply(res && typeof res.deviceId === 'string' ? res.deviceId : '');
        },
      );
    } catch {
      /* 扩展正在重载：这一轮写不上，下次页面加载再写 */
    }
  };

  ask();

  // 解除配对 / 重新配对之后不用等用户刷新页面：后台会广播一次。
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'matter.presence.changed') apply(msg.deviceId || '');
    });
  } catch {
    /* 同上 */
  }
})();
