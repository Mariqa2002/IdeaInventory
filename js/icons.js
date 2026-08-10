/* Stroke icon set (24x24, feather-ish). `icon(name)` returns an <svg> element. */

const PATHS = {
  chest:
    '<path d="M3 10a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>' +
    '<path d="M3.6 8.2 6 4.4A2 2 0 0 1 7.7 3.5h8.6A2 2 0 0 1 18 4.4l2.4 3.8"/>' +
    '<path d="M3 12.5h6.2M14.8 12.5H21"/><rect x="9.2" y="10.5" width="5.6" height="4" rx="1"/>',
  bulb:
    '<path d="M9 18h6M10 21h4"/>' +
    '<path d="M12 2a6.5 6.5 0 0 0-4 11.6c.6.5 1 1.2 1 2V15h6v-1.4c0-.8.4-1.5 1-2A6.5 6.5 0 0 0 12 2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.5 2.5 4.5-5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 1.9"/>',
  flag: '<path d="M4.5 21V4.2M4.5 4.6h10.9l-1.4 3.4 1.4 3.4H4.5"/>',
  message: '<path d="M20.5 12a7.6 7.6 0 0 1-8.2 7.5c-.8 0-1.6-.1-2.3-.3L4.5 21l1.5-4.4A7.4 7.4 0 0 1 4.5 12a7.6 7.6 0 0 1 8-7.5 7.7 7.7 0 0 1 8 7.5z"/>',
  trash: '<path d="M3.5 6h17M8.5 6V4.4A1.4 1.4 0 0 1 9.9 3h4.2a1.4 1.4 0 0 1 1.4 1.4V6M18.4 6l-.8 13.1a1.9 1.9 0 0 1-1.9 1.8H8.3a1.9 1.9 0 0 1-1.9-1.8L5.6 6"/>',
  edit: '<path d="M11 4.5H5.5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V13"/><path d="M18.4 3.1a1.9 1.9 0 0 1 2.7 2.7L12.5 14.4l-3.6.9.9-3.6z"/>',
  sparkles: '<path d="M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7z"/><path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5.5 3l.6 1.5L7.6 5l-1.5.6L5.5 7l-.6-1.4L3.4 5l1.5-.5z"/>',
  dashboard: '<rect x="3" y="3" width="8" height="9" rx="1.8"/><rect x="13" y="3" width="8" height="5.5" rx="1.8"/><rect x="13" y="11" width="8" height="10" rx="1.8"/><rect x="3" y="14.5" width="8" height="6.5" rx="1.8"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  gantt: '<path d="M3 5h9M3 12h13M3 19h7"/><circle cx="14" cy="5" r="1.6"/><circle cx="18" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  logout: '<path d="M9.5 21H5.4A1.9 1.9 0 0 1 3.5 19V5A1.9 1.9 0 0 1 5.4 3h4.1M16 16.5l4.5-4.5L16 7.5M20.5 12H9.5"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.6 14.6a1.5 1.5 0 0 0 .3 1.7l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.5 1.5 0 0 0-2.6 1v.3a1.9 1.9 0 1 1-3.7 0V20a1.5 1.5 0 0 0-2.6-1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.5 1.5 0 0 0-1-2.6H4a1.9 1.9 0 1 1 0-3.7H4a1.5 1.5 0 0 0 1-2.6l-.1-.1a1.9 1.9 0 0 1 2.7-2.7l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4V4a1.9 1.9 0 1 1 3.7 0v.1a1.5 1.5 0 0 0 2.6 1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.5 1.5 0 0 0 1 2.6h.3a1.9 1.9 0 1 1 0 3.7H20a1.5 1.5 0 0 0-1.4.9z"/>',
  alert: '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5M12 17.2h.01"/>',
  archive: '<rect x="2.5" y="3.5" width="19" height="5" rx="1.6"/><path d="M4.5 8.5v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-10M9.8 12.5h4.4"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  panelLeft: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9.5 4v16"/><path d="M15.6 9.9 13.5 12l2.1 2.1"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2.2"/><path d="M8 10.5V7.4a4 4 0 1 1 8 0v3.1"/>',
  mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.2"/><path d="m3 7 8.1 5.4a1.7 1.7 0 0 0 1.8 0L21 7"/>',
  download: '<path d="M21 15.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.5M7.5 10.5 12 15l4.5-4.5M12 15V3"/>',
  upload: '<path d="M21 15.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.5M16.5 7.5 12 3 7.5 7.5M12 3v12"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.6 15.5 12 10 15.4z"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9.2v5.6M14 9.2v5.6"/>',
  inbox: '<path d="M21 12.5h-5l-1.5 2.5h-5L8 12.5H3"/><path d="M6.1 4.5h11.8a2 2 0 0 1 1.8 1.1l2.1 4.2a2 2 0 0 1 .2.9v6.8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.8a2 2 0 0 1 .2-.9l2.1-4.2a2 2 0 0 1 1.8-1.1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  drag: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1M20.5 4.5V10h-5.5"/>',
};

const FILLED = new Set(['drag']);

export function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', FILLED.has(name) ? 'currentColor' : 'none');
  svg.setAttribute('stroke', FILLED.has(name) ? 'none' : 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (size) { svg.style.width = size + 'px'; svg.style.height = size + 'px'; }
  svg.innerHTML = PATHS[name] || '';
  return svg;
}
