import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire users.roles API
async function getRoles() {
  try {
    const data = await api.users.getRoles().catch(() => ({ roles: [] }))
    return data
  } catch (err) {
    return { roles: [] }
  }
}

export default function AdminRolesPage() {
  return (
    <ToDoBanner
      title="Admin · Roles"
      phase="Phase 1"
      description="Role definitions — viewer / analyst / operator / admin — and the permissions matrix they grant across the control plane."
    />
  );
}
