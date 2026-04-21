import type { ReactNode } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <div className="grid h-screen grid-cols-[260px_1fr] grid-rows-[auto_1fr]">
        <div className="row-span-2 h-screen">
          <Sidebar />
        </div>
        <TopBar />
        <main className="overflow-y-auto bg-background p-6">{children}</main>
      </div>
    </AuthGate>
  );
}
