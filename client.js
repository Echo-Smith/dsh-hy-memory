window.__ModuleLoader__.load({
  id: "@local/dsh-hy-memory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client-src/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var React4 = __toESM(require("react"), 1);

// client-src/api.js
var BASE = "/api/hy-memory";
var PanelApiError = class extends Error {
  constructor(verb, message, status = 0, code = "") {
    super(message);
    this.name = "PanelApiError";
    this.verb = verb;
    this.status = status;
    this.code = code;
  }
};
async function request(verb, payload) {
  const path = `${BASE}/${verb}`;
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {})
    });
  } catch (cause) {
    throw new PanelApiError(verb, `network request failed: ${cause?.message ?? String(cause)}`);
  }
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  let body = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  const errorCode = typeof body?.error?.code === "string" ? body.error.code : "";
  if (!response.ok) {
    throw new PanelApiError(
      verb,
      body?.error?.message ?? (text !== "" ? text : `HTTP ${response.status}`),
      response.status,
      errorCode
    );
  }
  if (body !== null && body.ok === false) {
    throw new PanelApiError(verb, body?.error?.message ?? "request was rejected", response.status, errorCode);
  }
  return body !== null && typeof body === "object" && "data" in body ? body.data : body;
}
var statusPromise = null;
function loadStatus() {
  if (statusPromise === null) {
    statusPromise = request("status").catch((error) => {
      statusPromise = null;
      throw error;
    });
  }
  return statusPromise;
}
function readStatus() {
  statusPromise = request("status").catch((error) => {
    statusPromise = null;
    throw error;
  });
  return statusPromise;
}
var sessionPanelEnabled = null;
var sessionPanelPromise = null;
function getSessionPanelEnabled() {
  if (sessionPanelEnabled !== null) return Promise.resolve(sessionPanelEnabled);
  if (sessionPanelPromise === null) {
    sessionPanelPromise = request("settings/get").then((data) => {
      const settings = data?.settings ?? data ?? {};
      sessionPanelEnabled = settings?.ui?.sessionPanel !== false;
      return sessionPanelEnabled;
    }).catch(() => {
      sessionPanelEnabled = true;
      return true;
    });
  }
  return sessionPanelPromise;
}
var api = {
  loadStatus,
  readStatus,
  list: (params) => request("list", params),
  update: (payload) => request("update", payload),
  delete: (payload) => request("delete", payload),
  // Forget: delete the memory AND record its text so promotion cannot bring it back.
  forget: (id) => request("forget", { id }),
  // Recall explanation: why (if ever) the host injected this memory.
  explain: (id) => request("explain", { id }),
  // Duplicate cleanup: scan groups, then merge one group per call.
  duplicates: (tier) => request("duplicates", typeof tier === "string" && tier !== "" ? { tier } : {}),
  merge: (payload) => request("merge", payload),
  search: (payload) => request("search", payload),
  activity: (since) => request("activity", since === void 0 ? {} : { since }),
  start: () => request("start"),
  getSettings: () => request("settings/get"),
  setSettings: (patch) => request("settings/set", { patch }),
  // Workspace and session pickers: `projects` lists the projects the plugin
  // already knows, `sessions` the sessions that hold session-tier memories in
  // one project. Both are read-only views (docs/CONTRACT.md panel routes).
  projects: () => request("projects"),
  // Update check: the host compares the installed version with GitHub releases.
  // Without force the host answers from its 12 h cache; force always refetches.
  updateCheck: (force) => request("update/check", typeof force === "boolean" ? { force } : {}),
  sessions: (projectKey) => request("sessions", typeof projectKey === "string" && projectKey !== "" ? { projectKey } : {}),
  // MemHub link (docs/CONTRACT.md addendum). Import/pull always target the
  // personal tier on the host; the panel only chooses the source.
  memhubExport: () => request("memhub/export"),
  memhubPull: () => request("memhub/pull"),
  memhubImport: (path) => request("memhub/import", typeof path === "string" && path !== "" ? { path } : {})
};

// locale/zh.json
var zh_default = {
  meta: {
    title: "记忆",
    description: "Hy-Memory 双层认知记忆：个人、项目、会话三层记忆，自动召回与沉淀，并在设置中管理与查看。"
  },
  "nav.label": "记忆",
  "section.title": "记忆管理",
  "section.subtitle": "查看与整理个人、项目、会话三层记忆。召回与沉淀由 Hy-Memory 自动完成。",
  "tabs.label": "记忆层级",
  "tabs.personal": "个人",
  "tabs.project": "项目",
  "tabs.session": "会话",
  "counts.item": "{label} {n}",
  "counts.total": "共 {n} 条",
  "search.placeholder": "搜索记忆文件…",
  "common.close": "关闭",
  "common.retry": "重试",
  "common.refresh": "刷新",
  "common.loading": "正在加载…",
  "common.details": "详细信息",
  "common.hideDetails": "收起详情",
  "banner.notReady.title": "Hy-Memory 侧车尚未就绪",
  "banner.notReady.body": "侧车状态：{state}。记忆的召回与沉淀在启动后恢复。",
  "banner.lastError": "最近错误：{message}",
  "banner.error": "无法读取记忆状态：{message}",
  "banner.start": "启动侧车",
  "banner.starting": "正在启动…",
  "diag.title": "诊断",
  "diag.sidecar": "侧车",
  "diag.model": "模型",
  "diag.embedding": "向量化",
  "diag.mode": "模式",
  "diag.scene": "场景",
  "diag.project": "当前项目",
  "diag.session": "当前会话",
  "diag.dataDir": "数据目录",
  "diag.dataSize": "数据大小",
  "diag.ready": "就绪",
  "diag.notReady": "未就绪",
  "diag.unknown": "未知",
  "diag.local": "本地",
  "diag.remote": "远程",
  "memhub.title": "MemHub 连接",
  "memhub.state": "检测状态",
  "memhub.detected": "已检测到 MemHub",
  "memhub.path": "记忆库位置",
  "memhub.size": "记忆库大小",
  "memhub.explain": "MemHub 是独立产品；导入只会把记忆复制到个人层，不会修改 MemHub 的记忆库。",
  "memhub.export": "导出到 JSON",
  "memhub.exporting": "正在导出…",
  "memhub.pull": "从 MemHub 拉取",
  "memhub.pulling": "正在拉取…",
  "memhub.import": "从文件导入",
  "memhub.importing": "正在导入…",
  "memhub.importPath": "JSON 文件绝对路径",
  "memhub.importPathPlaceholder": "/Users/you/Downloads/hy-memory.json",
  "memhub.importConfirm": "导入",
  "memhub.importCancel": "取消",
  "memhub.pathRequired": "请填写 JSON 文件的绝对路径。",
  "memhub.result.export": "已导出 {count} 条到 {path}",
  "memhub.result.import": "已导入 {imported} 条，跳过 {skipped} 条，失败 {failed} 条",
  "memhub.result.pull": "已从 MemHub 导入 {imported} 条，跳过 {skipped} 条，失败 {failed} 条",
  "memhub.result.path": "文件：{path}",
  "memhub.error.memhub_locked": "MemHub 正在运行并锁定了它的记忆库。请先退出 MemHub 后再试；本次没有做任何修改。",
  "memhub.error.embedding_mismatch": "记忆的向量维度与当前向量化设置不一致，导入已停止。请检查向量化设置后重试。",
  "memhub.error.not_found": "找不到该文件或 MemHub 记忆库，请检查路径后重试。",
  "memhub.error.import_missing": "找不到该 JSON 文件，请检查路径后重试。",
  "memhub.error.memhub_not_detected": "没有找到 MemHub 的记忆库；请先安装并运行一次 MemHub。",
  "memhub.error.generic": "操作失败：{message}",
  "state.ready": "就绪",
  "state.starting": "启动中",
  "state.stopped": "已停止",
  "state.error": "错误",
  "state.unknown": "未知",
  "empty.personal": "还没有个人记忆。你在对话中的偏好与事实会自动沉淀到这里。",
  "empty.project": "这个项目还没有记忆。项目相关的决定会沉淀到这里。",
  "empty.session": "当前会话还没有记忆。本轮对话的要点会沉淀到这里。",
  "empty.search": "没有匹配「{query}」的记忆。",
  "empty.hint": "侧栏的「记忆」面板可随时查看当前会话与项目记忆。",
  "list.error": "无法加载记忆：{message}",
  "list.fallback": "搜索服务不可用，已改为本地筛选。",
  "row.noContent": "（无内容）",
  "row.edit": "编辑",
  "row.save": "保存",
  "row.cancel": "取消",
  "row.delete": "删除",
  "row.saving": "保存中…",
  "row.saved": "已保存",
  "row.updatedAt": "更新于 {time}",
  "row.layer": "层级",
  "row.status": "状态",
  "row.project": "项目",
  "row.session": "会话",
  "row.ungrouped": "未分组",
  "row.confirmDelete.title": "删除这条记忆？",
  "row.confirmDelete.body": "这条{tier}记忆将被永久删除，无法恢复。",
  "row.confirmDelete.confirm": "删除",
  "row.confirmDelete.cancel": "取消",
  "row.deleteFailed": "删除失败：{message}",
  "row.saveFailed": "保存失败：{message}",
  "row.emptyContent": "内容不能为空。",
  "activity.title": "写入活动",
  "activity.hint": "每 3 秒刷新一次。",
  "activity.empty": "暂无活动记录。",
  "activity.error": "活动读取失败：{message}",
  "activity.kind.recall": "召回",
  "activity.kind.capture": "沉淀",
  "activity.kind.promote": "晋升",
  "activity.kind.delete": "删除",
  "activity.kind.update": "更新",
  "activity.kind.error": "错误",
  "activity.kind.sidecar": "侧车",
  "activity.tier.personal": "个人",
  "activity.tier.project": "项目",
  "activity.tier.session": "会话",
  "session.tabTitle": "记忆",
  "session.tabDesc": "当前会话与项目的记忆",
  "session.title": "会话记忆",
  "session.projectTitle": "项目记忆",
  "session.empty": "当前会话还没有记忆。",
  "session.emptyProject": "项目还没有记忆。",
  "session.noSession": "没有活动会话。",
  "session.error": "无法加载会话记忆：{message}",
  "time.now": "刚刚",
  "time.minutes": "{n} 分钟前",
  "time.hours": "{n} 小时前",
  "time.days": "{n} 天前",
  "time.months": "{n} 个月前",
  "time.years": "{n} 年前",
  "errorBoundary.title": "记忆面板出错了",
  "errorBoundary.body": "错误已被隔离，设置的其他部分不受影响。",
  "errorBoundary.retry": "重试",
  "master.label": "记忆功能",
  "master.error": "无法切换记忆功能：{message}",
  "project.workspace": "工作区",
  "project.select": "切换工作区",
  "project.empty": "还没有其他工作区。",
  "project.none": "未选择项目",
  "count.memories": "{n} 条记忆",
  "count.items": "{n} 条",
  "files.title": "文件",
  "files.refresh": "刷新文件列表",
  "row.actions": "记忆操作",
  "row.copy": "复制内容",
  "row.copied": "已复制",
  "row.copyFailed": "复制失败",
  "row.untitled": "无标题记忆",
  "session.picker": "会话",
  "session.select": "切换会话",
  "session.emptyPicker": "这个项目还没有会话记忆。",
  "tabs.workspace": "项目与会话",
  "session.all": "全部会话",
  "project.memories": "项目记忆",
  "empty.sessions": "这个项目还没有会话记忆。",
  "session.memories": "会话记忆",
  "pager.total": "共 {n} 条",
  "pager.page": "第 {page} / {pages} 页",
  "pager.prev": "上一页",
  "pager.next": "下一页",
  "pager.size": "每页",
  "memhub.missing": "未检测到 MemHub，安装后可在此同步。",
  "update.repo": "GitHub 仓库",
  "update.check": "检查更新",
  "update.checking": "检查中…",
  "update.latest": "已是最新 v{version}",
  "update.behind": "发现新版本 v{version}",
  "update.open": "查看",
  "update.failed": "检查更新失败，请稍后再试",
  "diag.memoryTokens": "记忆占用 · 本轮约 {round} tok，累计 {total} tok",
  "update.newVersion": "新版本 v{version}",
  "update.manualHint": "安装需手动进行",
  "row.forget": "永久遗忘",
  "row.confirmForget.title": "永久遗忘这条记忆？",
  "row.confirmForget.body": "这条记忆会从存储中永久删除，并记住它的内容：之后的晋升不会再把它带回来。",
  "row.confirmForget.confirm": "永久遗忘",
  "row.forgetFailed": "遗忘失败：{message}",
  "dupes.action": "整理重复项",
  "dupes.scanning": "扫描中…",
  "dupes.none": "没有重复项",
  "dupes.confirm.title": "整理重复项？",
  "dupes.confirm.body": "将移除 {rows} 条重复记忆（共 {groups} 组），每组保留最新的一条。",
  "dupes.confirm.confirm": "整理",
  "dupes.merging": "正在整理…",
  "dupes.done": "已移除 {n} 条重复记忆",
  "dupes.failed": "操作失败：{message}",
  "row.why": "为什么召回",
  "why.title": "为什么召回",
  "why.query": "匹配的请求",
  "why.tier": "层级",
  "why.score": "相关度",
  "why.rank": "排名",
  "why.at": "时间",
  "why.source": "来源",
  "why.source.semantic": "语义",
  "why.source.lexical": "关键词",
  "why.source.both": "语义 + 关键词",
  "why.never": "这条记忆还没有被召回过",
  "why.failed": "无法读取召回记录：{message}"
};

