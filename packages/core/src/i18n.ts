export type Lang = 'en' | 'es';

const en = {
  next_stop: 'Next stop', navigate: 'Navigate', arrive: 'Arrive', done: 'Done', problem: 'Problem', undo_last: 'Undo last',
  before_photo: 'Before photo', after_photo: 'After photo', photo_saved: 'Photo saved', depth: 'Snow depth', depth_required: 'Snow depth (needed on your first stop)',
  services: 'Services', salt: 'Salt', of_done: '{d} of {n} done', saved: 'Saved on phone', sending: 'Sending', synced: 'Synced',
  remaining: 'Remaining stops', here_arrive: "You're here. Arrive?", all_done: 'All stops done. Thanks.', blocked: 'Blocked', breakdown: 'Breakdown',
  skip: 'Skip', damage: 'Damage', other: 'Other', voice_note: 'Voice note', stop_recording: 'Stop recording', back: 'Back', send_problem: 'Send',
  link_dead_title: 'This link is no longer active', link_dead_body: 'Ask your dispatcher for a new link.', window: 'Open by', priority: 'Priority', notes: 'Notes',
  moved: 'Your route changed.', problem_sent: 'Problem sent', undone: 'Undone', set_next: 'Do this one next', offline_loading: 'No signal and this route is not saved yet. Open it once with signal.',
  save_failed: 'Could not save on this phone. Free up storage and tap again.',
  language: 'Español', status_open: 'Open', status_done: 'Done', status_skipped: 'Skipped', status_problem: 'Problem', status_onsite: 'On site', status_enroute: 'On the way',
};

const es: typeof en = {
  next_stop: 'Siguiente parada', navigate: 'Navegar', arrive: 'Llegué', done: 'Terminado', problem: 'Problema', undo_last: 'Deshacer',
  before_photo: 'Foto antes', after_photo: 'Foto después', photo_saved: 'Foto guardada', depth: 'Profundidad de nieve', depth_required: 'Profundidad de nieve (requerida en la primera parada)',
  services: 'Servicios', salt: 'Sal', of_done: '{d} de {n} listas', saved: 'Guardado en el teléfono', sending: 'Enviando', synced: 'Sincronizado',
  remaining: 'Paradas restantes', here_arrive: 'Ya llegaste. ¿Marcar llegada?', all_done: 'Todas las paradas listas. Gracias.', blocked: 'Bloqueado', breakdown: 'Avería',
  skip: 'Omitir', damage: 'Daño', other: 'Otro', voice_note: 'Nota de voz', stop_recording: 'Detener', back: 'Atrás', send_problem: 'Enviar',
  link_dead_title: 'Este enlace ya no está activo', link_dead_body: 'Pide un enlace nuevo a tu despachador.', window: 'Abrir antes de', priority: 'Prioridad', notes: 'Notas',
  moved: 'Tu ruta cambió.', problem_sent: 'Problema enviado', undone: 'Deshecho', set_next: 'Hacer esta ahora', offline_loading: 'Sin señal y esta ruta aún no está guardada. Ábrela una vez con señal.',
  save_failed: 'No se pudo guardar en este teléfono. Libera espacio y vuelve a tocar.',
  language: 'English', status_open: 'Abierta', status_done: 'Lista', status_skipped: 'Omitida', status_problem: 'Problema', status_onsite: 'En sitio', status_enroute: 'En camino',
};

export const DICT: Record<Lang, typeof en> = { en, es };
export type DictKey = keyof typeof en;
export function t(lang: Lang, key: DictKey, vars?: Record<string, string | number>): string {
  let s = DICT[lang][key];
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
  return s;
}
