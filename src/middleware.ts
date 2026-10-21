import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, canAccessPage, verifySessionToken } from "@/lib/session";
import { ADMIN_PAGES, ADMIN_USERS_PAGE, pathMatchesAdminPage } from "@/lib/admin-pages";

// 管理画面(/admin/**)と、管理画面専用のAPI(/api/admin, /api/report, /api/sources, /api/purchase-links,
// /api/logs/export-to-sheet)はログイン必須にする。
//
// 一方で、以下はLINE/LP側から直接呼ばれる(ログインしていない一般ユーザー・外部サービスからのアクセス)ため、
// 認証対象から外す必要がある:
//   - /api/line/webhook … LINEプラットフォームからのWebhook(署名で検証)
//   - /api/track/click, /api/track/conversion … LP(track.js)からのクロスオリジン計測リクエスト
//   - /api/logs/client … LP等からのクライアントエラー報告(CORS許可)
//   - /liff/add … LIFFからの友だち追加リダイレクト
//   - /login, /api/auth/** … ログイン自体
export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/api/report/:path*", "/api/sources/:path*", "/api/purchase-links/:path*", "/api/logs/export-to-sheet"],
};

// 「管理者権限」以外のユーザーが閲覧可能なページ一覧(ユーザー管理ページは管理者専用のため含めない)
const ALL_PAGE_PATHS = ADMIN_PAGES.map((p) => p.path);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApiRequest = pathname.startsWith("/api/");

  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    if (isApiRequest) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // APIリクエストは、ログイン済みであればページ単位の権限チェックはせずに通す
  // (ページ側の権限チェックで表示を絞り込んでいるため、APIレベルでは「ログイン済みかどうか」のみを見る)。
  // ただし「レポート閲覧権限」は常に閲覧のみ(編集不可)のため、GET以外(PUT/POST/DELETE等)は
  // 管理者権限のみに制限する(レポート画面のPV数編集・インポート等のAPIが対象)。
  if (isApiRequest) {
    // 例外: /api/admin/table は絞り込み条件を渡すためPOSTだが閲覧のみ。権限は各ルート側で検証する。
    const isReadOnlyPost = req.method === "POST" && pathname === "/api/admin/table";
    if (session.role !== "admin" && req.method !== "GET" && !isReadOnlyPost) {
      return NextResponse.json({ error: "閲覧権限のみのため、編集はできません" }, { status: 403 });
    }
    return NextResponse.next();
  }

  // ユーザー管理ページ(/admin/users)は管理者権限のみ
  if (pathMatchesAdminPage(pathname, ADMIN_USERS_PAGE.path)) {
    if (session.role !== "admin") {
      return NextResponse.redirect(new URL("/admin/no-access", req.url));
    }
    return NextResponse.next();
  }

  if (session.role === "admin") {
    return NextResponse.next();
  }

  // レポート閲覧権限: allowedPagesに含まれるページ(とその配下)のみ閲覧可能
  const matchesAllowedPage = ALL_PAGE_PATHS.some(
    (page) => canAccessPage(session, page) && pathMatchesAdminPage(pathname, page)
  );
  if (!matchesAllowedPage && pathname !== "/admin/no-access") {
    // ログイン直後の遷移先である"/admin"(友だち一覧。レポート閲覧権限では閲覧不可)に来た場合は、
    // 「権限がありません」と出すよりも、閲覧できる最初のページへそのまま連れて行く方が親切なため、
    // allowedPagesの先頭のページへリダイレクトする。それ以外の(閲覧できないと分かっているページを
    // 明示的に開こうとした)場合は、従来どおりno-accessページへ案内する。
    const firstAllowedPage = session.allowedPages?.[0];
    if (pathname === "/admin" && firstAllowedPage) {
      return NextResponse.redirect(new URL(firstAllowedPage, req.url));
    }
    return NextResponse.redirect(new URL("/admin/no-access", req.url));
  }

  return NextResponse.next();
}
