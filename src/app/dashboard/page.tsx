import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/server/frontend-auth";
import { hasDashboardAccess } from "@/server/presentation-permissions";
import { CrmShell } from "@/components/crm/shell";
import { Dashboard } from "@/components/crm/dashboard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!hasDashboardAccess(user.permissions)) notFound();
  return <CrmShell user={user}><h1>Dashboard</h1><Dashboard /></CrmShell>;
}

