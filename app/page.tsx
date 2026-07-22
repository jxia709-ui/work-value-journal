"use client";

import { FormEvent, useMemo, useState } from "react";

type View = "today" | "generate" | "history" | "profile";

const nav: { id: View; label: string; icon: string }[] = [
  { id: "today", label: "今日工作台", icon: "●" },
  { id: "generate", label: "生成报告", icon: "✦" },
  { id: "history", label: "历史报告", icon: "▤" },
  { id: "profile", label: "工作档案", icon: "◎" },
];

type RecordItem = { id: number; time: string; title: string; project: string; goal: string; polished: boolean };
type ReportItem = { id: string; title: string; date: string; type: "周报" | "月报" | "自定义总结"; status: "已确认" | "草稿"; range: string; count: number };
type UserAccount = { id: number; name: string; phone: string };

const historyReports: ReportItem[] = [
  { id: "week-29", title: "7月第3周周报", date: "2026.07.18", type: "周报", status: "已确认", range: "2026.07.13 — 2026.07.19", count: 11 },
  { id: "month-06", title: "2026年6月月报", date: "2026.07.01", type: "月报", status: "已确认", range: "2026.06.01 — 2026.06.30", count: 34 },
  { id: "q2-review", title: "Q2 工作复盘", date: "2026.06.30", type: "自定义总结", status: "草稿", range: "2026.04.01 — 2026.06.30", count: 76 },
  { id: "week-28", title: "7月第2周周报", date: "2026.07.11", type: "周报", status: "已确认", range: "2026.07.06 — 2026.07.12", count: 9 },
];

const initialRecords: RecordItem[] = [
  { id: 1, time: "今天 14:30", title: "企业端首页方案迭代与开发对齐", project: "企业端首页改版", goal: "提升核心服务入口使用效率", polished: true },
  { id: 2, time: "昨天 17:10", title: "补充 AI 开票异常反馈流程", project: "AI 开票", goal: "推动 AI 能力进入真实业务流程", polished: true },
];