// locale/en.json
var en_default = {
  meta: {
    title: "Memory",
    description: "Hy-Memory dual-system cognitive memory with personal, project and session tiers, automatic recall and capture, managed in Settings."
  },
  "nav.label": "Memory",
  "section.title": "Memory management",
  "section.subtitle": "Review and tidy personal, project and session memories. Hy-Memory recalls and captures them automatically.",
  "tabs.label": "Memory tiers",
  "tabs.personal": "Personal",
  "tabs.project": "Project",
  "tabs.session": "Session",
  "counts.item": "{label} {n}",
  "counts.total": "{n} total",
  "search.placeholder": "Search memory files…",
  "common.close": "Close",
  "common.retry": "Retry",
  "common.refresh": "Refresh",
  "common.loading": "Loading…",
  "common.details": "Details",
  "common.hideDetails": "Hide details",
  "banner.notReady.title": "Hy-Memory sidecar is not ready",
  "banner.notReady.body": "Sidecar state: {state}. Recall and capture resume after it starts.",
  "banner.lastError": "Last error: {message}",
  "banner.error": "Could not read memory status: {message}",
  "banner.start": "Start sidecar",
  "banner.starting": "Starting…",
  "diag.title": "Diagnostics",
  "diag.sidecar": "Sidecar",
  "diag.model": "Model",
  "diag.embedding": "Embedding",
  "diag.mode": "Mode",
  "diag.scene": "Scene",
  "diag.project": "Current project",
  "diag.session": "Current session",
  "diag.dataDir": "Data directory",
  "diag.dataSize": "Data size",
  "diag.ready": "Ready",
  "diag.notReady": "Not ready",
  "diag.unknown": "Unknown",
  "diag.local": "Local",
  "diag.remote": "Remote",
  "memhub.title": "MemHub link",
  "memhub.state": "Detection",
  "memhub.detected": "MemHub detected",
  "memhub.path": "Store location",
  "memhub.size": "Store size",
  "memhub.explain": "MemHub is a separate product; importing only copies memories into the personal tier and never changes MemHub's store.",
  "memhub.export": "Export to JSON",
  "memhub.exporting": "Exporting…",
  "memhub.pull": "Pull from MemHub",
  "memhub.pulling": "Pulling…",
  "memhub.import": "Import from file",
  "memhub.importing": "Importing…",
  "memhub.importPath": "Absolute path to the JSON file",
  "memhub.importPathPlaceholder": "/Users/you/Downloads/hy-memory.json",
  "memhub.importConfirm": "Import",
  "memhub.importCancel": "Cancel",
  "memhub.pathRequired": "Enter the absolute path to a JSON file.",
  "memhub.result.export": "Exported {count} memories to {path}",
  "memhub.result.import": "Imported {imported}, skipped {skipped}, failed {failed}",
  "memhub.result.pull": "Pulled {imported} memories from MemHub, skipped {skipped}, failed {failed}",
  "memhub.result.path": "File: {path}",
  "memhub.error.memhub_locked": "MemHub is running and holds its memory store locked. Quit MemHub and try again; nothing was changed.",
  "memhub.error.embedding_mismatch": "The memories' embedding dimensions do not match the current embedding settings, so the import stopped. Check the embedding settings and retry.",
  "memhub.error.not_found": "That file or the MemHub memory store was not found. Check the path and try again.",
  "memhub.error.import_missing": "That JSON file was not found. Check the path and try again.",
  "memhub.error.memhub_not_detected": "No MemHub memory store was found. Install and run MemHub once first.",
  "memhub.error.generic": "The action failed: {message}",
  "state.ready": "Ready",
  "state.starting": "Starting",
  "state.stopped": "Stopped",
  "state.error": "Error",
  "state.unknown": "Unknown",
  "empty.personal": "No personal memories yet. Preferences and facts from your conversations settle here.",
  "empty.project": "No project memories yet. Decisions about this project settle here.",
  "empty.session": "No memories in this session yet. Key points from this conversation settle here.",
  "empty.search": "No memories match “{query}”.",
  "empty.hint": "The Memory tab in the right sidebar shows the current session and project memories.",
  "list.error": "Could not load memories: {message}",
  "list.fallback": "Search is unavailable; showing a local filter instead.",
  "row.noContent": "(empty)",
  "row.edit": "Edit",
  "row.save": "Save",
  "row.cancel": "Cancel",
  "row.delete": "Delete",
  "row.saving": "Saving…",
  "row.saved": "Saved",
  "row.updatedAt": "Updated {time}",
  "row.layer": "Layer",
  "row.status": "Status",
  "row.project": "Project",
  "row.session": "Session",
  "row.ungrouped": "Ungrouped",
  "row.confirmDelete.title": "Delete this memory?",
  "row.confirmDelete.body": "This {tier} memory will be permanently deleted and cannot be restored.",
  "row.confirmDelete.confirm": "Delete",
  "row.confirmDelete.cancel": "Cancel",
  "row.deleteFailed": "Delete failed: {message}",
  "row.saveFailed": "Save failed: {message}",
  "row.emptyContent": "Content cannot be empty.",
  "activity.title": "Write activity",
  "activity.hint": "Refreshes every 3 seconds.",
  "activity.empty": "No activity yet.",
  "activity.error": "Could not read activity: {message}",
  "activity.kind.recall": "Recall",
  "activity.kind.capture": "Capture",
  "activity.kind.promote": "Promote",
  "activity.kind.delete": "Delete",
  "activity.kind.update": "Update",
  "activity.kind.error": "Error",
  "activity.kind.sidecar": "Sidecar",
  "activity.tier.personal": "Personal",
  "activity.tier.project": "Project",
  "activity.tier.session": "Session",
  "session.tabTitle": "Memory",
  "session.tabDesc": "Current session and project memories",
  "session.title": "Session memory",
  "session.projectTitle": "Project memory",
  "session.empty": "No memories in this session yet.",
  "session.emptyProject": "No project memories yet.",
  "session.noSession": "No active session.",
  "session.error": "Could not load session memories: {message}",
  "time.now": "just now",
  "time.minutes": "{n}m ago",
  "time.hours": "{n}h ago",
  "time.days": "{n}d ago",
  "time.months": "{n}mo ago",
  "time.years": "{n}y ago",
  "errorBoundary.title": "The memory panel hit an error",
  "errorBoundary.body": "The error is contained; the rest of Settings keeps working.",
  "errorBoundary.retry": "Retry",
  "master.label": "Memory",
  "master.error": "Could not switch memory: {message}",
  "project.workspace": "Workspaces",
  "project.select": "Switch workspace",
  "project.empty": "No workspaces yet.",
  "project.none": "No project selected",
  "count.memories": "{n} memories",
  "count.items": "{n} items",
  "files.title": "Files",
  "files.refresh": "Refresh files",
  "row.actions": "Memory actions",
  "row.copy": "Copy content",
  "row.copied": "Copied",
  "row.copyFailed": "Copy failed",
  "row.untitled": "Untitled memory",
  "session.picker": "Sessions",
  "session.select": "Switch session",
  "session.emptyPicker": "No session memories in this project yet.",
  "tabs.workspace": "Project & sessions",
  "session.all": "All sessions",
  "project.memories": "Project memories",
  "empty.sessions": "No session memories in this project yet.",
  "session.memories": "Session memories",
  "pager.total": "{n} total",
  "pager.page": "Page {page} of {pages}",
  "pager.prev": "Previous page",
  "pager.next": "Next page",
  "pager.size": "Per page",
  "memhub.missing": "MemHub is not installed. Install it to sync memories here.",
  "update.repo": "GitHub repository",
  "update.check": "Check for updates",
  "update.checking": "Checking…",
  "update.latest": "Up to date · v{version}",
  "update.behind": "New version v{version}",
  "update.open": "View",
  "update.failed": "Update check failed, try again later",
  "diag.memoryTokens": "Memory footprint · about {round} tok this round, {total} tok total",
  "update.newVersion": "v{version} available",
  "update.manualHint": "Install manually",
  "row.forget": "Forget permanently",
  "row.confirmForget.title": "Forget this memory permanently?",
  "row.confirmForget.body": "The memory is deleted from the store and its text is remembered, so promotion will not bring it back.",
  "row.confirmForget.confirm": "Forget permanently",
  "row.forgetFailed": "Forget failed: {message}",
  "dupes.action": "Clean up duplicates",
  "dupes.scanning": "Scanning…",
  "dupes.none": "No duplicates",
  "dupes.confirm.title": "Clean up duplicates?",
  "dupes.confirm.body": "This removes {rows} duplicate memories across {groups} groups, keeping the newest one in each group.",
  "dupes.confirm.confirm": "Clean up",
  "dupes.merging": "Cleaning up…",
  "dupes.done": "Removed {n} duplicate memories",
  "dupes.failed": "Action failed: {message}",
  "row.why": "Why recalled",
  "why.title": "Why was this recalled",
  "why.query": "Matched request",
  "why.tier": "Tier",
  "why.score": "Score",
  "why.rank": "Rank",
  "why.at": "When",
  "why.source": "Source",
  "why.source.semantic": "Semantic",
  "why.source.lexical": "Keyword",
  "why.source.both": "Semantic + keyword",
  "why.never": "This memory has not been recalled yet",
  "why.failed": "Could not read the recall record: {message}"
};

