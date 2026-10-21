import { adminDb } from "@/lib/firebase-admin";
import type { CollectionReference, DocumentData } from "firebase-admin/firestore";

// 配列をn件ずつのチャンクに分割する。
// Firestoreの where(field, "in", values) は一度に渡せる値の数に上限があるため、
// 大きな配列を渡す際はチャンクに分けて複数回に分けて問い合わせる必要がある。
export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// 指定したドキュメントIDの一覧だけを取得し、Mapにして返す。
// コレクション全体を .get() するのではなく、必要なIDのものだけをまとめて取得することで、
// コレクション全体が大きくなっても読み取り件数が「必要な件数分」で頭打ちになるようにする。
// (Firestoreの getAll は "in" クエリと違って一度に渡せる件数の上限がないため、まとめて1回で済む)
export async function getDocsByIds<T extends DocumentData>(
  collection: CollectionReference,
  ids: string[]
): Promise<Map<string, T>> {
  const map = new Map<string, T>();
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (uniqueIds.length === 0) return map;

  const refs = uniqueIds.map((id) => collection.doc(id));
  const snaps = await adminDb.getAll(...refs);
  snaps.forEach((snap) => {
    if (snap.exists) {
      map.set(snap.id, snap.data() as T);
    }
  });
  return map;
}