export default function Home() {
  const [accounts, setAccounts] = useState<UserAccount[]>([
    { id: 1, name: "Hang", phone: "13800138000" },
    { id: 2, name: "工作小号", phone: "18600001234" },
  ]);
  const [currentAccount, setCurrentAccount] = useState<UserAccount | null>(null);
  const [authHint, setAuthHint] = useState("");
  const [view, setView] = useState<View>("today");
  const [entry, setEntry] = useState("");
  const [records, setRecords] = useState(initialRecords);
  const [toast, setToast] = useState("");
  const [detail, setDetail] = useState(false);
  const [reportStyle, setReportStyle] = useState("按事项");
  const [activeReport, setActiveReport] = useState<ReportItem | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<RecordItem | null>(null);
  const [showWeeklyRecords, setShowWeeklyRecords] = useState(false);
  const [projects, setProjects] = useState(["企业端首页改版", "AI 开票", "合规服务体验"]);
  const [goals, setGoals] = useState(["提升核心服务入口使用效率", "推动 AI 能力进入真实业务流程", "减少跨团队沟通与返工成本"]);

  const title = useMemo(() => ({ today: `下午好，${currentAccount?.name || "新朋友"}`, generate: "生成工作报告", history: "历史报告", profile: "工作档案" })[view], [view, currentAccount]);
  const subtitle = useMemo(() => ({
    today: "今天完成了什么？用一分钟记下来。",
    generate: "选择时间范围，AI 会把零散工作转化为可汇报的价值。",
    history: "查看已确认的周报、月报和自定义总结。",
    profile: "目标、项目和过往表达习惯，都会成为 AI 总结的依据。",
  })[view], [view]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function saveEntry() {
    if (!entry.trim()) return flash("先写下一件今天完成的事");
    setRecords([{ id: Date.now(), time: "刚刚", title: entry.trim(), project: "未关联项目", goal: "未关联目标", polished: true }, ...records]);
    setEntry("");
    flash("已保存，AI 已完成价值提炼");
  }

  if (!currentAccount) return <AuthScreen accounts={accounts} hint={authHint} onLogin={(phone) => {
    const matched = accounts.find((item) => item.phone === phone);
    const account = matched || { id: Date.now(), name: `用户 ${phone.slice(-4)}`, phone };
    if (!matched) setAccounts([...accounts, account]);
    setCurrentAccount(account);
    setAuthHint("");
  }} onRegister={(name, phone) => {
    const account = { id: Date.now(), name: name || `用户 ${phone.slice(-4)}`, phone };
    setAccounts([...accounts.filter((item) => item.phone !== phone), account]);
    setCurrentAccount(account);
    setAuthHint("");
  }} />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("today")} aria-label="返回工作台"><span>值</span><b>工作价值助手</b></button>
        <nav>{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { if (item.id === "generate") setActiveReport(null); setView(item.id); }}><i>{view === item.id ? "●" : item.icon === "●" ? "○" : item.icon}</i><em>{item.label}</em></button>)}</nav>
        <button className="week-note" onClick={() => setShowWeeklyRecords(true)}>本周已记录 {records.length + 6} 项工作 <span>查看 ›</span></button>
      </aside>

      <section className="main-content">
        <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{view === "today" && <button className="primary" onClick={() => { setActiveReport(null); setView("generate"); }}>生成本周周报</button>}{view === "history" && <button className="primary" onClick={() => { setActiveReport(null); setView("generate"); }}>＋ 新建总结</button>}</header>

        {view === "today" && <>
          <section className="metrics">
            <button className="metric-card" onClick={() => setShowWeeklyRecords(true)}><span className="purple">本周记录</span><strong>{records.length + 6}</strong><em>查看全部 ›</em></button>
            <article><span className="green">关联目标</span><strong>3</strong></article>
            <article><span className="orange">周报完整度</span><strong>{Math.min(100, 70 + records.length * 5)}%</strong></article>
          </section>
          <section className="card quick"><h2>快速记录</h2><textarea value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="今天完成了什么？推进了什么？解决了什么问题？\n例如：修改企业端首页方案，和开发确认了卡片展示逻辑。" /><div className="actions"><button className="secondary" onClick={() => setDetail(!detail)}>＋ 补充更多信息</button><button className="primary" onClick={saveEntry}>保存并提炼</button></div>{detail && <div className="details"><select aria-label="关联项目"><option>企业端首页改版</option><option>AI 开票</option><option>其他项目</option></select><input placeholder="补充结果或数据（可选）" /></div>}</section>
          <section className="card recent"><div className="section-title"><h2>最近记录</h2><span>点击记录查看详情</span></div>{records.slice(0, 4).map((record) => <button className="record-row" key={record.id} onClick={() => setSelectedRecord(record)}><time>{record.time}</time><div><b>{record.title}</b><p>{record.project === "未关联项目" ? "待关联目标或项目" : `关联项目 · ${record.project}`}</p></div><span className="status">{record.polished ? "已提炼" : "待润色"}</span><i aria-hidden="true">›</i></button>)}</section>
        </>}

        {view === "generate" && <ReportBuilder report={activeReport} records={records} projects={projects} reportStyle={reportStyle} setReportStyle={setReportStyle} onSave={() => { flash(`${activeReport?.type || "周报"}已保存`); setView("history"); }} />}
        {view === "history" && <History onOpen={(report) => { setActiveReport(report); setReportStyle("按事项"); setView("generate"); }} />}
        {view === "profile" && <Profile projects={projects} setProjects={setProjects} account={currentAccount} accounts={accounts} onSwitch={(account) => { setCurrentAccount(account); flash(`已切换至 ${account.name}`); }} onAddAccount={() => { setAuthHint("登录另一个账号，完成后会自动切换"); setCurrentAccount(null); }} onLogout={() => { setAuthHint("已安全退出当前账号"); setCurrentAccount(null); }} onDone={() => flash("工作档案已更新")} onFlash={flash} />}
      </section>

      <nav className="bottom-nav">{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { if (item.id === "generate") setActiveReport(null); setView(item.id); }}><i>{item.icon}</i><span>{item.label.replace("今日工作台", "工作台").replace("生成报告", "生成").replace("历史报告", "历史").replace("工作档案", "档案")}</span></button>)}</nav>
      {selectedRecord && <RecordDrawer record={selectedRecord} projects={projects} goals={goals} onAddProject={(value) => setProjects([...projects, value])} onAddGoal={(value) => setGoals([...goals, value])} onClose={() => setSelectedRecord(null)} onSave={(updated) => { setRecords(records.map((item) => item.id === updated.id ? updated : item)); setSelectedRecord(null); flash("记录已更新"); }} />}
      {showWeeklyRecords && <WeeklyRecords records={records} total={records.length + 6} onClose={() => setShowWeeklyRecords(false)} onOpen={(record) => { setShowWeeklyRecords(false); setSelectedRecord(record); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function AuthScreen({ accounts, hint, onLogin, onRegister }: { accounts: UserAccount[]; hint: string; onLogin: (phone: string) => void; onRegister: (name: string, phone: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^1\d{10}$/.test(phone)) return setError("请输入正确的 11 位手机号");
    if (password.length < 6) return setError("密码至少需要 6 位");
    if (mode === "register" && password !== confirmPassword) return setError("两次输入的密码不一致");
    setError("");
    if (mode === "register") onRegister(name.trim(), phone);
    else onLogin(phone);
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
        <button className="primary auth-submit" type="submit">{mode === "login" ? "登录" : "注册并登录"}</button>
      </form>
      {mode === "login" && accounts.length > 0 && <div className="remembered"><span>最近登录</span>{accounts.slice(0, 2).map((account) => <button key={account.id} onClick={() => { setPhone(account.phone); setPassword("123456"); }}><i>{account.name.slice(0, 1)}</i><div><b>{account.name}</b><small>{maskPhone(account.phone)}</small></div><em>使用此账号</em></button>)}</div>}
      <div className="auth-switch">{mode === "login" ? "还没有账号？" : "已有账号？"}<button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "立即注册" : "返回登录"}</button></div>
      <p className="auth-agreement">登录或注册即表示你同意《用户协议》和《隐私政策》</p>
    </div></section>
  </main>;
}

function maskPhone(phone: string) { return phone.replace(/(\d{3})\d{4}(\d{4})/, "$1 **** $2"); }

function RecordDrawer({ record, projects, goals, onAddProject, onAddGoal, onClose, onSave }: { record: RecordItem; projects: string[]; goals: string[]; onAddProject: (value: string) => void; onAddGoal: (value: string) => void; onClose: () => void; onSave: (record: RecordItem) => void }) {
  const [draft, setDraft] = useState(record);
  const [polishing, setPolishing] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  function polish() {
    setPolishing(true);
    window.setTimeout(() => {
      setSuggestion(`完成${draft.title.replace(/^完成/, "")}，明确关键方案与协作结论，推动后续工作按计划落地。`);
      setPolishing(false);
    }, 650);
  }
  return <div className="drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="record-title">
      <div className="drawer-head"><div><span>工作记录</span><h2 id="record-title">记录详情</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭详情">×</button></div>
      <div className="drawer-body">
        <label>工作内容<textarea value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value, polished: false })} /></label>
        <button className="ai-polish" onClick={polish} disabled={polishing}><span>✦</span><div><b>{polishing ? "AI 正在润色…" : "AI 润色"}</b><small>让描述更清晰，更突出工作价值</small></div><i>›</i></button>
        {suggestion && <div className="ai-suggestion"><div className="suggestion-head"><span>✦ AI 润色建议</span><small>原内容不会被自动修改</small></div><p>{suggestion}</p><div><button className="text-button" onClick={() => setSuggestion("")}>暂不使用</button><button className="replace-button" onClick={() => { setDraft({ ...draft, title: suggestion, polished: true }); setSuggestion(""); }}>替换原内容</button></div></div>}
        <div className="drawer-divider" /><div className="relation-title"><h3>关联工作</h3><p>关联后，AI 会在总结时匹配对应的业务价值。</p></div>
        <EditableSelect label="关联目标" value={draft.goal} empty="未关联目标" options={goals} addLabel="＋ 新增目标" onChange={(goal) => setDraft({ ...draft, goal })} onAdd={onAddGoal} />
        <EditableSelect label="关联项目" value={draft.project} empty="未关联项目" options={projects} addLabel="＋ 新增项目" onChange={(project) => setDraft({ ...draft, project })} onAdd={onAddProject} />
        <div className="relation-preview"><span>当前关联</span><b>{draft.project !== "未关联项目" ? draft.project : draft.goal}</b></div>
      </div>
      <div className="drawer-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={() => onSave(draft)}>保存修改</button></div>
    </aside>
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

function History({ onOpen }: { onOpen: (report: ReportItem) => void }) {
  return <><div className="filters"><button>全部类型⌄</button><button>2026 年⌄</button><button>全部项目⌄</button><button>全部状态⌄</button></div><section className="card report-list">{historyReports.map((report) => <button key={report.id} onClick={() => onOpen(report)}><span className="doc">▤</span><div><b>{report.title}</b><p>{report.date} · {report.type} · {report.range} · {report.count} 条记录</p></div><em className={report.status === "草稿" ? "draft" : "status"}>{report.status}</em><i>›</i></button>)}</section></>;
}

type ImportedReport = { id: number; name: string; period: string; items: string[]; projects: string[] };

function Profile({ projects, setProjects, account, accounts, onSwitch, onAddAccount, onLogout, onDone, onFlash }: { projects: string[]; setProjects: (items: string[]) => void; account: UserAccount; accounts: UserAccount[]; onSwitch: (account: UserAccount) => void; onAddAccount: () => void; onLogout: () => void; onDone: () => void; onFlash: (message: string) => void }) {
  const [profileFile, setProfileFile] = useState("");
  const [uploading, setUploading] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [selectedImport, setSelectedImport] = useState<ImportedReport | null>(null);
  const [imports, setImports] = useState<ImportedReport[]>([
    { id: 1, name: "2026年7月第2周周报.docx", period: "07.06 — 07.12", items: ["完成企业端首页核心卡片方案", "补充 AI 开票异常反馈流程", "与开发对齐响应式展示规则"], projects: ["企业端首页改版", "AI 开票"] },
    { id: 2, name: "2026年7月第1周周报.pdf", period: "06.29 — 07.05", items: ["梳理合规提醒信息优先级", "完成服务日历入口方案"], projects: ["合规服务体验"] },
  ]);
  function uploadProfile(file?: File) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return onFlash("文件超过 20MB，请重新选择");
    setUploading(true);
    window.setTimeout(() => { setProfileFile(file.name); setUploading(false); onFlash("文件上传成功，已完成内容提取"); }, 500);
  }
  function importReports(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    window.setTimeout(() => {
      const added = Array.from(files).map((file, index) => ({ id: Date.now() + index, name: file.name, period: "自动识别时间范围", items: ["提取工作事项与成果表达", "识别关联项目和业务目标", "保留原始周报内容供查看"], projects: projects.slice(0, 2) }));
      setImports([...added, ...imports]); setUploading(false); onFlash(`成功导入 ${files.length} 份周报`);
    }, 650);
  }
  function addProject() { const value = newProject.trim(); if (!value || projects.includes(value)) return; setProjects([...projects, value]); setNewProject(""); }
  return <>
    <div className="profile-grid">
      <section className="card account-card"><div className="account-title"><div><span className="eyebrow">账号管理</span><h2>登录账号</h2></div><span className="secure-badge">已安全登录</span></div><div className="current-account"><span>{account.name.slice(0, 1)}</span><div><b>{account.name}</b><p>{maskPhone(account.phone)} · 手机号账号</p></div><em>当前账号</em></div><div className="account-actions"><button className="secondary" onClick={onAddAccount}>＋ 添加 / 登录其他账号</button><button className="danger-button" onClick={onLogout}>退出登录</button></div>{accounts.filter((item) => item.id !== account.id).length > 0 && <div className="other-accounts"><label>快速切换账号</label>{accounts.filter((item) => item.id !== account.id).map((item) => <button key={item.id} onClick={() => onSwitch(item)}><i>{item.name.slice(0, 1)}</i><div><b>{item.name}</b><small>{maskPhone(item.phone)}</small></div><span>切换 ›</span></button>)}</div>}</section>
      <section className="card upload"><span>⇧</span><h2>上传 KPI / OKR / 岗位职责</h2><p>支持 PDF、Word、Excel，单个文件不超过 20MB</p><label className="primary file-button">{uploading ? "上传并解析中…" : "选择文件"}<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => uploadProfile(e.target.files?.[0])} /></label>{profileFile && <div className="upload-success"><span>✓</span><div><b>{profileFile}</b><small>上传成功 · AI 已提取工作背景</small></div><button onClick={() => setProfileFile("")}>移除</button></div>}</section>
      <section className="card goals"><div><span className="eyebrow">AI 已提取</span><h2>你的工作背景</h2></div><label>核心目标<input defaultValue="提升核心服务入口使用效率" /></label><label>当前岗位<input defaultValue="用户体验设计师" /></label><div className="project-field"><label>重点项目</label><div className="project-tags">{projects.map(project => <span key={project}>{project}<button aria-label={`删除${project}`} onClick={() => setProjects(projects.filter(item => item !== project))}>×</button></span>)}</div><div className="project-add"><input value={newProject} onChange={(e) => setNewProject(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProject(); } }} placeholder="输入新项目名称" /><button onClick={addProject}>＋ 添加项目</button></div><small>这些项目会同步到周报的项目选择中</small></div><button className="primary" onClick={onDone}>确认并更新档案</button></section>
      <section className="card import"><h2>导入历史周报</h2><p>系统会学习你的项目结构和表达习惯。</p><label className="secondary file-button">{uploading ? "正在提取内容…" : "批量上传周报"}<input type="file" multiple accept=".pdf,.doc,.docx,.txt" onChange={(e) => importReports(e.target.files)} /></label><div className="analysis"><b>已分析 {imports.length} 份历史周报</b><p>已提取工作事项、关联项目及成果表达，点击文件可查看。</p></div><div className="import-list">{imports.map(item => <button key={item.id} onClick={() => setSelectedImport(item)}><span>▤</span><div><b>{item.name}</b><small>{item.period} · 提取 {item.items.length} 项内容</small></div><i>查看 ›</i></button>)}</div></section>
    </div>
    {selectedImport && <div className="drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedImport(null); }}><aside className="record-drawer import-drawer"><div className="drawer-head"><div><span>{selectedImport.period}</span><h2>周报提取内容</h2></div><button className="icon-button" onClick={() => setSelectedImport(null)}>×</button></div><div className="drawer-body"><div className="import-file-name">{selectedImport.name}</div><div className="extracted-block"><h3>识别到的项目</h3><div className="project-tags">{selectedImport.projects.map(project => <span key={project}>{project}</span>)}</div></div><div className="extracted-block"><h3>提取的工作事项</h3>{selectedImport.items.map((item, index) => <article key={item}><em>{index + 1}</em><p>{item}</p></article>)}</div><div className="source-note import-note">提取内容会用于后续报告生成，你仍可在每日记录中修改对应事项。</div></div></aside></div>}
  </>;
}
