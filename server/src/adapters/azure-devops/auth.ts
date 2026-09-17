/**
 * Azure DevOps auth — shared across every ADO call in this adapter
 * (settings test-connection now; `AzureDevOpsClient` in TASK-006, thread
 * publishing in TASK-008). ADO's REST API and SDK both authenticate PATs via
 * HTTP Basic auth with an EMPTY username and the PAT as the password — NOT a
 * Bearer token, which is GitHub's convention. Centralizing the header
 * construction here means every future call site gets this right once.
 */

/** Build the `Authorization: Basic ...` header value for a PAT. */
export function adoAuthHeader(pat: string): string {
  const encoded = Buffer.from(`:${pat}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

export interface AdoProfile {
  id: string;
  displayName: string;
}

export interface AdoConnectionTestResult {
  ok: boolean;
  message: string;
}

const PROFILE_URL =
  "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1";

/**
 * Shared fetch + defensive-parse core for both connection-test variants.
 *
 * Defensive parsing: an invalid/expired PAT sometimes comes back as an HTML
 * login page rather than a JSON error body — sometimes even with a
 * 2xx/203-ish status (confirmed empirically: a bogus PAT against a valid org
 * returns HTTP 203 + an HTML sign-in page, not a clean 401 JSON error).
 * Checking `content-type` before parsing avoids treating that as a confusing
 * crash or, worse, a false "connected". This same rule is required again for
 * the ADO REST path itself in TASK-009 (AC-48) — this is the first instance.
 */
async function fetchAdoJson(
  url: string,
  pat: string,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: adoAuthHeader(pat), Accept: "application/json" },
    });
  } catch (err) {
    // Network-level failure only — fetch() error messages never include
    // request headers, so the PAT cannot leak here.
    return { ok: false, message: `Could not reach Azure DevOps: ${(err as Error).message}` };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      message:
        "Azure DevOps did not return a valid JSON response — the PAT is likely invalid or expired",
    };
  }
  if (!res.ok) {
    return { ok: false, message: `Azure DevOps rejected the PAT (HTTP ${res.status})` };
  }
  return { ok: true, body: (await res.json()) as Record<string, unknown> };
}

/**
 * Validates a PAT against a KNOWN organization's `connectionData` endpoint
 * (`{baseUrl}/{org}/_apis/connectionData`) — the reliable check, since it
 * only requires whatever minimal scope (`vso.code` is enough) the PAT
 * already needs for reading repos/PRs.
 *
 * Preferred over `testAzureDevOpsConnection` below whenever an org is known
 * (i.e. the workspace already has at least one Azure DevOps repo added).
 */
export async function testAzureDevOpsOrgConnection(
  pat: string,
  org: string,
  baseUrl: string,
): Promise<AdoConnectionTestResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(org)}/_apis/connectionData?api-version=7.1-preview`;
  const result = await fetchAdoJson(url, pat);
  if (!result.ok) return result;
  const authenticatedUser = result.body.authenticatedUser as
    | { providerDisplayName?: string }
    | undefined;
  const name = authenticatedUser?.providerDisplayName ?? "Azure DevOps user";
  return { ok: true, message: `Connected as ${name} (org: ${org})` };
}

/**
 * Validates a PAT via the account-level, org-agnostic profile endpoint —
 * used only when no organization is known yet (first-time setup, before any
 * Azure DevOps repo has been added).
 *
 * KNOWN LIMITATION (confirmed empirically against a real Azure DevOps org
 * with Microsoft Entra ID Conditional Access enabled): this account-level
 * host can reject Basic-auth PAT requests with a bare 401 even for a PAT
 * that is otherwise fully valid and works fine against org-scoped endpoints
 * (`{baseUrl}/{org}/_apis/...`) — CA policies can restrict Basic auth at the
 * account level while still allowing it per-organization. There is no
 * reliable org-agnostic REST endpoint that works around this; the only fix
 * is `testAzureDevOpsOrgConnection` once an org is known. Callers should
 * prefer the org-scoped variant whenever possible.
 */
export async function testAzureDevOpsConnection(pat: string): Promise<AdoConnectionTestResult> {
  const result = await fetchAdoJson(PROFILE_URL, pat);
  if (!result.ok) return result;
  const profile = result.body as unknown as AdoProfile;
  return { ok: true, message: `Connected as ${profile.displayName}` };
}
