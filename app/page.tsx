"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  accountFromUser,
  addNamedItem,
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

type View = "today" | "history" | "profile";

const nav: { id: View; label: string; icon: string }[] = [
  { id: "today", label: "记录今日", icon: "●" },
  { id: "history", label: "历史记录", icon: "▤" },
  { id: "profile", label: "工作档案", icon: "◎" },
];

type RecordItem = { id: string; time: string; occurredAt: string; title: string; refinedTitle: string; project: string; goal: string; polished: boolean };
type ReportItem = { id: string; title: string; date: string; type: "周报" | "月报" | "自定义总结"; status: "已确认" | "草稿"; range: string; count: number; imported?: boolean; fileName?: string };
type UserAccount = { id: string; name: string; phone: string };
type RefinementOption = { label: string; text: string };
type ParsedWeeklyItem = { date: string | null; content: string; project?: string; goal?: string };
type WeeklyImportPreview = { fileName: string; items: Array<ParsedWeeklyItem & { selected: boolean }> };

function recordDisplayTitle(record: RecordItem) {
  return record.polished && record.refinedTitle.trim()
    ? record.refinedTitle
    : record.title;
}

function localRecordKey(accountId: string) {
  return `work-value-journal:records:${accountId}`;
}

function readLocalRecords(accountId: string): RecordItem[] {
  try {
    return JSON.parse(window.localStorage.getItem(localRecordKey(accountId)) || "[]") as RecordItem[];
  } catch {
    return [];
  }
}

function writeLocalRecords(accountId: string, records: RecordItem[]) {
  window.localStorage.setItem(localRecordKey(accountId), JSON.stringify(records.filter((record) => !record.id.startsWith("demo-"))));
}

function demoRecords(): RecordItem[] {
  const samples = [
    ["完成企业端首页卡片方案第二轮优化", "企业端首页改版", "提升核心服务入口使用效率"],
    ["与开发确认移动端响应式和验收规则", "企业端首页改版", "减少跨团队沟通与返工成本"],
    ["补充 AI 开票异常反馈流程", "AI 开票", "推动 AI 能力进入真实业务流程"],
    ["整理用户访谈问题与核心结论", "用户研究", "提升产品决策质量"],
    ["完成风险提醒卡片视觉规范", "合规服务体验", "提升核心服务入口使用效率"],
    ["复盘本周项目进度并同步下一步计划", "团队协作", "减少跨团队沟通与返工成本"],
  ];
  return samples.map(([title, project, goal], index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    date.setHours(10 + index, 20, 0, 0);
    return { id: `demo-${index}`, time: formatRecordTime(date.toISOString()), occurredAt: date.toISOString(), title, refinedTitle: `${title}，沉淀关键结论并推动后续工作按计划落地。`, project, goal, polished: index % 2 === 0 };
  });
}

function demoReports(): ReportItem[] {
  const now = new Date();
  return [0, 7, 14].map((offset, index) => {
    const end = new Date(now); end.setDate(now.getDate() - offset);
    const start = new Date(end); start.setDate(end.getDate() - 6);
    return { id: `demo-report-${index}`, title: `第 ${30 - index} 周周报`, date: localDateValue(end), type: "周报", status: index ? "已确认" : "草稿", range: `${localDateValue(start).replaceAll("-", ".")} — ${localDateValue(end).replaceAll("-", ".")}`, count: 6 - index };
  });
}

