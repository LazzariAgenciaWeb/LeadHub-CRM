/**
 * Coordenadas (lat, lng) de cidades pra renderizar marcadores no mapa-mundi.
 *
 * Estratégia:
 *  - Cobertura forte de Brasil (capitais + cidades médias/grandes ~150)
 *  - Capitais mundiais + grandes metrópoles
 *  - Lookup case-insensitive, normalização de acentos
 *  - Cidades não encontradas são silenciosamente ignoradas no mapa
 *
 * Pra ampliar: usar serviço de geocoding (Nominatim free) em batch ao
 * sincronizar e cachear num modelo CityCoords no banco. Por ora, este
 * arquivo cobre ~95% dos casos de agência local brasileira.
 */

export interface CityCoord {
  lat: number;
  lng: number;
}

/** Normaliza nome de cidade pra lookup (lowercase + remove acentos). */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Coordenadas — formato "país:cidade" => { lat, lng }
// Usar país no key evita colisão (ex: "Belém" no Brasil ≠ "Belém" em Portugal)
const COORDS: Record<string, CityCoord> = {
  // ── Brasil — Capitais ──
  "br:rio branco":      { lat: -9.97,  lng: -67.81 },
  "br:maceio":          { lat: -9.66,  lng: -35.73 },
  "br:macapa":          { lat: 0.04,   lng: -51.06 },
  "br:manaus":          { lat: -3.10,  lng: -60.02 },
  "br:salvador":        { lat: -12.97, lng: -38.50 },
  "br:fortaleza":       { lat: -3.73,  lng: -38.52 },
  "br:brasilia":        { lat: -15.78, lng: -47.93 },
  "br:vitoria":         { lat: -20.31, lng: -40.31 },
  "br:goiania":         { lat: -16.68, lng: -49.25 },
  "br:sao luis":        { lat: -2.53,  lng: -44.30 },
  "br:cuiaba":          { lat: -15.60, lng: -56.10 },
  "br:campo grande":    { lat: -20.45, lng: -54.62 },
  "br:belo horizonte":  { lat: -19.92, lng: -43.94 },
  "br:belem":           { lat: -1.46,  lng: -48.49 },
  "br:joao pessoa":     { lat: -7.12,  lng: -34.85 },
  "br:curitiba":        { lat: -25.43, lng: -49.27 },
  "br:recife":          { lat: -8.05,  lng: -34.88 },
  "br:teresina":        { lat: -5.09,  lng: -42.80 },
  "br:rio de janeiro":  { lat: -22.91, lng: -43.20 },
  "br:natal":           { lat: -5.79,  lng: -35.21 },
  "br:porto alegre":    { lat: -30.03, lng: -51.23 },
  "br:porto velho":     { lat: -8.76,  lng: -63.90 },
  "br:boa vista":       { lat: 2.82,   lng: -60.67 },
  "br:florianopolis":   { lat: -27.59, lng: -48.55 },
  "br:aracaju":         { lat: -10.92, lng: -37.07 },
  "br:sao paulo":       { lat: -23.55, lng: -46.63 },
  "br:palmas":          { lat: -10.25, lng: -48.32 },

  // ── Brasil — RS (próximo de você, Lazzari) ──
  "br:caxias do sul":   { lat: -29.16, lng: -51.18 },
  "br:pelotas":         { lat: -31.77, lng: -52.34 },
  "br:canoas":          { lat: -29.92, lng: -51.18 },
  "br:santa maria":     { lat: -29.68, lng: -53.81 },
  "br:gravatai":        { lat: -29.94, lng: -50.99 },
  "br:viamao":          { lat: -30.08, lng: -51.02 },
  "br:novo hamburgo":   { lat: -29.69, lng: -51.13 },
  "br:sao leopoldo":    { lat: -29.76, lng: -51.15 },
  "br:rio grande":      { lat: -32.04, lng: -52.10 },
  "br:passo fundo":     { lat: -28.26, lng: -52.41 },
  "br:bento goncalves": { lat: -29.17, lng: -51.52 },
  "br:lajeado":         { lat: -29.47, lng: -51.96 },
  "br:erechim":         { lat: -27.63, lng: -52.27 },
  "br:alvorada":        { lat: -29.99, lng: -51.08 },
  "br:cachoeirinha":    { lat: -29.95, lng: -51.09 },
  "br:esteio":          { lat: -29.86, lng: -51.18 },
  "br:sapucaia do sul": { lat: -29.83, lng: -51.15 },
  "br:guaiba":          { lat: -30.11, lng: -51.32 },
  "br:eldorado do sul": { lat: -30.08, lng: -51.62 },
  "br:portao":          { lat: -29.70, lng: -51.24 },
  "br:montenegro":      { lat: -29.69, lng: -51.46 },
  "br:taquara":         { lat: -29.65, lng: -50.78 },
  "br:campo bom":       { lat: -29.68, lng: -51.06 },
  "br:sapiranga":       { lat: -29.64, lng: -51.00 },
  "br:tres coroas":     { lat: -29.51, lng: -50.78 },
  "br:igrejinha":       { lat: -29.57, lng: -50.79 },
  "br:gramado":         { lat: -29.38, lng: -50.87 },
  "br:canela":          { lat: -29.36, lng: -50.81 },
  "br:nova petropolis": { lat: -29.37, lng: -51.11 },
  "br:farroupilha":     { lat: -29.22, lng: -51.34 },
  "br:garibaldi":       { lat: -29.26, lng: -51.53 },
  "br:carlos barbosa":  { lat: -29.30, lng: -51.50 },
  "br:vacaria":         { lat: -28.51, lng: -50.94 },
  "br:veranopolis":     { lat: -28.94, lng: -51.55 },
  "br:flores da cunha": { lat: -29.03, lng: -51.18 },
  "br:nova prata":      { lat: -28.78, lng: -51.61 },
  "br:antonio prado":   { lat: -28.85, lng: -51.28 },
  "br:cruz alta":       { lat: -28.64, lng: -53.61 },
  "br:ijui":            { lat: -28.39, lng: -53.91 },
  "br:santo angelo":    { lat: -28.30, lng: -54.26 },
  "br:santa rosa":      { lat: -27.87, lng: -54.48 },
  "br:bage":            { lat: -31.33, lng: -54.10 },
  "br:uruguaiana":      { lat: -29.76, lng: -57.09 },
  "br:santana do livramento": { lat: -30.89, lng: -55.53 },
  "br:cachoeira do sul":{ lat: -30.04, lng: -52.89 },
  "br:santo antonio da patrulha": { lat: -29.82, lng: -50.52 },
  "br:torres":          { lat: -29.34, lng: -49.73 },
  "br:tramandai":       { lat: -29.98, lng: -50.13 },
  "br:capao da canoa":  { lat: -29.75, lng: -50.01 },
  "br:osorio":          { lat: -29.89, lng: -50.27 },
  "br:venancio aires":  { lat: -29.61, lng: -52.19 },
  "br:santa cruz do sul": { lat: -29.71, lng: -52.43 },
  "br:teutonia":        { lat: -29.45, lng: -51.81 },
  "br:estrela":         { lat: -29.50, lng: -51.96 },
  "br:encantado":       { lat: -29.23, lng: -51.87 },
  "br:soledade":        { lat: -28.82, lng: -52.51 },
  "br:carazinho":       { lat: -28.28, lng: -52.79 },
  "br:marau":           { lat: -28.45, lng: -52.20 },
  "br:nao-me-toque":    { lat: -28.46, lng: -52.81 },
  "br:tapejara":        { lat: -28.07, lng: -52.01 },
  "br:getulio vargas":  { lat: -27.89, lng: -52.23 },
  "br:sananduva":       { lat: -27.94, lng: -51.81 },
  "br:frederico westphalen": { lat: -27.36, lng: -53.39 },
  "br:tres passos":     { lat: -27.46, lng: -53.93 },

  // ── Brasil — SC ──
  "br:lages":           { lat: -27.81, lng: -50.32 },
  "br:criciuma":        { lat: -28.67, lng: -49.37 },
  "br:tubarao":         { lat: -28.47, lng: -49.01 },
  "br:palhoca":         { lat: -27.64, lng: -48.67 },
  "br:sao jose":        { lat: -27.61, lng: -48.62 },
  "br:balneario camboriu": { lat: -26.99, lng: -48.63 },
  "br:brusque":         { lat: -27.10, lng: -48.92 },
  "br:jaragua do sul":  { lat: -26.49, lng: -49.07 },
  "br:concordia":       { lat: -27.23, lng: -52.03 },
  "br:videira":         { lat: -27.01, lng: -51.15 },
  "br:rio do sul":      { lat: -27.21, lng: -49.64 },
  "br:caçador":         { lat: -26.77, lng: -51.01 },
  "br:cacador":         { lat: -26.77, lng: -51.01 },
  "br:xanxere":         { lat: -26.88, lng: -52.40 },
  "br:sao bento do sul":{ lat: -26.25, lng: -49.38 },
  "br:mafra":           { lat: -26.11, lng: -49.81 },
  "br:tijucas":         { lat: -27.24, lng: -48.63 },

  // ── Brasil — PR ──
  "br:ponta grossa":    { lat: -25.10, lng: -50.16 },
  "br:sao jose dos pinhais": { lat: -25.53, lng: -49.21 },
  "br:colombo":         { lat: -25.29, lng: -49.22 },
  "br:guarapuava":      { lat: -25.39, lng: -51.46 },
  "br:apucarana":       { lat: -23.55, lng: -51.46 },
  "br:paranagua":       { lat: -25.52, lng: -48.51 },
  "br:toledo":          { lat: -24.71, lng: -53.74 },
  "br:campo largo":     { lat: -25.46, lng: -49.53 },
  "br:pinhais":         { lat: -25.45, lng: -49.19 },
  "br:araucaria":       { lat: -25.59, lng: -49.41 },
  "br:umuarama":        { lat: -23.77, lng: -53.32 },
  "br:campo mourao":    { lat: -24.05, lng: -52.38 },
  "br:francisco beltrao": { lat: -26.08, lng: -53.06 },
  "br:pato branco":     { lat: -26.23, lng: -52.67 },

  // ── Brasil — SP (médias adicionais) ──
  "br:diadema":         { lat: -23.69, lng: -46.62 },
  "br:maua":            { lat: -23.67, lng: -46.46 },
  "br:carapicuiba":     { lat: -23.52, lng: -46.84 },
  "br:itaquaquecetuba": { lat: -23.49, lng: -46.34 },
  "br:taboao da serra": { lat: -23.62, lng: -46.79 },
  "br:suzano":          { lat: -23.54, lng: -46.31 },
  "br:guaruja":         { lat: -23.99, lng: -46.26 },
  "br:praia grande":    { lat: -24.00, lng: -46.40 },
  "br:taubate":         { lat: -23.03, lng: -45.56 },
  "br:limeira":         { lat: -22.56, lng: -47.40 },
  "br:sao vicente":     { lat: -23.96, lng: -46.39 },
  "br:mogi das cruzes": { lat: -23.52, lng: -46.18 },
  "br:americana":       { lat: -22.74, lng: -47.33 },
  "br:rio claro":       { lat: -22.41, lng: -47.56 },
  "br:aracatuba":       { lat: -21.21, lng: -50.43 },
  "br:presidente prudente": { lat: -22.13, lng: -51.39 },
  "br:marilia":         { lat: -22.21, lng: -49.95 },
  "br:sao carlos":      { lat: -22.02, lng: -47.89 },
  "br:araraquara":      { lat: -21.79, lng: -48.18 },
  "br:indaiatuba":      { lat: -23.09, lng: -47.22 },
  "br:hortolandia":     { lat: -22.86, lng: -47.22 },
  "br:sumare":          { lat: -22.82, lng: -47.27 },
  "br:itu":             { lat: -23.26, lng: -47.30 },
  "br:braganca paulista": { lat: -22.95, lng: -46.54 },
  "br:atibaia":         { lat: -23.12, lng: -46.55 },

  // ── Brasil — MG ──
  "br:betim":           { lat: -19.97, lng: -44.20 },
  "br:montes claros":   { lat: -16.74, lng: -43.86 },
  "br:ipatinga":        { lat: -19.46, lng: -42.54 },
  "br:sete lagoas":     { lat: -19.46, lng: -44.25 },
  "br:divinopolis":     { lat: -20.14, lng: -44.88 },
  "br:santa luzia":     { lat: -19.77, lng: -43.85 },
  "br:ribeirao das neves": { lat: -19.77, lng: -44.09 },
  "br:governador valadares": { lat: -18.85, lng: -41.95 },
  "br:pocos de caldas": { lat: -21.79, lng: -46.56 },
  "br:varginha":        { lat: -21.55, lng: -45.43 },
  "br:teofilo otoni":   { lat: -17.85, lng: -41.50 },
  "br:uberaba":         { lat: -19.74, lng: -47.93 },

  // ── Brasil — RJ (médias adicionais) ──
  "br:sao goncalo":     { lat: -22.83, lng: -43.05 },
  "br:belford roxo":    { lat: -22.76, lng: -43.40 },
  "br:sao joao de meriti": { lat: -22.80, lng: -43.37 },
  "br:petropolis":      { lat: -22.51, lng: -43.18 },
  "br:volta redonda":   { lat: -22.52, lng: -44.10 },
  "br:resende":         { lat: -22.47, lng: -44.45 },
  "br:cabo frio":       { lat: -22.88, lng: -42.02 },
  "br:macae":           { lat: -22.37, lng: -41.78 },
  "br:nova friburgo":   { lat: -22.28, lng: -42.53 },
  "br:teresopolis":     { lat: -22.41, lng: -42.97 },
  "br:angra dos reis":  { lat: -23.01, lng: -44.32 },

  // ── Brasil — BA ──
  "br:itabuna":         { lat: -14.79, lng: -39.28 },
  "br:ilheus":          { lat: -14.79, lng: -39.05 },
  "br:juazeiro":        { lat: -9.42,  lng: -40.50 },
  "br:lauro de freitas":{ lat: -12.89, lng: -38.32 },
  "br:camacari":        { lat: -12.69, lng: -38.32 },
  "br:teixeira de freitas": { lat: -17.54, lng: -39.74 },
  "br:barreiras":       { lat: -12.15, lng: -45.00 },

  // ── Brasil — Outros estados (médias) ──
  "br:petrolina":       { lat: -9.39,  lng: -40.50 },
  "br:caxias":          { lat: -4.86,  lng: -43.36 },
  "br:mossoro":         { lat: -5.19,  lng: -37.34 },
  "br:parnaiba":        { lat: -2.91,  lng: -41.78 },
  "br:campina grande":  { lat: -7.23,  lng: -35.88 },
  "br:sobral":          { lat: -3.69,  lng: -40.35 },
  "br:juazeiro do norte": { lat: -7.21, lng: -39.32 },
  "br:rio verde":       { lat: -17.79, lng: -50.92 },
  "br:luziania":        { lat: -16.25, lng: -47.95 },
  "br:aguas lindas de goias": { lat: -15.81, lng: -48.27 },
  "br:valparaiso de goias": { lat: -16.06, lng: -47.97 },
  "br:formosa":         { lat: -15.54, lng: -47.33 },
  "br:sinop":           { lat: -11.86, lng: -55.51 },
  "br:tangara da serra":{ lat: -14.62, lng: -57.49 },
  "br:ariquemes":       { lat: -9.91,  lng: -63.04 },
  "br:ji-parana":       { lat: -10.88, lng: -61.94 },
  "br:parauapebas":     { lat: -6.07,  lng: -49.90 },
  "br:maraba":          { lat: -5.37,  lng: -49.12 },
  "br:santarem":        { lat: -2.44,  lng: -54.71 },
  "br:castanhal":       { lat: -1.30,  lng: -47.92 },
  "br:ananindeua":      { lat: -1.36,  lng: -48.37 },

  // ── Brasil — Outras médias/grandes ──
  "br:guarulhos":       { lat: -23.46, lng: -46.53 },
  "br:campinas":        { lat: -22.91, lng: -47.06 },
  "br:sao bernardo do campo": { lat: -23.69, lng: -46.56 },
  "br:santo andre":     { lat: -23.66, lng: -46.53 },
  "br:osasco":          { lat: -23.53, lng: -46.79 },
  "br:ribeirao preto":  { lat: -21.18, lng: -47.81 },
  "br:sorocaba":        { lat: -23.50, lng: -47.46 },
  "br:santos":          { lat: -23.96, lng: -46.33 },
  "br:sao jose dos campos": { lat: -23.18, lng: -45.88 },
  "br:jundiai":         { lat: -23.19, lng: -46.88 },
  "br:piracicaba":      { lat: -22.73, lng: -47.65 },
  "br:bauru":           { lat: -22.31, lng: -49.06 },
  "br:franca":          { lat: -20.54, lng: -47.40 },
  "br:londrina":        { lat: -23.31, lng: -51.16 },
  "br:maringa":         { lat: -23.43, lng: -51.94 },
  "br:foz do iguacu":   { lat: -25.55, lng: -54.59 },
  "br:cascavel":        { lat: -24.96, lng: -53.46 },
  "br:joinville":       { lat: -26.30, lng: -48.85 },
  "br:blumenau":        { lat: -26.92, lng: -49.07 },
  "br:itajai":          { lat: -26.91, lng: -48.66 },
  "br:chapeco":         { lat: -27.10, lng: -52.61 },
  "br:juiz de fora":    { lat: -21.76, lng: -43.35 },
  "br:uberlandia":      { lat: -18.92, lng: -48.28 },
  "br:contagem":        { lat: -19.93, lng: -44.05 },
  "br:nova iguacu":     { lat: -22.76, lng: -43.45 },
  "br:duque de caxias": { lat: -22.79, lng: -43.31 },
  "br:niteroi":         { lat: -22.88, lng: -43.10 },
  "br:campos dos goytacazes": { lat: -21.76, lng: -41.32 },
  "br:vitoria da conquista": { lat: -14.86, lng: -40.84 },
  "br:feira de santana":{ lat: -12.27, lng: -38.97 },
  "br:caruaru":         { lat: -8.28,  lng: -35.97 },
  "br:olinda":          { lat: -8.01,  lng: -34.86 },
  "br:jaboatao dos guararapes": { lat: -8.11, lng: -35.01 },
  "br:anapolis":        { lat: -16.33, lng: -48.95 },
  "br:aparecida de goiania": { lat: -16.82, lng: -49.24 },
  "br:dourados":        { lat: -22.22, lng: -54.81 },
  "br:varzea grande":   { lat: -15.65, lng: -56.13 },
  "br:rondonopolis":    { lat: -16.47, lng: -54.64 },
  "br:imperatriz":      { lat: -5.53,  lng: -47.49 },

  // ── América do Sul ──
  "ar:buenos aires":    { lat: -34.61, lng: -58.38 },
  "ar:cordoba":         { lat: -31.42, lng: -64.18 },
  "ar:rosario":         { lat: -32.95, lng: -60.66 },
  "cl:santiago":        { lat: -33.45, lng: -70.66 },
  "uy:montevideo":      { lat: -34.90, lng: -56.16 },
  "py:asuncion":        { lat: -25.30, lng: -57.63 },
  "bo:la paz":          { lat: -16.49, lng: -68.13 },
  "pe:lima":            { lat: -12.05, lng: -77.04 },
  "co:bogota":          { lat: 4.71,   lng: -74.07 },
  "co:medellin":        { lat: 6.24,   lng: -75.58 },
  "ve:caracas":         { lat: 10.49,  lng: -66.88 },
  "ec:quito":           { lat: -0.18,  lng: -78.47 },

  // ── América do Norte ──
  "us:new york":        { lat: 40.71,  lng: -74.01 },
  "us:los angeles":     { lat: 34.05,  lng: -118.24 },
  "us:chicago":         { lat: 41.88,  lng: -87.63 },
  "us:houston":         { lat: 29.76,  lng: -95.37 },
  "us:phoenix":         { lat: 33.45,  lng: -112.07 },
  "us:philadelphia":    { lat: 39.95,  lng: -75.17 },
  "us:san antonio":     { lat: 29.42,  lng: -98.49 },
  "us:san diego":       { lat: 32.72,  lng: -117.16 },
  "us:dallas":          { lat: 32.78,  lng: -96.80 },
  "us:san francisco":   { lat: 37.77,  lng: -122.42 },
  "us:miami":           { lat: 25.76,  lng: -80.19 },
  "us:atlanta":         { lat: 33.75,  lng: -84.39 },
  "us:boston":          { lat: 42.36,  lng: -71.06 },
  "us:seattle":         { lat: 47.61,  lng: -122.33 },
  "us:austin":          { lat: 30.27,  lng: -97.74 },
  "us:denver":          { lat: 39.74,  lng: -104.99 },
  "us:washington":      { lat: 38.91,  lng: -77.04 },
  "ca:toronto":         { lat: 43.65,  lng: -79.38 },
  "ca:montreal":        { lat: 45.50,  lng: -73.57 },
  "ca:vancouver":       { lat: 49.28,  lng: -123.12 },
  "mx:mexico city":     { lat: 19.43,  lng: -99.13 },
  "mx:guadalajara":     { lat: 20.66,  lng: -103.35 },

  // ── Europa ──
  "pt:lisbon":          { lat: 38.72,  lng: -9.14 },
  "pt:lisboa":          { lat: 38.72,  lng: -9.14 },
  "pt:porto":           { lat: 41.15,  lng: -8.61 },
  "es:madrid":          { lat: 40.42,  lng: -3.70 },
  "es:barcelona":       { lat: 41.39,  lng: 2.17 },
  "fr:paris":           { lat: 48.85,  lng: 2.35 },
  "gb:london":          { lat: 51.51,  lng: -0.13 },
  "gb:manchester":      { lat: 53.48,  lng: -2.24 },
  "ie:dublin":          { lat: 53.35,  lng: -6.26 },
  "de:berlin":          { lat: 52.52,  lng: 13.40 },
  "de:munich":          { lat: 48.14,  lng: 11.58 },
  "de:hamburg":         { lat: 53.55,  lng: 9.99 },
  "it:rome":            { lat: 41.90,  lng: 12.50 },
  "it:milan":           { lat: 45.46,  lng: 9.19 },
  "nl:amsterdam":       { lat: 52.37,  lng: 4.90 },
  "be:brussels":        { lat: 50.85,  lng: 4.35 },
  "ch:zurich":          { lat: 47.38,  lng: 8.54 },
  "ch:geneva":          { lat: 46.20,  lng: 6.15 },
  "at:vienna":          { lat: 48.21,  lng: 16.37 },
  "se:stockholm":       { lat: 59.33,  lng: 18.07 },
  "no:oslo":            { lat: 59.91,  lng: 10.75 },
  "dk:copenhagen":      { lat: 55.68,  lng: 12.57 },
  "fi:helsinki":        { lat: 60.17,  lng: 24.94 },
  "pl:warsaw":          { lat: 52.23,  lng: 21.01 },
  "cz:prague":          { lat: 50.08,  lng: 14.44 },
  "ru:moscow":          { lat: 55.75,  lng: 37.62 },
  "ru:saint petersburg":{ lat: 59.93,  lng: 30.34 },

  // ── Ásia ──
  "cn:beijing":         { lat: 39.91,  lng: 116.40 },
  "cn:shanghai":        { lat: 31.23,  lng: 121.47 },
  "cn:shenzhen":        { lat: 22.54,  lng: 114.06 },
  "cn:guangzhou":       { lat: 23.13,  lng: 113.26 },
  "jp:tokyo":           { lat: 35.68,  lng: 139.69 },
  "jp:osaka":           { lat: 34.69,  lng: 135.50 },
  "kr:seoul":           { lat: 37.57,  lng: 126.98 },
  "in:mumbai":          { lat: 19.08,  lng: 72.88 },
  "in:delhi":           { lat: 28.61,  lng: 77.21 },
  "in:bangalore":       { lat: 12.97,  lng: 77.59 },
  "id:jakarta":         { lat: -6.21,  lng: 106.85 },
  "th:bangkok":         { lat: 13.76,  lng: 100.50 },
  "vn:ho chi minh city":{ lat: 10.82,  lng: 106.63 },
  "vn:hanoi":           { lat: 21.03,  lng: 105.85 },
  "ph:manila":          { lat: 14.60,  lng: 120.98 },
  "my:kuala lumpur":    { lat: 3.14,   lng: 101.69 },
  "sg:singapore":       { lat: 1.35,   lng: 103.82 },
  "ae:dubai":           { lat: 25.20,  lng: 55.27 },
  "tr:istanbul":        { lat: 41.01,  lng: 28.98 },
  "il:tel aviv":        { lat: 32.08,  lng: 34.78 },
  "sa:riyadh":          { lat: 24.71,  lng: 46.68 },

  // ── Oceania ──
  "au:sydney":          { lat: -33.87, lng: 151.21 },
  "au:melbourne":       { lat: -37.81, lng: 144.96 },
  "au:brisbane":        { lat: -27.47, lng: 153.03 },
  "au:perth":           { lat: -31.95, lng: 115.86 },
  "nz:auckland":        { lat: -36.85, lng: 174.76 },

  // ── África ──
  "za:johannesburg":    { lat: -26.20, lng: 28.05 },
  "za:cape town":       { lat: -33.92, lng: 18.42 },
  "ng:lagos":           { lat: 6.52,   lng: 3.38 },
  "eg:cairo":           { lat: 30.04,  lng: 31.24 },
  "ke:nairobi":         { lat: -1.29,  lng: 36.82 },
  "ma:casablanca":      { lat: 33.57,  lng: -7.59 },
};

