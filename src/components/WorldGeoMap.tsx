"use client";

/**
 * Mapa-mundi com choropleth (cores por intensidade) usando react-simple-maps.
 *
 * Recebe lista de países { code (alpha-2), sessions, users } e pinta cada
 * país proporcional ao maior valor. Hover mostra tooltip com detalhes.
 *
 * TopoJSON servido localmente em /public/maps/world-110m.json (~105KB).
 */

import { useState, useMemo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
  Marker,
} from "react-simple-maps";
import { toAlpha2 } from "@/lib/iso-numeric";
import { ptCountryName, flagFromCountryCode } from "@/lib/country-flags";
import { lookupCity } from "@/lib/city-coords";

const TOPO_URL = "/maps/world-110m.json";

interface City {
  city: string;
  region: string | null;
  sessions: number;
  users: number;
}

interface Country {
  code: string;          // alpha-2: BR, US, ...
  name: string;
  sessions: number;
  users: number;
  topCities?: City[];
}

interface Tooltip {
  x: number;
  y: number;
  code?: string;          // país
  cityName?: string;      // cidade (se for marcador de cidade)
  region?: string | null;
  name: string;
  sessions: number;
  users: number;
}

export default function WorldGeoMap({
  countries,
  height = 360,
}: {
  countries: Country[];
  height?: number;
}) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([0, 20]);

  const byCode = useMemo(() => {
    const m = new Map<string, Country>();
    for (const c of countries) m.set(c.code.toUpperCase(), c);
    return m;
  }, [countries]);

  const max = useMemo(
    () => Math.max(1, ...countries.map((c) => c.sessions)),
    [countries]
  );

  // Coleta marcadores de cidade — combina country.code + topCities + lookup de coords
  const cityMarkers = useMemo(() => {
    const arr: { coord: { lat: number; lng: number }; city: string; region: string | null; sessions: number; users: number; countryCode: string }[] = [];
    for (const c of countries) {
      if (!c.topCities) continue;
      for (const ct of c.topCities) {
        const coord = lookupCity(c.code, ct.city);
        if (!coord) continue;
        arr.push({ coord, city: ct.city, region: ct.region, sessions: ct.sessions, users: ct.users, countryCode: c.code });
      }
    }
    return arr;
  }, [countries]);

  const cityMax = useMemo(
    () => Math.max(1, ...cityMarkers.map((m) => m.sessions)),
    [cityMarkers]
  );

  /** Raio da bolinha proporcional (escala raiz quadrada pra área bater com sessions). */
  function cityRadius(sessions: number): number {
    const minR = 2;
    const maxR = 14;
    const ratio = Math.sqrt(sessions / cityMax);
    return Math.max(minR, Math.min(maxR, minR + ratio * (maxR - minR)));
  }

  function colorFor(sessions: number): string {
    if (!sessions) return "#0f1623"; // fundo
    const ratio = Math.min(1, sessions / max);
    // Gradiente cyan → indigo conforme intensidade
    // (interpolação simples no canal HSL pra ficar suave)
    const hue   = 195 - ratio * 35; // 195 (cyan) → 160-ish (verde-cyan); ajusta conforme gosto
    const sat   = 60 + ratio * 35;
    const light = 25 + ratio * 35;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }

  return (
    <div
      className="relative w-full bg-[#070b14] rounded-lg overflow-hidden border border-[#1e2d45]"
      style={{ height }}
      onMouseLeave={() => setTooltip(null)}
    >
      <ComposableMap
        projectionConfig={{ scale: 130 }}
        width={800}
        height={400}
        style={{ width: "100%", height: "100%" }}
      >
        <ZoomableGroup
          center={center}
          zoom={zoom}
          onMoveEnd={({ coordinates, zoom: newZoom }) => {
            setCenter(coordinates as [number, number]);
            setZoom(newZoom);
          }}
          minZoom={1}
          maxZoom={8}
        >
          <Geographies geography={TOPO_URL}>
            {({ geographies }) =>
              geographies.map((geo: any) => {
                const numericId = geo.id; // ex: "076" para Brasil
                const code = toAlpha2(numericId);
                const data = code ? byCode.get(code) : null;
                const fill = colorFor(data?.sessions ?? 0);

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="#1e2d45"
                    strokeWidth={0.4}
                    onMouseEnter={(e: any) => {
                      if (!code) return;
                      const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
                      const containerRect = (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement)?.getBoundingClientRect();
                      if (!containerRect) return;
                      setTooltip({
                        x: rect.left + rect.width / 2 - containerRect.left,
                        y: rect.top - containerRect.top,
                        code,
                        name: data?.name || ptCountryName(code, geo.properties?.name || code),
                        sessions: data?.sessions ?? 0,
                        users: data?.users ?? 0,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      default: { outline: "none", transition: "fill 0.2s" },
                      hover:   { outline: "none", fill: "#6366f1", cursor: "pointer" },
                      pressed: { outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>

          {/* Marcadores de cidade — bolinhas proporcionais a sessions */}
          {cityMarkers.map((m, i) => {
            const r = cityRadius(m.sessions);
            return (
              <Marker
                key={`${m.countryCode}-${m.city}-${i}`}
                coordinates={[m.coord.lng, m.coord.lat]}
                onMouseEnter={(e: any) => {
                  const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
                  const containerRect = (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement)?.getBoundingClientRect();
                  if (!containerRect) return;
                  setTooltip({
                    x: rect.left + rect.width / 2 - containerRect.left,
                    y: rect.top - containerRect.top,
                    code: m.countryCode,
                    cityName: m.city,
                    region: m.region,
                    name: m.city,
                    sessions: m.sessions,
                    users: m.users,
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              >
                {/* Halo difuso */}
                <circle
                  r={r * 1.8}
                  fill="#06b6d4"
                  fillOpacity={0.15}
                  stroke="none"
                  style={{ pointerEvents: "none" }}
                />
                {/* Núcleo sólido — clicável */}
                <circle
                  r={r}
                  fill="#06b6d4"
                  fillOpacity={0.85}
                  stroke="#0a1220"
                  strokeWidth={1}
                  style={{ cursor: "pointer", transition: "r 0.15s" }}
                />
              </Marker>
            );
          })}
        </ZoomableGroup>
      </ComposableMap>

      {/* Controles de zoom */}
      <div className="absolute top-2 right-2 flex flex-col gap-1 bg-black/40 backdrop-blur-sm rounded-md p-1 z-10">
        <button
          onClick={() => setZoom((z) => Math.min(8, z * 1.5))}
          className="w-7 h-7 flex items-center justify-center rounded text-slate-200 hover:bg-white/10 text-base font-bold leading-none"
          title="Aproximar"
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
          className="w-7 h-7 flex items-center justify-center rounded text-slate-200 hover:bg-white/10 text-base font-bold leading-none"
          title="Afastar"
        >
          −
        </button>
        <button
          onClick={() => { setZoom(1); setCenter([0, 20]); }}
          className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white text-[10px] font-bold leading-none"
          title="Centralizar"
        >
          ⌂
        </button>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute bg-[#0d1525] border border-[#1e2d45] rounded-lg px-3 py-2 shadow-2xl pointer-events-none z-20 text-xs"
          style={{
            left: tooltip.x,
            top: tooltip.y - 10,
            transform: "translate(-50%, -100%)",
            minWidth: 160,
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-base">{flagFromCountryCode(tooltip.code)}</span>
            <span className="text-white font-semibold">
              {tooltip.cityName ? tooltip.cityName : tooltip.name}
            </span>
          </div>
          {tooltip.cityName && tooltip.region && (
            <div className="text-slate-500 text-[10px] mb-0.5 ml-5">
              {tooltip.region}
              {tooltip.code && ` · ${ptCountryName(tooltip.code, tooltip.code)}`}
            </div>
          )}
          {tooltip.sessions > 0 ? (
            <div className="text-slate-400 text-[11px]">
              <div><span className="text-cyan-300 font-mono">{tooltip.sessions.toLocaleString("pt-BR")}</span> sessões</div>
              <div><span className="text-indigo-300 font-mono">{tooltip.users.toLocaleString("pt-BR")}</span> usuários</div>
            </div>
          ) : (
            <div className="text-slate-600 text-[11px]">Sem visitas no período</div>
          )}
        </div>
      )}

      {/* Legenda de intensidade */}
      <div className="absolute bottom-2 left-2 bg-black/40 backdrop-blur-sm rounded px-2 py-1 text-[9px] text-slate-400 flex items-center gap-2">
        <span>Sessões:</span>
        <div className="flex items-center gap-0.5">
          {[0.1, 0.3, 0.5, 0.7, 1.0].map((r) => (
            <div
              key={r}
              style={{
                width: 10,
                height: 10,
                background: `hsl(${195 - r * 35}, ${60 + r * 35}%, ${25 + r * 35}%)`,
              }}
            />
          ))}
        </div>
        <span className="text-slate-600">{max.toLocaleString("pt-BR")}</span>
      </div>
    </div>
  );
}
