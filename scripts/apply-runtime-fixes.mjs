import fs from "node:fs";

function replaceBetween(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing ${label}`);
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

function mustReplace(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing ${label}`);
  return source.replace(before, after);
}

let page = fs.readFileSync("app/page.tsx", "utf8");

// Remove browser-only record storage. Production data must come from Supabase.
page = page.replace(/\nfunction localRecordKey[\s\S]*?\nfunction demoRecords\(\)/, "\nfunction demoRecords()");

const hydrate = `    async function hydrate(user: Parameters<typeof accountFromUser>[0] | null) {
      if (!active) return;
      if (!user) {
        setCurrentAccount(null);
        setRecords([]);
        setReports([]);
        setProjects([]);
        setGoals([]);
        setAuthLoading(false);
        return;
      }
      const account = accountFromUser(user);
      setCurrentAccount(account);
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
        setRecords(remoteRecords);
        setProjects(workspace.projects);
        setGoals(workspace.goals);
        setReports(workspace.reports.map((report) => ({
          id: report.id,
          title: report.title,
          date: report.report_date,
          type: report.report_type,
          status: report.status,
          range: report.range_start + " — " + report.range_end,
          count: report.source_count,
        })));
      } catch (error) {
        setRecords([]);
        setReports([]);
        setProjects([]);
        setGoals([]);
        flash("云端数据加载失败：" + authErrorMessage(error));
      } finally {
        if (active) setAuthLoading(false);
      }
    }
`;
page = replaceBetween(page, "    async function hydrate(", "    supabase.auth.getUser()", hydrate, "hydrate");

const saveEntry = `  async function saveEntry() {
    if (!entry.trim()) return flash("先写下一件今天完成的事");
    const occurredAt = dateAtCurrentTime(entryDate);
    setAiLoading(true);
    try {
      const result = await callAi<{ options: RefinementOption[] }>("refine", {
        content: entry.trim(),
        project: entryProject,
        goals,
        projects,
        date: entryDate,
      });
      const options = result.options.filter((item) => item.text?.trim()).slice(0, 3);
      if (options.length !== 3) throw new Error("AI 未返回完整的三个版本，请重试");
      const refinedTitle = options[0].text;
      const record = await addWorkRecord({ title: entry.trim(), details: refinedTitle, project: entryProject, occurredAt });
      const item = {
        id: record.id,
        time: formatRecordTime(record.occurred_at),
        occurredAt: record.occurred_at,
        title: record.title,
        refinedTitle: record.details || refinedTitle,
        project: record.project || "未关联项目",
        goal: record.goal || "未关联目标",
        polished: false,
      };
      setRecords((current) => [item, ...current]);
      setRefinedDraft(item);
      setRefinementOptions(options);
      setSelectedRefinement(0);
      setEntry("");
      flash("已写入云端，并生成 3 个 AI 提炼版本");
    } catch (error) {
      flash("保存失败，数据未写入云端：" + authErrorMessage(error));
    } finally {
      setAiLoading(false);
    }
  }

`;
page = replaceBetween(page, "  async function saveEntry()", "  async function importHistoricalReports", saveEntry, "saveEntry");

const confirmImport = `  async function confirmWeeklyImport() {
    if (!weeklyImportPreview) return;
    const selected = weeklyImportPreview.items.filter((item) => item.selected);
    if (!selected.length) return flash("请至少选择一条事项");
    if (selected.some((item) => !isDateValue(item.date))) return flash("请为每条已选事项补充有效日期");
    setImportingReports(true);
    try {
      const importedRecords: RecordItem[] = [];
      for (const item of selected) {
        const occurredAt = dateAtNoon(item.date!);
        const saved = await addWorkRecord({ title: item.content.trim(), details: "", project: item.project || "", occurredAt });
        importedRecords.push({
          id: saved.id,
          time: formatRecordTime(saved.occurred_at),
          occurredAt: saved.occurred_at,
          title: saved.title,
          refinedTitle: saved.details || "",
          project: saved.project || "未关联项目",
          goal: saved.goal || item.goal || "未关联目标",
          polished: false,
        });
      }
      const dates = selected.map((item) => item.date!).sort();
      const report: ReportItem = {
        id: "imported-" + Date.now(),
        title: weeklyImportPreview.fileName.replace(/\\.[^.、]+$/, "") || "历史周报",
        date: dates[dates.length - 1],
        type: "周报",
        status: "已确认",
        range: dates[0] + " — " + dates[dates.length - 1],
        count: selected.length,
        imported: true,
        fileName: weeklyImportPreview.fileName,
      };
      setRecords((current) => [...importedRecords, ...current]);
      setReports((current) => [report, ...current]);
      setWeeklyImportPreview(null);
      flash("已写入云端并按日期导入 " + selected.length + " 条事项");
    } catch (error) {
      flash("导入失败：" + authErrorMessage(error));
    } finally {
      setImportingReports(false);
    }
  }

`;
page = replaceBetween(page, "  async function confirmWeeklyImport()", "  if (!isSupabaseConfigured)", confirmImport, "confirmWeeklyImport");

