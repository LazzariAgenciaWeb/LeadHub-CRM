-- Instruções de cobrança por cliente — particularidades que quem fatura
-- precisa ver na hora do fechamento (emitir NF no mês, avisar no WhatsApp,
-- mandar Pix). Aparecem na fila "a faturar".
ALTER TABLE "Company" ADD COLUMN "billingNotes" TEXT;
