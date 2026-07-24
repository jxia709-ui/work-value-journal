"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  accountFromUser,
  addNamedItem,
  addImportedWorkRecords,
  addWorkRecord,
  deleteWorkRecord,
  isSupabaseConfigured,
  loadWorkspace,
  replaceProjects,
  saveReport,
  saveSourceFileMetadata,
  signInWithPhone,
  signUpWithPhone,
  supabase,
  updateWorkRecord,
} from "@/lib/supabase";
import {
  analyzeKpi,
  analyzeWeeklyReport,
  polishWorkRecord,
  type KpiAnalysis,
  type PolishVersion,
  type WeeklyItem,
} from "@/lib/ai";

type View = "today" | "history" | "profile";

const nav: { id: View; label: string; icon: string }[] = [
  { id: "today", label: "记录今日", icon: "●" },
  { id: "history", label: "历史记录", icon: "▤" },
  { id: "profile", label: "工作档案", icon: "◎" },
];

type RecordItem = { id: string; time: string; occurredAt: string; title: string; refinedTitle: string; project: string; goal: string; polished: boolean };
type ReportItem = { id: string; title: string; date: string; type: "周报" | "月报" | "自定义总结"; status: "已确认" | "草稿"; range: string; count: number };
type UserAccount = { id: string; name: string; phone: string };
type RefineDraft = { record: RecordItem; versions: PolishVersion[]; selected: number };

