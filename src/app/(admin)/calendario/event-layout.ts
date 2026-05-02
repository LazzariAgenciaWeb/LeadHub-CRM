/**
 * Algoritmo de "lanes" pra eventos sobrepostos no calendário.
 *
 * Recebe lista de eventos com {start, end} e devolve cada um com:
 *   - lane:      qual coluna o evento ocupa (0..N-1)
 *   - laneCount: quantas colunas o cluster precisa (N)
 *
 * Eventos que se sobrepõem em qualquer ponto formam um cluster e dividem
 * a largura horizontal igualmente. Não-sobrepostos ocupam 100%.
 *
 * Estilo Google Calendar / Outlook — ao bater o olho dá pra ver todos os
 * eventos paralelos sem stack vertical confuso.
 */

export interface PositionableEvent {
  start: Date;
  end: Date;
}

export interface LaidOutEvent<T extends PositionableEvent> {
  event: T;
  lane: number;
  laneCount: number;
}

export function layoutOverlappingEvents<T extends PositionableEvent>(events: T[]): LaidOutEvent<T>[] {
  if (events.length === 0) return [];

  // Ordena por início (eventos mais cedo entram em lanes menores)
  const sorted = [...events].sort((a, b) => {
    const diff = a.start.getTime() - b.start.getTime();
    if (diff !== 0) return diff;
    return a.end.getTime() - b.end.getTime();
  });

  type Result = LaidOutEvent<T>;
  const results: Result[] = sorted.map((event) => ({ event, lane: 0, laneCount: 1 }));

  // Identifica clusters de eventos que se sobrepõem (transitivamente).
  // Dois eventos se sobrepõem se [a.start, a.end) ∩ [b.start, b.end) ≠ ∅.
  // O cluster cresce por transitividade — se A sobrepõe B e B sobrepõe C,
  // mesmo que A não toque C, todos compartilham largura.
  const clusters: Result[][] = [];
  let currentCluster: Result[] = [];
  let clusterMaxEnd = -Infinity;

  for (const r of results) {
    const start = r.event.start.getTime();
    if (currentCluster.length === 0 || start < clusterMaxEnd) {
      currentCluster.push(r);
      clusterMaxEnd = Math.max(clusterMaxEnd, r.event.end.getTime());
    } else {
      clusters.push(currentCluster);
      currentCluster = [r];
      clusterMaxEnd = r.event.end.getTime();
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  // Para cada cluster, atribui lane usando algoritmo guloso:
  //   - Mantém um array de "ends" por lane
  //   - Pra cada evento, escolhe a primeira lane cujo end <= start (livre)
  //   - Se nenhuma livre, abre uma nova lane
  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    for (const r of cluster) {
      const start = r.event.start.getTime();
      let placed = false;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= start) {
          r.lane = i;
          laneEnds[i] = r.event.end.getTime();
          placed = true;
          break;
        }
      }
      if (!placed) {
        r.lane = laneEnds.length;
        laneEnds.push(r.event.end.getTime());
      }
    }
    const laneCount = laneEnds.length;
    for (const r of cluster) r.laneCount = laneCount;
  }

  return results;
}