/** Busca coordenadas pra (countryCode, cityName). Retorna null se não encontrar. */
export function lookupCity(countryCode: string | null | undefined, cityName: string | null | undefined): CityCoord | null {
  if (!countryCode || !cityName) return null;
  const key = `${countryCode.toLowerCase()}:${norm(cityName)}`;
  const hit = COORDS[key];
  if (hit) return hit;

  // Cidade não encontrada: registra em memória pra debug. Acessível via
  // getMissingCities() — útil pra identificar quais cidades adicionar na lista
  // sem precisar adivinhar.
  if (typeof window !== "undefined") {
    missingCities.add(`${countryCode.toLowerCase()}:${cityName}`);
  }
  return null;
}

/** Set de "country:city" que o lookupCity foi chamado mas não encontrou.
 *  Só popula no browser (debug client-side). Limpo a cada reload da página. */
const missingCities = new Set<string>();

/** Lista as cidades que sumiram do mapa nesta sessão do browser.
 *  Útil pra Diego abrir o console e ver: window.__leadhubMissingCities() */
export function getMissingCities(): string[] {
  return Array.from(missingCities).sort();
}

// Expor no window pra debug fácil no console do navegador
if (typeof window !== "undefined") {
  (window as any).__leadhubMissingCities = getMissingCities;
}
