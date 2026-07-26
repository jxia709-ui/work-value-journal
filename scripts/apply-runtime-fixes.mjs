import fs from "node:fs";

function mustReplace(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing ${label}`);
  return source.replace(before, after);
}
function replaceBetween(source, start, end, replacement, label) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Missing ${label}`);
  return source.slice(0, a) + replacement + source.slice(b);
}

let page = fs.readFileSync("app/page.tsx", "utf8");
let supabase = fs.readFileSync("lib/supabase.ts", "utf8");

// 1. Cloud-first persistence: remove browser-only record cache and silent local fallback.
page = page.replace(/\nfunction localRecordKey[\s\S]*?\nfunction demoRecords\(\)/, "\nfunction demoRecords()");
page = mustReplace(page,
`      const localRecords = readLocalRecords(account.id);
      try {`,
`      try {`, "local record hydration");
page = mustReplace(page,
`        const mergedRecords = [...localRecords, ...remoteRecords.filter((remote) => !localRecords.some((local) => local.id === remote.id))];
        setRecords(mergedRecords);`,
`        setRecords(remoteRecords);`, "remote record merge");
page = mustReplace(page, `        if (!mergedRecords.length) {`, `        if (!remoteRecords.length) {`, "empty remote records");
page = mustReplace(page,
`      } catch (error) {
        setRecords(localRecords.length ? localRecords : demoRecords());
        setReports(demoReports());
        setProjects(["企业端首页改版", "AI 开票", "用户研究", "合规服务体验"]);
        setGoals(["提升核心服务入口使用效率", "推动 AI 能力进入真实业务流程", "减少跨团队沟通与返工成本"]);
        flash(localRecords.length ? "已加载本机保存的测试记录" : authErrorMessage(error));`,
`      } catch (error) {
        setRecords([]);
        setReports([]);
        setProjects([]);
        setGoals([]);
        flash(authErrorMessage(error));`, "hydrate fallback");
page = page.replace(/\n\s*if \(currentAccount\) writeLocalRecords\(currentAccount\.id, next\);/g, "");
page = page.replace(/\n\s*writeLocalRecords\(currentAccount\.id, next\);/g, "");
page = page.replace(/\n\s*if \(currentAccount\) writeLocalRecords\(currentAccount\.id, next\);/g, "");
page = mustReplace(page,
`    } catch {
      const item = { id: \`local-\${crypto.randomUUID()}\`, time: formatRecordTime(occurredAt), occurredAt, title: entry.trim(), refinedTitle, project: entryProject || "未关联项目", goal: "未关联目标", polished: false };
      setRecords((current) => {
        const next = [item, ...current.filter((record) => !record.id.startsWith("demo-"))];
        if (currentAccount) writeLocalRecords(currentAccount.id, next);
        return next;
      });
      setRefinedDraft(item);
      setRefinementOptions(options);
      setSelectedRefinement(0);
      setEntry("");
      flash("已保存到测试环境，刷新后仍会保留");`,
`    } catch (error) {
      flash(\`保存失败，数据未写入云端：\${authErrorMessage(error)}\`);`, "save fallback");

