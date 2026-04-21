import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export default function Root() {
  redirect("/overview");
}