export default function Home() {
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [currentAccount, setCurrentAccount] = useState<UserAccount | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authHint, setAuthHint] = useState("");
  const [view, setView] = useState<View>("today");
  const [entry, setEntry] = useState("");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [toast, setToast] = useState("");
  const [entryProject, setEntryProject] = useState("");
  const [entryDate, setEntryDate] = useState(() => localDateValue(new Date()));
  const [refinedDraft, setRefinedDraft] = useState<RefineDraft | null>(null);
  const [showReportBuilder, setShowReportBuilder] = useState(false);
  const [reportStyle, setReportStyle] = useState("按事项");
  const [activeReport, setActiveReport] = useState<ReportItem | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<RecordItem | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    async function hydrate(user: Parameters<typeof accountFromUser>[0] | null) {
      if (!active) return;
      if (!user) {
        setCurrentAccount(null);
        setRecords([]);
        setProjects([]);
        setGoals([]);
        setAuthLoading(false);
        return;
      }
      const account = accountFromUser(user);
      setCurrentAccount(account);
      setAccounts([account]);
      try {
        const workspace = await loadWorkspace();
        if (!active) return;
        setRecords(workspace.records.map((record) => ({
          id: record.id,
          time: formatRecordTime(record.occurred_at),
          occurredAt: record.occurred_at,
          title: record.title,
          refinedTitle: record.details || "",
          project: record.project || "未关联项目",
          goal: record.goal || "未关联目标",
          polished: record.polished,
        })));
        setProjects(workspace.projects);
        setGoals(workspace.goals);
        setReports(workspace.reports.map((report) => ({
          id: report.id,
          title: report.title,
          date: report.report_date,
          type: report.report_type,
          status: report.status,
          range: `${report.range_start} — ${report.range_end}`,
          count: report.source_count,
        })));
      } catch (error) {
        flash(authErrorMessage(error));
      } finally {
        if (active) setAuthLoading(false);
      }
    }
    supabase.auth.getUser().then(({ data }) => hydrate(data.user));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => hydrate(session?.user ?? null));
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const title = useMemo(() => ({ today: `下午好，${currentAccount?.name || "新朋友"}`, history: "历史记录", profile: "工作档案" })[view], [view, currentAccount]);
  const subtitle = useMemo(() => ({
    today: "今天完成了什么？用一分钟记下来。",
    history: "按日期回看每天的工作事项与沉淀。",
    profile: "目标、项目和过往表达习惯，都会成为 AI 总结的依据。",
  })[view], [view]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  async function saveEntry() {
    if (!entry.trim()) return flash("先写下一件今天完成的事");
    try {
      const occurredAt = dateAtCurrentTime(entryDate);
      const { versions } = await polishWorkRecord(entry.trim());
      if (!versions?.length) throw new Error("AI 没有生成可选版本");
      const record = await addWorkRecord({ title: entry.trim(), details: "", project: entryProject, occurredAt });
      const item = { id: record.id, time: formatRecordTime(record.occurred_at), occurredAt: record.occurred_at, title: record.title, refinedTitle: "", project: record.project || "未关联项目", goal: "未关联目标", polished: false };
      setRecords([item, ...records]);
      setRefinedDraft({ record: item, versions, selected: 0 });
      setEntry("");
      flash("AI 已生成 3 个提炼版本");
    } catch (error) { flash(authErrorMessage(error)); }
  }

  if (!isSupabaseConfigured) return <main className="auth-page"><section className="auth-panel"><div className="auth-box"><div className="auth-heading"><h2>还差一步配置</h2><p>请为部署环境添加 Supabase 项目地址和 Publishable Key。</p></div></div></section></main>;
  if (authLoading) return <main className="auth-page"><section className="auth-panel"><div className="auth-box"><div className="auth-heading"><h2>正在加载账号…</h2></div></div></section></main>;
  if (!currentAccount) return <AuthScreen hint={authHint} onLogin={async (phone, password) => {
    await signInWithPhone(phone, password);
    setAuthHint("");
  }} onRegister={async (name, phone, password) => {
    await signUpWithPhone(name, phone, password);
    setAuthHint("");
  }} />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("today")} aria-label="返回工作台"><span>值</span><b>工作价值助手</b></button>
        <nav>{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><i>{view === item.id ? "●" : item.icon === "●" ? "○" : item.icon}</i><em>{item.label}</em></button>)}</nav>
      </aside>

      <section className="main-content">
        <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{view === "today" && <button className="primary" onClick={() => { setActiveReport(null); setShowReportBuilder(true); }}>生成工作报告</button>}</header>

        {view === "today" && <>
          <section className="card quick"><h2>快速记录</h2><textarea value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="今天完成了什么？推进了什么？解决了什么问题？\n例如：修改企业端首页方案，和开发确认了卡片展示逻辑。" /><div className="entry-options"><QuickProjectPicker value={entryProject} projects={projects} onChange={setEntryProject} onAdd={async (value) => { try { await addNamedItem("projects", value); setProjects((items) => items.includes(value) ? items : [...items, value]); setEntryProject(value); flash("项目已新增并选中"); } catch (error) { flash(authErrorMessage(error)); } }} /><label>修改时间<input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></label></div><div className="actions"><span className="save-note">保存原始内容，并生成一版可编辑的 AI 提炼</span><button className="primary" onClick={saveEntry}>保存并提炼</button></div></section>
          {refinedDraft && <RefineResult draft={refinedDraft} onChange={setRefinedDraft} onKeep={() => setRefinedDraft(null)} onUse={async () => { const selected = refinedDraft.versions[refinedDraft.selected]; const updated = { ...refinedDraft.record, refinedTitle: selected.text, polished: true }; await updateWorkRecord(updated); setRecords(records.map(item => item.id === updated.id ? updated : item)); setRefinedDraft(null); flash("已采用并保存 AI 提炼内容"); }} />}
          <section className="card recent"><div className="section-title"><h2>最近记录</h2><span>支持查看、修改和删除</span></div>{records.slice(0, 6).map((record) => <div className="record-row" key={record.id}><button className="record-main" onClick={() => setSelectedRecord(record)}><time>{record.time}</time><div><b>{record.polished && record.refinedTitle ? record.refinedTitle : record.title}</b><p>{record.project === "未关联项目" ? "未选择项目" : `关联项目 · ${record.project}`}</p></div><span className="status">{record.polished ? "已采用提炼" : "保留原文"}</span></button><button className="row-edit" onClick={() => setSelectedRecord(record)} aria-label="修改记录">编辑</button><button className="row-delete" onClick={async () => { if (!window.confirm("确定删除这条记录吗？")) return; await deleteWorkRecord(record.id); setRecords(records.filter(item => item.id !== record.id)); flash("记录已删除"); }} aria-label="删除记录">删除</button></div>)}</section>
        </>}

        {view === "history" && <HistoryCalendar records={records} reports={reports} onOpen={setSelectedRecord} />}
        {view === "profile" && <Profile projects={projects} setProjects={async (items) => { try { await replaceProjects(items); setProjects(items); } catch (error) { flash(authErrorMessage(error)); } }} onImported={(items) => setRecords([...items, ...records])} account={currentAccount} accounts={accounts} onSwitch={() => undefined} onAddAccount={async () => { await supabase.auth.signOut(); setAuthHint("登录另一个账号，完成后会自动切换"); }} onLogout={async () => { await supabase.auth.signOut(); setAuthHint("已安全退出当前账号"); }} onDone={() => flash("工作档案已更新")} onFlash={flash} />}
      </section>

      <nav className="bottom-nav">{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><i>{item.icon}</i><span>{item.label}</span></button>)}</nav>
      {showReportBuilder && <div className="drawer-layer report-drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowReportBuilder(false); }}><aside className="report-builder-drawer"><div className="drawer-head"><div><span>从工作记录生成</span><h2>生成工作报告</h2></div><button className="icon-button" onClick={() => setShowReportBuilder(false)}>×</button></div><div className="drawer-body"><ReportBuilder report={activeReport} records={records} projects={projects} reportStyle={reportStyle} setReportStyle={setReportStyle} onSave={async () => {
          const range = activeReport?.range || currentWeekRange();
          const [rangeStart, rangeEnd] = range.split(" — ").map((item) => item.replaceAll(".", "-"));
          try {
            await saveReport({ id: activeReport?.id, title: activeReport?.title || "本周工作周报", reportType: activeReport?.type || "周报", status: "已确认", rangeStart, rangeEnd, sourceCount: records.length });
            flash(`${activeReport?.type || "周报"}已保存`); setShowReportBuilder(false);
          } catch (error) { flash(authErrorMessage(error)); }
        }} /></div></aside></div>}
      {selectedRecord && <RecordDrawer record={selectedRecord} projects={projects} goals={goals} onAddProject={async (value) => { await addNamedItem("projects", value); setProjects([...projects, value]); }} onAddGoal={async (value) => { await addNamedItem("goals", value); setGoals([...goals, value]); }} onClose={() => setSelectedRecord(null)} onSave={async (updated) => { try { await updateWorkRecord(updated); setRecords(records.map((item) => item.id === updated.id ? updated : item)); setSelectedRecord(null); flash("记录已更新"); } catch (error) { flash(authErrorMessage(error)); } }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function AuthScreen({ hint, onLogin, onRegister }: { hint: string; onLogin: (phone: string, password: string) => Promise<void>; onRegister: (name: string, phone: string, password: string) => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^1\d{10}$/.test(phone)) return setError("请输入正确的 11 位手机号");
    if (password.length < 6) return setError("密码至少需要 6 位");
    if (mode === "register" && password !== confirmPassword) return setError("两次输入的密码不一致");
    setError(""); setSubmitting(true);
    try {
      if (mode === "register") await onRegister(name.trim(), phone, password);
      else await onLogin(phone, password);
    } catch (submitError) { setError(authErrorMessage(submitError)); }
    finally { setSubmitting(false); }
  }

  return <main className="auth-page">
    <section className="auth-story">
      <button className="auth-brand" aria-label="工作价值助手"><span>值</span><b>工作价值助手</b></button>
      <div className="auth-copy"><span className="auth-kicker">从记录事项，到看见价值</span><h1>让每一天的工作，<br />都成为成长的证据。</h1><p>持续记录、关联目标，自动生成有价值的周报与总结。</p></div>
      <div className="auth-preview"><div><span>本周工作价值</span><strong>8 项记录</strong><em>已关联 3 个业务目标</em></div><i>↗ 86%</i></div>
    </section>
    <section className="auth-panel"><div className="auth-box">
      <div className="auth-heading"><h2>{mode === "login" ? "欢迎回来" : "创建你的账号"}</h2><p>{mode === "login" ? "登录后继续记录和整理你的工作价值" : "使用手机号和密码注册，无需短信验证"}</p></div>
      {hint && <div className="auth-hint">✓ {hint}</div>}
      <form onSubmit={submit} className="auth-form">
        {mode === "register" && <label>昵称（选填）<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：小夏" autoComplete="name" /></label>}
        <label>手机号<div className="phone-input"><span>+86</span><input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="请输入手机号" inputMode="numeric" autoComplete="tel" /></div></label>
        <label>密码<div className="password-input"><input value={password} onChange={(e) => setPassword(e.target.value)} type={showPassword ? "text" : "password"} placeholder="请输入至少 6 位密码" autoComplete={mode === "login" ? "current-password" : "new-password"} /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "隐藏" : "显示"}</button></div></label>
        {mode === "register" && <label>确认密码<input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type={showPassword ? "text" : "password"} placeholder="请再次输入密码" autoComplete="new-password" /></label>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary auth-submit" type="submit" disabled={submitting}>{submitting ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}</button>
      </form>
      <div className="auth-switch">{mode === "login" ? "还没有账号？" : "已有账号？"}<button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "立即注册" : "返回登录"}</button></div>
      <p className="auth-agreement">登录或注册即表示你同意《用户协议》和《隐私政策》</p>
    </div></section>
  </main>;
}

function maskPhone(phone: string) { return phone.replace(/(\d{3})\d{4}(\d{4})/, "$1 **** $2"); }

function formatRecordTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const day = date.toDateString() === now.toDateString() ? "今天" : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${day} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function localDateValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function dateAtCurrentTime(date: string) {
  const now = new Date();
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, now.getHours(), now.getMinutes()).toISOString();
}

