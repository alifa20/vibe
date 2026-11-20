/**
 * The dashboard's breakdown tables and range presets, listed once. The order
 * here is the order they are queried and rendered in.
 */

/** name -> events column, card heading and table column label. */
export const BREAKDOWNS = [
  { name: 'pages', column: 'path', heading: 'Top pages', label: 'Page' },
  { name: 'referrers', column: 'referrer_host', heading: 'Referrers', label: 'Host' },
  { name: 'sources', column: 'utm_source', heading: 'UTM sources', label: 'Source' },
  { name: 'campaigns', column: 'utm_campaign', heading: 'UTM campaigns', label: 'Campaign' },
  { name: 'browsers', column: 'browser', heading: 'Browsers', label: 'Browser' },
  { name: 'os', column: 'os', heading: 'Operating systems', label: 'System' },
  { name: 'devices', column: 'device', heading: 'Devices', label: 'Device' }
];

/** ?range= presets: key -> number of days and chip label. */
export const RANGE_PRESETS = [
  { key: 'today', days: 1, label: 'Today' },
  { key: '7d', days: 7, label: '7 days' },
  { key: '30d', days: 30, label: '30 days' }
];
