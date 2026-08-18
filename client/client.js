// dsh-llm-fallback client bundle(DSH __ModuleLoader__ 格式)
// 侧边栏「回替链」Tab:实时显示当前渠道 / 健康 / 延迟 / 熔断状态。
// 数据通道:GET /api/llm-fallback/snapshot(初始快照)+ SSE /api/llm-fallback/events(事件推送)。
window.__ModuleLoader__.load({
  id: "dsh-llm-fallback",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    var h = React.createElement;

    var inject = ["slots"];

    // ── 数据:初始快照 + SSE 事件推送 ─────────────────────────────
    function useSnapshot() {
      var state = React.useState(null);
      var snap = state[0];
      var setSnap = state[1];
      React.useEffect(function () {
        var closed = false;
        fetch("/api/llm-fallback/snapshot")
          .then(function (r) { return r.json(); })
          .then(function (data) { if (!closed) setSnap(data); })
          .catch(function () { /* 首次拉取失败等 SSE */ });
        var es = null;
        try {
          es = new EventSource("/api/llm-fallback/events");
          es.onmessage = function (ev) {
            if (closed) return;
            try { setSnap(JSON.parse(ev.data)); } catch (e) { /* ignore */ }
          };
        } catch (e) { es = null; }
        return function () {
          closed = true;
          if (es) { try { es.close(); } catch (e) { /* ignore */ } }
        };
      }, []);
      return snap;
    }

    function fmtTime(ts) {
      try { return new Date(ts).toLocaleTimeString("zh-CN"); } catch (e) { return "-"; }
    }

    function FallbackView(props) {
      var snap = useSnapshot();
      var rows = null;
      if (snap && snap.providers && snap.providers.length > 0) {
        rows = snap.providers.map(function (p) {
          var breaker = p.downUntil != null
            ? "熔断至 " + fmtTime(p.downUntil)
            : (p.consecutiveFailures > 0 ? p.consecutiveFailures + " 次" : "-");
          return h("tr", { key: p.name },
            h("td", { style: styles.td }, p.name),
            h("td", { style: styles.td }, p.healthy ? "✅" : "❌"),
            h("td", { style: styles.td }, p.latency != null ? p.latency + "ms" : "-"),
            h("td", { style: styles.td }, breaker)
          );
        });
      }
      return h("div", { style: styles.box },
        h("div", { style: styles.head },
          "当前渠道:",
          h("b", { style: styles.cur }, snap && snap.current ? snap.current : "无")
        ),
        rows
          ? h("table", { style: styles.table },
              h("thead", null, h("tr", null,
                h("th", { style: styles.th }, "Provider"),
                h("th", { style: styles.th }, "健康"),
                h("th", { style: styles.th }, "延迟"),
                h("th", { style: styles.th }, "熔断")
              )),
              h("tbody", null, rows)
            )
          : h("div", { style: styles.empty }, "暂无已跟踪的 LLM provider")
      );
    }

    var styles = {
      box: { padding: "12px", fontSize: 12, color: "var(--dsw-alias-label-primary, inherit)", fontFamily: "inherit" },
      head: { marginBottom: 8, fontWeight: 500 },
      cur: { marginLeft: 4 },
      table: { width: "100%", borderCollapse: "collapse" },
      th: { textAlign: "left", padding: "4px 6px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))", fontSize: 11, color: "var(--dsw-alias-label-secondary, inherit)" },
      td: { padding: "4px 6px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.15))" },
      empty: { padding: "12px 0", color: "var(--dsw-alias-label-tertiary, #888)" }
    };

    function apply(ctx) {
      // better-sidebar 为可选宿主:用 ctx.get 安全访问(未安装则跳过,不影响其他功能)
      var bs = (ctx.get && ctx.get("betterSidebar")) || null;
      if (!bs || typeof bs.registerTab !== "function") return;

      var disposer = bs.registerTab({
        id: "llm-fallback",
        title: function () { return "回替链"; },
        icon: function (size) {
          return h("span", { style: { fontSize: (size || 14) + "px", lineHeight: 1 } }, "🔀");
        },
        order: 60,
        createTab: function () {
          return { tab: { id: "llm-fallback:main", type: "llm-fallback", title: "回替链" } };
        },
        component: function (props) { return h(FallbackView, props); }
      });

      // 自动打开:持续轮询直到会话就绪(吸取"2 秒放弃导致 Tab 不自动开"的教训)
      var attempt = 0;
      var timer = setInterval(function () {
        attempt++;
        try {
          var snap = bs.getSnapshot && bs.getSnapshot();
          if (!snap || !snap.sessionId) return;
          bs.openTab({ type: "llm-fallback" });
          clearInterval(timer);
        } catch (e) { /* ignore */ }
      }, attempt < 20 ? 100 : 5000);

      ctx.effect(function () {
        return function () {
          if (typeof disposer === "function") disposer();
          clearInterval(timer);
        };
      }, "dsh-llm-fallback: better-sidebar tab");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