function currentWeekRange() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const format = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", ".");
  return `${format(monday)} — ${format(sunday)}`;
}

function authErrorMessage(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "操作失败，请稍后重试";
  if (/invalid login credentials/i.test(message)) return "手机号或密码不正确";
  if (/user already registered/i.test(message)) return "这个手机号已经注册，请直接登录";
  if (/password/i.test(message) && /characters|length/i.test(message)) return "密码至少需要 6 位";
  return message;
}

function RefineResult({ draft, onChange, onKeep, onUse }: { draft: RefineDraft; onChange: (draft: RefineDraft) => void; onKeep: () => void; onUse: () => void }) {
  const selected = draft.versions[draft.selected];
  return <section className="card refine-result">
    <div className="refine-heading"><div><span>✦ AI 提炼结果</span><h2>选择最适合的一版</h2></div><button className="icon-button" onClick={onKeep}>×</button></div>
    <div className="refine-version-tabs">{draft.versions.map((version, index) => <button key={`${version.label}-${index}`} className={draft.selected === index ? "selected" : ""} onClick={() => onChange({ ...draft, selected: index })}>{version.label}</button>)}</div>
    <textarea value={selected.text} onChange={(e) => onChange({ ...draft, versions: draft.versions.map((item, index) => index === draft.selected ? { ...item, text: e.target.value } : item) })} />
    <div className="refine-actions"><button className="secondary" onClick={onKeep}>保留原内容</button><button className="primary" onClick={onUse}>采用此版本</button></div>
  </section>;
}

