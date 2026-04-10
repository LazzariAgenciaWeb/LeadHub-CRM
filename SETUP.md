# LeadHub — Setup

## Pré-requisitos
- Node.js >= 18
- MySQL rodando localmente (ou remotamente)

---

## 1. Configurar o banco de dados

Crie o banco no MySQL:
```sql
CREATE DATABASE leadhub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

---

## 2. Configurar variáveis de ambiente

Edite o arquivo `.env`:
```env
DATABASE_URL="mysql://USUARIO:SENHA@localhost:3306/leadhub"

NEXTAUTH_SECRET="troque-por-uma-string-aleatoria-segura"
NEXTAUTH_URL="http://localhost:3000"

# URL da sua Evolution API
EVOLUTION_API_URL="https://sua-evolution-api.com"
EVOLUTION_API_KEY="sua-api-key"
```

---

## 3. Criar as tabelas e o primeiro usuário

```bash
# Criar as tabelas no banco
npm run db:push

# Criar o super admin (email: admin@leadhub.com / senha: leadhub123)
npm run db:seed
```

Para personalizar o admin, defina antes de rodar o seed:
```bash
ADMIN_EMAIL="diego@seudominio.com" ADMIN_PASSWORD="suasenha" npm run db:seed
```

---

## 4. Rodar em desenvolvimento

```bash
npm run dev
```

Acesse: http://localhost:3000

---

## 5. Configurar o Webhook do WhatsApp (Evolution API)

No painel da Evolution API, configure o webhook da instância:

- **URL:** `https://seu-dominio.com/api/webhook/whatsapp`
- **Eventos:** `messages.upsert`

O sistema identificará automaticamente leads pelas palavras-chave das mensagens recebidas.

---

## Scripts disponíveis

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia em desenvolvimento |
| `npm run build` | Gera build de produção |
| `npm run db:push` | Aplica o schema no banco sem migration |
| `npm run db:migrate` | Cria migration e aplica |
| `npm run db:seed` | Cria o super admin |
| `npm run db:studio` | Abre o Prisma Studio (UI do banco) |

---

## Estrutura do projeto

```
src/
  app/
    (auth)/login/        → Página de login
    (admin)/
      dashboard/         → Dashboard (admin geral ou cliente)
      empresas/          → CRUD de empresas
        [id]/            → Detalhe + campanhas da empresa
        nova/            → Formulário de nova empresa
    api/
      auth/              → NextAuth
      companies/         → CRUD API de empresas
      campaigns/         → CRUD API de campanhas
      webhook/whatsapp/  → Webhook da Evolution API
  lib/
    prisma.ts            → Cliente Prisma singleton
    auth.ts              → Configuração NextAuth
    whatsapp.ts          → Lógica de identificação de leads
  components/
    Sidebar.tsx          → Menu lateral
    SessionProvider.tsx  → Provedor de sessão NextAuth
  generated/prisma/      → Cliente Prisma gerado (não editar)
prisma/
  schema.prisma          → Schema do banco de dados
  seed.ts                → Script para criar super admin
```
