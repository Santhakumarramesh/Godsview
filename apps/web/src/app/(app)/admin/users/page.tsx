import { ToDoBanner } from "@/components/ToDoBanner";

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