function RecordDrawer({ record, projects, goals, onAddProject, onAddGoal, onClose, onSave }: { record: RecordItem; projects: string[]; goals: string[]; onAddProject: (value: string) => void; onAddGoal: (value: string) => void; onClose: () => void; onSave: (record: RecordItem) => void }) {
  const [draft, setDraft] = useState(record);
  const [polishing, setPolishing] = useState(false);
  const [suggestions, setSuggestions] = useState<PolishVersion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  async function polish() {
    setPolishing(true);
    try {
      const result = await polishWorkRecord(draft.title);
      setSuggestions(result.versions);
      setSelectedSuggestion(0);
    } catch (error) {
      window.alert(authErrorMessage(error));
    } finally {
      setPolishing(false);
    }
  }
  return <div className="drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="record-title">
      <div className="drawer-head"><div><span>工作记录</span><h2 id="record-title">记录详情</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭详情">×</button></div>
      <div className="drawer-body">
        <label>工作内容<textarea value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value, polished: false })} /></label>
        <label>记录日期<input type="date" value={localDateValue(new Date(draft.occurredAt))} onChange={(e) => setDraft({ ...draft, occurredAt: dateAtCurrentTime(e.target.value), time: formatRecordTime(dateAtCurrentTime(e.target.value)) })} /></label>
        <button className="ai-polish" onClick={polish} disabled={polishing}><span>✦</span><div><b>{polishing ? "AI 正在润色…" : "AI 润色"}</b><small>让描述更清晰，更突出工作价值</small></div><i>›</i></button>
        {(suggestions.length > 0 || draft.refinedTitle) && <div className="ai-suggestion"><div className="suggestion-head"><span>✦ AI 提炼内容</span><small>选择、编辑后采用，不覆盖原文</small></div>{suggestions.length > 0 && <div className="refine-version-tabs">{suggestions.map((item, index) => <button key={`${item.label}-${index}`} className={selectedSuggestion === index ? "selected" : ""} onClick={() => setSelectedSuggestion(index)}>{item.label}</button>)}</div>}<textarea value={suggestions.length ? suggestions[selectedSuggestion].text : draft.refinedTitle} onChange={(e) => suggestions.length ? setSuggestions(suggestions.map((item, index) => index === selectedSuggestion ? { ...item, text: e.target.value } : item)) : setDraft({ ...draft, refinedTitle: e.target.value })} /><div><button className="text-button" onClick={() => { setSuggestions([]); setDraft({ ...draft, polished: false }); }}>保留原文</button><button className="replace-button" onClick={() => { setDraft({ ...draft, refinedTitle: suggestions.length ? suggestions[selectedSuggestion].text : draft.refinedTitle, polished: true }); setSuggestions([]); }}>采用提炼</button></div></div>}
        <div className="drawer-divider" /><div className="relation-title"><h3>关联工作</h3><p>关联后，AI 会在总结时匹配对应的业务价值。</p></div>
        <EditableSelect label="关联目标" value={draft.goal} empty="未关联目标" options={goals} addLabel="＋ 新增目标" onChange={(goal) => setDraft({ ...draft, goal })} onAdd={onAddGoal} />
        <EditableSelect label="关联项目" value={draft.project} empty="未关联项目" options={projects} addLabel="＋ 新增项目" onChange={(project) => setDraft({ ...draft, project })} onAdd={onAddProject} />
        <div className="relation-preview"><span>当前关联</span><b>{draft.project !== "未关联项目" ? draft.project : draft.goal}</b></div>
      </div>
      <div className="drawer-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={() => onSave(draft)}>保存修改</button></div>
    </aside>
  </div>;
}

