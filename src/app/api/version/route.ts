import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";
import pkg from "../../../../package.json";

/**
 * GET /api/version — informações de versão do build em execução.
 *
 * Fonte de verdade: arquivo `version.json` gerado pelo Dockerfile durante o
 * build (lê o SHA direto de `.git/HEAD`). Funciona com qualquer host
 * (Portainer, Coolify, manual) sem precisar de --build-arg.
 *
 * Fallback (dev/local): env vars (GIT_COMMIT_SHA, BUILD_TIMESTAMP) e por fim
 * placeholders "dev".
 */

interface VersionFile {
  commit: string;
  builtAt: string;
}

let cached: VersionFile | null = null;
function readVersionFile(): VersionFile | null {
  if (cached) return cached;
  // O standalone server roda a partir de /app, mas process.cwd pode variar.
  // Tenta dois caminhos comuns: cwd e raiz do projeto.
  const candidates = [
    path.join(process.cwd(), "version.json"),
    path.resolve(__dirname, "../../../../../version.json"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const raw = readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw) as VersionFile;
        if (parsed.commit) {
          cached = parsed;
          return cached;
        }
      }
    } catch { /* tenta o próximo */ }
  }
  return null;
}

export async function GET() {
  const fileVersion = readVersionFile();
  const envCommit = process.env.GIT_COMMIT_SHA;
  const envBuiltAt = process.env.BUILD_TIMESTAMP;

  // Prioridade: arquivo > env var > "dev". "unknown" é tratado como ausência.
  const commit =
    (fileVersion?.commit && fileVersion.commit !== "unknown" && fileVersion.commit) ||
    (envCommit && envCommit !== "unknown" && envCommit) ||
    "dev";
  const builtAt = fileVersion?.builtAt || envBuiltAt || null;

  const shortCommit = commit.length > 7 ? commit.slice(0, 7) : commit;
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
