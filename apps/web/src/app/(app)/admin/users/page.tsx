import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire users API
async function getUsers() {
  try {
    const data = await api.users.list().catch(() => ({ users: [] }))
    return data
  } catch (err) {
    return { users: [] }
  }
}

export default function AdminUsersPage() {
  return (
    <ToDoBanner
      title="Admin · Users"
      phase="Phase 1"
      description="User management — invite, deactivate, reset password, role assignment. All actions audit-logged."
      related={[{ label: "Admin · Roles", href: "/admin/roles" }]}
    />
  );
}
