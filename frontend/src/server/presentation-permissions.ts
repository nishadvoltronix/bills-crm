/** Navigation visibility only. Express authorizes every protected operation. */
export function hasDashboardAccess(permissions: readonly string[]): boolean {
  return ["dashboard.view", "sales_dashboard.view", "electric_dashboard.view", "civil_dashboard.view",
    "pm_dashboard.view", "switchgear_dashboard.view", "maintenance_dashboard.view"]
    .some(permission => permissions.includes(permission));
}
