# LeadHub CRM

[![Versão](https://img.shields.io/github/package-json/v/LazzariAgenciaWeb/LeadHub-CRM?label=vers%C3%A3o&color=indigo)](https://github.com/LazzariAgenciaWeb/LeadHub-CRM/blob/main/package.json)
[![Último commit](https://img.shields.io/github/last-commit/LazzariAgenciaWeb/LeadHub-CRM?label=%C3%BAltimo%20commit&color=blue)](https://github.com/LazzariAgenciaWeb/LeadHub-CRM/commits/main)
[![Releases](https://img.shields.io/github/v/release/LazzariAgenciaWeb/LeadHub-CRM?label=release&color=emerald&include_prereleases)](https://github.com/LazzariAgenciaWeb/LeadHub-CRM/releases)

SaaS multi-tenant de **marketing + atendimento WhatsApp + CRM**, voltado a agências e PMEs. Inbox unificada, pipeline configurável, integrações Evolution API / ClickUp / OpenAI.

## Como verificar a versão em produção

A versão atual aparece no **rodapé do menu lateral** (canto inferior esquerdo do sistema), no formato:

```
v0.2.0 · abc1234
```

Onde `abc1234` é o hash curto do commit do build atual. Clicando, abre o commit correspondente no GitHub.

Detalhes completos em `GET /api/version`:

```json
{
  "name": "leadhub",
  "version": "0.2.0",
  "commit": "abc1234567890...",
  "shortCommit": "abc1234",
  "builtAt": "2026-04-30T18:30:00Z",
  "commitUrl": "https://github.com/LazzariAgenciaWeb/LeadHub-CRM/commit/abc1234567890...",
  "releaseUrl": "https://github.com/LazzariAgenciaWeb/LeadHub-CRM/releases/tag/v0.2.0"
}
```

## Stack

- **Framework:** Next.js 16 (App Router) + React 19
- **Banco:** PostgreSQL via Prisma 5
- **Auth:** NextAuth (Credentials)
- **WhatsApp:** Evolution API v2 (multi-instância, Baileys)
- **IA:** OpenAI
- **Integrações:** ClickUp, Google Sheets (BDR sync)
- **Deploy:** Docker via Portainer

## Versionamento

O projeto segue [SemVer](https://semver.org/lang/pt-BR/) (`MAJOR.MINOR.PATCH`):

- **MAJOR** — quebras incompatíveis (raras)
- **MINOR** — features novas (releases regulares)
- **PATCH** — correções de bugs

A versão é mantida em `package.json`. Em cada release significativa:
1. Bump em `package.json`
2. Tag no git: `git tag vX.Y.Z && git push --tags`
3. (Opcional) Release notes em [Releases](https://github.com/LazzariAgenciaWeb/LeadHub-CRM/releases)

O hash do commit é injetado no build via `GIT_COMMIT_SHA` (Dockerfile), permitindo identificar exatamente qual commit está rodando em produção.

## Scripts

```bash
npm run dev        # Desenvolvimento (porta 3000)
npm run build      # Build de produção
npm run start      # Servir build
npm run lint       # ESLint
npm run db:migrate # Aplicar migrations Prisma
npm run db:seed    # Seed inicial
```

## Documentação

- `SISTEMA.md` — Visão geral, módulos, planos comerciais, roadmap (na raiz do workspace)
- [`AGENTS.md`](AGENTS.md) — Convenções para edição de código

---

🔗 [Repositório](https://github.com/LazzariAgenciaWeb/LeadHub-CRM) · [Commits](https://github.com/LazzariAgenciaWeb/LeadHub-CRM/commits/main) · [Releases](https://github.com/LazzariAgenciaWeb/LeadHub-CRM/releases)
