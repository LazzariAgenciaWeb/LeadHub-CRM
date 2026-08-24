import { prisma } from "./prisma";

// ─── Merge de empresas ────────────────────────────────────────────────────────
// Transfere todos os dados vinculados à empresa `sourceId` para `targetId` e
// deleta a empresa de origem. Resolve conflitos de unique constraints
// privilegiando o destino (target wins) — exceto onde mesclar faz mais sentido
// (ex: tags com mesmo nome viram a mesma tag, conversas com mesmo telefone têm
// mensagens fundidas).
//
// Roda dentro de uma única transação. Pode demorar pra empresas grandes —
// timeout configurado pra 60s.

export interface MergeResult {
  source: { id: string; name: string };
  target: { id: string; name: string };
  // Quantidade de registros movidos por tabela
  transferred: Record<string, number>;
  // Quantidade de registros descartados/mesclados por conflito
  conflicts: Record<string, number>;
}

export async function mergeCompany(
  sourceId: string,
  targetId: string
): Promise<MergeResult> {
  if (sourceId === targetId) {
    throw new Error("Empresa origem e destino são iguais.");
  }

  const [source, target] = await Promise.all([
    prisma.company.findUnique({
      where: { id: sourceId },
      select: { id: true, name: true, parentCompanyId: true },
    }),
    prisma.company.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, parentCompanyId: true },
    }),
  ]);
  if (!source) throw new Error("Empresa origem não encontrada.");
  if (!target) throw new Error("Empresa destino não encontrada.");

  const transferred: Record<string, number> = {};
  const conflicts: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      // ── 1) Hierarquia ────────────────────────────────────────────────────
      // Se o destino era sub-empresa da origem, re-aponta pro grand-parent
      // pra evitar self-parent quando re-pais filhos restantes.
      if (target.parentCompanyId === sourceId) {
        await tx.company.update({
          where: { id: targetId },
          data: { parentCompanyId: source.parentCompanyId ?? null },
        });
      }
      // Re-parenta sub-empresas restantes da origem pro destino.
      const reparented = await tx.company.updateMany({
        where: { parentCompanyId: sourceId, id: { not: targetId } },
        data: { parentCompanyId: targetId },
      });
      transferred.subEmpresas = reparented.count;

      // ── 2) Tag: unique (companyId, name) ─────────────────────────────────
      // Se já existe tag com mesmo nome no destino, remapeia LeadTag e descarta.
      const sourceTags = await tx.tag.findMany({ where: { companyId: sourceId } });
      const targetTags = await tx.tag.findMany({ where: { companyId: targetId } });
      const targetTagByName = new Map(targetTags.map((t) => [t.name.toLowerCase(), t.id]));
      let tagsMoved = 0;
      let tagsMerged = 0;
      for (const st of sourceTags) {
        const existing = targetTagByName.get(st.name.toLowerCase());
        if (existing) {
          // Remapeia LeadTag (PK [leadId, tagId]) ignorando conflitos.
          await tx.$executeRaw`
            UPDATE "LeadTag" lt SET "tagId" = ${existing}
            WHERE lt."tagId" = ${st.id}
              AND NOT EXISTS (
                SELECT 1 FROM "LeadTag" lt2
                WHERE lt2."leadId" = lt."leadId" AND lt2."tagId" = ${existing}
              )
          `;
          await tx.leadTag.deleteMany({ where: { tagId: st.id } });
          await tx.tag.delete({ where: { id: st.id } });
          tagsMerged++;
        } else {
          await tx.tag.update({ where: { id: st.id }, data: { companyId: targetId } });
          tagsMoved++;
        }
      }
      transferred.tags = tagsMoved;
      conflicts.tags = tagsMerged;

      // ── 3) CustomFieldDef: unique (companyId, key) ───────────────────────
      const sourceFields = await tx.customFieldDef.findMany({
        where: { companyId: sourceId },
      });
      const targetFields = await tx.customFieldDef.findMany({
        where: { companyId: targetId },
      });
      const targetFieldByKey = new Map(targetFields.map((f) => [f.key, f.id]));
      let fieldsMoved = 0;
      let fieldsMerged = 0;
      for (const sf of sourceFields) {
        const existing = targetFieldByKey.get(sf.key);
        if (existing) {
          // Remapeia LeadCustomValue (unique [leadId, fieldId]) — destino vence.
          await tx.$executeRaw`
            UPDATE "LeadCustomValue" lcv SET "fieldId" = ${existing}
            WHERE lcv."fieldId" = ${sf.id}
              AND NOT EXISTS (
                SELECT 1 FROM "LeadCustomValue" lcv2
                WHERE lcv2."leadId" = lcv."leadId" AND lcv2."fieldId" = ${existing}
              )
          `;
          await tx.leadCustomValue.deleteMany({ where: { fieldId: sf.id } });
          await tx.customFieldDef.delete({ where: { id: sf.id } });
          fieldsMerged++;
        } else {
          await tx.customFieldDef.update({
            where: { id: sf.id },
            data: { companyId: targetId },
          });
          fieldsMoved++;
        }
      }
      transferred.customFields = fieldsMoved;
      conflicts.customFields = fieldsMerged;

      // ── 4) CompanyContact: unique (companyId, phone) ─────────────────────
      const sourceContacts = await tx.companyContact.findMany({
        where: { companyId: sourceId },
        select: { id: true, phone: true },
      });
      const targetContactPhones = new Set(
        (
          await tx.companyContact.findMany({
            where: { companyId: targetId },
            select: { phone: true },
          })
        ).map((c) => c.phone)
      );
      let contactsMoved = 0;
      let contactsDropped = 0;
      for (const sc of sourceContacts) {
        if (targetContactPhones.has(sc.phone)) {
          await tx.companyContact.delete({ where: { id: sc.id } });
          contactsDropped++;
        } else {
          await tx.companyContact.update({
            where: { id: sc.id },
            data: { companyId: targetId },
          });
          contactsMoved++;
        }
      }
      transferred.contacts = contactsMoved;
      conflicts.contacts = contactsDropped;

      // ── 5) Conversation: unique (companyId, phone) ───────────────────────
      // Em conflito, funde mensagens/notas/atividades/leads na conversa do destino.
      const sourceConvos = await tx.conversation.findMany({
        where: { companyId: sourceId },
        select: { id: true, phone: true },
      });
      const targetConvoByPhone = new Map(
        (
          await tx.conversation.findMany({
            where: { companyId: targetId },
            select: { id: true, phone: true },
          })
        ).map((c) => [c.phone, c.id])
      );
      let convosMoved = 0;
      let convosMerged = 0;
      for (const sc of sourceConvos) {
        const existing = targetConvoByPhone.get(sc.phone);
        if (existing) {
          await tx.message.updateMany({
            where: { conversationId: sc.id },
            data: { conversationId: existing },
          });
          await tx.conversationNote.updateMany({
            where: { conversationId: sc.id },
            data: { conversationId: existing },
          });
          await tx.activity.updateMany({
            where: { conversationId: sc.id },
            data: { conversationId: existing },
          });
          await tx.lead.updateMany({
            where: { conversationId: sc.id },
            data: { conversationId: existing },
          });
          await tx.conversation.delete({ where: { id: sc.id } });
          convosMerged++;
        } else {
          await tx.conversation.update({
            where: { id: sc.id },
            data: { companyId: targetId },
          });
          convosMoved++;
        }
      }
      transferred.conversations = convosMoved;
      conflicts.conversations = convosMerged;

      // ── 6) Campaign: unique (companyId, slug) ────────────────────────────
      // Em conflito, renomeia o slug com sufixo.
      const sourceCampaigns = await tx.campaign.findMany({
        where: { companyId: sourceId },
        select: { id: true, slug: true },
      });
      const usedSlugs = new Set(
        (
          await tx.campaign.findMany({
            where: { companyId: targetId },
            select: { slug: true },
          })
        ).map((c) => c.slug)
      );
      let campaignsMoved = 0;
      let campaignsRenamed = 0;
      for (const sc of sourceCampaigns) {
        let newSlug = sc.slug;
        if (usedSlugs.has(sc.slug)) {
          newSlug = `${sc.slug}-merged-${sc.id.slice(-6)}`;
          campaignsRenamed++;
        }
        await tx.campaign.update({
          where: { id: sc.id },
          data: { companyId: targetId, slug: newSlug },
        });
        usedSlugs.add(newSlug);
        campaignsMoved++;
      }
      transferred.campaigns = campaignsMoved;
      conflicts.campaigns = campaignsRenamed;

      // ── 7) Subscription: @unique companyId ───────────────────────────────
      const sourceSub = await tx.subscription.findUnique({
        where: { companyId: sourceId },
      });
      if (sourceSub) {
        const targetSub = await tx.subscription.findUnique({
          where: { companyId: targetId },
        });
        if (targetSub) {
          await tx.subscription.delete({ where: { companyId: sourceId } });
          conflicts.subscription = 1;
        } else {
          await tx.subscription.update({
            where: { companyId: sourceId },
            data: { companyId: targetId },
          });
          transferred.subscription = 1;
        }
      }

      // ── 8) BusinessHoursConfig: unique (companyId, dayOfWeek) ────────────
      const targetBHDays = (
        await tx.businessHoursConfig.findMany({
          where: { companyId: targetId },
          select: { dayOfWeek: true },
        })
      ).map((b) => b.dayOfWeek);
      if (targetBHDays.length > 0) {
        const dropped = await tx.businessHoursConfig.deleteMany({
          where: { companyId: sourceId, dayOfWeek: { in: targetBHDays } },
        });
        conflicts.businessHours = dropped.count;
      }
      transferred.businessHours = (
        await tx.businessHoursConfig.updateMany({
          where: { companyId: sourceId },
          data: { companyId: targetId },
        })
      ).count;

      // ── 9) ScoreRuleConfig: unique (companyId, reason) ───────────────────
      const targetSRCReasons = (
        await tx.scoreRuleConfig.findMany({
          where: { companyId: targetId },
          select: { reason: true },
        })
      ).map((s) => s.reason);
      if (targetSRCReasons.length > 0) {
        const dropped = await tx.scoreRuleConfig.deleteMany({
          where: { companyId: sourceId, reason: { in: targetSRCReasons } },
        });
        conflicts.scoreRules = dropped.count;
      }
      transferred.scoreRules = (
        await tx.scoreRuleConfig.updateMany({
          where: { companyId: sourceId },
          data: { companyId: targetId },
        })
      ).count;

      // ── 10) MarketingIntegration: unique (companyId, provider, accountId) ──
      const sourceMIs = await tx.marketingIntegration.findMany({
        where: { companyId: sourceId },
        select: { id: true, provider: true, accountId: true },
      });
      const targetMIKeys = new Set(
        (
          await tx.marketingIntegration.findMany({
            where: { companyId: targetId },
            select: { provider: true, accountId: true },
          })
        ).map((m) => `${m.provider}::${m.accountId ?? ""}`)
      );
      let miMoved = 0;
      let miDropped = 0;
      for (const sm of sourceMIs) {
        const key = `${sm.provider}::${sm.accountId ?? ""}`;
        if (targetMIKeys.has(key)) {
          await tx.marketingIntegration.delete({ where: { id: sm.id } });
          miDropped++;
        } else {
          await tx.marketingIntegration.update({
            where: { id: sm.id },
            data: { companyId: targetId },
          });
          miMoved++;
        }
      }
      transferred.marketingIntegrations = miMoved;
      conflicts.marketingIntegrations = miDropped;

      // ── 11) Tabelas de Analytics (unique date-based) ─────────────────────
      // Deleta source rows que conflitam com target, depois move o resto.
      const analyticsTables: Array<{ table: string; keyCols: string[] }> = [
        { table: "AnalyticsSnapshot", keyCols: ["date", "source"] },
        { table: "AnalyticsTopPage", keyCols: ["date", "source", "pagePath"] },
        {
          table: "AnalyticsTrafficSource",
          keyCols: ["date", "source", "rawSource", "rawMedium"],
        },
        {
          table: "AnalyticsGeoData",
          keyCols: ["date", "source", "countryCode", "region", "city"],
        },
        {
          table: "SearchConsoleQuery",
          keyCols: ["date", "query", "page", "country", "device"],
        },
      ];
      for (const t of analyticsTables) {
        const join = t.keyCols.map((c) => `s."${c}" = d."${c}"`).join(" AND ");
        const dropped = await tx.$executeRawUnsafe(
          `DELETE FROM "${t.table}" AS s
           WHERE s."companyId" = $1
             AND EXISTS (
               SELECT 1 FROM "${t.table}" AS d
               WHERE d."companyId" = $2 AND ${join}
             )`,
          sourceId,
          targetId
        );
        conflicts[t.table] = Number(dropped);
        const moved = await tx.$executeRawUnsafe(
          `UPDATE "${t.table}" SET "companyId" = $2 WHERE "companyId" = $1`,
          sourceId,
          targetId
        );
        transferred[t.table] = Number(moved);
      }

      // ── 12) Tabelas sem conflito (apenas UPDATE companyId em massa) ──────
      const simpleTables: Array<keyof typeof tx> = [
        "lead",
        "task",
        "pipelineStageConfig",
        "whatsappInstance",
        "message",
        "keywordRule",
        "activity",
        "ticket",
        "setor",
        "companyAsset",
        "credentialAccessLog",
        "trackingLink",
        "reward",
        "rewardRedemption",
        "userScore",
        "userBadge",
        "scoreEvent",
        "billingEvent",
        "user",
      ];
      for (const t of simpleTables) {
        // @ts-expect-error — acesso dinâmico ao delegate do Prisma
        const res = await tx[t].updateMany({
          where: { companyId: sourceId },
          data: { companyId: targetId },
        });
        transferred[String(t)] = res.count;
      }

      // ── 12b) Financeiro ──────────────────────────────────────────────────
      // Estas apontam pro cliente por `clientCompanyId`, não por `companyId`,
      // então não entram na varredura genérica acima. Sem mover aqui, o passo
      // 13 apagaria a empresa de origem e levaria contratos e cobranças junto
      // por cascata — perda silenciosa, no meio de uma operação que a pessoa
      // fez justamente pra NÃO perder nada.
      transferred["clientService"] = (
        await tx.clientService.updateMany({
          where: { clientCompanyId: sourceId },
          data: { clientCompanyId: targetId },
        })
      ).count;
      transferred["clientInvoice"] = (
        await tx.clientInvoice.updateMany({
          where: { clientCompanyId: sourceId },
          data: { clientCompanyId: targetId },
        })
      ).count;
      // Sale aponta pros dois lados: o cliente que a venda virou e a agência
      // dona da venda. Merge de sub-empresa mexe no primeiro; o segundo só
      // importa quando se mescla a própria agência, mas custa nada cobrir.
      transferred["sale.cliente"] = (
        await tx.sale.updateMany({
          where: { clientCompanyId: sourceId },
          data: { clientCompanyId: targetId },
        })
      ).count;
      transferred["sale.agencia"] = (
        await tx.sale.updateMany({
          where: { companyId: sourceId },
          data: { companyId: targetId },
        })
      ).count;

      // MonthlyTarget tem unique (companyId, month): onde as duas empresas têm
      // meta do mesmo mês, a do destino prevalece e a da origem é descartada.
      const mesesDoDestino = (
        await tx.monthlyTarget.findMany({
          where: { companyId: targetId },
          select: { month: true },
        })
      ).map((m) => m.month);
      const metasDescartadas = await tx.monthlyTarget.deleteMany({
        where: { companyId: sourceId, month: { in: mesesDoDestino } },
      });
      conflicts["MonthlyTarget"] = metasDescartadas.count;
      transferred["monthlyTarget"] = (
        await tx.monthlyTarget.updateMany({
          where: { companyId: sourceId },
          data: { companyId: targetId },
        })
      ).count;

      // ── 13) Finalmente, deleta a empresa origem ──────────────────────────
      await tx.company.delete({ where: { id: sourceId } });
    },
    { maxWait: 10_000, timeout: 60_000 }
  );

  return {
    source: { id: source.id, name: source.name },
    target: { id: target.id, name: target.name },
    transferred,
    conflicts,
  };
}
