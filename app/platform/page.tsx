// Platform admin — super-admin-only surface to create orgs, rotate join keys,
// and see each org's Slack connection. Server-guarded: non-super-admins are
// bounced before any client code loads (the API re-checks too).
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import PlatformClient from "./PlatformClient";

export default async function PlatformPage() {
  const user = await requireSuperAdmin();
  if (!user) redirect("/calendar");
  return <PlatformClient />;
}