const aiHelpers = `async function callAi<T>(action: "refine" | "parse-weekly" | "parse-kpi" | "generate-report", payload: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("登录已失效，请重新登录");
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + data.session.access_token,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "AI 服务暂时不可用，请稍后重试");
  return body as T;
}

async function callAiFile<T>(action: "parse-weekly" | "parse-kpi", file: File, extra: Record<string, string> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("登录已失效，请重新登录");
  const form = new FormData();
  form.append("action", action);
  form.append("file", file);
  Object.entries(extra).forEach(([key, value]) => form.append(key, value));
  const response = await fetch("/api/files", {
    method: "POST",
    headers: { Authorization: "Bearer " + data.session.access_token },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "文件解析失败，请重试");
  return body as T;
}

`;
page = replaceBetween(page, "async function callAi<T>", "function currentWeekRange()", aiHelpers, "AI helpers");

page = mustReplace(page,
`        const text = await extractFileText(file);
        if (!text.trim()) throw new Error(\`${file.name} 未读取到可解析内容\`);
        const parsed = await callAi<{ items: ParsedWeeklyItem[] }>("parse-weekly", {
          fileName: file.name,
          text,
          referenceDate: localDateValue(new Date(file.lastModified || Date.now())),
        });`,
`        const parsed = await callAiFile<{ items: ParsedWeeklyItem[] }>("parse-weekly", file, {
          referenceDate: localDateValue(new Date(file.lastModified || Date.now())),
        });`,
"weekly file call");

page = mustReplace(page,
`      const text = await extractFileText(file);
      if (!text.trim()) throw new Error("文件中没有读取到可解析的文字");
      const parsed = await callAi<{ role?: string; summary?: string; kpis: Array<{ title: string; details?: string[] }> }>("parse-kpi", {
        fileName: file.name,
        text,
      });`,
`      const parsed = await callAiFile<{ role?: string; summary?: string; kpis: Array<{ title: string; details?: string[] }> }>("parse-kpi", file);`,
"KPI file call");

