import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

/**
 * GET /api/version — informações de versão do build em execução
 *
 * Lê:
 *   - version: do package.json (fonte da verdade do release)
 *   - commit:  GIT_COMMIT_SHA injetado no build (Dockerfile)
 *   - builtAt: BUILD_TIMESTAMP injetado no build
 *
 * Sem injection (dev/local), retorna placeholders.
 */
export async function GET() {
  const commit = process.env.GIT_COMMIT_SHA ?? "dev";
  const shortCommit = commit.length > 7 ? commit.slice(0, 7) : commit;
  const builtAt = process.env.BUILD_TIMESTAMP ?? null;
  const repo = "https://github.com/LazzariAgenciaWeb/LeadHub-CRM";

  return NextResponse.json({
    name: pkg.name,
    version: pkg.version,
    commit,
    shortCommit,
    builtAt,
    repoUrl: repo,
    commitUrl: commit !== "dev" ? `${repo}/commit/${commit}` : null,
    releaseUrl: `${repo}/releases/tag/v${pkg.version}`,
  });
}
