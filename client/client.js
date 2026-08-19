/* dsh-llm-fallback client bundle — 侧边栏「模型渠道」Tab v2
 * 卡片式布局,全部使用 DSH 主题变量(--dsw-alias-*)自动适配所有皮肤;
 * 支持拖拽调整回退优先级(POST /api/llm-fallback/chain 热更新 + 持久化);
 * 冷却倒计时实时刷新(1s tick);方舟用量进度条。
 * 数据:GET /api/llm-fallback/status(10s 轮询)。
 */
window.__ModuleLoader__.load({
  id: "@yfy-ai/dsh-llm-fallback",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var hooks = react;
    var h = react.createElement;

    // ---- inline styles(theme-aware via DSH CSS variables) ----
    var css = (
      ".llmf2-root{display:flex;flex-direction:column;gap:10px;padding:10px;font:var(--dsw-font-s-14,13px/1.5 system-ui);min-height:0;height:100%;box-sizing:border-box;}" +
      ".llmf2-scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;}" +
      ".llmf2-official{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-base,rgba(128,128,128,.03));flex:none;}" +
      ".llmf2-officialTitle{padding:6px 11px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#888);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06));}" +
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
      ".llmf2-hint{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);text-align:center;padding:2px 0 0;}" +
      ".llmf2-metric{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums;flex:none;}" +
      ".llmf2-rate-ok{color:var(--dsw-alias-state-success-primary,#30a46c);}" +
      ".llmf2-rate-warn{color:var(--dsw-alias-state-warn-label,#e5a63c);}" +
      ".llmf2-rate-down{color:var(--dsw-alias-state-error-primary,#e5484d);}" +
      ".llmf2-btn{flex:none;font-size:10px;line-height:1;padding:3px 7px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));color:var(--dsw-alias-label-secondary,#ccc);cursor:pointer;}" +
      ".llmf2-btn:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill,#5b8def);border-color:var(--dsw-alias-button-primary-fill,#5b8def);color:#fff;}" +
      ".llmf2-btn:disabled{opacity:.4;cursor:default;}" +
      ".llmf2-hist{margin-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));padding-top:6px;}" +
      ".llmf2-histHead{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;user-select:none;}" +
      ".llmf2-histBody{margin-top:4px;display:flex;flex-direction:column;gap:3px;max-height:180px;overflow:auto;}" +
      ".llmf2-histItem{display:flex;gap:8px;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary,#aaa);}" +
      ".llmf2-histTime{flex:none;color:var(--dsw-alias-label-dimmed,#777);font-variant-numeric:tabular-nums;}" +
      ".llmf2-footer{border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));padding-bottom:6px;display:flex;flex-direction:column;gap:6px;position:sticky;top:0;z-index:5;background:var(--dsw-alias-bg-base,rgba(128,128,128,.03));}" +
      ".llmf2-footerInfo{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".llmf2-footerInfo a{color:var(--dsw-alias-label-tertiary,#888);text-decoration:none;}" +
      ".llmf2-footerInfo a:hover{text-decoration:underline;color:var(--dsw-alias-label-secondary,#ccc);}" +
      ".llmf2-footerBtns{display:flex;gap:6px;}" +
      ".llmf2-fbtn{flex:1;height:24px;font-size:11px;line-height:1;padding:0 6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));color:var(--dsw-alias-label-secondary,#ccc);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;}" +
      ".llmf2-fbtn:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill,#5b8def);border-color:var(--dsw-alias-button-primary-fill,#5b8def);color:#fff;}" +
      ".llmf2-fbtn.active{background:var(--dsw-alias-button-primary-fill,#5b8def);border-color:var(--dsw-alias-button-primary-fill,#5b8def);color:#fff;}" +
      ".llmf2-fbtn:disabled{opacity:.4;cursor:default;}" +
      ".llmf2-modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);}" +
      ".llmf2-modalCard{background:var(--dsw-alias-bg-base,#1a1a1a);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:10px;padding:14px;width:300px;max-width:92vw;display:flex;flex-direction:column;gap:8px;box-shadow:var(--dsw-shadow-lv3,0 4px 16px rgba(0,0,0,.3));}" +
      ".llmf2-modalTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6);}" +
      ".llmf2-modalSub{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);line-height:14px;}" +
      ".llmf2-modalInput{width:100%;height:30px;padding:0 8px;font-size:12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));color:var(--dsw-alias-label-primary,#e6e6e6);box-sizing:border-box;}" +
      ".llmf2-modalInput:focus{outline:none;border-color:var(--dsw-alias-button-primary-fill,#5b8def);}" +
      ".llmf2-modalSel{width:100%;height:30px;padding:0 8px;font-size:12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));color:var(--dsw-alias-label-primary,#e6e6e6);box-sizing:border-box;}" +
      ".llmf2-modalSel:focus{outline:none;border-color:var(--dsw-alias-button-primary-fill,#5b8def);}" +
      ".llmf2-modalBtns{display:flex;justify-content:flex-end;gap:6px;margin-top:2px;}" +
      ".llmf2-mbtn{height:26px;padding:0 12px;font-size:11px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));color:var(--dsw-alias-label-secondary,#ccc);}" +
      ".llmf2-mbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));}" +
      ".llmf2-mbtn.primary{background:var(--dsw-alias-button-primary-fill,#5b8def);border-color:var(--dsw-alias-button-primary-fill,#5b8def);color:#fff;}" +
      ".llmf2-mbtn.primary:hover{opacity:.9;}" +
      ".llmf2-secureHint{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);line-height:14px;}"
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
      if (entry && (entry.truncated || (entry.lastFailAt && (!entry.lastOkAt || entry.lastFailAt > entry.lastOkAt)))) return "llmf2-dot-warn";
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
    // ---- 自动排序:按渠道实际表现与可用性打分,DS官方(deepseek-official)不参与 ----
    function autoScore(entry) {
      var score = 0;
      // 可用性:冷却中 / 额度耗尽 / 截断避让 → 直接排最后
      if (entry.cooling) score -= 10000;
      if (entry.truncated) score -= 5000;
      if (entry.lastFailAt && (!entry.lastOkAt || entry.lastFailAt > entry.lastOkAt)) score -= 2000;
      // 成功率(最近窗口,0-1):权重最大
      if (typeof entry.successRate === "number") score += entry.successRate * 100;
      // 平均延迟:越低越好(最多扣 50 分,避免延迟差 1s 就翻转)
      if (typeof entry.avgLatencyMs === "number" && isFinite(entry.avgLatencyMs)) {
        score -= Math.min(entry.avgLatencyMs, 30000) / 600;
      }
      // 火山方舟额度:百分比越高越危险
      if (entry.provider.indexOf("volcengine-ark") === 0 && typeof entry.arkPercent === "number") {
        score -= Math.max(0, entry.arkPercent - 60) / 2;
      }
      return score;
    }
    function autoSortChain(chain) {
      var official = [];
      var others = [];
      for (var i = 0; i < chain.length; i++) {
        // DS官方(deepseek-official)不参与自动排序,保持链尾兜底
        if (chain[i].provider === "deepseek-official") official.push(chain[i]);
        else others.push(chain[i]);
      }
      others.sort(function (a, b) { return autoScore(b) - autoScore(a); });
      return others.concat(official);
    }
    // ---- API Key 本地安全存储(localStorage,不写日志/不进 URL) ----
    function loadApikeys() {
      try {
        var raw = localStorage.getItem("dsh-llm-fallback-apikeys");
        return raw ? JSON.parse(raw) : {};
      } catch (e) { return {}; }
    }
    function saveApikey(provider, key) {
      var keys = loadApikeys();
      keys[provider] = key;
      try { localStorage.setItem("dsh-llm-fallback-apikeys", JSON.stringify(keys)); } catch (e) {}
    }
    function hasApikey(provider) {
      var keys = loadApikeys();
      return !!(keys[provider] && keys[provider].length > 0);
    }
    // ---- 用户拖拽(自定义)顺序快照:auto 排序前先备份,恢复时用 ----
    function loadCustomChain() {
      try {
        var raw = localStorage.getItem("dsh-llm-fallback-custom-chain");
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }
    function saveCustomChain(chain) {
      try {
        localStorage.setItem("dsh-llm-fallback-custom-chain",
          JSON.stringify(chain.map(function (e) { return { provider: e.provider, model: e.model }; })));
      } catch (e) {}
    }
    // ---- 指标/历史展示辅助 ----
    function dispName(provider) {
      var map = {
        "volcengine-ark": "火山方舟①",
        "volcengine-ark-2": "火山方舟②",
        "hcnsec-1": "幻城网安①",
        "hcnsec-2": "幻城网安②",
        "sensenova-1": "商汤日日新①",
        "sensenova-2": "商汤日日新②",
        "sensenova-3": "商汤日日新③",
        "deepseek-official": "DeepSeek 官方",
      };
      return map[provider] || provider;
    }
    function fmtLatency(ms) {
      if (ms === null || ms === undefined) return "";
      if (ms < 1000) return Math.round(ms) + "ms";
      return (ms / 1000).toFixed(1) + "s";
    }
    function fmtTime(t) {
      var d = new Date(t);
      var h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
      return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
    }
    function rateClass(rate) {
      if (rate === null || rate === undefined) return "";
      if (rate >= 0.8) return "llmf2-rate-ok";
      if (rate >= 0.5) return "llmf2-rate-warn";
      return "llmf2-rate-down";
    }
    function histText(ev) {
      switch (ev.kind) {
        case "fallback":
          return dispName(ev.from) + " " + (ev.model || "") + " → " + dispName(ev.to) + " " + (ev.targetModel || "") + (ev.reason ? "（" + ev.reason + "）" : "");
        case "manual":
          return "手动指定 " + dispName(ev.provider) + " " + ev.model;
        case "recover":
          return dispName(ev.provider) + " 恢复" + (ev.note ? "（" + ev.note + "）" : "");
        case "truncated":
          return dispName(ev.provider) + " " + ev.model + " 输出截断";
        case "avoid":
          return dispName(ev.provider) + " " + ev.model + " 截断避让";
        default:
          return ev.kind + (ev.provider ? " " + dispName(ev.provider) + (ev.model ? " " + ev.model : "") : "");
      }
    }

    // ---- data:10s 轮询 + 拖拽后乐观更新(带 sessionId,取该会话实时"当前"路由)----
    function useStatus(sessionId) {
      var state = hooks.useState({ status: "loading", data: null });
      var setData = state[1];
      hooks.useEffect(function () {
        var alive = true;
        function tick() {
          var url = sessionId
            ? "/api/llm-fallback/status?sessionId=" + encodeURIComponent(sessionId)
            : "/api/llm-fallback/status";
          fetch(url, { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (data) { if (alive) setData({ status: "ready", data: data }); })
            .catch(function () { if (alive) setData({ status: "error", data: null }); });
        }
        tick();
        var timer = setInterval(tick, 10000);
        return function () { alive = false; clearInterval(timer); };
      }, [sessionId]);
      return state;
    }

    // ---- main widget ----
    function ChannelStatusWidget(props) {
      // better-sidebar 传入 { tab, scope, store, visible };scope.sessionId 用于手动路由 + 实时"当前"展示
      var sessionId = props && props.scope ? props.scope.sessionId : null;
      var statusState = useStatus(sessionId);
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

      // 手动"用此渠道"反馈:记录最近点击的渠道 key,按钮短暂显示"已指定"
      var routedState = hooks.useState(null);
      var routed = routedState[0];
      var setRouted = routedState[1];

      // ---- 排序模式:'custom'=用户拖拽顺序(默认) / 'auto'=按表现自动排序 ----
      var sortModeState = hooks.useState("custom");
      var sortMode = sortModeState[0];
      var setSortMode = sortModeState[1];

      // ---- API Key 模态框 ----
      var apiModalState = hooks.useState(false);
      var showApiModal = apiModalState[0];
      var setShowApiModal = apiModalState[1];
      var apiProviderState = hooks.useState("");
      var apiProvider = apiProviderState[0];
      var setApiProvider = apiProviderState[1];
      var apiKeyState = hooks.useState("");
      var apiKeyInput = apiKeyState[0];
      var setApiKeyInput = apiKeyState[1];

      function persistChain(next, data) {
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

      // 自动排序:按实际表现重排并持久化
      function applyAutoSort(data) {
        // 备份当前(用户拖拽)顺序,便于"自定义"恢复
        var saved = loadCustomChain();
        if (!saved || saved.length !== data.chain.length) saveCustomChain(data.chain);
        var next = autoSortChain(data.chain);
        persistChain(next, data);
        setSortMode("auto");
      }
      // 恢复自定义(拖拽)顺序:优先用本地快照,否则保持 host 当前 chain
      function applyCustomSort(data) {
        var saved = loadCustomChain();
        if (saved && saved.length > 0) {
          // 把保存的顺序映射回当前 chain 条目(provider|model 匹配)
          var byKey = {};
          for (var i = 0; i < data.chain.length; i++) {
            byKey[data.chain[i].provider + "|" + data.chain[i].model] = data.chain[i];
          }
          var next = [];
          for (var j = 0; j < saved.length; j++) {
            var entry = byKey[saved[j].provider + "|" + saved[j].model];
            if (entry) next.push(entry);
          }
          // 兜底:把未匹配上的条目追加到末尾
          for (var k = 0; k < data.chain.length; k++) {
            if (next.indexOf(data.chain[k]) === -1) next.push(data.chain[k]);
          }
          if (next.length > 0) persistChain(next, data);
        }
        setSortMode("custom");
      }
      // 保存 API Key(掩码输入,存 localStorage,不上送日志)
      function submitApikey() {
        var key = apiKeyInput.trim();
        if (!key || !apiProvider) return;
        saveApikey(apiProvider, key);
        setShowApiModal(false);
        setApiKeyInput("");
      }
      function openApiModal() {
        setApiProvider("");
        setApiKeyInput("");
        setShowApiModal(true);
      }

      function useRoute(provider, model) {
        if (!sessionId) return;
        fetch("/api/llm-fallback/route", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: provider, model: model, sessionId: sessionId })
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.ok) {
              setRouted(provider + "|" + model);
              setTimeout(function () { setRouted(null); }, 2000);
            }
          })
          .catch(function () {});
      }

      function applyReorder(from, to, data) {
        // 拖拽 = 自定义模式(用户手动顺序),切回 custom 并持久化
        setSortMode("custom");
        var next = reorder(data.chain, from, to);
        saveCustomChain(next); // 记录用户拖拽顺序,供"自定义"恢复
        persistChain(next, data);
      }

      if (snap.status === "loading") {
        return h("div", { className: "llmf2-root" }, h("div", { className: "llmf2-currentLabel" }, "渠道状态…"));
      }
      if (snap.status === "error" || !snap.data) {
        return h("div", { className: "llmf2-root" }, h("div", { className: "llmf2-error" }, "无法获取渠道状态"));
      }

      var chain = snap.data.chain || [];
      // auto 模式下按实际表现排序展示
      var displayChain = sortMode === "auto" ? autoSortChain(chain) : chain;
      var ark = snap.data.usage && snap.data.usage.ark ? snap.data.usage.ark : null;
      // 实时"当前"路由:由 host 按 sessionId 返回(该会话最近一次实际派发的渠道)
      var current = snap.data.current || null;
      // 从 chain 匹配当前项(用于 dot 状态与行高亮)
      var currentEntry = current
        ? (chain.find(function (c) { return c.provider === current.provider && c.model === current.model; }) || null)
        : null;
      var groups = groupChain(displayChain);

      // 拆分:滚动区(非 DS 官方)与固定底部(DS 官方,不参与滚动)
      var scrollChain = [];
      var officialChain = [];
      for (var ci = 0; ci < displayChain.length; ci++) {
        if (displayChain[ci].provider === "deepseek-official") officialChain.push(displayChain[ci]);
        else scrollChain.push(displayChain[ci]);
      }
      var groups = groupChain(scrollChain);
      var officialGroups = groupChain(officialChain);

      // 渠道卡片行生成(供滚动区与固定区复用)
      function renderGroups(grps) {
        return grps.map(function (group, gi) {
          var cards = group.items.map(function (entry) {
            var globalIndex = displayChain.indexOf(entry);
            var isCurrent = currentEntry !== null && entry === currentEntry;
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
          // 质量指标:成功率(最近 20 次)+ 平均延迟
          var metricsRow = [];
          if (typeof entry.successRate === "number") {
            metricsRow.push(h("span", {
              key: "rate",
              className: "llmf2-metric " + rateClass(entry.successRate),
              title: "最近 " + entry.count + " 次:" + entry.okCount + " 成功 / " + entry.failCount + " 失败" + (entry.truncatedCount ? " · 累计截断 " + entry.truncatedCount : "")
            }, Math.round(entry.successRate * 100) + "%"));
          }
          if (entry.avgLatencyMs !== null && entry.avgLatencyMs !== undefined) {
            metricsRow.push(h("span", { key: "lat", className: "llmf2-metric", title: "平均延迟(最近窗口)" }, fmtLatency(entry.avgLatencyMs)));
          }
          // 手动"用此渠道"
          var routedKey = entry.provider + "|" + entry.model;
          var btn = h("button", {
            key: "btn",
            className: "llmf2-btn",
            title: sessionId ? "下一次请求强制使用此渠道" : "无活动会话,不可用",
            disabled: !sessionId,
            onClick: function (e) { e.stopPropagation(); useRoute(entry.provider, entry.model); }
          }, routed === routedKey ? "已指定" : "用此");
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
              metricsRow,
              usage,
              entry.truncated ? h("span", { className: "llmf2-cool", title: "上轮输出达到 token 上限,此期间自动避让" }, "截断") : null,
              cooling ? h("span", { className: "llmf2-cool" }, cooling) : null,
              btn
            )
          );
        });
        return h("div", { className: "llmf2-group", key: gi },
          h("div", { className: "llmf2-groupTitle" }, group.family + " · " + group.items.length),
          cards
        );
      });
      }
      // 滚动区:非 DS 官方渠道;固定区:DS 官方(链尾兜底,不参与滚动)
      var scrollRows = groups.length > 0 ? renderGroups(groups) : h("div", { className: "llmf2-error" }, "暂无渠道(chain 为空)");
      var officialRows = officialGroups.length > 0 ? renderGroups(officialGroups) : null;

      // 顶部:当前渠道(实时,按 sessionId)+ 方舟 5h 用量
      var head = h("div", { className: "llmf2-current" },
        h("span", { className: "llmf2-dot " + dotClass(currentEntry) }),
        h("span", { className: "llmf2-currentLabel" },
          current ? (dispName(current.provider) + " · " + (current.model || "")) : "暂无正在使用的模型"
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

      // 切换历史(最近 20 条,倒序展示,可折叠)
      var events = snap.data.events || [];
      var hist = null;
      if (events.length > 0) {
        hist = h("div", { className: "llmf2-hist" },
          h("details", null,
            h("summary", { className: "llmf2-histHead" }, "切换历史（" + events.length + "）"),
            h("div", { className: "llmf2-histBody" },
              events.slice().reverse().map(function (ev, i) {
                return h("div", { className: "llmf2-histItem", key: i },
                  h("span", { className: "llmf2-histTime" }, fmtTime(ev.t)),
                  h("span", { className: "llmf2-histText" }, histText(ev))
                );
              })
            )
          )
        );
      }

      return h("div", { className: "llmf2-root" },
        // ---- 顶部工具条:插件信息 + 自定义/自动/apikey(始终可见,不被列表挤下去) ----
        h("div", { className: "llmf2-footer" },
          h("div", { className: "llmf2-footerInfo" },
            "📦 dsh-llm-fallback · ",
            h("a", { href: "https://github.com/YFY-AI/dsh-llm-fallback", target: "_blank", rel: "noopener noreferrer" }, "YFY-AI/dsh-llm-fallback")
          ),
          h("div", { className: "llmf2-footerBtns" },
            h("button", {
              className: "llmf2-fbtn" + (sortMode === "custom" ? " active" : ""),
              title: "按你的拖拽顺序实施,DS官方兜底",
              onClick: function () { applyCustomSort(snap.data); }
            }, "🖐️ 自定义"),
            h("button", {
              className: "llmf2-fbtn" + (sortMode === "auto" ? " active" : ""),
              title: "按实际表现/可用性自动排序(DS官方不参与)",
              onClick: function () { applyAutoSort(snap.data); }
            }, "⚡ 自动"),
            h("button", {
              className: "llmf2-fbtn",
              title: "为渠道输入 API Key(掩码保存,不泄露)",
              onClick: openApiModal
            }, "🔑 apikey")
          )
        ),
        head,
        arkBlock,
        // 中间滚动区:非 DS 官方渠道(纵向滚动,不挤压顶部工具条与底部固定区)
        h("div", { className: "llmf2-scroll" },
          scrollRows
        ),
        // 固定底部:DS 官方(链尾兜底,不参与滚动,始终可见)
        officialRows !== null ? h("div", { className: "llmf2-official" },
          h("div", { className: "llmf2-officialTitle" }, "DS 官方 · 兜底"),
          officialRows
        ) : null,
        h("div", { className: "llmf2-hint" }, "拖动 ⋮⋮ 调整回退优先级 · 「用此」强制下次路由"),
        hist,
        // ---- API Key 模态框 ----
        showApiModal ? h("div", { className: "llmf2-modal", onClick: function (e) { if (e.target === e.currentTarget) setShowApiModal(false); } },
          h("div", { className: "llmf2-modalCard" },
            h("div", { className: "llmf2-modalTitle" }, "🔑 输入渠道 API Key"),
            h("div", { className: "llmf2-modalSub" }, "选择渠道并粘贴对应 API Key,本地掩码保存,不会写入日志或外发。"),
            h("select", {
              className: "llmf2-modalSel",
              value: apiProvider,
              onChange: function (e) { setApiProvider(e.target.value); }
            },
              h("option", { value: "" }, "请选择渠道…"),
              chain.map(function (e) {
                var key = e.provider;
                return h("option", { value: key, key: key }, dispName(key) + (hasApikey(key) ? " ✓已存" : ""));
              })
            ),
            h("input", {
              className: "llmf2-modalInput",
              type: "password",
              placeholder: "sk-xxxx (掩码显示)",
              value: apiKeyInput,
              onChange: function (e) { setApiKeyInput(e.target.value); },
              onKeyDown: function (e) { if (e.key === "Enter") submitApikey(); if (e.key === "Escape") setShowApiModal(false); }
            }),
            h("div", { className: "llmf2-secureHint" }, "安全说明:Key 仅存于本机浏览器 localStorage,输入时掩码显示,不随请求外发、不进日志。"),
            h("div", { className: "llmf2-modalBtns" },
              h("button", { className: "llmf2-mbtn", onClick: function () { setShowApiModal(false); } }, "取消"),
              h("button", { className: "llmf2-mbtn primary", onClick: submitApikey }, "保存")
            )
          )
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
          ensureTabs(ctx, bs);
        }
      }, 200);
      disposers.push(function () { clearInterval(waitTimer); });

      function registerTab(bs) {
        var off = bs.registerTab({
          id: "llm-fallback",
          title: function () { return "模型渠道"; },
          order: 60,
          single: true,
          component: function (tabProps) {
            // 透传 better-sidebar 的 { tab, scope, store, visible },scope.sessionId 供手动路由
            return react.createElement(ChannelStatusWidget, tabProps);
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

      // ---- 全会话覆盖:模型渠道 tab 进入每个会话 + 清理旧命名残留(ark-status) ----
      function ensureTabs(ctx, bs) {
        // 1) 对"所有已知会话"打开模型渠道 tab(targetedOpen 走 reduceFor,
        //    未打开过的会话也会生成并持久化状态,切过去即有该 tab)
        try {
          var snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot
            ? ctx.sessions.list.getSnapshot()
            : null;
          var ids = snap && snap.byId ? Object.keys(snap.byId) : [];
          for (var i = 0; i < ids.length; i++) {
            try { bs.openTab({ type: "llm-fallback", title: "模型渠道" }, { sessionId: ids[i] }); } catch (e) {}
          }
        } catch (e) {}
        // 2) 订阅状态变化:会话切换/新会话打开时兜底打开 + 清理当前会话的旧命名残留
        if (bs.subscribeState) {
          var unsub = bs.subscribeState(function () {
            try {
              var s = bs.getSnapshot ? bs.getSnapshot() : null;
              if (!s || !s.sessionId) return;
              try { bs.openTab({ type: "llm-fallback", title: "模型渠道" }); } catch (e) {}
              pruneLegacyTabs(bs, s);
            } catch (e) {}
          });
          if (typeof unsub === "function") disposers.push(unsub);
        }
        // 3) 当前活跃会话立即生效
        try {
          var cur = bs.getSnapshot ? bs.getSnapshot() : null;
          if (cur && cur.sessionId) {
            try { bs.openTab({ type: "llm-fallback", title: "模型渠道" }); } catch (e) {}
            pruneLegacyTabs(bs, cur);
          }
        } catch (e) {}
      }

      // 清理已移除插件的残留 tab(旧命名 ark-status,现由本插件内置)。closeTab
      // 只作用于当前活跃会话,因此"切到哪个会话清哪个",一次到位且不会误删。
      function pruneLegacyTabs(bs, snap) {
        if (!bs.closeTab || !snap || !snap.state) return;
        var legacy = { "ark-status": true };
        var victims = [];
        function collect(node) {
          if (!node || typeof node !== "object") return;
          if (node.kind === "leaf" && Array.isArray(node.tabs)) {
            for (var i = 0; i < node.tabs.length; i++) {
              var t = node.tabs[i];
              if (t && legacy[t.type]) victims.push(t.id);
            }
          }
          if (Array.isArray(node.children)) {
            for (var j = 0; j < node.children.length; j++) collect(node.children[j]);
          }
        }
        collect(snap.state.splits);
        collect(snap.state.bottomSplits);
        for (var k = 0; k < victims.length; k++) {
          try { bs.closeTab(victims[k]); } catch (e) {}
        }
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
