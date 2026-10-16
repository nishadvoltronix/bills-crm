"use client";
import Link from "next/link";
import { useState } from "react";
import type { DashboardResult, DepartmentProgress, PipelineMetric } from "@/server/dashboard/types";
import { Pagination, SearchBox } from "@/components/settings/client";
import { useRead } from "./read-client";

// Exact chart palette from the original Dashboard/dashboard.php.
const stageColors = ["#1ABC9C", "#FF9800", "#00BCD4", "#4CAF50", "#DC2626", "#9E9E9E"];
const stageLabels = ["Qualification", "Site Visit", "Proposal", "Closed to Won", "Ommitted", "Big Project & Others"];
const progressColors = ["var(--bs-primary)", "var(--bs-success)", "var(--bs-success)", "#4caf50", "#ff0000", "var(--bs-secondary)"];
const departmentIcons: Record<string, string> = { Electrical: "ph ph-lightning", Civil: "ph ph-buildings", PM: "ph ph-user-gear", Switchgear: "ph ph-plug", Maintenance: "ph ph-wrench" };
function Metric({ label, value, detail, color = "bg-brand-color-1", icon = "ph ph-briefcase", unavailable = false }: {
  label: string; value: string | number; detail?: string; color?: string; icon?: string; unavailable?: boolean;
}) {
  return <div className={`card ${color} crm-kpi`}><div className="card-body"><div className="d-flex align-items-center">
    <div className="flex-grow-1"><h6 className="mb-2 text-white">{label}</h6><h2 className={`text-white mb-0 f-w-300${unavailable ? " crm-kpi-unavailable" : ""}`}>{value}</h2>{detail && <p className="text-white mb-0">{detail}</p>}</div>
    <i className={`${icon} text-white crm-kpi-icon`} aria-hidden="true" />
  </div></div></div>;
}
function LeadMetric({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: string }) {
  return <div className={`card ${color}`}><div className="card-body"><div className="row align-items-center justify-content-center">
    <div className="col-auto"><i className={`${icon} text-white crm-kpi-icon`} aria-hidden="true" /></div><div className="col"><h2 className="text-white f-w-300">{value}</h2><h5 className="text-white">{label}</h5></div>
  </div></div></div>;
}
function DepartmentCards({ rows }: { rows: DepartmentProgress[] }) {
  return <div className="row crm-department-cards">{rows.map((row) => <div className="col-md-4" key={row.department}><div className="card Active-visitor"><div className="card-body text-center">
    <h5 className="mb-3">{row.department === "PM" ? "Project Manager" : row.department}</h5><i className={`${departmentIcons[row.department]} f-60 text-success`} aria-hidden="true" />
    <h2 className="f-w-300 mt-3">{row.total}</h2><span className="text-muted">Total Assigned</span>
    <div className="progress mt-4 mb-4"><div className="progress-bar bg-brand-color-1" role="progressbar" aria-label={`${row.department} completed assignments`} aria-valuenow={row.completed} aria-valuemin={0} aria-valuemax={row.total || 1} style={{ width: `${row.total ? row.completed / row.total * 100 : 0}%`, height: 7 }} /></div>
    <div className="crm-department-counts">{[["Pending", row.pending], ["Progress", row.process], ["Completed", row.completed], ["Hold", row.hold]].map(([label, count]) => <div key={label}><h5>{count}</h5><small>{label}</small></div>)}</div>
  </div></div></div>)}</div>;
}
function PipelineOverview({ stages, snapshot = false }: { stages: PipelineMetric[]; snapshot?: boolean }) {
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  return <section className="card" aria-label="Pipeline overview"><div className="card-header"><h5>Deals Overview</h5></div><div className="card-body">
    {snapshot && <p className="field-hint mb-3">Imported Zoho deals only · saved snapshot, not live sync.</p>}
    <svg className="crm-pipeline-chart" viewBox="0 0 220 220" role="img" aria-label={`Lead pipeline: ${total} leads`}>
      <circle cx="110" cy="110" r="90" fill="none" stroke="#f1f1f1" strokeWidth="20" />
      {stages.map((stage, index) => { const length = total ? stage.count / total * 100 : 0;
        const start = total ? stages.slice(0, index).reduce((sum, item) => sum + item.count, 0) / total * 100 : 0;
        return <circle key={stage.key} cx="110" cy="110" r="90" fill="none" stroke={stageColors[index] ?? "#cccccc"} strokeWidth="20" pathLength="100" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} transform="rotate(-90 110 110)"><title>{stage.label}: {stage.count}</title></circle>;
      })}
    </svg>
    {stages.map((stage, index) => <div key={stage.key} className="crm-pipeline-summary border-top py-3">
      <div className="d-flex align-items-center justify-content-between"><span><i className={`ph ${index === 0 ? "ph-desktop" : index === 5 ? "ph-device-tablet" : "ph-device-mobile"} me-2 f-18`} style={{ color: progressColors[index] }} aria-hidden="true" />{stageLabels[index] ?? stage.label}</span><strong>{Number(stage.percentage)}%</strong></div>
      <div className="progress mt-2" style={{ height: 4 }}><div className="progress-bar" role="progressbar" aria-label={stage.label + " percentage"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(stage.percentage)} style={{ width: `${stage.percentage}%`, backgroundColor: progressColors[index] ?? "#9E9E9E" }} /></div>
    </div>)}
  </div></section>;
}
export function Dashboard() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const result = useRead<DashboardResult>("/api/dashboard?" + new URLSearchParams({ employeePage: String(page), employeePageSize: "25", employeeSearch: search }));
  const data = result.data;
  const coverage = data?.sourceCoverage;
  const snapshot = coverage?.mode === "local-zoho-snapshot";
  const importedAt = coverage?.importedAt && Number.isFinite(Date.parse(coverage.importedAt)) ? coverage.importedAt : null;
  return <div className="crm-dashboard">
    {result.loading && <p role="status">Loading dashboard…</p>}
    {result.error && <p role="alert" className="error">{result.error}</p>}
    {snapshot && <section className="notice crm-dashboard-coverage" aria-label="Dashboard data coverage">
      <h2>Zoho snapshot · operational history not imported</h2>
      <p>The summary cards and deals overview show {coverage.importedDeals.toLocaleString("en-US")} imported Zoho deals. {coverage.localDeals.toLocaleString("en-US")} local/demo deals ({coverage.localWonJobs.toLocaleString("en-US")} won) are excluded from those totals.</p>
      <p>Live CRM department assignments, payment records, completion history and employees have not been imported. “Not imported” is unknown, not zero or pending work.</p>
      {importedAt && <p>Snapshot saved: <time dateTime={importedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }).format(new Date(importedAt))}</time> (Asia/Dubai).</p>}
    </section>}
    {data?.global && <>
      <section className="row crm-job-overview" aria-label="Job overview">
        <div className="col-md-6 col-xl-3"><Metric label="Total Won Jobs" value={snapshot ? coverage.importedWonJobs : data.global.wonJobs} detail={snapshot ? "Imported Zoho deals only" : "Till date"} /></div>
        <div className="col-md-6 col-xl-3"><Metric label="Pending Department Assign" value={snapshot ? "Not imported" : data.global.pendingAssignmentJobs ?? "Unavailable"} detail={snapshot ? "Assignment history required" : "Till date"} unavailable={snapshot || data.global.pendingAssignmentJobs === null} color="bg-brand-color-golden" icon="ti ti-hierarchy" /></div>
        <div className="col-md-6 col-xl-3"><Metric label="Pending Accounts Clearance" value={snapshot ? "Not imported" : data.global.accounts.totalPending ?? "Unavailable"} detail={snapshot ? "Payment history required" : data.global.accounts.pendingJobs === null ? "Job count unavailable" : `Against ${data.global.accounts.pendingJobs} jobs`} unavailable={snapshot || data.global.accounts.totalPending === null} color="bg-brand-color-2" icon="ti ti-currency-dirham" /></div>
        <div className="col-md-6 col-xl-3"><Metric label="Complete Jobs" value={snapshot ? "Not imported" : data.global.completedJobs ?? "Unavailable"} detail={snapshot ? "Completion history required" : "Till date"} unavailable={snapshot || data.global.completedJobs === null} color="bg-brand-color-green" icon="ph ph-flag" /></div>
      </section>
      {!snapshot && data.global.accounts.unknownServiceChargeJobs > 0 && <p className="notice">{data.global.accounts.unknownServiceChargeJobs} jobs have no recorded service charge. The complete pending balance cannot be calculated.</p>}
      <div className="row">
        <div className="col-xl-4"><PipelineOverview stages={data.global.pipeline} snapshot={snapshot} /></div>
        <div className="col-xl-8"><section className="card" aria-label="Employee workload">
          <div className="card-header crm-dashboard-panel-header"><h5>{snapshot ? "Local User Workload" : "User Workload Matrix"}</h5><Link className="btn btn-outline-primary btn-sm" href="/reports/employee-performance"><i className="ph ph-download-simple me-1" aria-hidden="true" />{snapshot ? "Local reports & export" : "Reports & export"}</Link></div>
          <div className="card-body">{snapshot && <p className="notice">Local users and assignment records only, including demo accounts. This is not the live CRM employee list or workload.</p>}<SearchBox label={snapshot ? "Search local users" : "Search employees"} onSearch={(value) => { setSearch(value); setPage(1); }} />
            <div className="table-scroll"><table className="table table-hover mb-0"><thead><tr><th>Employee Name</th><th>No. of Electrical</th><th>No. of Civil</th><th>No. of PM</th></tr></thead><tbody>
              {data.global.employees.items.map((row) => <tr key={row.id}><td><h6 className="text-muted">{row.name}</h6></td><td><span className="badge bg-danger">{row.electrical}</span></td><td><span className="badge bg-success">{row.civil}</span></td><td><span className="badge bg-warning">{row.pm}</span></td></tr>)}
            </tbody></table></div>
            {data.global.employees.items.length === 0 && <p>No employees match your search.</p>}
            <Pagination data={data.global.employees} page={page} onPage={setPage} />
          </div>
        </section></div>
      </div>
      <div className="row"><div className="col-xl-8"><section className="card" aria-label="Department overview"><div className="card-header"><h5>{snapshot ? "Local Department Progress" : "Department Progress"}</h5></div><div className="card-body crm-department-progress">{snapshot && <p className="notice">Local assignments only. Imported Zoho deals do not include department progress or completion history.</p>}<DepartmentCards rows={data.global.departmentProgress} /></div></section></div>
        <div className="col-xl-4"><LeadMetric label={snapshot ? "Snapshot: Today's Leads" : "Today's Leads"} value={data.global.leadsToday} color="bg-brand-color-2" icon="ti ti-discount-check-filled" /><LeadMetric label="Cleared Accounts" value="—" color="bg-brand-color-dark" icon="ti ti-moneybag-plus" /><LeadMetric label={snapshot ? "Snapshot: Leads this Month" : "Total Leads this Month"} value={data.global.leadsThisMonth} color="bg-brand-color-1" icon="ti ti-calendar-week" /><p className="field-hint">{snapshot ? "Lead dates use the saved Zoho snapshot, not live updates. Cleared accounts have not been imported." : "Cleared accounts are not supplied by the current records."}</p></div>
      </div>
    </>}
    {data?.sales && <section className="card" aria-label="Your sales leads"><div className="card-header"><h5>{snapshot ? "Your local sales leads" : "Your sales leads"}</h5></div><div className="card-body">{snapshot && <p className="notice">Uses local user mappings only. Unmapped Zoho deal owners are not included in your assigned leads.</p>}<div className="row crm-sales-overview">
      {[{ label: "Assigned leads", count: data.sales.total }, { label: "Created today", count: data.sales.today }, { label: "Created this month", count: data.sales.thisMonth }, ...data.sales.stages].map((stage) => <div className="col-md-4" key={stage.label}><Metric label={stage.label} value={stage.count} /></div>)}
    </div></div></section>}
    {data?.departments.map((department) => <section className="card" aria-label={"Your " + department.department + " jobs"} key={department.department}>
      <div className="card-header"><h5>Your {department.department} jobs{snapshot ? " · local assignments only" : ""}</h5></div><div className="card-body"><DepartmentCards rows={[department]} /><div className="row">
        <div className="col-md-6"><Metric label="Assigned today" value={department.assignedToday} /></div><div className="col-md-6"><Metric label="Completed assignments made this month" value={department.completedAssignedThisMonth} color="bg-brand-color-green" /></div>
      </div></div>
    </section>)}
    <div className="actions crm-dashboard-refresh"><span className="field-hint">{snapshot ? "Refresh reloads saved local records; it does not synchronize Zoho. Dates use Asia/Dubai." : "Current records · dates use Asia/Dubai"}</span><button type="button" className="secondary" onClick={result.reload}>Refresh dashboard</button></div>
  </div>;
}
