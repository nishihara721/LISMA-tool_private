import { redirect } from "next/navigation";
import { MANUAL_URL } from "@/lib/admin-pages";

// 管理画面内のマニュアルは廃止し、別URLのマニュアルサイトへ転送する(ブックマーク等で旧URLが開かれた場合用)
export default function ManualPage() {
  redirect(MANUAL_URL);
}
