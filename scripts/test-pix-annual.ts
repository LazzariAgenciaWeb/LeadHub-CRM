import assert from "node:assert/strict";
import { isPixAnnualTier, pixAnnualAction, pixAnnualCents, pixAnnualPeriod } from "../src/lib/pix-annual";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

// Quem pode pagar anual no Pix
for (const t of ["ORGANIZATION", "ESSENCIAL", "MARKETING", "PREMIUM"]) assert.equal(isPixAnnualTier(t), true, t);
for (const t of ["FREE", "ENTERPRISE", "XPTO", null]) assert.equal(isPixAnnualTier(t), false, String(t));

// Valor do ano, sem erro de centavos
assert.equal(pixAnnualCents("ORGANIZATION"), 47880);
assert.equal(pixAnnualCents("ESSENCIAL"), 92400);

// Primeiro pagamento: 12 meses a partir de hoje
assert.deepEqual(pixAnnualPeriod(d("2026-11-09")), { start: d("2026-11-09"), end: d("2027-11-09") });
// Renovação antecipada do mesmo plano soma no fim
assert.deepEqual(
  pixAnnualPeriod(d("2027-11-01"), { sameTier: true, end: d("2027-11-09") }),
  { start: d("2027-11-09"), end: d("2028-11-09") },
);
// Troca de plano ou período vencido recomeça hoje
assert.equal(pixAnnualPeriod(d("2027-11-01"), { sameTier: false, end: d("2027-11-09") }).start.getTime(), d("2027-11-01").getTime());
assert.equal(pixAnnualPeriod(d("2027-12-01"), { sameTier: true, end: d("2027-11-09") }).start.getTime(), d("2027-12-01").getTime());

const end = d("2027-11-09");
assert.deepEqual(pixAnnualAction(end, d("2027-08-01"), []), { type: "none" });
assert.deepEqual(pixAnnualAction(end, d("2027-10-20"), []), { type: "remind", days: 30 });
assert.deepEqual(pixAnnualAction(end, d("2027-10-20"), [30]), { type: "none" });
assert.deepEqual(pixAnnualAction(end, d("2027-11-05"), [30]), { type: "remind", days: 7 });
// Cron parado: manda só o aviso mais próximo, nunca o antigo
assert.deepEqual(pixAnnualAction(end, d("2027-11-05"), []), { type: "remind", days: 7 });
assert.deepEqual(pixAnnualAction(end, d("2027-11-08"), [30, 7]), { type: "remind", days: 1 });
// Vencido: tolerância e depois tira o plano
assert.deepEqual(pixAnnualAction(end, d("2027-11-10"), [30, 7, 1]), { type: "none" });
assert.deepEqual(pixAnnualAction(end, d("2027-11-12"), [30, 7, 1]), { type: "expire" });

console.log("ok test-pix-annual");
