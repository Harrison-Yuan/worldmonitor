import type { PanelConfig, MapLayers } from '@/types';

// ============================================
// FOUNDER VARIANT — Opportunity Radar
// For the serial entrepreneur.
// 12 core panels only. No noise.
// ============================================

export const FOUNDER_PANELS: Record<string, PanelConfig> = {
  // ── Tier 1: Daily scan (always visible) ──
  map:       { name: 'Global Pulse',    enabled: true, priority: 1 },
  'live-news': { name: 'Signal Feed',   enabled: true, priority: 1 },
  insights:  { name: 'AI Signal Scan',  enabled: true, priority: 1 },
  'latest-brief': { name: 'Daily Brief', enabled: true, priority: 1 },

  // ── Tier 2: Where money flows & what's breaking ──
  markets:   { name: 'Market Pulse',    enabled: true, priority: 2 },
  economic:  { name: 'Macro Climate',   enabled: true, priority: 2 },
  'trade-policy': { name: 'Trade Winds', enabled: true, priority: 2 },
  'supply-chain': { name: 'Chain Gaps', enabled: true, priority: 2 },
  'sanctions-pressure': { name: 'Sanctions = Gaps', enabled: true, priority: 2 },

  // ── Tier 3: Technology & risk ──
  ai:        { name: 'AI Frontier',     enabled: true, priority: 3 },
  cii:       { name: 'Risk Radar',      enabled: true, priority: 3 },

  // ── Tier 4: Personal tracking ──
  monitors:  { name: 'My Radar',        enabled: true, priority: 4 },
};

export const FOUNDER_MAP_LAYERS: MapLayers = {
  // ── Tier 1: Opportunity signals (always on) ──
  economic: true,        // Economic heatmap: where to expand
  tradeRoutes: true,     // Trade flows: where goods move
  sanctions: true,       // Sanctions = market gaps
  ciiChoropleth: true,   // Country risk overlay
  conflicts: true,       // Geopolitical risk
  hotspots: true,        // Intel hotspots
  startupHubs: true,     // Where innovation clusters
  stockExchanges: true,  // Capital markets
  financialCenters: true,// Financial hubs

  // ── Tier 2: Business context ──
  centralBanks: true,    // Policy direction
  outages: true,         // Internet disruptions
  pipelines: true,       // Energy infrastructure
  cables: true,          // Internet backbone
  weather: true,         // Weather affecting operations
  natural: true,         // Natural disasters
  cloudRegions: true,    // Cloud infrastructure
  techHQs: true,         // Tech company locations
  waterways: true,       // Strategic chokepoints

  // ── Tier 3: Supplementary ──
  cyberThreats: true,    // Cyber activity
  datacenters: true,     // Data center buildout
  ucdpEvents: true,      // Detailed conflict events
  commodityHubs: true,   // Commodity trading centers
  commodityPorts: true,  // Key ports
  minerals: true,        // Critical minerals

  // ── Disabled (noise for a founder) ──
  climate: false,
  gulfInvestments: false,
  techEvents: false,
  gpsJamming: false,
  radiationWatch: false,
  fires: false,
  webcams: false,
  diseaseOutbreaks: false,
  dayNight: false,
  iranAttacks: false,
  bases: false,
  nuclear: false,
  irradiators: false,
  military: false,
  ais: false,
  flights: false,
  protests: false,
  displacement: false,
  spaceports: false,
  satellites: false,
  miningSites: false,
  processingPlants: false,
  accelerators: false,
  storageFacilities: false,
  fuelShortages: false,
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  resilienceScore: false,
};

export const FOUNDER_MOBILE_MAP_LAYERS: MapLayers = {
  ...FOUNDER_MAP_LAYERS,
  startupHubs: false,
  cloudRegions: false,
  datacenters: false,
  techHQs: false,
  techEvents: false,
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  commodityPorts: false,
  minerals: false,
  tradeRoutes: false,
  gulfInvestments: false,
  ciiChoropleth: false,
  ucdpEvents: false,
  cyberThreats: false,
};
