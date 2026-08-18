/* dsh-llm-fallback client bundle — 侧边栏「模型渠道」Tab v2
 * 卡片式布局,全部使用 DSH 主题变量(--dsw-alias-*)自动适配所有皮肤;
 * 支持拖拽调整回退优先级(POST /api/llm-fallback/chain 热更新 + 持久化);
 * 冷却倒计时实时刷新(1s tick);方舟用量进度条。
 * 数据:GET /api/llm-fallback/status(10s 轮询)。
 */
window.__ModuleLoader__.load({
  id: "dsh-llm-fallback",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var hooks = react;
    var h = react.createElement;

    // ---- inline styles(theme-aware via DSH CSS variables) ----
    var css = (
      ".llmf2-root{display:flex;flex-direction:column;gap:10px;padding:10px;font:var(--dsw-font-s-14,13px/1.5 system-ui);}" +
      ".llmf2-current{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.07));border-radius:12px;padding:9px 11px;display:flex;align-items:center;gap:8px;}" +
      ".llmf2-currentLabel{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".llmf2-currentHint{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#888);}" +
      ".llmf2-dot{width:8px;height:8px;border-radius:50%;flex:none;}" +
      ".llmf2-dot-ok{background:var(--dsw-alias-state-success-primary,#30a46c);}" +
      ".llmf2-dot-warn{background:var(--dsw-alias-state-warn-label,#e5a63c);}" +
      ".llmf2-dot-down{background:var(--dsw-alias-state-error-primary,#e5484d);}" +
      ".llmf2-group{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-base,rgba(128,128,128,.03));}" +
      ".llmf2-groupTitle{padding:6px 11px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#888);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06));}" +
      ".llmf2-row{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:grab;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.12));}" +
      ".llmf2-row:first-child{border-top:none;}" +
      ".llmf2-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));}" +
      ".llmf2-row.llmf2-currentRow{background:var(--dsw-alias-interactive-bg-active,rgba(91,141,239,.12));}" +
      ".llmf2-row.llmf2-dragFrom{opacity:.45;}" +
      ".llmf2-row.llmf2-dragOver{border-top:2px solid var(--dsw-alias-button-primary-fill,#5b8def);}" +
      ".llmf2-grip{color:var(--dsw-alias-label-dimmed,#999);font-size:13px;line-height:1;cursor:grab;flex:none;user-select:none;}" +
      ".llmf2-rowMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}" +
      ".llmf2-rowName{font-size:12px;color:var(--dsw-alias-label-primary,#e6e6e6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".llmf2-rowModel{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".llmf2-meta{flex:none;display:flex;align-items:center;gap:7px;}" +
      ".llmf2-usage{display:flex;align-items:center;gap:4px;}" +
      ".llmf2-usageBar{width:38px;height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.22));overflow:hidden;}" +
      ".llmf2-usageFill{height:100%;border-radius:2px;transition:width .3s;}" +
      ".llmf2-usageText{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums;}" +
      ".llmf2-cool{flex:none;font-size:10px;color:var(--dsw-alias-state-warn-label,#e5a63c);font-variant-numeric:tabular-nums;}" +
      ".llmf2-ark{margin:2px 0 0;}" +
      ".llmf2-arkHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;}" +
      ".llmf2-arkTitle{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);}" +
      ".llmf2-arkPct{font-size:10px;color:var(--dsw-alias-label-secondary,#aaa);font-variant-numeric:tabular-nums;}" +
      ".llmf2-arkBar{height:6px;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.22));overflow:hidden;}" +
      ".llmf2-arkFill{height:100%;border-radius:3px;transition:width .3s;}" +
      ".llmf2-error{font-size:11px;color:var(--dsw-alias-state-error-primary,#e5484d);line-height:16px;padding:10px;}" +
      ".llmf2-hint{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);text-align:center;padding:2px 0 0;}"
    );
    if (typeof document !== "undefined" && !document.querySelector("style[data-llmf2]")) {
      var style = document.createElement("style");
      style.dataset.llmf2 = "1";
      style.textContent = css;
      document.head.appendChild(style);
    }

    // ---- helpers ----
    function familyOf(provider) {
      if (provider.indexOf("volcengine-ark") === 0) return "火山方舟";
      if (provider.indexOf("sensenova") === 0) return "商汤日日新";
      if (provider.indexOf("hcnsec") === 0) return "幻城网安";
      if (provider.indexOf("deepseek") === 0) return "DeepSeek";
      if (provider.indexOf("nexusvai") === 0) return "NexusVai";
      return "其他";
    }
    function fmtCountdown(until, now) {
      var s = Math.max(0, Math.ceil((until - now) / 1000));
      if (s <= 0) return "";
      var m = Math.floor(s / 60), r = s % 60;
      return m + ":" + (r < 10 ? "0" + r : "" + r);
    }
    function fillColor(percent) {
      if (percent >= 85) return "var(--dsw-alias-state-error-primary,#e5484d)";
      if (percent >= 60) return "var(--dsw-alias-state-warn-label,#e5a63c)";
      return "var(--dsw-alias-state-success-primary,#30a46c)";
    }
    function dotClass(entry) {
      if (entry && entry.cooling) return "llmf2-dot-down";
      if (entry && entry.lastFailAt && (!entry.lastOkAt || entry.lastFailAt > entry.lastOkAt)) return "llmf2-dot-warn";
      return "llmf2-dot-ok";
    }
    function reorder(list, from, to) {
      var next = list.slice();
      var moved = next.splice(from, 1)[0];
      next.splice(to, 0, moved);
      return next;
    }
    function groupChain(chain) {
      var groups = [];
      var seen = {};
      for (var i = 0; i < chain.length; i++) {
        var fam = familyOf(chain[i].provider);
        if (!seen[fam]) { seen[fam] = groups.length; groups.push({ family: fam, items: [] }); }
        groups[seen[fam]].items.push(chain[i]);
      }
      return groups;
    }

    // ---- data:10s 轮询 + 拖拽后乐观更新 ----
    function useStatus() {
      var state = hooks.useState({ status: "loading", data: null });
      var setData = state[1];
      hooks.useEffect(function () {
        var alive = true;
        function tick() {
          fetch("/api/llm-fallback/status", { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (data) { if (alive) setData({ status: "ready", data: data }); })
            .catch(function () { if (alive) setData({ status: "error", data: null }); });
        }
        tick();
        var timer = setInterval(tick, 10000);
        return function () { alive = false; clearInterval(timer); };
      }, []);
      return state;
    }

    // ---- main widget ----
    function ChannelStatusWidget(_props) {
      var statusState = useStatus();
      var snap = statusState[0];
      var setSnap = statusState[1];

      // 冷却倒计时 tick
      var nowState = hooks.useState(Date.now());
      var setNow = nowState[1];
      hooks.useEffect(function () {
        var timer = setInterval(function () { setNow(Date.now()); }, 1000);
        return function () { clearInterval(timer); };
      }, []);
      var now = nowState[0];

      // 拖拽状态
      var dragState = hooks.useState({ from: -1, over: -1 });
      var drag = dragState[0];
      var setDrag = dragState[1];

      function applyReorder(from, to, data) {
        var next = reorder(data.chain, from, to);
        setSnap({ status: "ready", data: { ...data, chain: next } }); // 乐观更新
        fetch("/api/llm-fallback/chain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chain: next.map(function (e) { return { provider: e.provider, model: e.model }; }) })
        })
          .then(function (r) { return r.json(); })
          .then(function (res) { if (!res || !res.ok) setSnap({ status: "ready", data: data }); }) // 失败回滚
          .catch(function () { setSnap({ status: "ready", data: data }); });
      }

      if (snap.status === "loading") {
        return h("div", { className: "llmf2-root" }, h("div", { className: "llmf2-currentLabel" }, "渠道状态…"));
      }
      if (snap.status === "error" || !snap.data) {
        return h("div", { className: "llmf2-root" }, h("div", { className: "llmf2-error" }, "无法获取渠道状态"));
      }

      var chain = snap.data.chain || [];
      var ark = snap.data.usage && snap.data.usage.ark ? snap.data.usage.ark : null;
      var current = chain.find(function (c) { return c.lastOkAt && !c.cooling; }) || null;
      var groups = groupChain(chain);

      var rows = groups.map(function (group, gi) {
        var cards = group.items.map(function (entry) {
          var globalIndex = chain.indexOf(entry);
          var isCurrent = current === entry;
          var cooling = entry.cooling && entry.cooldownUntil
            ? fmtCountdown(entry.cooldownUntil, now)
            : (entry.cooling ? "冷却" : "");
          var usage = null;
          if (entry.provider.indexOf("volcengine-ark") === 0 && typeof entry.arkPercent === "number") {
            var pct = entry.arkPercent;
            usage = h("div", { className: "llmf2-usage", key: "u" },
              h("div", { className: "llmf2-usageBar" },
                h("div", { className: "llmf2-usageFill", style: { width: Math.min(100, pct) + "%", background: fillColor(pct) } })),
              h("span", { className: "llmf2-usageText" }, Math.round(pct) + "%")
            );
          }
          var rowClass = "llmf2-row" +
            (isCurrent ? " llmf2-currentRow" : "") +
            (drag.from === globalIndex ? " llmf2-dragFrom" : "") +
            (drag.over === globalIndex && drag.from >= 0 ? " llmf2-dragOver" : "");
          return h("div", {
            key: entry.provider + "|" + entry.model,
            className: rowClass,
            draggable: true,
            onDragStart: function (e) { setDrag({ from: globalIndex, over: -1 }); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; },
            onDragOver: function (e) { e.preventDefault(); if (drag.from >= 0 && drag.from !== globalIndex) setDrag({ from: drag.from, over: globalIndex }); },
            onDragLeave: function () { if (drag.over === globalIndex) setDrag({ from: drag.from, over: -1 }); },
            onDrop: function (e) {
              e.preventDefault();
              if (drag.from >= 0 && drag.from !== globalIndex) applyReorder(drag.from, globalIndex, snap.data);
              setDrag({ from: -1, over: -1 });
            },
            onDragEnd: function () { setDrag({ from: -1, over: -1 }); }
          },
            h("span", { className: "llmf2-grip" }, "⋮⋮"),
            h("span", { className: "llmf2-dot " + dotClass(entry) }),
            h("div", { className: "llmf2-rowMain" },
              h("div", { className: "llmf2-rowName" }, entry.displayName || entry.provider),
              h("div", { className: "llmf2-rowModel" }, entry.model)
            ),
            h("div", { className: "llmf2-meta" },
              usage,
              cooling ? h("span", { className: "llmf2-cool" }, cooling) : null
            )
          );
        });
        return h("div", { className: "llmf2-group", key: gi },
          h("div", { className: "llmf2-groupTitle" }, group.family + " · " + group.items.length),
          cards
        );
      });

      // 顶部:当前渠道 + 方舟 5h 用量
      var head = h("div", { className: "llmf2-current" },
        h("span", { className: "llmf2-dot " + dotClass(current) }),
        h("span", { className: "llmf2-currentLabel" },
          current ? (current.displayName || current.provider) + " · " + (current.model || "") : "无可用渠道"
        ),
        current ? h("span", { className: "llmf2-currentHint" }, "当前") : null
      );
      var arkBlock = null;
      if (ark && ark["5h"] && typeof ark["5h"].percent === "number") {
        var p = ark["5h"].percent;
        arkBlock = h("div", { className: "llmf2-ark" },
          h("div", { className: "llmf2-arkHead" },
            h("span", { className: "llmf2-arkTitle" }, "方舟 5h 用量"),
            h("span", { className: "llmf2-arkPct" }, Math.round(p) + "%")
          ),
          h("div", { className: "llmf2-arkBar" },
            h("div", { className: "llmf2-arkFill", style: { width: Math.min(100, p) + "%", background: fillColor(p) } })
          )
        );
      }

      return h("div", { className: "llmf2-root" },
        head,
        arkBlock,
        groups.length > 0 ? rows : h("div", { className: "llmf2-error" }, "暂无渠道(chain 为空)"),
        h("div", { className: "llmf2-hint" }, "拖动 ⋮⋮ 调整回退优先级(自动保存)")
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
          if (opened) { clearInterval(timer); return; }
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