const reportBuilder = `function ReportBuilder({ report, records, projects, reportStyle, setReportStyle, onSave }: { report: ReportItem | null; records: RecordItem[]; projects: string[]; reportStyle: string; setReportStyle: (s: string) => void; onSave: (sourceCount: number) => void }) {
  const [showSources, setShowSources] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [reportText, setReportText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const range = report?.range || currentWeekRange();
  const [rangeStart, rangeEnd] = range.split(" — ").map((value) => value.replaceAll(".", "-"));
  const candidates = records.filter((record) => {
    const date = recordDateValue(record);
    return date >= rangeStart && date <= rangeEnd && !record.id.startsWith("demo-") && !record.id.startsWith("local-");
  });
  const [selectedIds, setSelectedIds] = useState<string[]>(() => candidates.map((record) => record.id));
  const selectedRecords = candidates.filter((record) => selectedIds.includes(record.id));
  const type = report?.type || "周报";
  const heading = report?.title || (type === "月报" ? "本月工作月报" : "本周工作周报");
  const toggleAll = () => setSelectedIds(selectedIds.length === candidates.length ? [] : candidates.map((record) => record.id));

  async function generate(mode = reportStyle) {
    if (!selectedRecords.length || generating) return;
    setGenerating(true);
    setGenerationError("");
    try {
      const result = await callAi<{ content: string }>("generate-report", {
        reportType: type,
        range,
        mode,
        records: selectedRecords.map((record) => ({
          date: recordDateValue(record),
          title: record.title,
          refinedTitle: record.polished && record.refinedTitle ? record.refinedTitle : record.title,
          project: record.project,
          goal: record.goal,
        })),
      });
      if (!result.content?.trim()) throw new Error("AI 没有返回报告内容");
      setReportText(result.content.trim());
      setGenerated(true);
    } catch (error) {
      setGenerationError(authErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  }

  if (!generated) return <section className="report-source-step">
    <div className="source-step-head"><div><span className="eyebrow">第一步 · 选择生成依据</span><h2>选择要写进报告的事项</h2><p>{range}，默认已全选，你可以取消不需要的记录。</p></div><button className="select-all-button" onClick={toggleAll}>{selectedIds.length === candidates.length ? "取消全选" : "全部选择"}</button></div>
    <div className="source-selection-list">{candidates.map((record) => <label key={record.id} className={selectedIds.includes(record.id) ? "selected" : ""}><input type="checkbox" checked={selectedIds.includes(record.id)} onChange={() => setSelectedIds((ids) => ids.includes(record.id) ? ids.filter((id) => id !== record.id) : [...ids, record.id])} /><span className="custom-check">✓</span><time>{recordDateValue(record).replaceAll("-", ".")}</time><div><b>{recordDisplayTitle(record)}</b><p>{record.project === "未关联项目" ? "未选择项目" : record.project}</p></div></label>)}</div>
    {!candidates.length && <div className="calendar-empty-state"><b>该时间范围没有可用记录</b><p>请先记录事项，或切换到有记录的日期范围。</p></div>}
    {generationError && <p className="auth-error" role="alert">{generationError}</p>}
    <div className="source-step-footer"><span>已选择 <b>{selectedIds.length}</b> / {candidates.length} 条事项</span><button className="primary" disabled={!selectedIds.length || generating} onClick={() => void generate()}>{generating ? "AI 正在生成…" : "使用所选事项生成" + type}</button></div>
  </section>;

  return <>
    <div className="report-layout"><section className="range-card"><h2>总结范围</h2><div className="range-options">{["周报", "月报", "自定义总结"].map((value) => <button key={value} className={type === value ? "selected" : ""}>{value.replace("总结", "")}</button>)}</div><label>时间范围<input value={range} readOnly /></label><label>关联项目<select><option>全部项目</option>{projects.map((project) => <option key={project}>{project}</option>)}</select></label><button className="primary full" disabled={!selectedRecords.length || generating} onClick={() => void generate()}>{generating ? "AI 重新生成中…" : "重新生成"}</button></section>
      <section className="card report"><div className="report-top"><div><span className="eyebrow">AI 生成稿</span><h2>{heading}</h2><button className="source-link" onClick={() => setShowSources(true)}>{selectedRecords.length} 条原始记录 <span>查看生成依据 ›</span></button></div></div>
        <div className="report-mode"><span>报告展示逻辑</span><div className="tabs">{["按照事项", "按照目标", "按照项目"].map((value) => <button key={value} disabled={generating} onClick={() => { setReportStyle(value); void generate(value); }} className={reportStyle === value ? "selected" : ""}>{value}</button>)}</div></div>
        {generationError && <p className="auth-error" role="alert">{generationError}</p>}
        <ReportContent content={reportText} />
        <div className="report-actions"><button className="secondary" onClick={() => { setGenerated(false); setGenerationError(""); }}>重新选择事项</button><button className="secondary">导出</button><button className="primary" disabled={generating || !reportText} onClick={() => onSave(selectedRecords.length)}>保存{report?.status === "已确认" ? "修改" : "正式" + type}</button></div></section></div>
    {showSources && <SourceRecords records={selectedRecords} count={selectedRecords.length} range={range} onClose={() => setShowSources(false)} />}
  </>;
}

function ReportContent({ content }: { content: string }) {
  return <div className="report-copy" contentEditable suppressContentEditableWarning>{content.split(/\\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>;
}

`;
page = replaceBetween(page, "function ReportBuilder(", "function SourceRecords(", reportBuilder, "ReportBuilder");

page = page.replace(
  '<ReportBuilder report={activeReport}',
  '<ReportBuilder key={(activeReport?.id || "new") + ":" + (activeReport?.range || currentWeekRange())} report={activeReport}',
);

page = page.replace(
  '  const samples = [...records, { id: -1, time: "周三 11:20", title: "整理首页响应式规则与验收清单", project: "企业端首页改版", goal: "减少跨团队沟通与返工成本", polished: true }, { id: -2, time: "周二 16:40", title: "梳理风险提醒卡片的信息优先级", project: "合规服务体验", goal: "提升核心服务入口使用效率", polished: true }];',
  '  const samples = records;',
);

page = page.replaceAll(
  'try { if (!updated.id.startsWith("local-")) await updateWorkRecord(updated); } catch { /* keep local fallback */ }',
  'try { await updateWorkRecord(updated); } catch (error) { flash(authErrorMessage(error)); return; }',
);
page = page.replaceAll(
  'try { if (!record.id.startsWith("demo-") && !record.id.startsWith("local-")) await deleteWorkRecord(record.id); } catch { /* remove the test copy locally */ }',
  'try { await deleteWorkRecord(record.id); } catch (error) { flash(authErrorMessage(error)); return; }',
);
page = page.replaceAll(
  'try { if (!updated.id.startsWith("demo-") && !updated.id.startsWith("local-")) await updateWorkRecord(updated); } catch { /* persist the editable test copy below */ }',
  'try { await updateWorkRecord(updated); } catch (error) { flash(authErrorMessage(error)); return; }',
);
page = page.replace(/\n\s*if \(currentAccount\) writeLocalRecords\(currentAccount\.id, next\);/g, "");
page = page.replace(/\n\s*writeLocalRecords\(currentAccount\.id, next\);/g, "");

fs.writeFileSync("app/page.tsx", page);
console.log("Production page fixes applied");
