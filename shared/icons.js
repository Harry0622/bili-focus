const svg = paths => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
export const ICONS = {
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'),
  moon: svg('<path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z"/>'),
  settings: svg('<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>'),
  edit: svg('<path d="m14 5 5 5M4 20l1-5L16 4a2.1 2.1 0 0 1 3 3L8 19l-4 1Z"/>'),
  trash: svg('<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>'),
  folder: svg('<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z"/>'),
  folderPlus: svg('<path d="M3 7V5h6l3 3h9v12H3V7Zm9 5v5m-2.5-2.5h5"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'),
};