export default function Home() {
  const [currentAccount, setCurrentAccount] = useState<UserAccount | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authHint, setAuthHint] = useState("");
  const [view, setView] = useState<View>("today");
  const [entry, setEntry] = useState("");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [importingReports, setImportingReports] = useState(false);
  const [weeklyImportPreview, setWeeklyImportPreview] = useState<WeeklyImportPreview | null>(null);
  const [toast, setToast] = useState("");
  const [entryProject, setEntryProject] = useState("");
  const [entryDate, setEntryDate] = useState(() => localDateValue(new Date()));
  const [refinedDraft, setRefinedDraft] = useState<RecordItem | null>(null);
  const [refinementOptions, setRefinementOptions] = useState<RefinementOption[]>([]);
  const [selectedRefinement, setSelectedRefinement] = useState(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [showReportBuilder, setShowReportBuilder] = useState(false);
  const [reportStyle, setReportStyle] = useState("按照事项");
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
      const localRecords = readLocalRecords(account.id);
      try {
        const workspace = await loadWorkspace();
        if (!active) return;
        const remoteRecords = workspace.records.map((record) => ({
          id: record.id,
          time: formatRecordTime(record.occurred_at),
          occurredAt: record.occurred_at,
          title: record.title,
          refinedTitle: record.details || "",
          project: record.project || "未关联项目",
          goal: record.goal || "未关联目标",
          polished: record.polished,
        }));
        const mergedRecords = [...localRecords, ...remoteRecords.filter((remote) => !localRecords.some((local) => local.id === remote.id))];
        setRecords(mergedRecords);
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
        if (!mergedRecords.length) {
          setRecords(demoRecords());
          setReports(demoReports());
          setProjects(["企业端首页改版", "AI 开票", "用户研究", "合规服务体验"]);
          setGoals(["提升核心服务入口使用效率", "推动 AI 能力进入真实业务流程", "减少跨团队沟通与返工成本"]);
        }
      } catch (error) {
        setRecords(localRecords.length ? localRecords : demoRecords());
        setReports(demoReports());
        setProjects(["企业端首页改版", "AI 开票", "用户研究", "合规服务体验"]);
        setGoals(["提升核心服务入口使用效率", "推动 AI 能力进入真实业务流程", "减少跨团队沟通与返工成本"]);
        flash(localRecords.length ? "已加载本机保存的测试记录" : authErrorMessage(error));
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
    const occurredAt = dateAtCurrentTime(entryDate);
    setAiLoading(true);
    let options: RefinementOption[];
    try {
      const result = await callAi<{ options: RefinementOption[] }>("refine", {
        content: entry.trim(),
        project: entryProject,
        goals,
        projects,
        date: entryDate,
      });
      options = result.options.filter((item) => item.text?.trim()).slice(0, 3);
      if (options.length !== 3) throw new Error("AI 未返回完整的三个版本，请重试");
    } catch (error) {
      setAiLoading(false);
      return flash(authErrorMessage(error));
    }
    const refinedTitle = options[0].text;
    try {
      const record = await addWorkRecord({ title: entry.trim(), details: refinedTitle, project: entryProject, occurredAt });
      const item = { id: record.id, time: formatRecordTime(record.occurred_at), occurredAt: record.occurred_at, title: record.title, refinedTitle: record.details || refinedTitle, project: record.project || "未关联项目", goal: "未关联目标", polished: false };
      setRecords((current) => {
        const next = [item, ...current];
        if (currentAccount) writeLocalRecords(currentAccount.id, next);
        return next;
      });
      setRefinedDraft(item);
      setRefinementOptions(options);
      setSelectedRefinement(0);
      setEntry("");
      flash("已生成 3 个 AI 提炼版本，请选择");
    } catch {
      const item = { id: `local-${crypto.randomUUID()}`, time: formatRecordTime(occurredAt), occurredAt, title: entry.trim(), refinedTitle, project: entryProject || "未关联项目", goal: "未关联目标", polished: false };
      setRecords((current) => {
        const next = [item, ...current.filter((record) => !record.id.startsWith("demo-"))];
        if (currentAccount) writeLocalRecords(currentAccount.id, next);
        return next;
      });
      setRefinedDraft(item);
      setRefinementOptions(options);
      setSelectedRefinement(0);
      setEntry("");
      flash("已保存到测试环境，刷新后仍会保留");
    } finally {
      setAiLoading(false);
    }
  }

  async function importHistoricalReports(files: FileList | null) {
    if (!files?.length) return;
    setImportingReports(true);
    try {
      const selected = Array.from(files);
      const previewItems: WeeklyImportPreview["items"] = [];
      for (const file of selected) {
        await saveSourceFileMetadata(file, "weekly_report").catch(() => null);
        const text = await extractFileText(file);
        if (!text.trim()) throw new Error(`${file.name} 未读取到可解析内容`);
        const parsed = await callAi<{ items: ParsedWeeklyItem[] }>("parse-weekly", {
          fileName: file.name,
          text,
          referenceDate: localDateValue(new Date(file.lastModified || Date.now())),
        });
        const items = parsed.items.filter((item) => item.content?.trim());
        if (!items.length) throw new Error(`${file.name} 未识别到工作事项`);
        previewItems.push(...items.map((item) => ({
          ...item,
          date: isDateValue(item.date) ? item.date : null,
          selected: true,
        })));
      }
      setWeeklyImportPreview({ fileName: selected.map((file) => file.name).join("、"), items: previewItems });
      flash(`AI 已拆分出 ${previewItems.length} 条事项，请检查日期后确认导入`);
    } catch (error) {
      flash(authErrorMessage(error));
    } finally {
      setImportingReports(false);
    }
  }

  async function confirmWeeklyImport() {
    if (!weeklyImportPreview) return;
    const selected = weeklyImportPreview.items.filter((item) => item.selected);
    if (!selected.length) return flash("请至少选择一条事项");
    if (selected.some((item) => !isDateValue(item.date))) return flash("请为每条已选事项补充有效日期");
    setImportingReports(true);
    const importedRecords: RecordItem[] = [];
    for (const item of selected) {
      const occurredAt = dateAtNoon(item.date!);
      try {
        const saved = await addWorkRecord({ title: item.content.trim(), details: "", project: item.project || "", occurredAt });
        importedRecords.push({ id: saved.id, time: formatRecordTime(saved.occurred_at), occurredAt: saved.occurred_at, title: saved.title, refinedTitle: "", project: saved.project || "未关联项目", goal: item.goal || "未关联目标", polished: false });
      } catch {
        importedRecords.push({ id: `local-import-${crypto.randomUUID()}`, time: formatRecordTime(occurredAt), occurredAt, title: item.content.trim(), refinedTitle: "", project: item.project || "未关联项目", goal: item.goal || "未关联目标", polished: false });
      }
    }
    const dates = selected.map((item) => item.date!).sort();
    const report: ReportItem = {
      id: `imported-${Date.now()}`,
      title: weeklyImportPreview.fileName.replace(/\.[^.、]+$/, "") || "历史周报",
      date: dates[dates.length - 1],
      type: "周报",
      status: "已确认",
      range: `${dates[0]} — ${dates[dates.length - 1]}`,
      count: selected.length,
      imported: true,
      fileName: weeklyImportPreview.fileName,
    };
    setRecords((current) => {
      const next = [...importedRecords, ...current.filter((item) => !item.id.startsWith("demo-"))];
      if (currentAccount) writeLocalRecords(currentAccount.id, next);
      return next;
    });
    setReports((current) => [report, ...current]);
    setWeeklyImportPreview(null);
    setImportingReports(false);
    flash(`已按日期导入 ${selected.length} 条事项`);
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
        <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{view === "today" && <button className="primary" onClick={() => { setActiveReport(null); setShowReportBuilder(true); }}>生成工作报告</button>}{view === "history" && <label className="secondary history-import-button">{importingReports ? "正在导入…" : "导入历史周报"}<input type="file" multiple accept=".pdf,.doc,.docx,.txt,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp" onChange={(e) => { void importHistoricalReports(e.target.files); e.currentTarget.value = ""; }} /></label>}{view === "profile" && <div className="compact-account"><span>{currentAccount.name.slice(0, 1)}</span><div><b>{currentAccount.name}</b><small>{maskPhone(currentAccount.phone)}</small></div><button onClick={async () => { await supabase.auth.signOut(); setAuthHint("登录另一个账号，完成后会自动切换"); }}>切换</button><button className="compact-logout" onClick={async () => { await supabase.auth.signOut(); setAuthHint("已安全退出当前账号"); }}>退出</button></div>}</header>

        {view === "today" && <>
          <section className="card quick"><h2>快速记录</h2><textarea value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="今天完成了什么？推进了什么？解决了什么问题？\n例如：修改企业端首页方案，和开发确认了卡片展示逻辑。" /><div className="entry-options"><QuickProjectPicker value={entryProject} projects={projects} onChange={setEntryProject} onAdd={async (value) => { try { await addNamedItem("projects", value); } catch { /* keep the project available for interaction testing */ } setProjects((items) => items.includes(value) ? items : [...items, value]); setEntryProject(value); flash("项目已新增并选中"); }} /><label>修改时间<input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></label></div><div className="actions"><span className="save-note">保存原始内容，AI 将生成 3 个侧重点不同的版本</span><button className="primary" disabled={aiLoading} onClick={saveEntry}>{aiLoading ? "AI 正在理解…" : "保存并提炼"}</button></div>{refinedDraft && <div className="quick-ai-result"><div className="quick-original"><span>你的原始输入</span><p>{refinedDraft.title}</p></div><div className="quick-ai-head"><div><span>✦ AI 提炼 · 选择一个版本</span><small>结合项目和目标生成，均可修改</small></div></div><div className="ai-version-tabs">{refinementOptions.map((option, index) => <button key={option.label} className={selectedRefinement === index ? "selected" : ""} onClick={() => { setSelectedRefinement(index); setRefinedDraft({ ...refinedDraft, refinedTitle: option.text }); }}>{option.label}</button>)}</div><textarea value={refinedDraft.refinedTitle} onChange={(e) => setRefinedDraft({ ...refinedDraft, refinedTitle: e.target.value })} /><div className="record-ai-actions"><button className="text-button" onClick={() => setRefinedDraft(null)}>暂不使用</button><button className="replace-button" onClick={async () => { const updated = { ...refinedDraft, polished: true }; try { if (!updated.id.startsWith("local-")) await updateWorkRecord(updated); } catch { /* keep local fallback */ } const next = records.map(item => item.id === updated.id ? updated : item); setRecords(next); writeLocalRecords(currentAccount.id, next); setRefinedDraft(null); flash("已采用并保存所选 AI 版本"); }}>采用这个版本</button></div></div>}</section>
          <section className="card recent"><div className="section-title"><h2>最近记录</h2><span>支持查看、修改和删除</span></div>{records.slice(0, 6).map((record) => {
            return <article className="record-card" key={record.id}>
              <div className="record-row"><button className="record-main" onClick={() => setSelectedRecord(record)}><time>{record.time}</time><div><b>{recordDisplayTitle(record)}</b><p>{record.project === "未关联项目" ? "未选择项目" : `关联项目 · ${record.project}`}</p></div><span className="status">{record.polished ? "已采用提炼" : "已记录"}</span></button><button className="row-edit" onClick={() => setSelectedRecord(record)} aria-label="修改记录">编辑</button><button className="row-delete" onClick={async () => { if (!window.confirm("确定删除这条记录吗？")) return; try { if (!record.id.startsWith("demo-") && !record.id.startsWith("local-")) await deleteWorkRecord(record.id); } catch { /* remove the test copy locally */ } const next = records.filter(item => item.id !== record.id); setRecords(next); if (currentAccount) writeLocalRecords(currentAccount.id, next); flash("记录已删除"); }} aria-label="删除记录">删除</button></div>
            </article>;
          })}</section>
        </>}

        {view === "history" && <HistoryCalendar records={records} reports={reports} onOpen={setSelectedRecord} onOpenReport={(report) => { setActiveReport(report); setShowReportBuilder(true); }} onGenerateWeek={(range, count) => { setActiveReport({ id: "", title: "本周工作周报", date: localDateValue(new Date()), type: "周报", status: "草稿", range, count }); setShowReportBuilder(true); }} onGenerateMonth={(range, count) => { setActiveReport({ id: "", title: "本月工作月报", date: localDateValue(new Date()), type: "月报", status: "草稿", range, count }); setShowReportBuilder(true); }} />}
        {view === "profile" && <Profile projects={projects} setProjects={async (items) => { setProjects(items); try { await replaceProjects(items); } catch { flash("已在测试环境更新项目"); } }} onDone={() => flash("工作档案已更新")} onFlash={flash} />}
      </section>

      <nav className="bottom-nav">{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><i>{item.icon}</i><span>{item.label}</span></button>)}</nav>
      {showReportBuilder && <div className="drawer-layer report-drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowReportBuilder(false); }}><aside className="report-builder-drawer"><div className="drawer-head"><div><span>从工作记录生成</span><h2>生成工作报告</h2></div><button className="icon-button" onClick={() => setShowReportBuilder(false)}>×</button></div><div className="drawer-body"><ReportBuilder report={activeReport} records={records} projects={projects} reportStyle={reportStyle} setReportStyle={setReportStyle} onSave={async (sourceCount) => {
          const range = activeReport?.range || currentWeekRange();
          const [rangeStart, rangeEnd] = range.split(" — ").map((item) => item.replaceAll(".", "-"));
          try {
            await saveReport({ id: activeReport?.id, title: activeReport?.title || "本周工作周报", reportType: activeReport?.type || "周报", status: "已确认", rangeStart, rangeEnd, sourceCount });
            if (activeReport) {
              const saved = { ...activeReport, id: activeReport.id || `local-report-${Date.now()}`, status: "已确认" as const, count: sourceCount };
              setReports((items) => [saved, ...items.filter((item) => item.id !== activeReport.id)]);
            }
            flash(`${activeReport?.type || "周报"}已保存`); setShowReportBuilder(false);
          } catch (error) { flash(authErrorMessage(error)); }
        }} /></div></aside></div>}
      {selectedRecord && <RecordDrawer record={selectedRecord} projects={projects} goals={goals} onAddProject={async (value) => { try { await addNamedItem("projects", value); } catch { /* keep selectable in the test environment */ } setProjects([...projects, value]); }} onAddGoal={async (value) => { try { await addNamedItem("goals", value); } catch { /* keep selectable in the test environment */ } setGoals([...goals, value]); }} onClose={() => setSelectedRecord(null)} onSave={async (updated) => { try { if (!updated.id.startsWith("demo-") && !updated.id.startsWith("local-")) await updateWorkRecord(updated); } catch { /* persist the editable test copy below */ } const next = records.map((item) => item.id === updated.id ? updated : item); setRecords(next); if (currentAccount) writeLocalRecords(currentAccount.id, next); setSelectedRecord(null); flash("记录已更新"); }} />}
      {weeklyImportPreview && <div className="drawer-layer weekly-preview-layer"><section className="weekly-preview"><div className="drawer-head"><div><span>AI 拆分结果</span><h2>确认周报事项与日期</h2></div><button className="icon-button" onClick={() => setWeeklyImportPreview(null)}>×</button></div><p className="weekly-preview-help">每一条事项都会保存到对应日期。你可以取消勾选、修改日期和事项内容，再确认导入。</p><div className="weekly-preview-list">{weeklyImportPreview.items.map((item, index) => <article key={index} className={item.selected ? "selected" : ""}><input aria-label={`选择事项 ${index + 1}`} type="checkbox" checked={item.selected} onChange={(e) => setWeeklyImportPreview((preview) => preview ? { ...preview, items: preview.items.map((value, itemIndex) => itemIndex === index ? { ...value, selected: e.target.checked } : value) } : null)} /><label><span>日期</span><input type="date" value={item.date || ""} onChange={(e) => setWeeklyImportPreview((preview) => preview ? { ...preview, items: preview.items.map((value, itemIndex) => itemIndex === index ? { ...value, date: e.target.value || null } : value) } : null)} /></label><label className="weekly-content-field"><span>事项 {index + 1}</span><textarea value={item.content} onChange={(e) => setWeeklyImportPreview((preview) => preview ? { ...preview, items: preview.items.map((value, itemIndex) => itemIndex === index ? { ...value, content: e.target.value } : value) } : null)} /></label></article>)}</div><div className="weekly-preview-actions"><span>已选 {weeklyImportPreview.items.filter((item) => item.selected).length} / {weeklyImportPreview.items.length} 条</span><button className="secondary" onClick={() => setWeeklyImportPreview(null)}>取消</button><button className="primary" disabled={importingReports} onClick={() => void confirmWeeklyImport()}>{importingReports ? "正在写入…" : "确认并按日期导入"}</button></div></section></div>}
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
  if (Number.isNaN(date.getTime())) return "日期待补充";
  const now = new Date();
  const day = date.toDateString() === now.toDateString() ? "今天" : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${day} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function localDateValue(date: Date) {
  if (Number.isNaN(date.getTime())) return localDateValue(new Date());
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function recordDateValue(record: RecordItem) {
  const parsed = new Date(record.occurredAt || "");
  return Number.isNaN(parsed.getTime()) ? localDateValue(new Date()) : localDateValue(parsed);
}

function dateAtCurrentTime(date: string) {
  const now = new Date();
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return now.toISOString();
  return new Date(year, month - 1, day, now.getHours(), now.getMinutes()).toISOString();
}

function dateAtNoon(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

function isDateValue(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

async function callAi<T>(action: "refine" | "parse-weekly" | "parse-kpi", payload: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("登录已失效，请重新登录");
  const response = await fetch("/.netlify/functions/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "AI 服务暂时不可用，请稍后重试");
  return body as T;
}

async function extractFileText(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "txt" || extension === "csv") return file.text();
  if (extension === "docx") {
    const mammoth = await import("mammoth/mammoth.browser");
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  if (extension === "xls" || extension === "xlsx") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    return workbook.SheetNames.map((name) => `【${name}】\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join("\n\n");
  }
  if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return pages.join("\n");
  }
  if (file.type.startsWith("image/")) {
    const Tesseract = await import("tesseract.js");
    return (await Tesseract.recognize(file, "chi_sim+eng")).data.text;
  }
  throw new Error("暂不支持该文件格式，请使用 PDF、DOCX、Excel、CSV、TXT 或图片");
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

function RecordDrawer({ record, projects, goals, onAddProject, onAddGoal, onClose, onSave }: { record: RecordItem; projects: string[]; goals: string[]; onAddProject: (value: string) => void; onAddGoal: (value: string) => void; onClose: () => void; onSave: (record: RecordItem) => void }) {
  const [draft, setDraft] = useState<RecordItem>(() => ({
    id: String(record.id || `local-${crypto.randomUUID()}`),
    time: record.time || "日期待补充",
    occurredAt: Number.isNaN(new Date(record.occurredAt || "").getTime()) ? new Date().toISOString() : record.occurredAt,
    title: record.title || "",
    refinedTitle: record.refinedTitle || "",
    project: record.project || "未关联项目",
    goal: record.goal || "未关联目标",
    polished: Boolean(record.polished),
  }));
  const [polishing, setPolishing] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [drawerOptions, setDrawerOptions] = useState<RefinementOption[]>([]);
  async function polish() {
    setPolishing(true);
    try {
      const result = await callAi<{ options: RefinementOption[] }>("refine", {
        content: draft.title,
        project: draft.project,
        goal: draft.goal,
        projects,
        goals,
        date: recordDateValue(draft),
      });
      setDrawerOptions(result.options.slice(0, 3));
      setSuggestion(result.options[0]?.text || "");
    } catch (error) {
      setSuggestion(authErrorMessage(error));
    } finally {
      setPolishing(false);
    }
  }
  return <div className="drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="record-title">
      <div className="drawer-head"><div><span>工作记录</span><h2 id="record-title">记录详情</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭详情">×</button></div>
      <div className="drawer-body">
        <label>工作内容<textarea value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value, polished: false })} /></label>
        <label>记录日期<input type="date" value={recordDateValue(draft)} onChange={(e) => { const occurredAt = dateAtCurrentTime(e.target.value); setDraft({ ...draft, occurredAt, time: formatRecordTime(occurredAt) }); }} /></label>
        <button className="ai-polish" onClick={polish} disabled={polishing}><span>✦</span><div><b>{polishing ? "AI 正在润色…" : "AI 润色"}</b><small>让描述更清晰，更突出工作价值</small></div><i>›</i></button>
        {(suggestion || draft.refinedTitle) && <div className="ai-suggestion"><div className="suggestion-head"><span>✦ AI 提炼内容</span><small>可直接修改，不覆盖原文</small></div>{drawerOptions.length > 0 && <div className="ai-version-tabs">{drawerOptions.map((option) => <button key={option.label} className={suggestion === option.text ? "selected" : ""} onClick={() => setSuggestion(option.text)}>{option.label}</button>)}</div>}<textarea value={suggestion || draft.refinedTitle} onChange={(e) => suggestion ? setSuggestion(e.target.value) : setDraft({ ...draft, refinedTitle: e.target.value })} /><div><button className="text-button" onClick={() => { setSuggestion(""); setDraft({ ...draft, polished: false }); }}>保留原文</button><button className="replace-button" onClick={() => { setDraft({ ...draft, refinedTitle: suggestion || draft.refinedTitle, polished: true }); setSuggestion(""); }}>采用这个版本</button></div></div>}
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

function HistoryCalendar({ records, reports, onOpen, onOpenReport, onGenerateWeek, onGenerateMonth }: { records: RecordItem[]; reports: ReportItem[]; onOpen: (record: RecordItem) => void; onOpenReport: (report: ReportItem) => void; onGenerateWeek: (range: string, count: number) => void; onGenerateMonth: (range: string, count: number) => void }) {
  const latest = records[0] ? new Date(records[0].occurredAt) : new Date();
  const [mode, setMode] = useState<"day" | "week" | "month">("week");
  const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
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
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(days).padStart(2, "0")}`;
  const monthlyReports = reports.filter((report) => report.type === "周报" && report.range.slice(-10) >= monthStart && report.range.slice(0, 10) <= monthEnd);
  const selectedMonthlyReports = monthlyReports.filter((report) => selectedWeeks.includes(report.id));
  return <div className="history-layout">
    <section className="card calendar-card">
      <div className="history-toolbar"><div className="history-switch"><button className={mode === "day" ? "selected" : ""} onClick={() => setMode("day")}>按日</button><button className={mode === "week" ? "selected" : ""} onClick={() => setMode("week")}>按周</button><button className={mode === "month" ? "selected" : ""} onClick={() => { setMode("month"); setSelectedWeeks(monthlyReports.map((report) => report.id)); }}>按月</button></div><span>{mode === "day" ? "选择日期查看当天记录" : mode === "week" ? "选择任意日期查看所在周周报" : "选择周报汇总生成月报"}</span></div>
      <div className="calendar-head"><button onClick={() => setCursor(new Date(year, month - 1, 1))}>‹</button><h2>{year} 年 {month + 1} 月</h2><button onClick={() => setCursor(new Date(year, month + 1, 1))}>›</button></div>
      <div className="calendar-week">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{cells.map((day, index) => {
        if (day < 1 || day > days) return <span className="calendar-empty" key={index} />;
        const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const count = recordsByDate[key]?.length || 0;
        const inSelectedWeek = mode === "week" && key >= weekStartKey && key <= weekEndKey;
        return <button key={key} className={`${mode === "day" && selectedDate === key ? "selected" : ""} ${inSelectedWeek ? "week-selected" : ""} ${count ? "has-record" : ""}`} onClick={() => setSelectedDate(key)}><b>{day}</b>{count > 0 && <em>{count} 项</em>}</button>;
      })}</div>
    </section>
    {mode === "day" ? <section className="card day-records"><div className="section-title"><div><span className="eyebrow">当日记录</span><h2>{selectedDate.replaceAll("-", ".")}</h2></div><strong>{selectedRecords.length} 项</strong></div>{selectedRecords.length ? selectedRecords.map(record => <button key={record.id} onClick={() => onOpen(record)}><div><b>{recordDisplayTitle(record)}</b><p>{record.project}</p></div><i>›</i></button>) : <div className="calendar-empty-state"><span>○</span><b>这一天还没有记录</b><p>选择有紫色标记的日期查看工作事项。</p></div>}</section>
      : mode === "week" ? <section className="card day-records weekly-report-card"><div className="section-title"><div><span className="eyebrow">本周周报</span><h2>{weekStartKey.replaceAll("-", ".")} — {weekEndKey.replaceAll("-", ".")}</h2></div><strong>{weeklyRecords.length} 项</strong></div>{weeklyReport ? <button className={`weekly-report-summary clickable-summary ${weeklyReport.imported ? "imported-report" : ""}`} onClick={() => onOpenReport(weeklyReport)}><div className="report-labels"><span>{weeklyReport.status}</span>{weeklyReport.imported && <span className="imported-label">历史导入</span>}</div><h3>{weeklyReport.title}</h3><p>{weeklyReport.imported ? `来源文件：${weeklyReport.fileName || weeklyReport.title} · 点击查看完整内容。` : `该周周报已生成，共引用 ${weeklyReport.count} 条工作记录，点击查看。`}</p></button> : weeklyRecords.length ? <><button className="weekly-report-summary draft-summary clickable-summary" onClick={() => onGenerateWeek(`${weekStartKey} — ${weekEndKey}`, weeklyRecords.length)}><span>待生成</span><h3>本周工作记录汇总</h3><p>当前共有 {weeklyRecords.length} 条记录，点击选择事项并生成周报。</p></button>{weeklyRecords.map(record => <button key={record.id} onClick={() => onOpen(record)}><div><b>{recordDisplayTitle(record)}</b><p>{record.project}</p></div><i>›</i></button>)}</> : <div className="calendar-empty-state"><span>○</span><b>这一周还没有记录或周报</b><p>在日历中选择其他时间段查看。</p></div>}</section>
      : <section className="card day-records monthly-report-card"><div className="section-title"><div><span className="eyebrow">月度查看</span><h2>{year} 年 {month + 1} 月</h2></div><strong>{monthlyReports.length} 份周报</strong></div><p className="month-help">选择本月周报生成月报，默认全选。</p>{monthlyReports.length ? <><label className="month-select-all"><input type="checkbox" checked={selectedWeeks.length === monthlyReports.length} onChange={(e) => setSelectedWeeks(e.target.checked ? monthlyReports.map((report) => report.id) : [])} /> 全选本月周报</label>{monthlyReports.map((report) => <label className="month-report-row" key={report.id}><input type="checkbox" checked={selectedWeeks.includes(report.id)} onChange={(e) => setSelectedWeeks(e.target.checked ? [...selectedWeeks, report.id] : selectedWeeks.filter((id) => id !== report.id))} /><div><b>{report.title}</b><p>{report.range} · {report.count} 条记录</p></div><span>{report.imported ? "历史导入" : report.status}</span></label>)}<button className="primary full month-generate" disabled={!selectedMonthlyReports.length} onClick={() => onGenerateMonth(`${monthStart} — ${monthEnd}`, selectedMonthlyReports.reduce((sum, report) => sum + report.count, 0))}>生成月报（已选 {selectedMonthlyReports.length} 份）</button></> : <div className="calendar-empty-state"><span>○</span><b>本月还没有周报</b><p>先在按周视图生成周报，再汇总为月报。</p></div>}</section>}
  </div>;
}

function EditableSelect({ label, value, empty, options, addLabel, onChange, onAdd }: { label: string; value: string; empty: string; options: string[]; addLabel: string; onChange: (value: string) => void; onAdd: (value: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  function add() { const value = newValue.trim(); if (!value) return; onAdd(value); onChange(value); setNewValue(""); setAdding(false); }
  return <label>{label}<select value={value} onChange={(e) => { if (e.target.value === "__add__") setAdding(true); else onChange(e.target.value); }}><option>{empty}</option>{options.map((option) => <option key={option}>{option}</option>)}<option value="__add__">{addLabel}</option></select>{adding && <div className="inline-add"><input autoFocus value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={`输入${label.replace("关联", "")}名称`} /><button type="button" onClick={add}>添加</button><button type="button" onClick={() => setAdding(false)}>取消</button></div>}</label>;
}

function WeeklyRecords({ records, total, onClose, onOpen }: { records: RecordItem[]; total: number; onClose: () => void; onOpen: (record: RecordItem) => void }) {
  return <div className="drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><aside className="record-drawer weekly-drawer" role="dialog" aria-modal="true"><div className="drawer-head"><div><span>2026.07.20 — 07.26</span><h2>本周记录 · {total}</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="weekly-summary"><div><strong>{total}</strong><span>全部记录</span></div><div><strong>{records.filter(r => r.project !== "未关联项目").length + 4}</strong><span>已关联</span></div><div><strong>{records.filter(r => r.polished).length + 5}</strong><span>已提炼</span></div></div><div className="drawer-body weekly-list">{records.map(record => <button key={record.id} onClick={() => onOpen(record)}><time>{record.time}</time><b>{recordDisplayTitle(record)}</b><span>{record.project}</span><i>›</i></button>)}<div className="older-records">另有 6 条较早记录已收起</div></div></aside></div>;
}

function ReportBuilder({ report, records, projects, reportStyle, setReportStyle, onSave }: { report: ReportItem | null; records: RecordItem[]; projects: string[]; reportStyle: string; setReportStyle: (s: string) => void; onSave: (sourceCount: number) => void }) {
  const [showSources, setShowSources] = useState(false);
  const [generated, setGenerated] = useState(Boolean(report));
  const weekStart = startOfWeek(new Date());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const weekRecords = records.filter((record) => {
    const key = recordDateValue(record);
    return key >= localDateValue(weekStart) && key <= localDateValue(weekEnd);
  });
  const candidates = weekRecords.length ? weekRecords : records.slice(0, 6);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => candidates.map((record) => record.id));
  const type = report?.type || "周报";
  const range = report?.range || `${localDateValue(weekStart).replaceAll("-", ".")} — ${localDateValue(weekEnd).replaceAll("-", ".")}`;
  const selectedRecords = candidates.filter((record) => selectedIds.includes(record.id));
  const count = report?.count || selectedRecords.length;
  const heading = report?.title || "第 30 周周报";
  const toggleAll = () => setSelectedIds(selectedIds.length === candidates.length ? [] : candidates.map((record) => record.id));
  if (!generated) return <section className="report-source-step">
    <div className="source-step-head"><div><span className="eyebrow">第一步 · 选择生成依据</span><h2>选择本周要写进报告的事项</h2><p>{range}，默认已全选，你可以取消不需要的记录。</p></div><button className="select-all-button" onClick={toggleAll}>{selectedIds.length === candidates.length ? "取消全选" : "全部选择"}</button></div>
    <div className="source-selection-list">{candidates.map((record) => <label key={record.id} className={selectedIds.includes(record.id) ? "selected" : ""}><input type="checkbox" checked={selectedIds.includes(record.id)} onChange={() => setSelectedIds((ids) => ids.includes(record.id) ? ids.filter((id) => id !== record.id) : [...ids, record.id])} /><span className="custom-check">✓</span><time>{recordDateValue(record).replaceAll("-", ".")}</time><div><b>{recordDisplayTitle(record)}</b><p>{record.project === "未关联项目" ? "未选择项目" : record.project}{record.polished ? " · 已采用 AI 提炼" : record.refinedTitle ? " · 已有 AI 提炼" : ""}</p></div></label>)}</div>
    <div className="source-step-footer"><span>已选择 <b>{selectedIds.length}</b> / {candidates.length} 条事项</span><button className="primary" disabled={!selectedIds.length} onClick={() => setGenerated(true)}>使用所选事项生成周报</button></div>
  </section>;
  return <>
    <div className="report-layout"><section className="range-card"><h2>总结范围</h2><div className="range-options">{["周报", "月报", "自定义总结"].map(x => <button key={x} className={type === x ? "selected" : ""}>{x.replace("总结", "")}</button>)}</div><label>时间范围<input value={range} readOnly /></label><label>关联项目<select><option>全部项目</option>{projects.map(project => <option key={project}>{project}</option>)}</select></label><button className="primary full">重新生成</button></section>
      <section className="card report"><div className="report-top"><div><span className="eyebrow">{report?.status === "已确认" ? "正式报告" : "AI 生成稿"}</span><h2>{heading}</h2><button className="source-link" onClick={() => setShowSources(true)}>{count} 条原始记录 <span>查看生成依据 ›</span></button></div></div>
        <div className="report-mode"><span>周报展示逻辑</span><div className="tabs">{["按照事项", "按照目标", "按照项目"].map(x => <button key={x} onClick={() => setReportStyle(x)} className={reportStyle === x ? "selected" : ""}>{x}</button>)}</div></div>
        <ReportContent mode={reportStyle} /><div className="report-actions"><button className="secondary" onClick={() => setGenerated(false)}>重新选择事项</button><button className="secondary">导出</button><button className="primary" onClick={() => onSave(selectedRecords.length)}>保存{report?.status === "已确认" ? "修改" : `正式${type}`}</button></div></section></div>
    {showSources && <SourceRecords records={selectedRecords} count={count} range={range} onClose={() => setShowSources(false)} />}
  </>;
}

function ReportContent({ mode }: { mode: string }) {
  if (mode === "按照目标") return <div className="report-copy" contentEditable suppressContentEditableWarning><h3>目标一：提升核心服务入口使用效率</h3><ul><li>完成企业端首页核心卡片方案迭代，重新梳理服务完成、待办与风险提醒的信息优先级。</li><li>明确自适应展示规则，为用户快速找到高频服务建立清晰路径。</li></ul><h3>目标二：推动 AI 能力进入真实业务流程</h3><ul><li>补充 AI 开票异常反馈流程，完善从发起、处理到结果反馈的业务闭环。</li></ul><h3>目标三：减少沟通与返工成本</h3><p>与产品和开发完成关键交互规则对齐，并沉淀验收口径。</p></div>;
  if (mode === "按照项目") return <div className="report-copy" contentEditable suppressContentEditableWarning><h3>企业端首页改版</h3><ul><li>完成核心卡片方案迭代并明确内容优先级。</li><li>与开发对齐桌面、平板和手机端的响应式规则。</li></ul><h3>AI 开票</h3><ul><li>补充异常反馈路径和结果状态，完善业务闭环。</li></ul><h3>合规服务体验</h3><p>梳理风险提醒与服务日历的首页整合方向。</p></div>;
  return <div className="report-copy" contentEditable suppressContentEditableWarning><h3>本周核心事项</h3><ol><li><b>首页方案迭代：</b>完成企业端首页核心卡片方案，明确服务完成、待办与风险提醒的信息优先级。</li><li><b>跨团队协作：</b>与产品和开发对齐交互规则，减少设计还原偏差，推动方案进入开发阶段。</li><li><b>流程完善：</b>补充 AI 开票异常反馈流程，完善从发起、处理到结果反馈的业务闭环。</li></ol><h3>下阶段事项</h3><p>跟进首页开发验收，完成开票异常流程的关键页面设计。</p></div>;
}

function SourceRecords({ records, count, range, onClose }: { records: RecordItem[]; count: number; range: string; onClose: () => void }) {
  const samples = [...records, { id: -1, time: "周三 11:20", title: "整理首页响应式规则与验收清单", project: "企业端首页改版", goal: "减少跨团队沟通与返工成本", polished: true }, { id: -2, time: "周二 16:40", title: "梳理风险提醒卡片的信息优先级", project: "合规服务体验", goal: "提升核心服务入口使用效率", polished: true }];
  return <div className="drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><aside className="record-drawer source-drawer" role="dialog" aria-modal="true"><div className="drawer-head"><div><span>{range}</span><h2>原始数据记录 · {count}</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="source-note">以下记录是本次报告的生成依据，可返回工作台修改原始内容。</div><div className="drawer-body source-list">{samples.slice(0, Math.min(count, samples.length)).map(item => <article key={item.id}><time>{item.time}</time><b>{item.title}</b><div><span>{item.project}</span><span>{item.goal}</span></div></article>)}{count > samples.length && <div className="older-records">另有 {count - samples.length} 条记录已收起</div>}</div></aside></div>;
}

function History({ reports, onOpen }: { reports: ReportItem[]; onOpen: (report: ReportItem) => void }) {
  return <><div className="filters"><button>全部类型⌄</button><button>2026 年⌄</button><button>全部项目⌄</button><button>全部状态⌄</button></div><section className="card report-list">{reports.length ? reports.map((report) => <button key={report.id} onClick={() => onOpen(report)}><span className="doc">▤</span><div><b>{report.title}</b><p>{report.date} · {report.type} · {report.range} · {report.count} 条记录</p></div><em className={report.status === "草稿" ? "draft" : "status"}>{report.status}</em><i>›</i></button>) : <div className="older-records">还没有历史报告，先生成一份周报吧</div>}</section></>;
}

type KpiItem = { id: string; title: string; details: string[] };
type KpiCandidate = KpiItem & { selected: boolean };

function Profile({ projects, setProjects, onDone, onFlash }: { projects: string[]; setProjects: (items: string[]) => void; onDone: () => void; onFlash: (message: string) => void }) {
  const [profileFile, setProfileFile] = useState("");
  const [uploading, setUploading] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [role, setRole] = useState("用户体验设计师");
  const [newKpi, setNewKpi] = useState("");
  const [kpiCandidates, setKpiCandidates] = useState<KpiCandidate[]>([]);
  const [kpiSummary, setKpiSummary] = useState("");
  const [kpis, setKpis] = useState<KpiItem[]>([
    { id: "kpi-1", title: "提升核心服务入口使用效率", details: ["完成企业端首页核心服务入口改版", "关键任务操作路径缩短，提升完成效率"] },
    { id: "kpi-2", title: "推动 AI 能力进入真实业务流程", details: ["完善 AI 开票从发起到异常反馈的完整闭环"] },
  ]);
  async function uploadProfile(file?: File) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return onFlash("文件超过 20MB，请重新选择");
    setUploading(true);
    try {
      const text = await extractFileText(file);
      if (!text.trim()) throw new Error("文件中没有读取到可解析的文字");
      const parsed = await callAi<{ role?: string; summary?: string; kpis: Array<{ title: string; details?: string[] }> }>("parse-kpi", {
        fileName: file.name,
        text,
      });
      const candidates = (parsed.kpis || []).filter((item) => item.title?.trim()).map((item) => ({
        id: `candidate-${crypto.randomUUID()}`,
        title: item.title.trim(),
        details: (item.details || []).filter(Boolean),
        selected: true,
      }));
      if (!candidates.length) throw new Error("AI 没有识别出 KPI，请检查文件内容后重试");
      await saveSourceFileMetadata(file, "profile").catch(() => null);
      setProfileFile(file.name);
      setKpiCandidates(candidates);
      setKpiSummary(parsed.summary || "已从文件中识别出可写入的 KPI，请确认。");
      if (parsed.role?.trim()) setRole(parsed.role.trim());
      onFlash(`AI 已解析出 ${candidates.length} 项 KPI，请选择后确认`);
    } catch (error) { onFlash(authErrorMessage(error)); }
    finally { setUploading(false); }
  }
  function addProject() { const value = newProject.trim(); if (!value || projects.includes(value)) return; void setProjects([...projects, value]); setNewProject(""); }
  function deleteProject(project: string) { void setProjects(projects.filter((item) => item !== project)); onFlash("项目已删除"); }
  function addKpi() {
    const title = newKpi.trim();
    if (!title) return;
    setKpis([...kpis, { id: `kpi-${crypto.randomUUID()}`, title, details: [] }]);
    setNewKpi("");
  }
  function updateKpi(id: string, patch: Partial<KpiItem>) {
    setKpis(kpis.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
  function addKpiDetail(id: string) {
    setKpis(kpis.map((item) => item.id === id ? { ...item, details: [...item.details, ""] } : item));
  }
  function confirmKpiCandidates() {
    const selected = kpiCandidates.filter((item) => item.selected).map(({ id, title, details }) => ({ id: `kpi-${crypto.randomUUID()}`, title, details }));
    if (!selected.length) return onFlash("请至少选择一项 KPI");
    setKpis(selected);
    setKpiCandidates([]);
    onFlash(`已将 ${selected.length} 项 AI 解析结果填入 KPI`);
  }
  return <>
    <div className="profile-grid">
      <section className="card upload"><span>⇧</span><h2>上传 KPI / OKR / 岗位职责</h2><p>支持 PDF、Word（DOCX）、Excel，单个文件不超过 20MB</p><label className="primary file-button">{uploading ? "AI 正在解析…" : "选择文件"}<input type="file" accept=".pdf,.docx,.xls,.xlsx" onChange={(e) => { void uploadProfile(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label>{profileFile && <div className="upload-success"><span>✓</span><div><b>{profileFile}</b><small>{kpiCandidates.length ? `AI 已识别 ${kpiCandidates.length} 项，等待确认` : "解析结果已处理"}</small></div><button onClick={() => { setProfileFile(""); setKpiCandidates([]); }}>移除</button></div>}{kpiCandidates.length > 0 && <div className="kpi-review"><div className="kpi-review-head"><div><b>选择要填入的 KPI</b><p>{kpiSummary}</p></div><span>{kpiCandidates.filter((item) => item.selected).length}/{kpiCandidates.length} 已选</span></div>{kpiCandidates.map((candidate, index) => <article key={candidate.id} className={candidate.selected ? "selected" : ""}><label><input type="checkbox" checked={candidate.selected} onChange={(e) => setKpiCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, selected: e.target.checked } : item))} /><span>选择</span></label><div><small>KPI {index + 1}</small><input value={candidate.title} onChange={(e) => setKpiCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, title: e.target.value } : item))} />{candidate.details.map((detail, detailIndex) => <input key={detailIndex} className="candidate-detail" value={detail} onChange={(e) => setKpiCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, details: item.details.map((value, i) => i === detailIndex ? e.target.value : value) } : item))} />)}</div></article>)}<div className="kpi-review-actions"><button className="secondary" onClick={() => setKpiCandidates([])}>取消</button><button className="primary" onClick={confirmKpiCandidates}>确认填入 KPI</button></div></div>}</section>
      <section className="card goals profile-background"><div className="profile-background-head"><div><span className="eyebrow">AI 已提取</span><h2>你的工作背景</h2></div><label className="role-field">当前岗位<input value={role} onChange={(e) => setRole(e.target.value)} /></label></div><div className="kpi-field"><div className="field-heading"><label>KPI</label><small>支持按层级添加关键结果或拆解项</small></div><div className="kpi-list">{kpis.map((kpi, kpiIndex) => <article className="kpi-item" key={kpi.id}><div className="kpi-main"><b>KPI {kpiIndex + 1}</b><input value={kpi.title} onChange={(e) => updateKpi(kpi.id, { title: e.target.value })} /><button aria-label={`删除 KPI ${kpiIndex + 1}`} onClick={() => setKpis(kpis.filter((item) => item.id !== kpi.id))}>删除</button></div><div className="kpi-details">{kpi.details.map((detail, detailIndex) => <div key={`${kpi.id}-${detailIndex}`}><span>{detailIndex + 1}.</span><input value={detail} onChange={(e) => updateKpi(kpi.id, { details: kpi.details.map((item, index) => index === detailIndex ? e.target.value : item) })} placeholder="输入 KPI 拆解项" /><button aria-label="删除拆解项" onClick={() => updateKpi(kpi.id, { details: kpi.details.filter((_, index) => index !== detailIndex) })}>×</button></div>)}</div><button className="add-detail" onClick={() => addKpiDetail(kpi.id)}>＋ 添加拆解项</button></article>)}</div><div className="project-add"><input value={newKpi} onChange={(e) => setNewKpi(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKpi(); } }} placeholder="输入新的 KPI" /><button onClick={addKpi}>＋ 添加 KPI</button></div></div><div className="project-field"><label>重点项目</label><div className="project-tags">{projects.map(project => <span key={project}>{project}<button aria-label={`删除${project}`} onClick={() => deleteProject(project)}>×</button></span>)}</div><div className="project-add"><input value={newProject} onChange={(e) => setNewProject(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProject(); } }} placeholder="输入新项目名称" /><button onClick={addProject}>＋ 添加项目</button></div><small>这些项目会同步到周报的项目选择中</small></div><button className="primary" onClick={onDone}>确认并更新档案</button></section>
    </div>
  </>;
}