// 2. KPI/weekly files are parsed on the server to avoid browser PDF/DOCX workers silently hanging.
page = mustReplace(page,
`async function callAi<T>(action: "refine" | "parse-weekly" | "parse-kpi", payload: Record<string, unknown>): Promise<T> {`,
`async function callAi<T>(action: "refine" | "parse-weekly" | "parse-kpi", payload: Record<string, unknown>): Promise<T> {`, "callAi marker");
const fileHelperMarker = `async function extractFileText(file: File) {`;
page = mustReplace(page, fileHelperMarker,
`async function callAiFile<T>(action: "parse-weekly" | "parse-kpi", file: File, extra: Record<string, string> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("登录已失效，请重新登录");
  const form = new FormData();
  form.append("action", action);
  form.append("file", file);
  Object.entries(extra).forEach(([key, value]) => form.append(key, value));
  const response = await fetch("/api/files", { method: "POST", headers: { Authorization: \`Bearer \${data.session.access_token}\` }, body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "文件解析失败，请重试");
  return body as T;
}

${fileHelperMarker}`, "file helper");
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
        });`, "weekly file parsing");
page = mustReplace(page,
`      const text = await extractFileText(file);
      if (!text.trim()) throw new Error("文件中没有读取到可解析的文字");
      const parsed = await callAi<{ role?: string; summary?: string; kpis: Array<{ title: string; details?: string[] }> }>("parse-kpi", {
        fileName: file.name,
        text,
      });`,
`      const parsed = await callAiFile<{ role?: string; summary?: string; kpis: Array<{ title: string; details?: string[] }> }>("parse-kpi", file);`, "KPI file parsing");

// 3. Rebuild report generation: selected records drive output; regenerate buttons really reset/rebuild state.
const reportBuilder = `function ReportBuilder({ report, records, projects, reportStyle, setReportStyle, onSave }: { report: ReportItem | null; records: RecordItem[]; projects: string[]; reportStyle: string; setReportStyle: (s: string) => void; onSave: (sourceCount: number) => void }) {
  const [showSources, setShowSources] = useState(false);
  const [generated, setGenerated] = useState(Boolean(report?.id));
  const [revision, setRevision] = useState(0);
  const range = report?.range || currentWeekRange();
  const [rangeStart, rangeEnd] = range.split(" — ").map((value) => value.replaceAll(".", "-"));
  const candidates = records.filter((record) => {
    const date = recordDateValue(record);
    return date >= rangeStart && date <= rangeEnd && !record.id.startsWith("demo-");
  });
  const [selectedIds, setSelectedIds] = useState<string[]>(() => candidates.map((record) => record.id));
  const selectedRecords = candidates.filter((record) => selectedIds.includes(record.id));
  const type = report?.type || "周报";
  const heading = report?.title || (type === "月报" ? "本月工作月报" : "本周工作周报");
  const toggleAll = () => setSelectedIds(selectedIds.length === candidates.length ? [] : candidates.map((record) => record.id));
  const regenerate = () => { if (!selectedRecords.length) return; setRevision((value) => value + 1); setGenerated(true); };
  if (!generated) return <section className="report-source-step">
    <div className="source-step-head"><div><span className="eyebrow">第一步 · 选择生成依据</span><h2>选择要写进报告的事项</h2><p>{range}，默认已全选，你可以取消不需要的记录。</p></div><button className="select-all-button" onClick={toggleAll}>{selectedIds.length === candidates.length ? "取消全选" : "全部选择"}</button></div>
    <div className="source-selection-list">{candidates.map((record) => <label key={record.id} className={selectedIds.includes(record.id) ? "selected" : ""}><input type="checkbox" checked={selectedIds.includes(record.id)} onChange={() => setSelectedIds((ids) => ids.includes(record.id) ? ids.filter((id) => id !== record.id) : [...ids, record.id])} /><span className="custom-check">✓</span><time>{recordDateValue(record).replaceAll("-", ".")}</time><div><b>{recordDisplayTitle(record)}</b><p>{record.project === "未关联项目" ? "未选择项目" : record.project}</p></div></label>)}</div>
    {!candidates.length && <div className="calendar-empty-state"><b>该时间范围没有可用记录</b><p>请先记录事项，或切换到有记录的日期范围。</p></div>}
    <div className="source-step-footer"><span>已选择 <b>{selectedIds.length}</b> / {candidates.length} 条事项</span><button className="primary" disabled={!selectedIds.length} onClick={regenerate}>使用所选事项生成{type}</button></div>
  </section>;
  return <>
    <div className="report-layout"><section className="range-card"><h2>总结范围</h2><div className="range-options">{["周报", "月报", "自定义总结"].map((value) => <button key={value} className={type === value ? "selected" : ""}>{value.replace("总结", "")}</button>)}</div><label>时间范围<input value={range} readOnly /></label><label>关联项目<select><option>全部项目</option>{projects.map((project) => <option key={project}>{project}</option>)}</select></label><button className="primary full" disabled={!selectedRecords.length} onClick={regenerate}>重新生成</button></section>
      <section className="card report"><div className="report-top"><div><span className="eyebrow">{report?.status === "已确认" ? "正式报告" : "AI 生成稿"}</span><h2>{heading}</h2><button className="source-link" onClick={() => setShowSources(true)}>{selectedRecords.length} 条原始记录 <span>查看生成依据 ›</span></button></div></div>
        <div className="report-mode"><span>报告展示逻辑</span><div className="tabs">{["按照事项", "按照目标", "按照项目"].map((value) => <button key={value} onClick={() => setReportStyle(value)} className={reportStyle === value ? "selected" : ""}>{value}</button>)}</div></div>
        <ReportContent key={revision} mode={reportStyle} records={selectedRecords} /><div className="report-actions"><button className="secondary" onClick={() => setGenerated(false)}>重新选择事项</button><button className="secondary">导出</button><button className="primary" onClick={() => onSave(selectedRecords.length)}>保存{report?.status === "已确认" ? "修改" : \`正式\${type}\`}</button></div></section></div>
    {showSources && <SourceRecords records={selectedRecords} count={selectedRecords.length} range={range} onClose={() => setShowSources(false)} />}
  </>;
}

`;
page = replaceBetween(page, "function ReportBuilder(", "function ReportContent(", reportBuilder, "ReportBuilder");
const reportContent = `function ReportContent({ mode, records }: { mode: string; records: RecordItem[] }) {
  const groups = records.reduce<Record<string, RecordItem[]>>((result, record) => {
    const key = mode === "按照目标" ? record.goal : mode === "按照项目" ? record.project : "本期核心事项";
    (result[key || "未关联"] ||= []).push(record);
    return result;
  }, {});
  return <div className="report-copy" contentEditable suppressContentEditableWarning>{Object.entries(groups).map(([title, items]) => <section key={title}><h3>{title}</h3><ul>{items.map((item) => <li key={item.id}>{recordDisplayTitle(item)}</li>)}</ul></section>)}</div>;
}

`;
page = replaceBetween(page, "function ReportContent(", "function SourceRecords(", reportContent, "ReportContent");
page = page.replace('<ReportBuilder report={activeReport}', '<ReportBuilder key={`${activeReport?.id || "new"}:${activeReport?.range || currentWeekRange()}`} report={activeReport}');

// Cloud operations must surface errors instead of pretending local success.
page = page.replaceAll('try { if (!updated.id.startsWith("local-")) await updateWorkRecord(updated); } catch { /* keep local fallback */ }', 'await updateWorkRecord(updated);');
page = page.replaceAll('try { if (!updated.id.startsWith("demo-") && !updated.id.startsWith("local-")) await updateWorkRecord(updated); } catch { /* persist the editable test copy below */ }', 'await updateWorkRecord(updated);');
page = page.replaceAll('try { if (!record.id.startsWith("demo-") && !record.id.startsWith("local-")) await deleteWorkRecord(record.id); } catch { /* remove the test copy locally */ }', 'await deleteWorkRecord(record.id);');

fs.writeFileSync("app/page.tsx", page);

supabase = replaceBetween(supabase, "export async function loadWorkspace()", "export async function addWorkRecord", `export async function loadWorkspace() {
  const [records, projects, goals, reports] = await Promise.all([
    supabase.from("work_records").select("id,occurred_at,title,details,project,goal,polished").order("occurred_at", { ascending: false }),
    supabase.from("projects").select("name").order("created_at", { ascending: true }),
    supabase.from("goals").select("name").order("created_at", { ascending: true }),
    supabase.from("reports").select("id,title,report_date,report_type,status,range_start,range_end,source_count").order("report_date", { ascending: false }),
  ]);
  const error = records.error ?? projects.error ?? goals.error ?? reports.error;
  if (error) throw error;
  return {
    records: (records.data ?? []) as WorkspaceRecord[],
    projects: (projects.data ?? []).map((item) => item.name),
    goals: (goals.data ?? []).map((item) => item.name),
    reports: (reports.data ?? []) as WorkspaceReport[],
  };
}

`, "loadWorkspace");
supabase = mustReplace(supabase,
`  const { data, error } = await supabase.from("work_records").insert(payload).select("id,occurred_at,title,details,project,goal,polished").single();
  const record = error ? {
    id: \`local-\${Date.now()}-\${Math.random().toString(36).slice(2, 9)}\`,
    occurred_at: input.occurredAt,
    title: input.title,
    details: input.details,
    project: input.project || null,
    goal: null,
    polished: false,
  } : data as WorkspaceRecord;
  const workspace = await readLocalWorkspace();
  workspace.records = [record, ...workspace.records.filter((item) => item.id !== record.id)];
  await writeLocalWorkspace(workspace);
  return record;`,
`  const { data, error } = await supabase.from("work_records").insert(payload).select("id,occurred_at,title,details,project,goal,polished").single();
  if (error) throw error;
  return data as WorkspaceRecord;`, "addWorkRecord");
fs.writeFileSync("lib/supabase.ts", supabase);

fs.mkdirSync("app/api/files", { recursive: true });
fs.writeFileSync("app/api/files/route.ts", `import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { PDFParse } from "pdf-parse";
export const runtime = "nodejs";
async function extract(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) { const parser = new PDFParse({ data: buffer }); try { return (await parser.getText()).text; } finally { await parser.destroy(); } }
  if (name.endsWith(".docx")) return (await mammoth.extractRawText({ buffer })).value;
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) { const book = XLSX.read(buffer); return book.SheetNames.map((sheet) => XLSX.utils.sheet_to_csv(book.Sheets[sheet])).join("\\n\\n"); }
  if (name.endsWith(".txt") || name.endsWith(".csv")) return buffer.toString("utf8");
  throw new Error("暂不支持该文件格式，请上传 PDF、DOCX、Excel、CSV 或 TXT");
}
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData(); const file = form.get("file"); const action = String(form.get("action") || "");
    if (!(file instanceof File) || !["parse-weekly", "parse-kpi"].includes(action)) return NextResponse.json({ error: "文件或任务无效" }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "文件超过 20MB" }, { status: 413 });
    const text = await extract(file); if (!text.trim()) return NextResponse.json({ error: "文件中没有读取到可解析文字" }, { status: 422 });
    const response = await fetch(new URL("/api/ai", request.url), { method: "POST", headers: { "content-type": "application/json", authorization: request.headers.get("authorization") || "" }, body: JSON.stringify({ action, fileName: file.name, text, referenceDate: String(form.get("referenceDate") || "") }) });
    return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "文件解析失败" }, { status: 500 }); }
}
`);
console.log("Runtime fixes applied");
