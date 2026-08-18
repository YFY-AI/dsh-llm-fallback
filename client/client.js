/* dsh-llm-fallback client bundle — 侧边栏「模型渠道」Tab。
 * 常驻显示各渠道状态(冷却/用量) + 当前渠道。数据来自 host 插件的
 * GET /api/llm-fallback/status(零 Token 被动监测)。每 10s 轮询。
 *
 * 由本机生产中的 dsh-client-ui-ark-status 整合而来,API 路径改为
 * /api/llm-fallback/status,Tab id 改为 llm-fallback(避免与旧包重复注册冲突)。
 */
window.__ModuleLoader__.load({
  id: "dsh-llm-fallback",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var hooks = react;

    // ---- inline styles (theme-aware via CSS vars) ----
    var css = (
      ".llmf-root{display:flex;flex-direction:column;gap:6px;padding:12px 10px 10px;}" +
      ".llmf-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);line-height:16px;}" +
      ".llmf-current{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);}" +
      ".llmf-dot{width:7px;height:7px;border-radius:50%;flex:none;}" +
      ".llmf-dot-ok{background:var(--dsw-alias-state-success-primary);}" +
      ".llmf-dot-warn{background:var(--dsw-alias-state-warn-label);}" +
      ".llmf-dot-down{background:var(--dsw-alias-state-error-primary);}" +
      ".llmf-rows{display:flex;flex-direction:column;gap:3px;}" +
      ".llmf-row{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);min-width:0;}" +
      ".llmf-row-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".llmf-row-usage{flex:none;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;}" +
      ".llmf-row-cool{flex:none;color:var(--dsw-alias-state-warn-label);}" +
      ".llmf-error{font-size:11px;color:var(--dsw-alias-state-error-primary);line-height:16px;}"
    );
    if (typeof document !== "undefined" && !document.querySelector("style[data-llmf]")) {
      var style = document.createElement("style");
      style.dataset.llmf = "1";
      style.textContent = css;
      document.head.appendChild(style);
    }

    function useStatus() {
      var state = hooks.useState({ status: "loading", data: null });
      hooks.useEffect(function () {
        var alive = true;
        function tick() {
          fetch("/api/llm-fallback/status", { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (data) { if (alive) state[1]({ status: "ready", data: data }); })
            .catch(function () { if (alive) state[1]({ status: "error", data: null }); });
        }
        tick();
        var timer = setInterval(tick, 10000);
        return function () { alive = false; clearInterval(timer); };
      }, []);
      return state[0];
    }

    function dotClass(entry) {
      if (entry && entry.cooling) return "llmf-dot-down";
      if (entry && entry.lastFailAt && (!entry.lastOkAt || entry.lastFailAt > entry.lastOkAt)) return "llmf-dot-warn";
      return "llmf-dot-ok";
    }

    function ChannelStatusWidget(_props) {
      var s = useStatus();
      if (s.status === "loading") {
        return react.createElement("div", { className: "llmf-root" }, react.createElement("div", { className: "llmf-title" }, "渠道状态…"));
      }
      if (s.status === "error" || !s.data) {
        return react.createElement("div", { className: "llmf-root" }, react.createElement("div", { className: "llmf-title" }, "模型渠道"), react.createElement("div", { className: "llmf-error" }, "无法获取"));
      }
      var chain = s.data.chain || [];
      var current = chain.find(function (c) { return c.lastOkAt && (!c.cooling); }) || null;
      var ark = s.data.usage && s.data.usage.ark ? s.data.usage.ark : null;
      var rows = chain.map(function (entry) {
        var usageText = "";
        if (entry.provider.indexOf("volcengine-ark") === 0 && typeof entry.arkPercent === "number") {
          usageText = Math.round(entry.arkPercent) + "%";
        }
        var cool = entry.cooling ? react.createElement("span", { className: "llmf-row-cool" }, "冷却") : null;
        return react.createElement("div", { className: "llmf-row", key: entry.provider },
          react.createElement("span", { className: "llmf-dot " + dotClass(entry) }),
          react.createElement("span", { className: "llmf-row-name" }, entry.displayName),
          usageText ? react.createElement("span", { className: "llmf-row-usage" }, usageText) : null,
          cool
        );
      });
      var currentLabel = current
        ? (current.displayName + " · " + (current.model || ""))
        : "—";
      return react.createElement("div", { className: "llmf-root" },
        react.createElement("div", { className: "llmf-title" }, "模型渠道"),
        react.createElement("div", { className: "llmf-current" },
          react.createElement("span", { className: "llmf-dot " + dotClass(current) }),
          currentLabel
        ),
        react.createElement("div", { className: "llmf-rows" }, rows),
        ark && ark["5h"] ? react.createElement("div", { className: "llmf-title" },
          "方舟5h: " + Math.round(ark["5h"].percent) + "%"
        ) : null
      );
    }

    var inject = ["betterSidebar"];

    function apply(ctx) {
      var disposers = [];
      // 防御:betterSidebar 可能尚未就绪,轮询等待
      var waitTimer = setInterval(function () {
        var bs = ctx.get ? ctx.get("betterSidebar") : ctx.betterSidebar;
        if (bs && typeof bs.registerTab === "function") {
          clearInterval(waitTimer);
          registerTab(bs);
        }
      }, 200);
      disposers.push(function () { clearInterval(waitTimer); });

      function registerTab(bs) {
        var off = bs.registerTab({
          id: "llm-fallback",
          title: function () { return "模型渠道"; },
          order: 60,
          single: true,
          component: function () {
            return react.createElement(ChannelStatusWidget, null);
          }
        });
        if (typeof off === "function") disposers.push(off);
        // 自动打开该选项卡一次,让「模型渠道」出现在右侧工作台标签栏。
        var attempt = 0;
        var opened = false;
        function openIt() {
          if (opened) return;
          try {
            var snap = bs.getSnapshot && bs.getSnapshot();
            if (!snap || !snap.sessionId) { return; }
            bs.openTab({ type: "llm-fallback", title: "模型渠道" });
            opened = true;
          } catch (e) { /* 忽略 */ }
        }
        var timer = setInterval(function () {
          attempt++;
          openIt();
          if (opened) {
            clearInterval(timer);
            return;
          }
          if (attempt < 20) return;
        }, attempt < 20 ? 100 : 5000);
        disposers.push(function () { clearInterval(timer); });
      }

      return function () {
        for (var i = 0; i < disposers.length; i++) {
          try { disposers[i](); } catch (e) {}
        }
        disposers = [];
      };
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