// client-src/locale.js
var NS = "hy-memory";
function strings(catalog) {
  const out = {};
  for (const [key, value] of Object.entries(catalog ?? {})) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
var dictionaries = {
  zh: strings(zh_default),
  en: strings(en_default)
};

// client-src/panel.js
var React2 = __toESM(require("react"), 1);

// client-src/ui.js
var React = __toESM(require("react"), 1);
var h = React.createElement;
var seed = (() => {
  try {
    return typeof require === "function" ? require("@deepseek-ai/dsh-client-ui-primitives") : null;
  } catch {
    return null;
  }
})();
function pick(name, fallback) {
  const candidate = seed?.[name];
  return typeof candidate === "function" ? candidate : fallback;
}
function FallbackButton({ variant = "ghost", size = "md", icon, children, className, type, ...rest }) {
  return h("button", {
    ...rest,
    type: type ?? "button",
    className: `hm-btn hm-btn-${variant} hm-btn-${size}${className ? ` ${className}` : ""}`
  }, icon != null ? h("span", { className: "hm-btnIcon", "aria-hidden": "true" }, icon) : null, children);
}
function FallbackInput({ icon, className, ...rest }) {
  return h(
    "span",
    { className: `hm-inputWrap${className ? ` ${className}` : ""}` },
    icon != null ? h("span", { className: "hm-inputIcon", "aria-hidden": "true" }, icon) : null,
    h("input", { ...rest, className: "hm-input" })
  );
}
function FallbackTag({ tone = "outline", className, children }) {
  return h("span", { className: `hm-tag${className ? ` ${className}` : ""}`, "data-tone": tone }, children);
}
function FallbackStateDot({ state, className }) {
  return h("span", { className: `hm-dot${className ? ` ${className}` : ""}`, "data-state": state, "aria-hidden": "true" });
}
function FallbackSegmentedTabs({ items = [], value, onChange, label, className }) {
  return h(
    "div",
    { role: "tablist", "aria-label": label, className: `hm-tabs${className ? ` ${className}` : ""}` },
    items.map((item) => h("button", {
      key: item.value,
      type: "button",
      role: "tab",
      id: item.id,
      "aria-selected": item.value === value ? "true" : "false",
      "aria-controls": item.panelId,
      tabIndex: item.value === value ? 0 : -1,
      className: "hm-tab",
      onClick: () => {
        onChange(item.value);
      }
    }, item.label))
  );
}
function FallbackDisclosureRow({ icon, title, open, expandable, onToggle, headerAccessory, children }) {
  return h(
    "div",
    { className: "hm-disclosure" },
    h(
      "div",
      { className: "hm-disclosureHead" },
      h(
        "button",
        {
          type: "button",
          className: "hm-disclosureToggle",
          "aria-expanded": open ? "true" : "false",
          disabled: !expandable,
          onClick: () => {
            onToggle();
          }
        },
        icon != null ? h("span", { className: "hm-disclosureIcon", "aria-hidden": "true" }, icon) : null,
        h("span", { className: "hm-disclosureTitle" }, title),
        h("span", { className: "hm-disclosureChevron", "aria-hidden": "true" }, open ? "▾" : "▸")
      ),
      headerAccessory
    ),
    open ? h("div", { className: "hm-disclosureBody" }, children) : null
  );
}
function FallbackModal({ open, onClose, title, closeLabel, description, children, footer }) {
  React.useEffect(() => {
    if (!open) return void 0;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    if (typeof document !== "undefined") document.addEventListener("keydown", onKeyDown);
    return () => {
      if (typeof document !== "undefined") document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);
  if (!open) return null;
  return h(
    "div",
    { className: "hm-modalRoot", role: "presentation" },
    h("div", { className: "hm-modalMask", "aria-hidden": "true", onClick: onClose }),
    h(
      "div",
      { className: "hm-modalDialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      h(
        "div",
        { className: "hm-modalHeader" },
        h("h2", { className: "hm-modalTitle" }, title),
        h("button", { type: "button", className: "hm-modalClose", "aria-label": closeLabel, onClick: onClose }, "×")
      ),
      description != null ? h("p", { className: "hm-modalDescription" }, description) : null,
      h("div", { className: "hm-modalBody" }, children),
      footer != null ? h("div", { className: "hm-modalFooter" }, footer) : null
    )
  );
}
function FallbackTooltip({ label, children }) {
  if (typeof label !== "string" || label === "") return children;
  return h("span", { className: "hm-tip", title: label }, children);
}
var ICON_PATHS = {
  brain: [
    "M12 4.6C11.2 3.2 9.5 2.5 8 3.1 6.5 3.7 5.7 5.3 6.1 6.8 4.7 7.3 3.8 8.7 4 10.2c.1.8.5 1.5 1.1 2-1 .8-1.3 2.3-.6 3.4.5.8 1.4 1.3 2.3 1.3.4 1.7 2 2.9 3.7 2.7 1.1-.1 2-.7 2.5-1.6",
    "M12 4.6c.8-1.4 2.5-2.1 4-1.5 1.5.6 2.3 2.2 1.9 3.7 1.4.5 2.3 1.9 2.1 3.4-.1.8-.5 1.5-1.1 2 1 .8 1.3 2.3.6 3.4-.5.8-1.4 1.3-2.3 1.3-.4 1.7-2 2.9-3.7 2.7-1.1-.1-2-.7-2.5-1.6",
    "M12 4.6v15.2",
    "M9.6 7.4c.9.2 1.6.9 1.8 1.8M7.9 11.1c.8.1 1.5.6 1.9 1.3M9.3 15.2c.8 0 1.5.4 2 1",
    "M14.4 7.4c-.9.2-1.6.9-1.8 1.8M16.1 11.1c-.8.1-1.5.6-1.9 1.3M14.7 15.2c-.8 0-1.5.4-2 1"
  ],
  folder: ["M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M16 13H8M16 17H8M10 9H8"],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronLeft: ["m15 18-6-6 6-6"],
  chevronRight: ["m9 18 6-6-6-6"],
  check: ["M20 6 9 17l-5-5"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "M21 21l-4.35-4.35"],
  refresh: ["M23 4v6h-6", "M20.49 15a9 9 0 1 1-2.12-9.36L23 10"],
  hash: ["M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"]
};
function GitHubMark(props) {
  const size = typeof props.size === "number" ? props.size : 16;
  return h("svg", {
    className: props.className,
    viewBox: "0 0 16 16",
    width: size,
    height: size,
    fill: "currentColor",
    "aria-hidden": "true",
    focusable: "false"
  }, h("path", {
    d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
  }));
}
function Icon(props) {
  const name = props.name;
  const size = typeof props.size === "number" ? props.size : 16;
  const strokeWidth = typeof props.strokeWidth === "number" ? props.strokeWidth : 1.6;
  const paths = ICON_PATHS[name] ?? [];
  return h("svg", {
    className: props.className,
    style: props.style,
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    focusable: "false"
  }, paths.map((d, index) => h("path", { key: index, d })));
}
function FallbackSwitch(props) {
  const checked = props.checked === true;
  return h("button", {
    type: "button",
    role: "switch",
    "aria-checked": checked ? "true" : "false",
    "aria-label": props.label,
    title: props.title,
    disabled: props.disabled === true,
    className: "hm-switch",
    onClick: () => {
      if (props.disabled === true) return;
      if (typeof props.onChange === "function") props.onChange(!checked);
    }
  }, h(
    "span",
    { className: "hm-switchTrack", "data-on": checked ? "true" : "false" },
    h("span", { className: "hm-switchThumb" })
  ));
}
function fallbackRelativeTime(at, now) {
  const MINUTE = 6e4;
  const HOUR = 36e5;
  const DAY = 864e5;
  const diff = Math.max(0, now - at);
  if (diff < MINUTE) return { unit: "now", n: 0 };
  if (diff < HOUR) return { unit: "minutes", n: Math.floor(diff / MINUTE) };
  if (diff < DAY) return { unit: "hours", n: Math.floor(diff / HOUR) };
  if (diff < 30 * DAY) return { unit: "days", n: Math.floor(diff / DAY) };
  if (diff < 365 * DAY) return { unit: "months", n: Math.floor(diff / (30 * DAY)) };
  return { unit: "years", n: Math.floor(diff / (365 * DAY)) };
}
var ui = {
  Button: pick("Button", FallbackButton),
  Input: pick("Input", FallbackInput),
  Tag: pick("Tag", FallbackTag),
  StateDot: pick("StateDot", FallbackStateDot),
  SegmentedTabs: pick("SegmentedTabs", FallbackSegmentedTabs),
  DisclosureRow: pick("DisclosureRow", FallbackDisclosureRow),
  Modal: pick("Modal", FallbackModal),
  Tooltip: pick("Tooltip", FallbackTooltip),
  Switch: pick("Switch", FallbackSwitch),
  relativeTime: pick("relativeTime", fallbackRelativeTime),
  primitives: seed !== null
};
function useLocaleSubscription(props) {
  const subscribe = typeof props?.subscribeLocale === "function" ? props.subscribeLocale : emptySubscribe;
  const snapshot = typeof props?.localeSnapshot === "function" ? props.localeSnapshot : emptySnapshot;
  React.useSyncExternalStore(subscribe, snapshot, snapshot);
}
function emptySubscribe() {
  return () => {
  };
}
function emptySnapshot() {
  return "";
}
var PanelErrorBoundary = class extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
    this.reset = this.reset.bind(this);
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("hy-memory: panel render failed", error);
  }
  reset() {
    this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const t = typeof this.props.t === "function" ? this.props.t : null;
    const text = (key, fallback) => {
      try {
        const value = t?.(key);
        return typeof value === "string" && value !== key ? value : fallback;
      } catch {
        return fallback;
      }
    };
    return h(
      "section",
      { className: "hm-panel", role: "alert" },
      panelStyles(),
      h("h2", { className: "hm-h2" }, text("errorBoundary.title", "The memory panel hit an error")),
      h("p", { className: "hm-muted" }, text("errorBoundary.body", "The error is contained; the rest of Settings keeps working.")),
      h(
        "div",
        { className: "hm-row" },
        h("button", {
          type: "button",
          className: "hm-btn hm-btn-outline hm-btn-sm",
          onClick: this.reset
        }, text("errorBoundary.retry", "Retry"))
      )
    );
  }
};
function panelStyles() {
  return h("style", { key: "hy-memory-styles" }, PANEL_CSS);
}
function errorMessage(error) {
  if (error == null) return "unknown error";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message !== "") return error.message;
  return String(error);
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function asNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function normalizeItem(item) {
  const source = item !== null && typeof item === "object" ? item : {};
  return {
    id: typeof source.id === "string" ? source.id : String(source.id ?? ""),
    content: typeof source.content === "string" ? source.content : "",
    tier: typeof source.tier === "string" ? source.tier : "",
    layer: typeof source.layer === "string" ? source.layer : "",
    status: typeof source.status === "string" ? source.status : "",
    tags: Array.isArray(source.tags) ? source.tags.filter((tag) => typeof tag === "string") : [],
    createdAt: source.createdAt ?? null,
    updatedAt: source.updatedAt ?? null,
    score: typeof source.score === "number" ? source.score : void 0,
    projectKey: typeof source.projectKey === "string" ? source.projectKey : "",
    sessionId: typeof source.sessionId === "string" ? source.sessionId : ""
  };
}
function shortId(value, length = 8) {
  const text = typeof value === "string" ? value : "";
  if (text.length <= length) return text;
  return text.slice(0, length);
}
function stateLabel(t, state) {
  if (typeof state !== "string" || state === "") return t("state.unknown");
  const key = `state.${state}`;
  const value = t(key);
  return value === key ? state : value;
}
function dotState(state) {
  switch (state) {
    case "ready":
    case "done":
    case "ok":
    case "success":
      return "done";
    case "starting":
    case "running":
    case "pending":
      return "ongoing";
    case "error":
    case "failed":
      return "error";
    case "warning":
      return "warning";
    default:
      return "idle";
  }
}
function memoryTitle(content, fallback) {
  const text = typeof content === "string" ? content.replace(/\s+/g, " ").trim() : "";
  if (text === "") return fallback;
  const sentence = text.match(/^[^。！？.!?]*[。！？.!?]?/)?.[0]?.trim() ?? text;
  const base = sentence === "" ? text : sentence;
  return base.length > 40 ? base.slice(0, 40) : base;
}
async function copyToClipboard(content) {
  const text = typeof content === "string" ? content : "";
  try {
    if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText !== void 0) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
function timeText(t, at, now = Date.now()) {
  const value = typeof at === "number" ? at : Date.parse(typeof at === "string" ? at : "");
  if (!Number.isFinite(value)) return "";
  const relative = ui.relativeTime(value, now);
  return t(`time.${relative.unit}`, { n: relative.n });
}
function formatBytes(size) {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}
function dataDirSize(status) {
  const candidates = [
    status?.dataDirSize,
    status?.dataDir?.size,
    status?.storage?.dataDirSize,
    status?.storage?.size,
    status?.dataDirBytes
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) return formatBytes(candidate);
    if (typeof candidate === "string" && candidate !== "") return candidate;
  }
  return "";
}
function dataDirPath(status) {
  const candidates = [status?.dataDir, status?.dataDirPath, status?.storage?.dataDir, status?.storage?.dir];
  for (const candidate of candidates) if (typeof candidate === "string" && candidate !== "") return candidate;
  return "";
}
var PANEL_CSS = `
.hm-panel { display:flex; flex-direction:column; gap:16px; color:var(--dsw-alias-label-primary); font-size:13px; line-height:1.5; }
.hm-panel * { box-sizing:border-box; }
.hm-header { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.hm-headerSwitch { display:flex; align-items:center; gap:8px; flex:none; }
.hm-title { margin:0; font-size:17px; font-weight:600; color:var(--dsw-alias-label-primary); }
.hm-h2 { margin:0; font-size:14px; font-weight:600; color:var(--dsw-alias-label-primary); }
.hm-header { container-type:inline-size; }
.hm-subtitle {
  margin:4px 0 0;
  font-size:12px;
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
/* Narrow settings panels fold the description onto two lines instead of clipping. */
@container (max-width: 480px) {
  .hm-subtitle { white-space:normal; overflow:visible; text-overflow:clip; }
}
.hm-headerActions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.hm-counts { display:flex; align-items:center; gap:6px; flex-wrap:wrap; color:var(--dsw-alias-label-secondary); font-size:12px; }
.hm-card { border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1)); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
.hm-cardMissing { border-style:dashed; border-color:var(--dsw-alias-border-l2); }
.hm-cardHead { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.hm-memhubActions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.hm-memhubImport { display:flex; align-items:flex-end; gap:8px; flex-wrap:wrap; }
.hm-memhubImportField { display:flex; flex-direction:column; gap:4px; flex:1 1 260px; min-width:200px; }
.hm-memhubResult { display:flex; flex-direction:column; gap:4px; border-top:1px dashed var(--dsw-alias-border-l1); padding-top:8px; }
.hm-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:10px 18px; margin:0; }
.hm-field { display:flex; flex-direction:column; gap:2px; min-width:0; }
.hm-fieldLabel { font-size:11px; color:var(--dsw-alias-label-tertiary); }
.hm-fieldValue { display:flex; align-items:center; gap:6px; color:var(--dsw-alias-label-primary); font-size:12px; overflow-wrap:anywhere; }
.hm-mono { font-family:var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size:11px; color:var(--dsw-alias-label-secondary); }
.hm-pre { margin:0; padding:10px; border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-2)); color:var(--dsw-alias-label-secondary); font-family:var(--dsw-font-mono, ui-monospace, monospace); font-size:11px; max-height:260px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; }
.hm-banner { border:1px solid var(--dsw-alias-state-warn-primary); background:var(--dsw-alias-bg-layer-1); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
.hm-bannerText { display:flex; flex-direction:column; gap:2px; }
.hm-bannerText strong { font-size:13px; }
.hm-bannerText p { margin:0; font-size:12px; color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }
.hm-bannerActions { display:flex; gap:8px; flex-wrap:wrap; }
.hm-headerMain { display:flex; align-items:flex-start; gap:10px; min-width:0; }
.hm-switch { appearance:none; border:0; background:transparent; padding:0; cursor:pointer; display:inline-flex; align-items:center; }
.hm-switchTrack { position:relative; display:inline-block; width:34px; height:20px; border-radius:999px; background:var(--dsw-alias-border-l2); transition:background-color .12s ease; }
.hm-switchTrack[data-on="true"] { background:var(--dsw-alias-state-business-primary); }
.hm-switchThumb { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:var(--dsw-alias-switch-thumb); transition:transform .12s ease; }
.hm-switchTrack[data-on="true"] .hm-switchThumb { transform:translateX(14px); }
.hm-switch:focus-visible .hm-switchTrack { outline:1px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:2px; }
.hm-switch:disabled { opacity:.5; cursor:default; }
.hm-projectBar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.hm-picker { position:relative; display:inline-flex; }
.hm-pill { appearance:none; display:inline-flex; align-items:center; gap:6px; max-width:260px; height:28px; padding:0 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; cursor:pointer; }
.hm-pill:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-pillLabel { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hm-pillChevron { display:inline-flex; flex:none; color:var(--dsw-alias-label-tertiary); }
.hm-tabsRow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.hm-projectBar .hm-searchField { min-width:160px; }
.hm-pager { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding-top:2px; color:var(--dsw-alias-label-tertiary); font-size:11px; }
.hm-pagerNav { display:flex; align-items:center; gap:6px; }
.hm-pageButton { appearance:none; width:24px; height:24px; padding:0; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
.hm-pageButton:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.hm-pageButton:disabled { opacity:.45; cursor:default; }
.hm-pagerStatus { min-width:56px; text-align:center; font-size:11px; color:var(--dsw-alias-label-secondary); }
.hm-pagerSize { display:inline-flex; align-items:center; gap:6px; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.hm-footer { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding-top:2px; }
.hm-footerLink { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; flex:none; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); text-decoration:none; }
.hm-footerLink:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.hm-footerLeft { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
.hm-updateNotice { display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; min-width:0; }
.hm-updatePill { display:inline-flex; align-items:center; padding:2px 8px; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-link); font-size:11px; text-decoration:none; }
.hm-updatePill:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-updateHint { font-size:11px; color:var(--dsw-alias-label-tertiary); }
.hm-footerRight { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-left:auto; }
.hm-footerResult { font-size:11px; color:var(--dsw-alias-label-secondary); }
.hm-footerResult a { color:var(--dsw-alias-link); text-decoration:none; }
.hm-footerResult a:hover { text-decoration:underline; }
.hm-contextLine { margin:0; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.hm-countLine { margin:0; font-size:11px; color:var(--dsw-alias-label-secondary); }
.hm-dupeRow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding-top:2px; }
.hm-dupeHint { font-size:11px; color:var(--dsw-alias-label-secondary); }
.hm-select { appearance:none; border:1px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-sm, 7px); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:11px; padding:2px 6px; cursor:pointer; }
.hm-select:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
.hm-pillIcon { display:inline-flex; flex:none; color:var(--dsw-alias-label-tertiary); }
.hm-divider { width:1px; height:16px; flex:none; background:var(--dsw-alias-border-l2); }
.hm-projectCount { font-size:12px; color:var(--dsw-alias-label-secondary); white-space:nowrap; }
.hm-menuCard { position:absolute; z-index:20; top:calc(100% + 6px); left:0; min-width:210px; max-height:280px; overflow:auto; padding:6px; border:1px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md, 10px); background:var(--dsw-alias-bg-layer-3); box-shadow:0 12px 32px var(--dsw-alias-bg-mask-drop); display:flex; flex-direction:column; gap:2px; }
.hm-menuTitle { padding:4px 8px 6px; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.hm-menuItem { appearance:none; width:100%; border:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; text-align:left; display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:var(--dsw-radius-sm, 7px); cursor:pointer; }
.hm-menuItem:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-menuItemIcon { display:inline-flex; flex:none; color:var(--dsw-alias-label-tertiary); }
.hm-menuItemLabel { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hm-menuItemCheck { display:inline-flex; flex:none; color:var(--dsw-alias-label-primary); }
.hm-menuEmpty { padding:10px 8px; font-size:12px; color:var(--dsw-alias-label-secondary); }
.hm-searchField { margin-left:auto; display:flex; align-items:center; gap:6px; min-width:180px; max-width:280px; height:28px; padding:0 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-tertiary); }
.hm-searchField:focus-within { border-color:var(--dsw-alias-brand-primary); }
.hm-searchInput { flex:1 1 auto; min-width:0; appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; padding:0; }
.hm-searchInput::placeholder { color:var(--dsw-alias-label-tertiary); }
.hm-searchInput:focus { outline:none; }
.hm-filesHead { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.hm-filesTitle { margin:0; font-size:12px; font-weight:600; letter-spacing:.02em; color:var(--dsw-alias-label-secondary); }
.hm-iconButton { appearance:none; width:26px; height:26px; padding:0; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
.hm-iconButton:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.hm-iconButton:focus-visible { outline:1px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:2px; }
.hm-files { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.hm-file { position:relative; display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dsw-radius-lg, 14px); background:var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2)); }
.hm-file:hover { border-color:var(--dsw-alias-border-l2); }
.hm-fileIcon { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; flex:none; border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dsw-radius-md, 9px); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-tertiary); }
.hm-fileText { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 1 auto; }
.hm-fileTitle { margin:0; font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hm-fileDate { margin:0; font-size:11px; color:var(--dsw-alias-label-tertiary); display:flex; align-items:center; gap:6px; }
.hm-fileStatus { color:var(--dsw-alias-state-success-primary); }
.hm-fileActions { position:relative; flex:none; }
.hm-fileAction { appearance:none; width:26px; height:26px; padding:0; border:0; border-radius:999px; background:transparent; color:var(--dsw-alias-label-tertiary); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
.hm-fileAction:hover, .hm-fileAction[aria-expanded="true"] { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.hm-fileActions .hm-menuCard { left:auto; right:0; min-width:160px; }
.hm-actionItem { appearance:none; width:100%; border:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; text-align:left; padding:6px 10px; border-radius:var(--dsw-radius-sm, 7px); cursor:pointer; }
.hm-actionItem:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-actionItem-danger { color:var(--dsw-alias-state-error-primary); }
.hm-sessionBar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.hm-groupHead { display:flex; align-items:center; gap:8px; margin:2px 0 6px; }
.hm-groupLabel { display:inline-flex; align-items:center; gap:6px; margin:0; font-size:12px; font-weight:600; color:var(--dsw-alias-label-secondary); }
.hm-fileEditor { display:flex; flex-direction:column; gap:8px; }
.hm-fileEditorActions { display:flex; align-items:center; gap:6px; }
.hm-tabs { display:flex; gap:4px; background:var(--dsw-alias-bg-layer-2); border-radius:9px; padding:3px; width:max-content; max-width:100%; }
.hm-tab { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; padding:5px 14px; border-radius:7px; cursor:pointer; }
.hm-tab[aria-selected="true"] { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); box-shadow:0 1px 2px var(--dsw-alias-bg-mask-1); }
.hm-panelBody { display:flex; flex-direction:column; gap:12px; }
.hm-rows { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.hm-rowCard { border:1px solid var(--dsw-alias-border-l1); border-radius:9px; background:var(--dsw-alias-bg-layer-1); padding:10px 12px; display:flex; flex-direction:column; gap:6px; }
.hm-content { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
.hm-meta { display:flex; align-items:center; gap:6px; flex-wrap:wrap; color:var(--dsw-alias-label-tertiary); font-size:11px; }
.hm-rowActions { display:flex; align-items:center; gap:6px; }
.hm-group { display:flex; flex-direction:column; gap:8px; }
.hm-block { display:flex; flex-direction:column; gap:8px; }
.hm-blockHead { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:2px; }
.hm-blockTitle { margin:0; font-size:12px; font-weight:600; letter-spacing:.02em; color:var(--dsw-alias-label-secondary); }
.hm-groupTitle { margin:4px 0 0; font-size:12px; font-weight:600; color:var(--dsw-alias-label-secondary); display:flex; align-items:center; gap:6px; }
.hm-textarea { width:100%; min-height:76px; resize:vertical; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; padding:8px 10px; }
.hm-textarea:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
.hm-state { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary); font-size:12px; padding:14px 4px; }
.hm-empty { display:flex; flex-direction:column; gap:4px; border:1px dashed var(--dsw-alias-border-l2); border-radius:9px; padding:18px 14px; color:var(--dsw-alias-label-secondary); font-size:12px; text-align:center; }
.hm-emptyHint { color:var(--dsw-alias-label-tertiary); font-size:11px; }
.hm-error { margin:0; color:var(--dsw-alias-state-error-primary); font-size:12px; overflow-wrap:anywhere; }
.hm-errorRow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.hm-muted { margin:0; color:var(--dsw-alias-label-secondary); font-size:12px; }
.hm-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.hm-disclosure { border:1px solid var(--dsw-alias-border-l1); border-radius:9px; background:var(--dsw-alias-bg-layer-1); }
.hm-disclosureHead { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; }
.hm-disclosureToggle { appearance:none; background:transparent; border:0; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; display:flex; align-items:center; gap:8px; cursor:pointer; padding:0; }
.hm-disclosureTitle { color:var(--dsw-alias-label-primary); font-weight:600; }
.hm-disclosureBody { display:flex; flex-direction:column; gap:8px; padding:0 12px 12px; }
.hm-activity { display:flex; flex-direction:column; gap:6px; max-height:260px; overflow:auto; }
.hm-activityRow { display:flex; align-items:flex-start; gap:8px; font-size:12px; }
.hm-activitySummary { color:var(--dsw-alias-label-primary); overflow-wrap:anywhere; }
.hm-activityTime { margin-left:auto; color:var(--dsw-alias-label-tertiary); font-size:11px; white-space:nowrap; }
.hm-activityDetail { margin:0; color:var(--dsw-alias-label-tertiary); font-size:11px; overflow-wrap:anywhere; }
.hm-tag { display:inline-flex; align-items:center; padding:1px 7px; border-radius:999px; border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); font-size:11px; }
.hm-tag[data-tone="neutral"] { background:var(--dsw-alias-bg-layer-2); }
.hm-tag[data-tone="info"] { border-color:var(--dsw-alias-link); color:var(--dsw-alias-link); }
.hm-tag[data-tone="danger"] { border-color:var(--dsw-alias-state-error-primary); color:var(--dsw-alias-state-error-primary); }
.hm-tag[data-tone="success"] { border-color:var(--dsw-alias-state-success-primary); color:var(--dsw-alias-state-success-primary); }
.hm-dot { display:inline-block; width:8px; height:8px; border-radius:999px; background:var(--dsw-alias-state-idle-primary); flex:none; }
.hm-dot[data-state="done"] { background:var(--dsw-alias-state-done-primary); }
.hm-dot[data-state="ongoing"] { background:var(--dsw-alias-state-warn-primary); }
.hm-dot[data-state="warning"] { background:var(--dsw-alias-state-warn-primary); }
.hm-dot[data-state="error"] { background:var(--dsw-alias-state-error-primary); }
.hm-btn { appearance:none; border:1px solid transparent; border-radius:8px; font:inherit; font-size:12px; padding:5px 12px; cursor:pointer; background:transparent; color:var(--dsw-alias-label-primary); display:inline-flex; align-items:center; gap:6px; }
.hm-btn-sm { padding:3px 9px; font-size:11px; border-radius:7px; }
.hm-btn-ghost:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-btn-outline { border-color:var(--dsw-alias-border-l2); }
.hm-btn-outline:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-btn-primary { background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground); }
.hm-btn-primary:hover { background:var(--dsw-alias-button-primary-hover); }
.hm-btn:disabled { opacity:.5; cursor:default; }
.hm-inputWrap { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); padding:0 8px; min-height:28px; }
.hm-input { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; padding:4px 0; width:100%; min-width:120px; }
.hm-input:focus { outline:none; }
.hm-modalRoot { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:24px; }
.hm-modalMask { position:absolute; inset:0; background:var(--dsw-alias-bg-mask-2); }
.hm-modalDialog { position:relative; width:min(420px, 100%); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:12px; box-shadow:0 18px 48px var(--dsw-alias-bg-mask-drop); padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
.hm-modalHeader { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.hm-modalTitle { margin:0; font-size:14px; font-weight:600; }
.hm-modalClose { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-secondary); font-size:18px; line-height:1; cursor:pointer; padding:2px 6px; border-radius:6px; }
.hm-modalClose:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-modalDescription { margin:0; font-size:12px; color:var(--dsw-alias-label-secondary); }
.hm-modalBody { font-size:12px; color:var(--dsw-alias-label-secondary); }
.hm-modalFooter { display:flex; justify-content:flex-end; gap:8px; }
.hm-tip { display:inline-flex; min-width:0; }
.hm-sessionPanel { gap:14px; }
.hm-sectionTitle { margin:0; font-size:13px; font-weight:600; }
`;

// client-src/panel.js
var TIERS = ["personal", "project", "session"];
var ACTIVITY_LIMIT = 60;
var ACTIVITY_INTERVAL_MS = 3e3;
var PAGE_SIZES = [10, 20, 50];
var DEFAULT_PAGE_SIZE = 20;
var PAGED_LISTS = ["personal", "project", "session"];
var autoUpdateChecked = false;
var COPY_FEEDBACK_MS = 2e3;
function emptyList() {
  return { loading: true, error: "", items: [], total: 0, fallback: false };
}
function emptyLists() {
  return { personal: emptyList(), project: emptyList(), session: emptyList() };
}
function emptyPicker() {
  return { loading: true, error: "", items: [] };
}
function normalizeProject(item) {
  const source = item !== null && typeof item === "object" ? item : {};
  return {
    key: typeof source.key === "string" ? source.key : String(source.key ?? ""),
    title: typeof source.title === "string" ? source.title : ""
  };
}
function normalizeSession(item) {
  const source = item !== null && typeof item === "object" ? item : {};
  return {
    sessionId: typeof source.sessionId === "string" ? source.sessionId : String(source.sessionId ?? "")
  };
}
function normalizeEvent(event) {
  const source = event !== null && typeof event === "object" ? event : {};
  return {
    at: source.at ?? null,
    kind: typeof source.kind === "string" ? source.kind : "error",
    tier: typeof source.tier === "string" ? source.tier : "",
    summary: typeof source.summary === "string" ? source.summary : "",
    detail: typeof source.detail === "string" ? source.detail : "",
    ok: source.ok !== false
  };
}
function kindLabel(t, kind) {
  const key = `activity.kind.${kind}`;
  const value = t(key);
  return value === key ? kind : value;
}
function tierLabel(t, tier) {
  if (!TIERS.includes(tier)) return tier;
  return t(`tabs.${tier}`);
}
function activityTierLabel(t, tier) {
  if (tier !== "personal" && tier !== "project" && tier !== "session") return "";
  return t(`activity.tier.${tier}`);
}
function mergeNewEvents(current, incoming) {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((event) => `${String(event.at)}|${event.kind}|${event.summary}`));
  const fresh = incoming.filter((event) => !seen.has(`${String(event.at)}|${event.kind}|${event.summary}`));
  return [...fresh, ...current].slice(0, ACTIVITY_LIMIT);
}
function ActivityPanel(props) {
  const t = props.t;
  const [events, setEvents] = React2.useState([]);
  const [error, setError] = React2.useState("");
  const [loading, setLoading] = React2.useState(true);
  const [open, setOpen] = React2.useState(false);
  const [tick, setTick] = React2.useState(0);
  const [now, setNow] = React2.useState(() => Date.now());
  React2.useEffect(() => {
    let cancelled = false;
    let timer = null;
    let cursor;
    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const data = await api.activity(cursor);
        if (cancelled) return;
        cursor = typeof data?.cursor === "string" || typeof data?.cursor === "number" ? data.cursor : cursor;
        const incoming = asArray(data?.events).map(normalizeEvent);
        setEvents((prev) => mergeNewEvents(prev, incoming));
        setError("");
        setLoading(false);
        setNow(Date.now());
      } catch (pollError) {
        if (cancelled) return;
        setError(errorMessage(pollError));
        setLoading(false);
      }
    };
    void poll();
    timer = setInterval(() => {
      void poll();
    }, ACTIVITY_INTERVAL_MS);
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") void poll();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tick]);
  const rows = events.map((event, index) => h(
    "div",
    {
      key: `${String(event.at)}|${event.kind}|${index}`,
      className: "hm-activityRow"
    },
    h(ui.StateDot, { state: event.ok ? dotState(event.kind === "error" ? "error" : "done") : "error" }),
    h(
      "div",
      null,
      h(
        "div",
        { className: "hm-activitySummary" },
        h(ui.Tag, { tone: event.kind === "error" || !event.ok ? "danger" : "outline" }, kindLabel(t, event.kind)),
        " ",
        event.tier !== "" ? h(ui.Tag, { tone: "quiet" }, activityTierLabel(t, event.tier)) : null,
        " ",
        event.summary
      ),
      event.detail !== "" ? h("p", { className: "hm-activityDetail" }, event.detail) : null
    ),
    h("span", { className: "hm-activityTime" }, timeText(t, event.at, now))
  ));
  let body;
  if (loading) {
    body = h("div", { className: "hm-state" }, h(ui.StateDot, { state: "ongoing" }), t("common.loading"));
  } else if (error !== "") {
    body = h(
      "div",
      { className: "hm-empty", role: "alert" },
      h("p", { className: "hm-error" }, t("activity.error", { message: error })),
      h(
        "div",
        { className: "hm-row" },
        h(ui.Button, { size: "sm", variant: "outline", onClick: () => {
          setTick((value) => value + 1);
        } }, t("common.retry"))
      )
    );
  } else if (rows.length === 0) {
    body = h("div", { className: "hm-empty" }, t("activity.empty"));
  } else {
    body = h("div", { className: "hm-activity" }, rows);
  }
  return h(ui.DisclosureRow, {
    icon: h(ui.StateDot, { state: error !== "" ? "error" : events.length > 0 ? "done" : "idle" }),
    title: events.length > 0 ? `${t("activity.title")} (${events.length})` : t("activity.title"),
    open,
    expandable: true,
    onToggle: () => {
      setOpen((value) => !value);
    },
    headerAccessory: h("span", { className: "hm-meta" }, t("activity.hint"))
  }, body);
}
var MEMHUB_ERROR_KEYS = Object.freeze({
  memhub_locked: "memhub.error.memhub_locked",
  embedding_mismatch: "memhub.error.embedding_mismatch",
  not_found: "memhub.error.not_found",
  // The host's import/pull routes use these codes for the same two situations.
  import_missing: "memhub.error.import_missing",
  memhub_not_detected: "memhub.error.memhub_not_detected"
});
function isAbsolutePath(value) {
  if (typeof value !== "string" || value === "") return false;
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}
function memhubErrorText(t, error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const key = MEMHUB_ERROR_KEYS[code];
  if (key !== void 0) {
    const text = t(key);
    if (typeof text === "string" && text !== key) return text;
  }
  return t("memhub.error.generic", { message: errorMessage(error) });
}
function MemhubCard(props) {
  const t = props.t;
  const memhub = props.memhub ?? null;
  const onImported = props.onImported;
  const [busy, setBusy] = React2.useState("");
  const [result, setResult] = React2.useState(null);
  const [importOpen, setImportOpen] = React2.useState(false);
  const [importPath, setImportPath] = React2.useState("");
  const [pathError, setPathError] = React2.useState(false);
  const [detailsOpen, setDetailsOpen] = React2.useState(false);
  const detected = memhub !== null && memhub.detected === true;
  const detectedPath = typeof memhub?.path === "string" ? memhub.path : "";
  const detectedSize = formatBytes(memhub?.sizeBytes);
  if (memhub === null) return null;
  if (detected !== true) {
    return h(
      "section",
      { className: "hm-card hm-cardMissing" },
      h(
        "div",
        { className: "hm-cardHead" },
        h("h2", { className: "hm-h2" }, t("memhub.title"))
      ),
      h("p", { className: "hm-muted" }, t("memhub.missing"))
    );
  }
  const run = async (kind) => {
    if (busy !== "") return;
    if (kind === "import") {
      const target = importPath.trim();
      if (isAbsolutePath(target) === false) {
        setPathError(true);
        return;
      }
      setPathError(false);
      setBusy(kind);
      setResult(null);
      try {
        const data = await api.memhubImport(target);
        setResult({ kind, data: data ?? {} });
        setImportOpen(false);
        setImportPath("");
        if (typeof onImported === "function") onImported();
      } catch (error) {
        setResult({ kind, error });
      } finally {
        setBusy("");
      }
      return;
    }
    setBusy(kind);
    setResult(null);
    try {
      const data = kind === "export" ? await api.memhubExport() : await api.memhubPull();
      setResult({ kind, data: data ?? {} });
      if (kind === "pull" && typeof onImported === "function") onImported();
    } catch (error) {
      setResult({ kind, error });
    } finally {
      setBusy("");
    }
  };
  const renderResult = () => {
    if (result === null) return null;
    if (result.error !== void 0) {
      return h("p", { className: "hm-error", role: "alert" }, memhubErrorText(t, result.error));
    }
    const data = result.data ?? {};
    if (result.kind === "export") {
      const bytes = formatBytes(data.bytes);
      return h(
        "div",
        { className: "hm-memhubResult" },
        h("p", { className: "hm-muted", role: "status" }, t("memhub.result.export", {
          count: asNumber(data.count),
          path: typeof data.path === "string" ? data.path : ""
        })),
        bytes !== "" ? h("span", { className: "hm-meta" }, bytes) : null
      );
    }
    return h(
      "div",
      { className: "hm-memhubResult" },
      h("p", { className: "hm-muted", role: "status" }, t(
        result.kind === "pull" ? "memhub.result.pull" : "memhub.result.import",
        {
          imported: asNumber(data.imported),
          skipped: asNumber(data.skipped),
          failed: asNumber(data.failed)
        }
      )),
      typeof data.path === "string" && data.path !== "" ? h("span", { className: "hm-meta hm-mono" }, t("memhub.result.path", { path: data.path })) : null
    );
  };
  const actionButton = (kind, label, busyLabel, onClick, variant) => h(ui.Button, {
    key: kind,
    size: "sm",
    variant,
    disabled: busy !== "",
    onClick
  }, busy === kind ? busyLabel : label);
  const actions = h(
    "div",
    { className: "hm-memhubActions" },
    actionButton("export", t("memhub.export"), t("memhub.exporting"), () => {
      void run("export");
    }, "outline"),
    actionButton("pull", t("memhub.pull"), t("memhub.pulling"), () => {
      void run("pull");
    }, "outline"),
    h(ui.Button, {
      key: "import",
      size: "sm",
      variant: importOpen ? "ghost" : "outline",
      disabled: busy !== "",
      onClick: () => {
        setPathError(false);
        setImportOpen((value) => !value);
      }
    }, t("memhub.import"))
  );
  const importForm = importOpen ? h(
    "div",
    { className: "hm-memhubImport" },
    h(
      "div",
      { className: "hm-memhubImportField" },
      h("span", { className: "hm-fieldLabel" }, t("memhub.importPath")),
      h(ui.Input, {
        type: "text",
        value: importPath,
        placeholder: t("memhub.importPathPlaceholder"),
        "aria-label": t("memhub.importPath"),
        onChange: (event) => {
          setImportPath(event.target.value);
          setPathError(false);
        }
      })
    ),
    h(ui.Button, {
      size: "sm",
      variant: "primary",
      disabled: busy !== "",
      onClick: () => {
        void run("import");
      }
    }, busy === "import" ? t("memhub.importing") : t("memhub.importConfirm")),
    h(ui.Button, {
      size: "sm",
      variant: "ghost",
      onClick: () => {
        setImportOpen(false);
        setPathError(false);
      }
    }, t("memhub.importCancel"))
  ) : null;
  const fields = [
    h(
      "div",
      { key: "state", className: "hm-field" },
      h("span", { className: "hm-fieldLabel" }, t("memhub.state")),
      h(
        "span",
        { className: "hm-fieldValue" },
        h(ui.StateDot, { state: "done" }),
        t("memhub.detected")
      )
    )
  ];
  const details = [];
  if (detectedPath !== "") {
    details.push(h(
      "div",
      { key: "path", className: "hm-field" },
      h("span", { className: "hm-fieldLabel" }, t("memhub.path")),
      h("span", { className: "hm-fieldValue hm-mono" }, detectedPath)
    ));
  }
  if (detectedSize !== "" && asNumber(memhub?.sizeBytes) > 0) {
    details.push(h(
      "div",
      { key: "size", className: "hm-field" },
      h("span", { className: "hm-fieldLabel" }, t("memhub.size")),
      h("span", { className: "hm-fieldValue" }, detectedSize)
    ));
  }
  return h(
    "section",
    { className: "hm-card" },
    h(
      "div",
      { className: "hm-cardHead" },
      h("h2", { className: "hm-h2" }, t("memhub.title")),
      h(ui.Button, {
        size: "sm",
        variant: "ghost",
        onClick: () => {
          setDetailsOpen((value) => !value);
        }
      }, detailsOpen ? t("common.hideDetails") : t("common.details"))
    ),
    h("dl", { className: "hm-grid" }, fields),
    actions,
    importForm,
    pathError ? h("p", { className: "hm-error", role: "alert" }, t("memhub.pathRequired")) : null,
    renderResult(),
    detailsOpen ? h(
      React2.Fragment,
      null,
      h("p", { className: "hm-muted" }, t("memhub.explain")),
      details.length > 0 ? h("dl", { className: "hm-grid" }, details) : null
    ) : null
  );
}
function useEscapeToClose(open, close) {
  React2.useEffect(() => {
    if (open !== true) return void 0;
    if (typeof document === "undefined") return void 0;
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);
}
function PickerPill(props) {
  const [open, setOpen] = React2.useState(false);
  const close = React2.useCallback(() => {
    setOpen(false);
  }, []);
  useEscapeToClose(open, close);
  const rows = props.items.map((item) => {
    const selected = item.key === props.selected;
    return h(
      "button",
      {
        key: item.key,
        type: "button",
        role: "menuitemradio",
        "aria-checked": selected ? "true" : "false",
        className: "hm-menuItem",
        onClick: () => {
          setOpen(false);
          props.onSelect(item.key);
        }
      },
      h("span", { className: "hm-menuItemIcon" }, h(Icon, { name: props.icon, size: 15 })),
      h("span", { className: "hm-menuItemLabel" }, item.title),
      selected ? h("span", { className: "hm-menuItemCheck" }, h(Icon, { name: "check", size: 14 })) : null
    );
  });
  return h(
    "div",
    { className: "hm-picker" },
    h(
      "button",
      {
        type: "button",
        className: "hm-pill",
        "aria-haspopup": "menu",
        "aria-expanded": open ? "true" : "false",
        "aria-label": props.ariaLabel,
        onClick: () => {
          setOpen((value) => !value);
        }
      },
      h("span", { className: "hm-pillIcon" }, h(Icon, { name: props.icon, size: 15 })),
      h("span", { className: "hm-pillLabel" }, props.label),
      h("span", { className: "hm-pillChevron" }, h(Icon, { name: "chevronDown", size: 14 }))
    ),
    open ? h(
      "div",
      { className: "hm-menuCard", role: "menu", "aria-label": props.title },
      h("div", { className: "hm-menuTitle" }, props.title),
      rows.length > 0 ? rows : h("div", { className: "hm-menuEmpty" }, props.emptyText)
    ) : null
  );
}
function FileRow(props) {
  const t = props.t;
  const [open, setOpen] = React2.useState(false);
  const close = React2.useCallback(() => {
    setOpen(false);
  }, []);
  useEscapeToClose(open, close);
  const meta = [];
  if (props.date !== "") meta.push(h("span", { key: "date" }, props.date));
  if (props.status !== "") meta.push(h("span", { key: "status", className: "hm-fileStatus", role: "status" }, props.status));
  return h(
    "li",
    { className: "hm-file" },
    h("span", { className: "hm-fileIcon", "aria-hidden": "true" }, h(Icon, { name: "file", size: 17 })),
    h(
      "div",
      { className: "hm-fileText" },
      h("p", { className: "hm-fileTitle", title: props.title }, props.title),
      meta.length > 0 ? h("p", { className: "hm-fileDate" }, meta) : null
    ),
    h(
      "div",
      { className: "hm-fileActions" },
      h("button", {
        type: "button",
        className: "hm-fileAction",
        "aria-label": t("row.actions"),
        "aria-haspopup": "menu",
        "aria-expanded": open ? "true" : "false",
        onClick: () => {
          setOpen((value) => !value);
        }
      }, h(Icon, { name: "chevronDown", size: 16 })),
      open ? h(
        "div",
        { className: "hm-menuCard", role: "menu" },
        props.actions.map((action) => h("button", {
          key: action.key,
          type: "button",
          role: "menuitem",
          className: `hm-actionItem${action.danger === true ? " hm-actionItem-danger" : ""}`,
          onClick: () => {
            setOpen(false);
            action.onSelect();
          }
        }, action.label))
      ) : null
    )
  );
}
function SettingsSection(props) {
  const t = typeof props.t === "function" ? props.t : typeof props.translate === "function" ? props.translate : (key) => key;
  useLocaleSubscription(props);
  const [tab, setTab] = React2.useState("personal");
  const [status, setStatus] = React2.useState(null);
  const [statusLoading, setStatusLoading] = React2.useState(true);
  const [statusError, setStatusError] = React2.useState("");
  const [starting, setStarting] = React2.useState(false);
  const [startError, setStartError] = React2.useState("");
  const [query, setQuery] = React2.useState("");
  const [searchQuery, setSearchQuery] = React2.useState("");
  const [lists, setLists] = React2.useState(emptyLists);
  const [refreshTick, setRefreshTick] = React2.useState(0);
  const [paging, setPaging] = React2.useState(() => ({
    personal: { page: 1, size: DEFAULT_PAGE_SIZE },
    project: { page: 1, size: DEFAULT_PAGE_SIZE },
    session: { page: 1, size: DEFAULT_PAGE_SIZE }
  }));
  const [editing, setEditing] = React2.useState(null);
  const [savingId, setSavingId] = React2.useState("");
  const [savedId, setSavedId] = React2.useState("");
  const [rowError, setRowError] = React2.useState(null);
  const [deleteTarget, setDeleteTarget] = React2.useState(null);
  const [forgetTarget, setForgetTarget] = React2.useState(null);
  const [forgetting, setForgetting] = React2.useState(false);
  const [forgetError, setForgetError] = React2.useState("");
  const [dupeBusy, setDupeBusy] = React2.useState("");
  const [dupeScan, setDupeScan] = React2.useState(null);
  const [dupeOpen, setDupeOpen] = React2.useState(false);
  const [dupeDone, setDupeDone] = React2.useState(null);
  const [dupeError, setDupeError] = React2.useState("");
  const [why, setWhy] = React2.useState(null);
  const [whyLoading, setWhyLoading] = React2.useState(false);
  const [whyError, setWhyError] = React2.useState("");
  const [deleting, setDeleting] = React2.useState(false);
  const [deleteError, setDeleteError] = React2.useState("");
  const [diagOpen, setDiagOpen] = React2.useState(false);
  const [projects, setProjects] = React2.useState(emptyPicker);
  const [projectChoice, setProjectChoice] = React2.useState(null);
  const [sessions, setSessions] = React2.useState(emptyPicker);
  const [sessionChoice, setSessionChoice] = React2.useState(null);
  const [checking, setChecking] = React2.useState(false);
  const [updateResult, setUpdateResult] = React2.useState(null);
  const [autoUpdate, setAutoUpdate] = React2.useState(null);
  const [masterBusy, setMasterBusy] = React2.useState(false);
  const [masterError, setMasterError] = React2.useState("");
  const [copiedId, setCopiedId] = React2.useState("");
  const [copyFailedId, setCopyFailedId] = React2.useState("");
  const savedTimer = React2.useRef(null);
  const copyTimer = React2.useRef(null);
  const now = Date.now();
  const refresh = React2.useCallback(() => {
    setRefreshTick((value) => value + 1);
  }, []);
  React2.useEffect(() => () => {
    if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
  }, []);
  React2.useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    setStatusError("");
    const read = refreshTick === 0 ? api.loadStatus() : api.readStatus();
    read.then((data) => {
      if (cancelled) return;
      setStatus(data ?? null);
      setStatusLoading(false);
    }).catch((error) => {
      if (cancelled) return;
      setStatusError(errorMessage(error));
      setStatusLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);
  const statusProjectKey = typeof status?.project?.key === "string" ? status.project.key : "";
  const statusProjectTitle = typeof status?.project?.title === "string" ? status.project.title : "";
  const currentSessionId = typeof status?.session?.id === "string" ? status.session.id : "";
  const projectKey = typeof projectChoice === "string" && projectChoice !== "" ? projectChoice : statusProjectKey;
  const sessionFilter = typeof sessionChoice === "string" ? sessionChoice : "";
  const masterOff = status?.enabled === false;
  React2.useEffect(() => {
    if (masterOff || autoUpdateChecked) return void 0;
    autoUpdateChecked = true;
    let cancelled = false;
    void api.updateCheck(false).then((data) => {
      if (cancelled || data === null || typeof data !== "object") return;
      setAutoUpdate({
        latest: typeof data.latest === "string" ? data.latest : "",
        behind: data.behind === true,
        url: typeof data.url === "string" ? data.url : "",
        error: typeof data.error === "string" ? data.error : ""
      });
    }).catch(() => {
    });
    return () => {
      cancelled = true;
    };
  }, [masterOff]);
  React2.useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(query.trim());
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);
  React2.useEffect(() => {
    if (masterOff) return void 0;
    let cancelled = false;
    setProjects((prev) => ({ ...prev, loading: true, error: "" }));
    api.projects().then((data) => {
      if (cancelled) return;
      const items = asArray(data?.items).map(normalizeProject).filter((item) => item.key !== "");
      const current = typeof data?.current === "string" ? data.current : "";
      setProjects({ loading: false, error: "", items });
      setProjectChoice((prev) => typeof prev === "string" && prev !== "" ? prev : current);
    }).catch((error) => {
      if (cancelled) return;
      setProjects({ loading: false, error: errorMessage(error), items: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTick, masterOff]);
  React2.useEffect(() => {
    if (masterOff || tab !== "project") return void 0;
    if (projectKey === "") {
      setSessions({ loading: false, error: "", items: [] });
      return void 0;
    }
    let cancelled = false;
    setSessions((prev) => ({ ...prev, loading: true, error: "" }));
    api.sessions(projectKey).then((data) => {
      if (cancelled) return;
      const items = asArray(data?.items).map(normalizeSession).filter((item) => item.sessionId !== "");
      setSessions({ loading: false, error: "", items });
    }).catch((error) => {
      if (cancelled) return;
      setSessions({ loading: false, error: errorMessage(error), items: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [tab, projectKey, refreshTick, masterOff]);
  const listRequest = (key, extra) => {
    const { page, size } = paging[key];
    const request2 = { limit: size, offset: (page - 1) * size, ...extra };
    return searchQuery === "" ? api.list(request2) : api.list({ ...request2, query: searchQuery });
  };
  React2.useEffect(() => {
    if (masterOff || tab !== "personal") return void 0;
    let cancelled = false;
    setLists((prev) => ({ ...prev, personal: { ...prev.personal, loading: true, error: "", fallback: false } }));
    void (async () => {
      try {
        const data = await listRequest("personal", { tier: "personal" });
        if (cancelled) return;
        const items = asArray(data?.items).map(normalizeItem);
        setLists((prev) => ({
          ...prev,
          personal: { loading: false, error: "", items, total: asNumber(data?.total, items.length), fallback: false }
        }));
      } catch (error) {
        if (cancelled) return;
        setLists((prev) => ({
          ...prev,
          personal: { loading: false, error: errorMessage(error), items: [], total: 0, fallback: false }
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, masterOff, searchQuery, refreshTick, paging.personal]);
  React2.useEffect(() => {
    if (masterOff || tab !== "project") return void 0;
    let cancelled = false;
    const scope = projectKey === "" ? {} : { projectKey };
    setLists((prev) => ({ ...prev, project: { ...prev.project, loading: true, error: "", fallback: false } }));
    void (async () => {
      try {
        const data = await listRequest("project", { tier: "project", ...scope });
        if (cancelled) return;
        const items = asArray(data?.items).map(normalizeItem);
        setLists((prev) => ({
          ...prev,
          project: { loading: false, error: "", items, total: asNumber(data?.total, items.length), fallback: false }
        }));
      } catch (error) {
        if (cancelled) return;
        setLists((prev) => ({
          ...prev,
          project: { loading: false, error: errorMessage(error), items: [], total: 0, fallback: false }
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, masterOff, searchQuery, refreshTick, projectKey, paging.project]);
  React2.useEffect(() => {
    if (masterOff || tab !== "project") return void 0;
    let cancelled = false;
    const scope = projectKey === "" ? {} : { projectKey };
    setLists((prev) => ({ ...prev, session: { ...prev.session, loading: true, error: "", fallback: false } }));
    void (async () => {
      try {
        const data = await listRequest("session", { tier: "session", sessionId: sessionFilter, ...scope });
        if (cancelled) return;
        const items = asArray(data?.items).map(normalizeItem);
        setLists((prev) => ({
          ...prev,
          session: { loading: false, error: "", items, total: asNumber(data?.total, items.length), fallback: false }
        }));
      } catch (error) {
        if (cancelled) return;
        setLists((prev) => ({
          ...prev,
          session: { loading: false, error: errorMessage(error), items: [], total: 0, fallback: false }
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, masterOff, searchQuery, refreshTick, projectKey, sessionFilter, paging.session]);
  React2.useEffect(() => {
    for (const key of PAGED_LISTS) {
      const pages = Math.max(1, Math.ceil(asNumber(lists[key].total) / paging[key].size));
      if (paging[key].page > pages) {
        setPaging((prev) => ({ ...prev, [key]: { ...prev[key], page: pages } }));
        return;
      }
    }
  }, [lists, paging]);
  React2.useEffect(() => {
    if (masterOff) setEditing(null);
  }, [masterOff]);
  const startSidecar = React2.useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setStartError("");
    try {
      const data = await api.start();
      if (data !== null && typeof data === "object") {
        setStatus(data);
        setStatusError("");
        setStatusLoading(false);
      }
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setStartError(errorMessage(error));
    } finally {
      setStarting(false);
    }
  }, [starting]);
  const setMaster = async (next) => {
    if (masterBusy) return;
    const value = typeof next === "boolean" ? next : !masterOff;
    setMasterBusy(true);
    setMasterError("");
    try {
      const data = await api.setSettings({ enabled: value });
      const applied = data?.settings?.enabled;
      setStatus((prev) => ({ ...prev ?? {}, enabled: typeof applied === "boolean" ? applied : value }));
    } catch (error) {
      setMasterError(errorMessage(error));
    } finally {
      setMasterBusy(false);
    }
  };
  const onMasterChange = (next) => {
    void setMaster(next);
  };
  const closeEditor = React2.useCallback(() => {
    setEditing(null);
    setRowError(null);
  }, []);
  const startEditing = (item) => {
    if (masterOff) return;
    setRowError(null);
    setEditing({ id: item.id, draft: item.content });
  };
  const saveEditing = async () => {
    if (editing === null || masterOff) return;
    const content = editing.draft.trim();
    if (content === "") {
      setRowError({ id: editing.id, message: t("row.emptyContent") });
      return;
    }
    const id = editing.id;
    setSavingId(id);
    setRowError(null);
    try {
      const data = await api.update({ tier: "personal", id, content });
      const updated = normalizeItem(data?.item ?? {});
      setLists((prev) => ({
        ...prev,
        personal: {
          ...prev.personal,
          items: prev.personal.items.map((item) => item.id === id ? { ...item, ...updated, id, content } : item)
        }
      }));
      setEditing(null);
      setSavedId(id);
      if (savedTimer.current !== null) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => {
        savedTimer.current = null;
        setSavedId("");
      }, 2e3);
    } catch (error) {
      setRowError({ id, message: errorMessage(error) });
    } finally {
      setSavingId("");
    }
  };
  const confirmDelete = async () => {
    if (deleteTarget === null || deleting || masterOff) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.delete({ tier: deleteTarget.tier, id: deleteTarget.id });
      setLists((prev) => {
        const list = prev[deleteTarget.tier];
        const items = list.items.filter((item) => item.id !== deleteTarget.id);
        return {
          ...prev,
          [deleteTarget.tier]: { ...list, items, total: Math.max(0, list.total - 1) }
        };
      });
      setDeleteTarget(null);
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };
  const confirmForget = async () => {
    if (forgetTarget === null || forgetting || masterOff) return;
    setForgetting(true);
    setForgetError("");
    try {
      await api.forget(forgetTarget.id);
      setLists((prev) => {
        const list = prev[forgetTarget.tier];
        const items = list.items.filter((item) => item.id !== forgetTarget.id);
        return {
          ...prev,
          [forgetTarget.tier]: { ...list, items, total: Math.max(0, list.total - 1) }
        };
      });
      setForgetTarget(null);
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setForgetError(errorMessage(error));
    } finally {
      setForgetting(false);
    }
  };
  const openWhy = async (item) => {
    setWhy({ id: item.id, title: memoryTitle(item.content, t("row.untitled")), result: null });
    setWhyLoading(true);
    setWhyError("");
    try {
      const data = await api.explain(item.id);
      setWhy((prev) => prev !== null && prev.id === item.id ? { ...prev, result: data !== null && typeof data === "object" ? data : { found: false } } : prev);
    } catch (error) {
      setWhyError(errorMessage(error));
    } finally {
      setWhyLoading(false);
    }
  };
  const scanDuplicates = async () => {
    if (dupeBusy !== "") return;
    setDupeBusy("scan");
    setDupeError("");
    setDupeDone(null);
    try {
      const data = await api.duplicates();
      const groups = asArray(data?.groups).filter((group) => group !== null && typeof group === "object" && typeof group.tier === "string" && Array.isArray(group.drop) && group.drop.length > 0);
      const total = asNumber(data?.total, groups.reduce((sum, group) => sum + asNumber(group.count, group.drop.length), 0));
      setDupeScan({ groups, total });
      setDupeOpen(total > 0);
    } catch (error) {
      setDupeScan(null);
      setDupeError(errorMessage(error));
    } finally {
      setDupeBusy("");
    }
  };
  const applyMerge = async () => {
    if (dupeScan === null || dupeBusy !== "" || dupeOpen !== true) return;
    setDupeBusy("merge");
    setDupeError("");
    let removed = 0;
    try {
      for (const group of dupeScan.groups) {
        await api.merge({ tier: group.tier, keep: group.keep, drop: group.drop });
        removed += asNumber(group.count, group.drop.length);
      }
      setDupeOpen(false);
      setDupeScan(null);
      setDupeDone(removed);
      refresh();
    } catch (error) {
      setDupeError(errorMessage(error));
    } finally {
      setDupeBusy("");
    }
  };
  const copyItem = async (item) => {
    const ok = await copyToClipboard(item.content);
    if (copyTimer.current !== null) {
      clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
    setCopiedId(ok ? item.id : "");
    setCopyFailedId(ok ? "" : item.id);
    copyTimer.current = setTimeout(() => {
      copyTimer.current = null;
      setCopiedId("");
      setCopyFailedId("");
    }, COPY_FEEDBACK_MS);
  };
  const checkUpdate = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const data = await api.updateCheck(true);
      setAutoUpdate(null);
      setUpdateResult({
        current: typeof data?.current === "string" ? data.current : "",
        latest: typeof data?.latest === "string" ? data.latest : "",
        behind: data?.behind === true,
        url: typeof data?.url === "string" ? data.url : "",
        error: typeof data?.error === "string" ? data.error : ""
      });
    } catch (error) {
      setUpdateResult({ current: "", latest: "", behind: false, url: "", error: errorMessage(error) });
    } finally {
      setChecking(false);
    }
  };
  const sidecar = status?.sidecar ?? null;
  const sidecarReady = sidecar?.state === "ready";
  const workspaceCount = asNumber(lists.project.total) + asNumber(lists.session.total);
  const memoryDate = (item) => {
    const at = item.updatedAt ?? item.createdAt;
    const text = timeText(t, at, now);
    return text === "" ? "" : t("row.updatedAt", { time: text });
  };
  const rowActions = (tier, item) => {
    const actions = [{ key: "copy", label: t("row.copy"), onSelect: () => {
      void copyItem(item);
    } }];
    if (!masterOff && tier === "personal") {
      actions.push({ key: "edit", label: t("row.edit"), onSelect: () => {
        startEditing(item);
      } });
    }
    if (!masterOff && item.id !== "") {
      actions.push({ key: "why", label: t("row.why"), onSelect: () => {
        void openWhy(item);
      } });
    }
    if (!masterOff) {
      actions.push({
        key: "delete",
        label: t("row.delete"),
        danger: true,
        onSelect: () => {
          setDeleteError("");
          setDeleteTarget({ tier, id: item.id });
        }
      });
      actions.push({
        key: "forget",
        label: t("row.forget"),
        danger: true,
        onSelect: () => {
          setForgetError("");
          setForgetTarget({ tier, id: item.id });
        }
      });
    }
    return actions;
  };
  const dupeHint = () => {
    if (dupeError !== "") return t("dupes.failed", { message: dupeError });
    if (dupeDone !== null) return t("dupes.done", { n: dupeDone });
    if (dupeScan !== null && dupeScan.total === 0) return t("dupes.none");
    return "";
  };
  const renderHeader = () => h(
    "header",
    { className: "hm-header" },
    h(
      "div",
      { className: "hm-headerMain" },
      h(
        "div",
        null,
        h("h1", { className: "hm-title" }, t("section.title")),
        h("p", { className: "hm-subtitle" }, t("section.subtitle"))
      )
    ),
    h(
      "div",
      { className: "hm-headerSwitch" },
      h(ui.Switch, {
        checked: !masterOff,
        label: t("master.label"),
        disabled: masterBusy,
        onChange: onMasterChange
      }),
      masterError !== "" ? h("p", { className: "hm-error", role: "alert" }, t("master.error", { message: masterError })) : null
    )
  );
  const renderSidecarBanner = () => {
    if (masterOff) return null;
    if (statusLoading && status === null) return null;
    if (sidecarReady && statusError === "") return null;
    const title = t("banner.notReady.title");
    const body = statusError !== "" ? t("banner.error", { message: statusError }) : t("banner.notReady.body", { state: stateLabel(t, sidecar?.state) });
    const children = [
      h(
        "div",
        { key: "text", className: "hm-bannerText" },
        h("strong", null, title),
        h("p", null, body),
        sidecar?.lastError ? h("p", { className: "hm-error" }, t("banner.lastError", { message: sidecar.lastError })) : null,
        startError !== "" ? h("p", { className: "hm-error" }, startError) : null
      )
    ];
    const actions = [h(ui.Button, {
      key: "start",
      size: "sm",
      variant: "primary",
      disabled: starting,
      onClick: startSidecar
    }, starting ? t("banner.starting") : t("banner.start"))];
    if (statusError !== "") {
      actions.push(h(ui.Button, { key: "retry", size: "sm", variant: "outline", onClick: refresh }, t("common.retry")));
    }
    children.push(h("div", { key: "actions", className: "hm-bannerActions" }, actions));
    return h("section", { className: "hm-banner", role: "status" }, children);
  };
  const workspaceLabel = () => {
    const active = projects.items.find((item) => item.key === projectKey) ?? null;
    return active?.title || statusProjectTitle || (projectKey !== "" ? shortId(projectKey) : t("project.none"));
  };
  const renderWorkspaceBar = () => h(
    "div",
    { className: "hm-projectBar" },
    h(PickerPill, {
      t,
      icon: "folder",
      label: workspaceLabel(),
      title: t("project.workspace"),
      ariaLabel: t("project.select"),
      emptyText: t("project.empty"),
      items: projects.items.map((project) => ({
        key: project.key,
        title: project.title !== "" ? project.title : shortId(project.key)
      })),
      selected: projectKey,
      onSelect: (key) => {
        setProjectChoice(key);
        setSessionChoice(null);
        setLists(emptyLists());
        setPaging((prev) => ({
          ...prev,
          project: { ...prev.project, page: 1 },
          session: { ...prev.session, page: 1 }
        }));
      }
    }),
    h("span", { className: "hm-divider", "aria-hidden": "true" }),
    h("span", { className: "hm-projectCount" }, t("count.memories", { n: workspaceCount })),
    renderSearchField(),
    renderRefreshButton()
  );
  const renderBlockHead = (title, count) => h(
    "div",
    { className: "hm-blockHead" },
    h("h3", { className: "hm-blockTitle" }, title),
    h("span", { className: "hm-meta" }, t("count.items", { n: count }))
  );
  const renderPager = (key, list) => {
    const { page, size } = paging[key];
    const total = asNumber(list.total);
    if (total <= 0) return null;
    const pages = Math.max(1, Math.ceil(total / size));
    const changePage = (next) => {
      setPaging((prev) => ({ ...prev, [key]: { ...prev[key], page: next } }));
    };
    return h(
      "div",
      { className: "hm-pager" },
      h("span", { className: "hm-pagerTotal" }, t("pager.total", { n: total })),
      h(
        "div",
        { className: "hm-pagerNav" },
        h("button", {
          type: "button",
          className: "hm-pageButton",
          "aria-label": t("pager.prev"),
          title: t("pager.prev"),
          disabled: page <= 1,
          onClick: () => {
            changePage(page - 1);
          }
        }, h(Icon, { name: "chevronLeft", size: 14 })),
        h("span", { className: "hm-pagerStatus" }, t("pager.page", { page, pages })),
        h("button", {
          type: "button",
          className: "hm-pageButton",
          "aria-label": t("pager.next"),
          title: t("pager.next"),
          disabled: page >= pages,
          onClick: () => {
            changePage(page + 1);
          }
        }, h(Icon, { name: "chevronRight", size: 14 }))
      ),
      h(
        "label",
        { className: "hm-pagerSize" },
        h("span", null, t("pager.size")),
        h("select", {
          className: "hm-select",
          value: String(size),
          "aria-label": t("pager.size"),
          onChange: (event) => {
            const next = Number(event.target.value);
            setPaging((prev) => ({
              ...prev,
              [key]: { page: 1, size: PAGE_SIZES.includes(next) ? next : DEFAULT_PAGE_SIZE }
            }));
          }
        }, PAGE_SIZES.map((value) => h("option", { key: value, value: String(value) }, String(value))))
      )
    );
  };
  const renderProjectBlock = () => h(
    "section",
    { className: "hm-block" },
    renderBlockHead(t("project.memories"), lists.project.total),
    renderListFace("project", (list) => h(
      React2.Fragment,
      null,
      renderRows("project", list.items),
      renderPager("project", list)
    ), "empty.project")
  );
  const renderSessionBlock = () => h(
    "section",
    { className: "hm-block" },
    renderBlockHead(t("session.memories"), lists.session.total),
    renderSessionPicker(),
    renderSessionArea()
  );
  const renderTabsRow = () => h("div", { className: "hm-tabsRow" }, renderTabs());
  const renderTabs = () => h(ui.SegmentedTabs, {
    items: [
      { value: "personal", label: t("tabs.personal"), id: "hy-memory-tab-personal", panelId: "hy-memory-panel-personal" },
      { value: "project", label: t("tabs.workspace"), id: "hy-memory-tab-project", panelId: "hy-memory-panel-project" }
    ],
    value: tab,
    onChange: (value) => {
      setTab(value);
    },
    label: t("tabs.label"),
    size: "sm"
  });
  const renderSearchField = () => h(
    "label",
    { className: "hm-searchField" },
    h(Icon, { name: "search", size: 14 }),
    h("input", {
      type: "search",
      className: "hm-searchInput",
      value: query,
      placeholder: t("search.placeholder"),
      "aria-label": t("search.placeholder"),
      onChange: (event) => {
        setQuery(event.target.value);
      }
    })
  );
  const renderRefreshButton = () => h("button", {
    type: "button",
    className: "hm-iconButton",
    "aria-label": t("files.refresh"),
    title: t("files.refresh"),
    onClick: refresh
  }, h(Icon, { name: "refresh", size: 14 }));
  const renderFilesHead = () => h(
    "div",
    { className: "hm-filesHead" },
    h("h2", { className: "hm-filesTitle" }, t("files.title")),
    renderSearchField(),
    renderRefreshButton()
  );
  const renderListFace = (tier, body, emptyKey) => {
    const list = lists[tier];
    if (list.loading && list.items.length === 0) {
      return h(
        "div",
        { className: "hm-state", role: "status" },
        h(ui.StateDot, { state: "ongoing" }),
        h("span", null, t("common.loading"))
      );
    }
    if (list.error !== "") {
      return h(
        "div",
        { className: "hm-empty", role: "alert" },
        h("p", { className: "hm-error" }, t("list.error", { message: list.error })),
        h(
          "div",
          { className: "hm-row" },
          h(ui.Button, { size: "sm", variant: "outline", onClick: refresh }, t("common.retry"))
        )
      );
    }
    if (list.items.length === 0) {
      return h(
        "div",
        { className: "hm-empty" },
        h("span", null, searchQuery !== "" ? t("empty.search", { query: searchQuery }) : t(emptyKey ?? `empty.${tier}`)),
        searchQuery === "" ? h("span", { className: "hm-emptyHint" }, t("empty.hint")) : null
      );
    }
    return h(
      React2.Fragment,
      null,
      list.fallback ? h("p", { className: "hm-muted" }, t("list.fallback")) : null,
      body(list)
    );
  };
  const renderFileRow = (tier, item) => {
    const statusText = savedId === item.id ? t("row.saved") : copiedId === item.id ? t("row.copied") : copyFailedId === item.id ? t("row.copyFailed") : "";
    return h(FileRow, {
      key: item.id,
      t,
      title: memoryTitle(item.content, t("row.untitled")),
      date: memoryDate(item),
      status: statusText,
      actions: rowActions(tier, item)
    });
  };
  const renderEditorRow = (item) => h(
    "li",
    { key: item.id, className: "hm-file hm-fileEditor" },
    h("textarea", {
      className: "hm-textarea",
      rows: 3,
      value: editing.draft,
      "aria-label": t("row.edit"),
      onChange: (event) => {
        setEditing({ id: item.id, draft: event.target.value });
      }
    }),
    rowError !== null && rowError.id === item.id ? h("p", { className: "hm-error" }, t("row.saveFailed", { message: rowError.message })) : null,
    h(
      "div",
      { className: "hm-fileEditorActions" },
      h(ui.Button, {
        size: "sm",
        variant: "primary",
        disabled: savingId === item.id,
        onClick: saveEditing
      }, savingId === item.id ? t("row.saving") : t("row.save")),
      h(ui.Button, { size: "sm", variant: "ghost", onClick: closeEditor }, t("row.cancel"))
    )
  );
  const renderRows = (tier, items) => h(
    "ul",
    { className: "hm-files" },
    items.map((item) => editing !== null && editing.id === item.id && tier === "personal" ? renderEditorRow(item) : renderFileRow(tier, item))
  );
  const renderPersonal = () => renderListFace("personal", (list) => h(
    React2.Fragment,
    null,
    renderRows("personal", list.items),
    renderPager("personal", list)
  ));
  const renderSessionPicker = () => {
    const items = [
      { key: "", title: t("session.all") },
      ...sessions.items.map((entry) => ({ key: entry.sessionId, title: shortId(entry.sessionId) }))
    ];
    return h(
      "div",
      { className: "hm-sessionBar" },
      h(PickerPill, {
        t,
        icon: "hash",
        label: sessionFilter === "" ? t("session.all") : shortId(sessionFilter),
        title: t("session.picker"),
        ariaLabel: t("session.select"),
        emptyText: t("session.emptyPicker"),
        items,
        selected: sessionFilter,
        onSelect: (key) => {
          setSessionChoice(key);
          setPaging((prev) => ({ ...prev, session: { ...prev.session, page: 1 } }));
        }
      })
    );
  };
  const sessionGroups = () => {
    const groups = /* @__PURE__ */ new Map();
    for (const item of lists.session.items) {
      if (!groups.has(item.sessionId)) groups.set(item.sessionId, []);
      groups.get(item.sessionId).push(item);
    }
    return [...groups.entries()].map(([key, rows]) => ({
      key,
      rows,
      updatedAt: rows.reduce((max, row) => Math.max(max, asNumber(row.updatedAt)), 0)
    })).sort((left, right) => {
      if (left.key === currentSessionId) return -1;
      if (right.key === currentSessionId) return 1;
      return right.updatedAt - left.updatedAt;
    });
  };
  const renderSessionArea = () => {
    const list = lists.session;
    if (list.loading && list.items.length === 0) {
      return h(
        "div",
        { className: "hm-state", role: "status" },
        h(ui.StateDot, { state: "ongoing" }),
        h("span", null, t("common.loading"))
      );
    }
    if (list.error !== "") {
      return h(
        "div",
        { className: "hm-empty", role: "alert" },
        h("p", { className: "hm-error" }, t("list.error", { message: list.error })),
        h(
          "div",
          { className: "hm-row" },
          h(ui.Button, { size: "sm", variant: "outline", onClick: refresh }, t("common.retry"))
        )
      );
    }
    const groups = sessionGroups();
    if (groups.length === 0) {
      return h(
        "div",
        { className: "hm-empty" },
        h("span", null, searchQuery !== "" ? t("empty.search", { query: searchQuery }) : sessionFilter !== "" ? t("empty.session") : t("empty.sessions"))
      );
    }
    return h(
      React2.Fragment,
      null,
      groups.map((group) => h(
        "section",
        {
          key: group.key === "" ? "__ungrouped__" : group.key,
          className: "hm-group"
        },
        h(
          "div",
          { className: "hm-groupHead" },
          h(
            "h4",
            { className: "hm-groupLabel" },
            h(Icon, { name: "hash", size: 13 }),
            group.key === "" ? t("row.ungrouped") : shortId(group.key)
          ),
          h("span", { className: "hm-meta" }, t("count.items", { n: group.rows.length }))
        ),
        renderRows("session", group.rows)
      )),
      renderPager("session", list)
    );
  };
  const renderPersonalBody = () => h(React2.Fragment, null, renderFilesHead(), renderPersonal());
  const renderWorkspaceBody = () => h(
    React2.Fragment,
    null,
    renderWorkspaceBar(),
    renderProjectBlock(),
    renderSessionBlock()
  );
  const renderTabBody = () => tab === "personal" ? renderPersonalBody() : renderWorkspaceBody();
  const renderDeleteModal = () => h(
    ui.Modal,
    {
      open: deleteTarget !== null,
      onClose: () => {
        if (deleting) return;
        setDeleteTarget(null);
        setDeleteError("");
      },
      title: t("row.confirmDelete.title"),
      closeLabel: t("common.close"),
      footer: h(
        "div",
        { className: "hm-row" },
        h(ui.Button, {
          size: "sm",
          variant: "ghost",
          "data-modal-autofocus": "",
          onClick: () => {
            setDeleteTarget(null);
            setDeleteError("");
          }
        }, t("row.confirmDelete.cancel")),
        h(
          ui.Button,
          { size: "sm", variant: "primary", disabled: deleting, onClick: confirmDelete },
          deleting ? t("common.loading") : t("row.confirmDelete.confirm")
        )
      )
    },
    deleteTarget !== null ? h("p", { className: "hm-muted" }, t("row.confirmDelete.body", { tier: tierLabel(t, deleteTarget.tier) })) : null,
    deleteError !== "" ? h("p", { className: "hm-error" }, t("row.deleteFailed", { message: deleteError })) : null
  );
  const renderWhyModal = () => {
    const result = why?.result ?? null;
    const found = result !== null && result.found === true;
    const fields = [];
    if (found) {
      fields.push(h(
        "div",
        { key: "query", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("why.query")),
        h("span", { className: "hm-fieldValue hm-mono" }, String(result.query ?? ""))
      ));
      fields.push(h(
        "div",
        { key: "tier", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("why.tier")),
        h("span", { className: "hm-fieldValue" }, tierLabel(t, String(result.tier ?? "")))
      ));
      const score = asNumber(result.score);
      fields.push(h(
        "div",
        { key: "score", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("why.score")),
        h("span", { className: "hm-fieldValue" }, Number.isFinite(score) ? score.toFixed(3) : String(result.score ?? ""))
      ));
      fields.push(h(
        "div",
        { key: "rank", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("why.rank")),
        h("span", { className: "hm-fieldValue" }, `#${asNumber(result.rank)}`)
      ));
      fields.push(h(
        "div",
        { key: "at", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("why.at")),
        h("span", { className: "hm-fieldValue" }, timeText(t, result.at, now))
      ));
      const sourceKey = `why.source.${String(result.source ?? "")}`;
      const sourceText = t(sourceKey);
      fields.push(h(
        "div",
        { key: "source", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("why.source")),
        h("span", { className: "hm-fieldValue" }, sourceText === sourceKey ? String(result.source ?? "") : sourceText)
      ));
    }
    let body;
    if (whyLoading) {
      body = h("p", { className: "hm-muted", role: "status" }, t("common.loading"));
    } else if (whyError !== "") {
      body = h("p", { className: "hm-error", role: "alert" }, t("why.failed", { message: whyError }));
    } else if (found) {
      body = h("dl", { className: "hm-grid" }, fields);
    } else {
      body = h("p", { className: "hm-muted" }, t("why.never"));
    }
    return h(
      ui.Modal,
      {
        open: why !== null,
        onClose: () => {
          setWhy(null);
          setWhyError("");
        },
        title: t("why.title"),
        closeLabel: t("common.close"),
        footer: h(
          "div",
          { className: "hm-row" },
          h(ui.Button, {
            size: "sm",
            variant: "ghost",
            "data-modal-autofocus": "",
            onClick: () => {
              setWhy(null);
              setWhyError("");
            }
          }, t("common.close"))
        )
      },
      why !== null ? h("p", { className: "hm-muted" }, why.title) : null,
      body
    );
  };
  const renderDupeModal = () => h(
    ui.Modal,
    {
      open: dupeOpen && dupeScan !== null,
      onClose: () => {
        if (dupeBusy === "merge") return;
        setDupeOpen(false);
        setDupeScan(null);
        setDupeError("");
      },
      title: t("dupes.confirm.title"),
      closeLabel: t("common.close"),
      footer: h(
        "div",
        { className: "hm-row" },
        h(ui.Button, {
          size: "sm",
          variant: "ghost",
          "data-modal-autofocus": "",
          onClick: () => {
            setDupeOpen(false);
            setDupeScan(null);
            setDupeError("");
          }
        }, t("row.confirmDelete.cancel")),
        h(
          ui.Button,
          { size: "sm", variant: "primary", disabled: dupeBusy === "merge", onClick: () => {
            void applyMerge();
          } },
          dupeBusy === "merge" ? t("dupes.merging") : t("dupes.confirm.confirm")
        )
      )
    },
    dupeScan !== null ? h("p", { className: "hm-muted" }, t("dupes.confirm.body", {
      rows: dupeScan.total,
      groups: dupeScan.groups.length
    })) : null,
    dupeError !== "" ? h("p", { className: "hm-error" }, t("dupes.failed", { message: dupeError })) : null
  );
  const renderForgetModal = () => h(
    ui.Modal,
    {
      open: forgetTarget !== null,
      onClose: () => {
        if (forgetting) return;
        setForgetTarget(null);
        setForgetError("");
      },
      title: t("row.confirmForget.title"),
      closeLabel: t("common.close"),
      footer: h(
        "div",
        { className: "hm-row" },
        h(ui.Button, {
          size: "sm",
          variant: "ghost",
          "data-modal-autofocus": "",
          onClick: () => {
            setForgetTarget(null);
            setForgetError("");
          }
        }, t("row.confirmDelete.cancel")),
        h(
          ui.Button,
          { size: "sm", variant: "primary", disabled: forgetting, onClick: confirmForget },
          forgetting ? t("common.loading") : t("row.confirmForget.confirm")
        )
      )
    },
    forgetTarget !== null ? h("p", { className: "hm-muted" }, t("row.confirmForget.body")) : null,
    forgetError !== "" ? h("p", { className: "hm-error" }, t("row.forgetFailed", { message: forgetError })) : null
  );
  const renderActivity = () => h(ActivityPanel, { t });
  const renderDiagnostics = () => {
    const model = status?.model ?? null;
    const embedding = status?.embedding ?? null;
    const dir = dataDirPath(status);
    const size = dataDirSize(status);
    const modelText = model?.ready ? [model.provider, model.model].filter(Boolean).join(" / ") || t("diag.ready") : t("diag.notReady");
    const embeddingText = `${embedding?.mode === "remote" ? t("diag.remote") : embedding?.mode === "local" ? t("diag.local") : embedding?.mode ?? t("diag.unknown")} · ${embedding?.ready ? t("diag.ready") : t("diag.notReady")}`;
    const details = [
      h(
        "div",
        { key: "model", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("diag.model")),
        h("span", { className: "hm-fieldValue" }, modelText)
      ),
      h(
        "div",
        { key: "embedding", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("diag.embedding")),
        h("span", { className: "hm-fieldValue" }, embeddingText)
      ),
      h(
        "div",
        { key: "mode", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("diag.mode")),
        h("span", { className: "hm-fieldValue" }, status?.mode ?? t("diag.unknown"))
      ),
      h(
        "div",
        { key: "scene", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("diag.scene")),
        h("span", { className: "hm-fieldValue" }, status?.scene ?? t("diag.unknown"))
      ),
      h(
        "div",
        { key: "project", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("diag.project")),
        h(
          "span",
          { className: "hm-fieldValue" },
          status?.project?.title || (projectKey !== "" ? shortId(projectKey) : t("diag.unknown"))
        )
      ),
      h(
        "div",
        { key: "session", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("diag.session")),
        h("span", { className: "hm-fieldValue" }, status?.session?.title || (currentSessionId !== "" ? shortId(currentSessionId) : t("diag.unknown")))
      )
    ];
    if (dir !== "") {
      details.push(h(
        "div",
        { key: "dir", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("diag.dataDir")),
        h("span", { className: "hm-fieldValue hm-mono" }, dir)
      ));
    }
    if (size !== "") {
      details.push(h(
        "div",
        { key: "size", className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("diag.dataSize")),
        h("span", { className: "hm-fieldValue" }, size)
      ));
    }
    const counts = status?.counts ?? null;
    const totalCount = counts === null ? null : asNumber(counts.personal) + asNumber(counts.project) + asNumber(counts.session);
    const context = status?.context ?? null;
    const memoryTokens = asNumber(context?.memoryTokens);
    const totalTokens = asNumber(context?.totalTokens);
    return h(
      "section",
      { className: "hm-card" },
      h(
        "div",
        { className: "hm-cardHead" },
        h("h2", { className: "hm-h2" }, t("diag.title")),
        h(ui.Button, {
          size: "sm",
          variant: "ghost",
          onClick: () => {
            setDiagOpen((value) => !value);
          }
        }, diagOpen ? t("common.hideDetails") : t("common.details"))
      ),
      h(
        "div",
        { className: "hm-field" },
        h("span", { className: "hm-fieldLabel" }, t("diag.sidecar")),
        h(
          "span",
          { className: "hm-fieldValue" },
          h(ui.StateDot, { state: dotState(sidecar?.state) }),
          stateLabel(t, sidecar?.state),
          sidecar?.port ? h("span", { className: "hm-mono" }, `:${sidecar.port}`) : null
        )
      ),
      totalCount !== null ? h("p", { className: "hm-countLine" }, t("counts.total", { n: totalCount })) : null,
      context !== null && (memoryTokens > 0 || totalTokens > 0) ? h("p", { className: "hm-contextLine" }, t("diag.memoryTokens", { round: memoryTokens, total: totalTokens })) : null,
      h(
        "div",
        { className: "hm-dupeRow" },
        h(ui.Button, {
          size: "sm",
          variant: "outline",
          disabled: dupeBusy !== "",
          onClick: () => {
            void scanDuplicates();
          }
        }, dupeBusy === "scan" ? t("dupes.scanning") : t("dupes.action")),
        dupeHint() !== "" ? h("span", {
          className: `hm-dupeHint${dupeError !== "" ? " hm-error" : ""}`,
          role: "status"
        }, dupeHint()) : null
      ),
      diagOpen ? h("dl", { className: "hm-grid" }, details) : null,
      diagOpen ? h("pre", { className: "hm-pre" }, JSON.stringify(status, null, 2)) : null
    );
  };
  const renderMemhub = () => h(MemhubCard, {
    t,
    memhub: status?.memhub ?? null,
    onImported: refresh
  });
  const repoUrl = (() => {
    const raw = typeof status?.package?.repoUrl === "string" ? status.package.repoUrl : "";
    return raw.replace(/\.git$/, "");
  })();
  const renderAutoNotice = () => {
    if (autoUpdate === null || autoUpdate.behind !== true || autoUpdate.latest === "") return null;
    const version = t("update.newVersion", { version: autoUpdate.latest });
    return h(
      "div",
      { className: "hm-updateNotice", role: "status" },
      autoUpdate.url !== "" ? h("a", {
        className: "hm-updatePill",
        href: autoUpdate.url,
        target: "_blank",
        rel: "noopener noreferrer"
      }, version) : h("span", { className: "hm-updatePill" }, version),
      h("span", { className: "hm-updateHint" }, t("update.manualHint"))
    );
  };
  const renderUpdateResult = () => {
    if (checking || updateResult === null) return null;
    if (updateResult.error !== "") {
      return h("span", { className: "hm-footerResult hm-error", title: updateResult.error }, t("update.failed"));
    }
    if (updateResult.behind) {
      return h(
        "span",
        { className: "hm-footerResult" },
        t("update.behind", { version: updateResult.latest }),
        " ",
        updateResult.url !== "" ? h("a", { href: updateResult.url, target: "_blank", rel: "noopener noreferrer" }, t("update.open")) : null
      );
    }
    return h(
      "span",
      { className: "hm-footerResult" },
      t("update.latest", { version: updateResult.latest || updateResult.current })
    );
  };
  const renderFooter = () => h(
    "footer",
    { className: "hm-footer" },
    h(
      "div",
      { className: "hm-footerLeft" },
      repoUrl !== "" ? h("a", {
        className: "hm-footerLink",
        href: repoUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": t("update.repo"),
        title: repoUrl
      }, h(GitHubMark, { size: 16 })) : null,
      renderAutoNotice()
    ),
    h(
      "div",
      { className: "hm-footerRight" },
      renderUpdateResult(),
      h(ui.Button, {
        size: "sm",
        variant: "outline",
        disabled: checking,
        onClick: () => {
          void checkUpdate();
        }
      }, checking ? t("update.checking") : t("update.check"))
    )
  );
  if (masterOff) {
    return h(
      "section",
      { className: "hm-panel", "aria-label": t("section.title") },
      panelStyles(),
      renderHeader()
    );
  }
  return h(
    "section",
    { className: "hm-panel", "aria-label": t("section.title") },
    panelStyles(),
    renderHeader(),
    renderSidecarBanner(),
    renderTabsRow(),
    h(
      "div",
      {
        role: "tabpanel",
        id: `hy-memory-panel-${tab}`,
        "aria-labelledby": `hy-memory-tab-${tab}`,
        className: "hm-panelBody"
      },
      renderTabBody()
    ),
    renderActivity(),
    renderDiagnostics(),
    renderMemhub(),
    renderFooter(),
    renderDeleteModal(),
    renderForgetModal(),
    renderDupeModal(),
    renderWhyModal()
  );
}

// client-src/session-panel.js
var React3 = __toESM(require("react"), 1);
function settledList(result) {
  if (result.status === "fulfilled") {
    const data = result.value;
    const items = asArray(data?.items).map(normalizeItem);
    return { loading: false, error: "", items, total: asNumber(data?.total, items.length) };
  }
  return { loading: false, error: errorMessage(result.reason), items: [], total: 0 };
}
function headList() {
  return { loading: true, error: "", items: [], total: 0 };
}
function SessionMemoryView(props) {
  const t = typeof props.t === "function" ? props.t : typeof props.translate === "function" ? props.translate : (key) => key;
  const sessionId = typeof props.sessionId === "string" ? props.sessionId : "";
  useLocaleSubscription(props);
  const [status, setStatus] = React3.useState(null);
  const [statusError, setStatusError] = React3.useState("");
  const [sessionList, setSessionList] = React3.useState(headList);
  const [projectList, setProjectList] = React3.useState(headList);
  const [tick, setTick] = React3.useState(0);
  const now = Date.now();
  React3.useEffect(() => {
    let cancelled = false;
    setStatusError("");
    setSessionList(headList);
    setProjectList(headList);
    const run = async () => {
      let current = null;
      try {
        current = tick === 0 ? await api.loadStatus() : await api.readStatus();
      } catch (error) {
        if (cancelled) return;
        setStatusError(errorMessage(error));
        setSessionList((prev) => ({ ...prev, loading: false, error: errorMessage(error) }));
        setProjectList((prev) => ({ ...prev, loading: false, error: errorMessage(error) }));
        return;
      }
      if (cancelled) return;
      setStatus(current ?? null);
      const projectKey = current?.project?.key ?? "";
      const results = await Promise.allSettled([
        sessionId === "" ? Promise.reject(new Error(t("session.noSession"))) : api.list({ tier: "session", sessionId, limit: 100 }),
        api.list({ tier: "project", ...projectKey === "" ? {} : { projectKey }, limit: 100 })
      ]);
      if (cancelled) return;
      setSessionList(settledList(results[0]));
      setProjectList(settledList(results[1]));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [sessionId, tick]);
  const renderRows = (list, emptyKey) => {
    if (list.loading) {
      return h(
        "div",
        { className: "hm-state", role: "status" },
        h(ui.StateDot, { state: "ongoing" }),
        h("span", null, t("common.loading"))
      );
    }
    if (list.error !== "") {
      return h(
        "div",
        { className: "hm-empty", role: "alert" },
        h("p", { className: "hm-error" }, t("session.error", { message: list.error }))
      );
    }
    if (list.items.length === 0) {
      return h("div", { className: "hm-empty" }, t(emptyKey));
    }
    return h("ul", { className: "hm-rows" }, list.items.map((item) => h(
      "li",
      {
        key: item.id,
        className: "hm-rowCard"
      },
      h("p", { className: "hm-content" }, item.content === "" ? t("row.noContent") : item.content),
      h(
        "div",
        { className: "hm-meta" },
        item.layer !== "" ? h(ui.Tag, { key: "layer", tone: "neutral" }, `${t("row.layer")}: ${item.layer}`) : null,
        item.updatedAt ? h("span", { key: "time" }, t("row.updatedAt", { time: timeText(t, item.updatedAt, now) })) : null
      )
    )));
  };
  const renderSection = (title, list, emptyKey) => h(
    "section",
    { className: "hm-card" },
    h(
      "div",
      { className: "hm-cardHead" },
      h("h2", { className: "hm-h2" }, title),
      h("span", { className: "hm-meta" }, t("counts.total", { n: list.items.length }))
    ),
    renderRows(list, emptyKey)
  );
  return h(
    "section",
    { className: "hm-panel hm-sessionPanel", "aria-label": t("session.tabTitle") },
    panelStyles(),
    h(
      "header",
      { className: "hm-header" },
      h(
        "div",
        null,
        h("h2", { className: "hm-h2" }, t("session.tabTitle")),
        h("p", { className: "hm-subtitle" }, t("session.tabDesc"))
      ),
      h(
        "div",
        { className: "hm-headerActions" },
        h(ui.Button, { size: "sm", variant: "outline", onClick: () => {
          setTick((value) => value + 1);
        } }, t("common.refresh"))
      )
    ),
    statusError !== "" ? h(
      "div",
      { className: "hm-empty", role: "alert" },
      h("p", { className: "hm-error" }, t("session.error", { message: statusError }))
    ) : null,
    status?.sidecar !== void 0 ? h(
      "div",
      { className: "hm-counts" },
      h(ui.StateDot, { state: dotState(status?.sidecar?.state) }),
      h("span", null, stateLabel(t, status?.sidecar?.state))
    ) : null,
    sessionId === "" ? h("div", { className: "hm-empty" }, t("session.noSession")) : renderSection(t("session.title"), sessionList, "session.empty"),
    renderSection(t("session.projectTitle"), projectList, "session.emptyProject")
  );
}

// client-src/index.js
var SECTION_ID = "hy-memory";
var TAB_ID = "hy-memory";
var TAB_KIND = "hy-memory";
var NAV_STYLE_ID = "hy-memory-nav-glyph";
var NAV_CSS = [
  ".hm-navLabel{display:inline-flex;align-items:center;gap:8px;min-width:0}",
  ".hm-navBrain{flex:none;color:currentColor}",
  "button:has(> span > .hm-navLabel) > svg:first-child{display:none}"
].join("");
function navLabelNode(t) {
  return React4.createElement(
    "span",
    { className: "hm-navLabel" },
    React4.createElement(Icon, {
      name: "brain",
      size: 16,
      strokeWidth: 1.5,
      className: "hm-navBrain",
      style: { flex: "none" }
    }),
    React4.createElement("span", { className: "hm-navText" }, t("nav.label"))
  );
}
function installNavGlyph() {
  if (typeof document === "undefined" || document.head === void 0 || document.head === null) {
    return () => {
    };
  }
  if (document.getElementById(NAV_STYLE_ID) !== null) return () => {
  };
  const style = document.createElement("style");
  style.id = NAV_STYLE_ID;
  style.textContent = NAV_CSS;
  document.head.appendChild(style);
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style);
  };
}
var inject = ["slots", "locale"];
function translatorOf(props) {
  if (typeof props.t === "function") return props.t;
  if (typeof props.translate === "function") return props.translate;
  return (key) => key;
}
function HyMemorySection(props) {
  useLocaleSubscription(props);
  const t = translatorOf(props);
  return React4.createElement(
    PanelErrorBoundary,
    { t },
    React4.createElement(SettingsSection, { ...props, t })
  );
}
function HyMemorySessionPane(props) {
  useLocaleSubscription(props);
  const t = translatorOf(props);
  return React4.createElement(
    PanelErrorBoundary,
    { t },
    React4.createElement(SessionMemoryView, { ...props, t })
  );
}
function installSessionPanel(ctx, deps) {
  const stops = [];
  if (ctx.sidebarRightTabs !== void 0 && typeof ctx.sidebarRightTabs.register === "function") {
    try {
      stops.push(ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        title: () => deps.t("session.tabTitle"),
        guide: [{
          id: TAB_ID,
          order: 40,
          title: () => deps.t("session.tabTitle"),
          description: () => deps.t("session.tabDesc")
        }]
      }));
    } catch (error) {
      console.error("hy-memory: session tab type could not be registered", error);
    }
  }
  try {
    stops.push(ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
      name: "sidebar.right.pane.tab",
      key: TAB_ID,
      locale: NS,
      inject: (sessionId) => ({
        sessionId,
        translate: deps.t,
        api,
        subscribeLocale: deps.subscribeLocale,
        localeSnapshot: deps.localeSnapshot
      })
    }, HyMemorySessionPane)));
  } catch (error) {
    console.error("hy-memory: session pane seat could not be registered", error);
  }
  return () => {
    for (const stop of stops.reverse()) {
      try {
        stop();
      } catch {
      }
    }
  };
}
function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(NS, dictionaries),
    "hy-memory: bilingual dictionaries"
  );
  const t = ctx.locale.bind(NS);
  const subscribeLocale = (listener) => typeof ctx.on === "function" ? ctx.on("locale/change", listener) : () => {
  };
  const localeSnapshot = () => {
    try {
      return ctx.locale.getLocale?.()?.active ?? "";
    } catch {
      return "";
    }
  };
  void loadStatus().catch(() => {
  });
  ctx.effect(installNavGlyph, "hy-memory: settings nav glyph");
  ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: SECTION_ID,
    order: 30,
    label: () => navLabelNode(t),
    locale: NS,
    inject: () => ({ translate: t, api, subscribeLocale, localeSnapshot })
  }, HyMemorySection)), "hy-memory: settings section");
  ctx.effect(() => {
    let disposed = false;
    let release = null;
    void getSessionPanelEnabled().then((enabled) => {
      if (disposed || !enabled) return;
      if (typeof ctx.inject !== "function") return;
      release = ctx.inject(["sidebarRightTabs", "slots"], (paneCtx) => {
        if (disposed) return () => {
        };
        return installSessionPanel(paneCtx, { t, subscribeLocale, localeSnapshot });
      });
    }).catch(() => {
    });
    return () => {
      disposed = true;
      if (typeof release === "function") {
        try {
          release();
        } catch {
        }
      }
    };
  }, "hy-memory: optional session panel");
}

    return module.exports;
  }
});
