import { ToDoBanner } from "@/components/ToDoBanner";

export default function AdminRolesPage() {
  return (
    <ToDoBanner
      title="Admin · Roles"
      phase="Phase 1"
      description="Role definitions — viewer / analyst / operator / admin — and the permissions matrix they grant across the control plane."
    />
  );
}
