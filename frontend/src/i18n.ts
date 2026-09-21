// Interface texts in Spanish (default) and English.
export type Lang = "es" | "en";

const en = {
  appName: "Weather Radar Platform",
  tagline: "Satellite and rain radar over Europe",
  layersButton: "Layers",
  closePanel: "Close panel",
  language: "Español",
  languageLabel: "Switch language",
  theme: { toDark: "Switch to dark mode", toLight: "Switch to light mode" },
  install: "Install app",
  offline: "You are offline. The app opened from the cache, but the map needs a connection.",
  quickViews: "Quick views",
  presets: { clouds: "Clouds", rain: "Rain", storms: "Storms" },
  groups: { satellite: "Clouds and satellite", rain: "Rain" },
  layers: {
    "mtg-geocolour": {
      label: "Geo Colour (MTG)",
      note: "Natural colours by day; clouds and city lights at night.",
    },
    "msg-ir108": {
      label: "Infrared 10.8 µm (MSG)",
      note: "Cloud temperature. White = cold, high clouds.",
    },
    "mtg-ir105": {
      label: "Infrared 10.5 µm, high resolution (MTG)",
      note: "Same idea, sharper image from the newer satellite.",
    },
    "msg-airmass": {
      label: "Airmass RGB (MSG)",
      note: "Composite that distinguishes air masses; useful to follow storm systems.",
    },
    "msg-precip": {
      label: "Estimated rainfall (satellite)",
      note: "Drawn only where rain is detected; light rain is pale.",
    },
    "rain-radar": {
      label: "Rain radar (RainViewer)",
      note: "Third-party composite of national radars; last 2 hours.",
    },
  } as Record<string, { label: string; note: string }>,
  opacity: "Opacity",
  goToSpain: "Zoom to Spain",
  time: {
    play: "Play animation",
    pause: "Pause animation",
    previous: "Previous image",
    next: "Next image",
    now: "Now",
    latest: "latest",
    loading: "Loading available times…",
    hoursAgo: "3 h ago",
    slider: "Time",
    utc: "UTC",
  },
  legend: {
    title: "Legend",
    radarTitle: "Rain radar",
    radarWeak: "Weak",
    radarIntense: "Intense",
    radarNote: "Colours as provided by RainViewer.",
    precipTitle: "Estimated rainfall (mm/h)",
    irTitle: "Cloud brightness temperature (°C)",
    irNote: "White = cold, high clouds; dark = warm surface.",
  },
  status: {
    title: "System status",
    sources: "Data sources",
    products: "Latest ingested products",
    none: "Nothing ingested yet.",
    planned: "planned",
    active: "active",
    needsConfig: "needs configuration",
    apiError: "The platform API is not reachable",
  },
  loadingMap: "Loading…",
  layerError: "Some layers could not be loaded. They will be retried on the next update.",
  locateError: "Your location could not be determined.",
  creditsTitle: "Data credits",
  credits: [
    { name: "EUMETSAT", url: "https://www.eumetsat.int", what: "satellite imagery (Meteosat MSG and MTG)" },
    { name: "RainViewer", url: "https://www.rainviewer.com", what: "rain radar tiles" },
    { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright", what: "base map" },
    { name: "NOAA", url: "https://www.noaa.gov", what: "US radar (ingested by the platform)" },
    { name: "AEMET", url: "https://www.aemet.es", what: "Spanish radar (in progress)" },
  ],
  footerNote: "Final degree project, University of Oviedo. Not for operational or safety use.",
};

export type Messages = typeof en;

const es: Messages = {
  appName: "Plataforma de radar meteorológico",
  tagline: "Satélite y radar de lluvia sobre Europa",
  layersButton: "Capas",
  closePanel: "Cerrar panel",
  language: "English",
  languageLabel: "Cambiar idioma",
  theme: { toDark: "Cambiar a modo oscuro", toLight: "Cambiar a modo claro" },
  install: "Instalar app",
  offline: "Sin conexión. La aplicación se abrió desde la caché, pero el mapa necesita conexión.",
  quickViews: "Vistas rápidas",
  presets: { clouds: "Nubes", rain: "Lluvia", storms: "Tormentas" },
  groups: { satellite: "Nubes y satélite", rain: "Lluvia" },
  layers: {
    "mtg-geocolour": {
      label: "Geo Colour (MTG)",
      note: "Colores naturales de día; nubes y luces de las ciudades de noche.",
    },
    "msg-ir108": {
      label: "Infrarrojo 10,8 µm (MSG)",
      note: "Temperatura de las nubes. Blanco = frío, nubes altas.",
    },
    "mtg-ir105": {
      label: "Infrarrojo 10,5 µm, alta resolución (MTG)",
      note: "Lo mismo, con más nitidez, del satélite más moderno.",
    },
    "msg-airmass": {
      label: "RGB de masas de aire (MSG)",
      note: "Composición que distingue masas de aire; útil para seguir sistemas de tormentas.",
    },
    "msg-precip": {
      label: "Lluvia estimada (satélite)",
      note: "Solo se dibuja donde se detecta lluvia; la lluvia débil es pálida.",
    },
    "rain-radar": {
      label: "Radar de lluvia (RainViewer)",
      note: "Composición de radares nacionales de terceros; últimas 2 horas.",
    },
  },
  opacity: "Opacidad",
  goToSpain: "Ir a España",
  time: {
    play: "Reproducir animación",
    pause: "Pausar animación",
    previous: "Imagen anterior",
    next: "Imagen siguiente",
    now: "Ahora",
    latest: "última",
    loading: "Cargando horas disponibles…",
    hoursAgo: "hace 3 h",
    slider: "Hora",
    utc: "UTC",
  },
  legend: {
    title: "Leyenda",
    radarTitle: "Radar de lluvia",
    radarWeak: "Débil",
    radarIntense: "Intensa",
    radarNote: "Colores proporcionados por RainViewer.",
    precipTitle: "Lluvia estimada (mm/h)",
    irTitle: "Temperatura de brillo de las nubes (°C)",
    irNote: "Blanco = frío, nubes altas; oscuro = superficie cálida.",
  },
  status: {
    title: "Estado del sistema",
    sources: "Fuentes de datos",
    products: "Últimos productos ingeridos",
    none: "Todavía no se ha ingerido nada.",
    planned: "prevista",
    active: "activa",
    needsConfig: "requiere configuración",
    apiError: "No se puede acceder a la API de la plataforma",
  },
  loadingMap: "Cargando…",
  layerError: "No se pudieron cargar algunas capas. Se reintentará en la próxima actualización.",
  locateError: "No se pudo determinar tu ubicación.",
  creditsTitle: "Créditos de los datos",
  credits: [
    { name: "EUMETSAT", url: "https://www.eumetsat.int", what: "imágenes de satélite (Meteosat MSG y MTG)" },
    { name: "RainViewer", url: "https://www.rainviewer.com", what: "teselas de radar de lluvia" },
    { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright", what: "mapa base" },
    { name: "NOAA", url: "https://www.noaa.gov", what: "radar de EE. UU. (ingerido por la plataforma)" },
    { name: "AEMET", url: "https://www.aemet.es", what: "radar de España (en desarrollo)" },
  ],
  footerNote: "Trabajo Fin de Grado, Universidad de Oviedo. No apto para uso operativo ni de seguridad.",
};

export const messages: Record<Lang, Messages> = { es, en };

const STORAGE_KEY = "tfg-lang";

export function isLang(value: unknown): value is Lang {
  return value === "es" || value === "en";
}

/** Saved choice if any, otherwise Spanish. */
export function initialLang(fromUrl?: Lang): Lang {
  if (fromUrl) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage blocked: fall through */
  }
  return "es";
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage blocked: the choice just is not remembered */
  }
}