function QuickProjectPicker({ value, projects, onChange, onAdd }: { value: string; projects: string[]; onChange: (value: string) => void; onAdd: (value: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [saving, setSaving] = useState(false);
  async function addProject() {
    const next = newProject.trim();
    if (!next || saving) return;
    setSaving(true);
    await onAdd(next);
    setSaving(false);
    setNewProject("");
    setAdding(false);
    setOpen(false);
  }
  return <label className="quick-project-field">选择项目
    <div className="quick-project-picker">
      <button type="button" className={`project-picker-trigger ${open ? "open" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{value || "暂不选择"}</span><i>⌄</i>
      </button>
      {open && <div className="project-picker-menu">
        <button type="button" className={!value ? "selected" : ""} onClick={() => { onChange(""); setOpen(false); }}>暂不选择</button>
        {projects.map((project) => <button type="button" key={project} className={value === project ? "selected" : ""} onClick={() => { onChange(project); setOpen(false); }}>{project}<span>{value === project ? "✓" : ""}</span></button>)}
        <button type="button" className="add-project-option" onClick={() => setAdding(true)}>＋ 新增项目</button>
        {adding && <div className="quick-project-add"><input autoFocus value={newProject} onChange={(e) => setNewProject(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addProject(); } }} placeholder="输入项目名称" /><button type="button" onClick={() => void addProject()} disabled={saving}>{saving ? "保存中" : "添加"}</button></div>}
      </div>}
    </div>
  </label>;
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function HistoryCalendar({ records, reports, onOpen }: { records: RecordItem[]; reports: ReportItem[]; onOpen: (record: RecordItem) => void }) {
  const latest = records[0] ? new Date(records[0].occurredAt) : new Date();
  const [mode, setMode] = useState<"day" | "week">("day");
  const [weeklyStyle, setWeeklyStyle] = useState("按事项");
  const [cursor, setCursor] = useState(new Date(latest.getFullYear(), latest.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(localDateValue(latest));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => index - firstOffset + 1);
  const recordsByDate = records.reduce<Record<string, RecordItem[]>>((grouped, record) => {
    const key = localDateValue(new Date(record.occurredAt));
    (grouped[key] ||= []).push(record);
    return grouped;
  }, {});
  const selectedRecords = recordsByDate[selectedDate] || [];
  const selectedWeekStart = startOfWeek(new Date(`${selectedDate}T12:00:00`));
  const selectedWeekEnd = new Date(selectedWeekStart);
  selectedWeekEnd.setDate(selectedWeekStart.getDate() + 6);
  const weekStartKey = localDateValue(selectedWeekStart);
  const weekEndKey = localDateValue(selectedWeekEnd);
  const weeklyRecords = records.filter((record) => {
    const key = localDateValue(new Date(record.occurredAt));
    return key >= weekStartKey && key <= weekEndKey;
  });
  const weeklyReport = reports.find((report) => report.type === "周报" && report.range.slice(0, 10) <= weekEndKey && report.range.slice(-10) >= weekStartKey);
  const chooseDate = (key: string) => setSelectedDate(key);
  return <div className="history-layout">
    <section className="card calendar-card">
      <div className="history-toolbar"><div className="history-switch"><button className={mode === "day" ? "selected" : ""} onClick={() => setMode("day")}>按日</button><button className={mode === "week" ? "selected" : ""} onClick={() => setMode("week")}>按周</button></div><span>{mode === "day" ? "选择日期查看当天记录" : "选择任意日期查看所在周周报"}</span></div>
      <div className="calendar-head"><button onClick={() => setCursor(new Date(year, month - 1, 1))}>‹</button><h2>{year} 年 {month + 1} 月</h2><button onClick={() => setCursor(new Date(year, month + 1, 1))}>›</button></div>
      <div className="calendar-week">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{cells.map((day, index) => {
        if (day < 1 || day > days) return <span className="calendar-empty" key={index} />;
        const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const count = recordsByDate[key]?.length || 0;
        const inSelectedWeek = mode === "week" && key >= weekStartKey && key <= weekEndKey;
        return <button key={key} className={`${mode === "day" && selectedDate === key ? "selected" : ""} ${inSelectedWeek ? "week-selected" : ""} ${count ? "has-record" : ""}`} onClick={() => chooseDate(key)}><b>{day}</b>{count > 0 && <em>{count} 项</em>}</button>;
      })}</div>
    </section>
    {mode === "day" ? <section className="card day-records"><div className="section-title"><div><span className="eyebrow">当日记录</span><h2>{selectedDate.replaceAll("-", ".")}</h2></div><strong>{selectedRecords.length} 项</strong></div>{selectedRecords.length ? selectedRecords.map(record => <button key={record.id} onClick={() => onOpen(record)}><div><b>{record.polished && record.refinedTitle ? record.refinedTitle : record.title}</b><p>{record.project}</p></div><i>›</i></button>) : <div className="calendar-empty-state"><span>○</span><b>这一天还没有记录</b><p>选择有紫色标记的日期查看工作事项。</p></div>}</section>
      : <section className="card day-records weekly-report-card"><div className="section-title"><div><span className="eyebrow">本周周报</span><h2>{weekStartKey.replaceAll("-", ".")} — {weekEndKey.replaceAll("-", ".")}</h2></div><strong>{weeklyRecords.length} 项</strong></div>{weeklyReport ? <><div className="weekly-report-summary"><span>{weeklyReport.status}</span><h3>{weeklyReport.title}</h3><p>该周周报已生成，共引用 {weeklyReport.count} 条工作记录。</p></div><div className="report-mode history-report-mode"><span>周报分类方式</span><div className="tabs">{["按事项", "按业务目标", "按项目"].map((style) => <button key={style} onClick={() => setWeeklyStyle(style)} className={weeklyStyle === style ? "selected" : ""}>{style}</button>)}</div></div><ReportContent mode={weeklyStyle} /></> : weeklyRecords.length ? <><div className="weekly-report-summary draft-summary"><span>待生成</span><h3>本周工作记录汇总</h3><p>当前共有 {weeklyRecords.length} 条记录，可前往“记录今日”生成正式周报。</p></div>{weeklyRecords.map(record => <button key={record.id} onClick={() => onOpen(record)}><div><b>{record.polished && record.refinedTitle ? record.refinedTitle : record.title}</b><p>{record.project}</p></div><i>›</i></button>)}</> : <div className="calendar-empty-state"><span>○</span><b>这一周还没有记录或周报</b><p>在日历中选择其他时间段查看。</p></div>}</section>}
  </div>;
}

function EditableSelect({ label, value, empty, options, addLabel, onChange, onAdd }: { label: string; value: string; empty: string; options: string[]; addLabel: string; onChange: (value: string) => void; onAdd: (value: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  function add() { const value = newValue.trim(); if (!value) return; onAdd(value); onChange(value); setNewValue(""); setAdding(false); }
  return <label>{label}<select value={value} onChange={(e) => { if (e.target.value === "__add__") setAdding(true); else onChange(e.target.value); }}><option>{empty}</option>{options.map((option) => <option key={option}>{option}</option>)}<option value="__add__">{addLabel}</option></select>{adding && <div className="inline-add"><input autoFocus value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={`输入${label.replace("关联", "")}名称`} /><button type="button" onClick={add}>添加</button><button type="button" onClick={() => setAdding(false)}>取消</button></div>}</label>;
}

function WeeklyRecords({ records, total, onClose, onOpen }: { records: RecordItem[]; total: number; onClose: () => void; onOpen: (record: RecordItem) => void }) {
  return <div className="drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><aside className="record-drawer weekly-drawer" role="dialog" aria-modal="true"><div className="drawer-head"><div><span>2026.07.20 — 07.26</span><h2>本周记录 · {total}</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="weekly-summary"><div><strong>{total}</strong><span>全部记录</span></div><div><strong>{records.filter(r => r.project !== "未关联项目").length + 4}</strong><span>已关联</span></div><div><strong>{records.filter(r => r.polished).length + 5}</strong><span>已提炼</span></div></div><div className="drawer-body weekly-list">{records.map(record => <button key={record.id} onClick={() => onOpen(record)}><time>{record.time}</time><b>{record.title}</b><span>{record.project}</span><i>›</i></button>)}<div className="older-records">另有 6 条较早记录已收起</div></div></aside></div>;
}

function ReportBuilder({ report, records, projects, reportStyle, setReportStyle, onSave }: { report: ReportItem | null; records: RecordItem[]; projects: string[]; reportStyle: string; setReportStyle: (s: string) => void; onSave: () => void }) {
  const [showSources, setShowSources] = useState(false);
  const type = report?.type || "周报";
  const range = report?.range || "2026.07.20 — 2026.07.26";
  const count = report?.count || 8;
  const heading = report?.title || "第 30 周周报";
  return <>
    <div className="report-layout"><section className="range-card"><h2>总结范围</h2><div className="range-options">{["周报", "月报", "自定义总结"].map(x => <button key={x} className={type === x ? "selected" : ""}>{x.replace("总结", "")}</button>)}</div><label>时间范围<input value={range} readOnly /></label><label>关联项目<select><option>全部项目</option>{projects.map(project => <option key={project}>{project}</option>)}</select></label><button className="primary full">重新生成</button></section>
      <section className="card report"><div className="report-top"><div><span className="eyebrow">{report?.status === "已确认" ? "正式报告" : "AI 生成稿"}</span><h2>{heading}</h2><button className="source-link" onClick={() => setShowSources(true)}>{count} 条原始记录 <span>查看生成依据 ›</span></button></div></div>
        <div className="report-mode"><span>报告分类方式</span><div className="tabs">{["按事项", "按业务目标", "按项目"].map(x => <button key={x} onClick={() => setReportStyle(x)} className={reportStyle === x ? "selected" : ""}>{x}</button>)}</div></div>
        <ReportContent mode={reportStyle} /><div className="report-actions"><button className="secondary">导出</button><button className="primary" onClick={onSave}>保存{report?.status === "已确认" ? "修改" : `正式${type}`}</button></div></section></div>
    {showSources && <SourceRecords records={records} count={count} range={range} onClose={() => setShowSources(false)} />}
  </>;
}

function ReportContent({ mode }: { mode: string }) {
  if (mode === "按业务目标") return <div className="report-copy" contentEditable suppressContentEditableWarning><h3>目标一：提升核心服务入口使用效率</h3><ul><li>完成企业端首页核心卡片方案迭代，重新梳理服务完成、待办与风险提醒的信息优先级。</li><li>明确自适应展示规则，为用户快速找到高频服务建立清晰路径。</li></ul><h3>目标二：推动 AI 能力进入真实业务流程</h3><ul><li>补充 AI 开票异常反馈流程，完善从发起、处理到结果反馈的业务闭环。</li></ul><h3>目标三：减少沟通与返工成本</h3><p>与产品和开发完成关键交互规则对齐，并沉淀验收口径。</p></div>;
  if (mode === "按项目") return <div className="report-copy" contentEditable suppressContentEditableWarning><h3>企业端首页改版</h3><ul><li>完成核心卡片方案迭代并明确内容优先级。</li><li>与开发对齐桌面、平板和手机端的响应式规则。</li></ul><h3>AI 开票</h3><ul><li>补充异常反馈路径和结果状态，完善业务闭环。</li></ul><h3>合规服务体验</h3><p>梳理风险提醒与服务日历的首页整合方向。</p></div>;
  return <div className="report-copy" contentEditable suppressContentEditableWarning><h3>本周核心事项</h3><ol><li><b>首页方案迭代：</b>完成企业端首页核心卡片方案，明确服务完成、待办与风险提醒的信息优先级。</li><li><b>跨团队协作：</b>与产品和开发对齐交互规则，减少设计还原偏差，推动方案进入开发阶段。</li><li><b>流程完善：</b>补充 AI 开票异常反馈流程，完善从发起、处理到结果反馈的业务闭环。</li></ol><h3>下阶段事项</h3><p>跟进首页开发验收，完成开票异常流程的关键页面设计。</p></div>;
}

function SourceRecords({ records, count, range, onClose }: { records: RecordItem[]; count: number; range: string; onClose: () => void }) {
  const samples = [...records, { id: -1, time: "周三 11:20", title: "整理首页响应式规则与验收清单", project: "企业端首页改版", goal: "减少跨团队沟通与返工成本", polished: true }, { id: -2, time: "周二 16:40", title: "梳理风险提醒卡片的信息优先级", project: "合规服务体验", goal: "提升核心服务入口使用效率", polished: true }];
  return <div className="drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><aside className="record-drawer source-drawer" role="dialog" aria-modal="true"><div className="drawer-head"><div><span>{range}</span><h2>原始数据记录 · {count}</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="source-note">以下记录是本次报告的生成依据，可返回工作台修改原始内容。</div><div className="drawer-body source-list">{samples.slice(0, Math.min(count, samples.length)).map(item => <article key={item.id}><time>{item.time}</time><b>{item.title}</b><div><span>{item.project}</span><span>{item.goal}</span></div></article>)}{count > samples.length && <div className="older-records">另有 {count - samples.length} 条记录已收起</div>}</div></aside></div>;
}

function History({ reports, onOpen }: { reports: ReportItem[]; onOpen: (report: ReportItem) => void }) {
  return <><div className="filters"><button>全部类型⌄</button><button>2026 年⌄</button><button>全部项目⌄</button><button>全部状态⌄</button></div><section className="card report-list">{reports.length ? reports.map((report) => <button key={report.id} onClick={() => onOpen(report)}><span className="doc">▤</span><div><b>{report.title}</b><p>{report.date} · {report.type} · {report.range} · {report.count} 条记录</p></div><em className={report.status === "草稿" ? "draft" : "status"}>{report.status}</em><i>›</i></button>) : <div className="older-records">还没有历史报告，先生成一份周报吧</div>}</section></>;
}

type ImportedReport = { id: number; name: string; period: string; items: WeeklyItem[]; projects: string[] };

function Profile({ projects, setProjects, onImported, account, accounts, onSwitch, onAddAccount, onLogout, onDone, onFlash }: { projects: string[]; setProjects: (items: string[]) => void; onImported: (items: RecordItem[]) => void; account: UserAccount; accounts: UserAccount[]; onSwitch: (account: UserAccount) => void; onAddAccount: () => void; onLogout: () => void; onDone: () => void; onFlash: (message: string) => void }) {
  const [profileFile, setProfileFile] = useState("");
  const [uploading, setUploading] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [selectedImport, setSelectedImport] = useState<ImportedReport | null>(null);
  const [imports, setImports] = useState<ImportedReport[]>([]);
  const [kpiDraft, setKpiDraft] = useState<KpiAnalysis | null>(null);
  const [role, setRole] = useState("用户体验设计师");
  const [coreGoal, setCoreGoal] = useState("提升核心服务入口使用效率");
  async function uploadProfile(file?: File) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return onFlash("文件超过 20MB，请重新选择");
    setUploading(true);
    try {
      const analysis = await analyzeKpi(file);
      if (!analysis.items?.length) throw new Error("AI 未识别到 KPI，请尝试内容更清晰的文件");
      await saveSourceFileMetadata(file, "profile");
      setProfileFile(file.name);
      setKpiDraft(analysis);
      onFlash("KPI 解析完成，请选择并确认");
    } catch (error) { onFlash(authErrorMessage(error)); }
    finally { setUploading(false); }
  }
  async function importReports(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const selected = Array.from(files);
      const analyses = await Promise.all(selected.map(async (file) => {
        const analysis = await analyzeWeeklyReport(file);
        await saveSourceFileMetadata(file, "weekly_report");
        return { id: Date.now() + Math.random(), name: file.name, ...analysis };
      }));
      const added = analyses;
      setImports([...added, ...imports]);
      setSelectedImport(added[0]);
      onFlash(`已解析 ${files.length} 份周报，请确认日期后导入`);
    } catch (error) { onFlash(authErrorMessage(error)); }
    finally { setUploading(false); }
  }
  async function confirmImport(report: ImportedReport) {
    const selected = report.items.filter((item) => item.selected);
    if (!selected.length) return onFlash("请至少选择一条工作事项");
    if (selected.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.date))) return onFlash("仍有事项日期待确认，请补充日期");
    setUploading(true);
    try {
      const saved = await addImportedWorkRecords(selected.map((item) => ({ title: item.title, project: item.project, occurredAt: dateAtCurrentTime(item.date) })));
      onImported(saved.map((record) => ({ id: record.id, time: formatRecordTime(record.occurred_at), occurredAt: record.occurred_at, title: record.title, refinedTitle: record.details || "", project: record.project || "未关联项目", goal: record.goal || "未关联目标", polished: record.polished })));
      setSelectedImport(null);
      onFlash(`已按日期导入 ${saved.length} 条记录`);
    } catch (error) { onFlash(authErrorMessage(error)); }
    finally { setUploading(false); }
  }
  function confirmKpi() {
    if (!kpiDraft) return;
    const chosen = kpiDraft.items.filter((item) => item.selected);
    if (!chosen.length) return onFlash("请至少选择一项 KPI");
    setCoreGoal(chosen.map((item) => item.title).join("；"));
    if (kpiDraft.role) setRole(kpiDraft.role);
    setKpiDraft(null);
    onFlash(`已将 ${chosen.length} 项 KPI 填入工作档案`);
  }
  function addProject() { const value = newProject.trim(); if (!value || projects.includes(value)) return; setProjects([...projects, value]); setNewProject(""); }
  return <>
    <div className="profile-grid">
      <section className="card account-card"><div className="account-title"><div><span className="eyebrow">账号管理</span><h2>登录账号</h2></div><span className="secure-badge">已安全登录</span></div><div className="current-account"><span>{account.name.slice(0, 1)}</span><div><b>{account.name}</b><p>{maskPhone(account.phone)} · 手机号账号</p></div><em>当前账号</em></div><div className="account-actions"><button className="secondary" onClick={onAddAccount}>＋ 添加 / 登录其他账号</button><button className="danger-button" onClick={onLogout}>退出登录</button></div>{accounts.filter((item) => item.id !== account.id).length > 0 && <div className="other-accounts"><label>快速切换账号</label>{accounts.filter((item) => item.id !== account.id).map((item) => <button key={item.id} onClick={() => onSwitch(item)}><i>{item.name.slice(0, 1)}</i><div><b>{item.name}</b><small>{maskPhone(item.phone)}</small></div><span>切换 ›</span></button>)}</div>}</section>
      <section className="card upload"><span>⇧</span><h2>上传 KPI / OKR / 岗位职责</h2><p>支持 PDF、Word、Excel，单个文件不超过 20MB</p><label className="primary file-button">{uploading ? "上传并解析中…" : "选择文件"}<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => uploadProfile(e.target.files?.[0])} /></label>{profileFile && <div className="upload-success"><span>✓</span><div><b>{profileFile}</b><small>上传成功 · AI 已提取工作背景</small></div><button onClick={() => setProfileFile("")}>移除</button></div>}</section>
      <section className="card goals"><div><span className="eyebrow">工作档案</span><h2>你的工作背景</h2></div><label>核心目标<textarea value={coreGoal} onChange={(e) => setCoreGoal(e.target.value)} /></label><label>当前岗位<input value={role} onChange={(e) => setRole(e.target.value)} /></label><div className="project-field"><label>重点项目</label><div className="project-tags">{projects.map(project => <span key={project}>{project}<button aria-label={`删除${project}`} onClick={() => setProjects(projects.filter(item => item !== project))}>×</button></span>)}</div><div className="project-add"><input value={newProject} onChange={(e) => setNewProject(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProject(); } }} placeholder="输入新项目名称" /><button onClick={addProject}>＋ 添加项目</button></div><small>这些项目会同步到周报的项目选择中</small></div><button className="primary" onClick={onDone}>确认并更新档案</button></section>
      <section className="card import"><h2>导入历史周报</h2><p>系统会学习你的项目结构和表达习惯。</p><label className="secondary file-button">{uploading ? "正在提取内容…" : "批量上传周报"}<input type="file" multiple accept=".pdf,.doc,.docx,.txt" onChange={(e) => importReports(e.target.files)} /></label><div className="analysis"><b>已分析 {imports.length} 份历史周报</b><p>已提取工作事项、关联项目及成果表达，点击文件可查看。</p></div><div className="import-list">{imports.map(item => <button key={item.id} onClick={() => setSelectedImport(item)}><span>▤</span><div><b>{item.name}</b><small>{item.period} · 提取 {item.items.length} 项内容</small></div><i>查看 ›</i></button>)}</div></section>
    </div>
    {kpiDraft && <div className="drawer-layer"><aside className="record-drawer import-drawer"><div className="drawer-head"><div><span>上传后确认</span><h2>选择要写入的 KPI</h2></div><button className="icon-button" onClick={() => setKpiDraft(null)}>×</button></div><div className="drawer-body"><p className="source-note">AI 解析结果不会直接覆盖档案。请勾选、修改后确认。</p>{kpiDraft.items.map((item, index) => <div className="kpi-review" key={index}><label className="review-check"><input type="checkbox" checked={item.selected} onChange={(e) => setKpiDraft({ ...kpiDraft, items: kpiDraft.items.map((value, itemIndex) => itemIndex === index ? { ...value, selected: e.target.checked } : value) })} />采用此项</label><input value={item.title} onChange={(e) => setKpiDraft({ ...kpiDraft, items: kpiDraft.items.map((value, itemIndex) => itemIndex === index ? { ...value, title: e.target.value } : value) })} />{item.metrics.map((metric, metricIndex) => <label className="metric-review" key={metricIndex}><input type="checkbox" checked={metric.selected} onChange={(e) => setKpiDraft({ ...kpiDraft, items: kpiDraft.items.map((value, itemIndex) => itemIndex === index ? { ...value, metrics: value.metrics.map((child, childIndex) => childIndex === metricIndex ? { ...child, selected: e.target.checked } : child) } : value) })} /><input value={metric.text} onChange={(e) => setKpiDraft({ ...kpiDraft, items: kpiDraft.items.map((value, itemIndex) => itemIndex === index ? { ...value, metrics: value.metrics.map((child, childIndex) => childIndex === metricIndex ? { ...child, text: e.target.value } : child) } : value) })} /></label>)}</div>)}</div><div className="drawer-actions"><button className="secondary" onClick={() => setKpiDraft(null)}>取消</button><button className="primary" onClick={confirmKpi}>确认写入档案</button></div></aside></div>}
    {selectedImport && <div className="drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedImport(null); }}><aside className="record-drawer import-drawer"><div className="drawer-head"><div><span>{selectedImport.period}</span><h2>确认周报提取内容</h2></div><button className="icon-button" onClick={() => setSelectedImport(null)}>×</button></div><div className="drawer-body"><div className="import-file-name">{selectedImport.name}</div><div className="extracted-block"><h3>逐条确认日期和事项</h3>{selectedImport.items.map((item, index) => <article className="weekly-review-item" key={index}><input type="checkbox" checked={item.selected} onChange={(e) => setSelectedImport({ ...selectedImport, items: selectedImport.items.map((value, itemIndex) => itemIndex === index ? { ...value, selected: e.target.checked } : value) })} /><div><input type="date" value={item.date} onChange={(e) => setSelectedImport({ ...selectedImport, items: selectedImport.items.map((value, itemIndex) => itemIndex === index ? { ...value, date: e.target.value } : value) })} /><textarea value={item.title} onChange={(e) => setSelectedImport({ ...selectedImport, items: selectedImport.items.map((value, itemIndex) => itemIndex === index ? { ...value, title: e.target.value } : value) })} /><input placeholder="关联项目（选填）" value={item.project} onChange={(e) => setSelectedImport({ ...selectedImport, items: selectedImport.items.map((value, itemIndex) => itemIndex === index ? { ...value, project: e.target.value } : value) })} /></div></article>)}</div><div className="source-note import-note">日期不明确的事项会留空，必须由你确认日期后才会写入历史记录。</div></div><div className="drawer-actions"><button className="secondary" onClick={() => setSelectedImport(null)}>暂不导入</button><button className="primary" disabled={uploading} onClick={() => void confirmImport(selectedImport)}>{uploading ? "正在写入…" : "确认并按日期导入"}</button></div></aside></div>}
  </>;
}
