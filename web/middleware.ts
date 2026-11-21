import { withAuth } from "next-auth/middleware";

export default withAuth({ pages: { signIn: "/login" } });

// Session required everywhere except: sign-in, Auth.js, Meta's webhook (signature-checked), the public API
// (API-key auth), tracked-link redirects and invite acceptance (token-checked).
export const config = { matcher: ["/((?!login|invite|r/|api/auth|api/webhooks|api/v1|_next/static|_next/image|favicon.ico).*)"] };
