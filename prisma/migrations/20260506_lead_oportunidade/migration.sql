-- Lead promovido pra Oportunidade — bonus distinto de LEAD_AVANCADO.
-- Lead vira reuniao; oportunidade vira venda. A promocao em si tem peso.

ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'LEAD_VIROU_OPORTUNIDADE';
