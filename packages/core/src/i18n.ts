export type Lang = 'en' | 'es';

const en = {
  next_stop: 'Next stop', navigate: 'Navigate', arrive: 'Arrive', done: 'Done', problem: 'Problem', undo_last: 'Undo last',
  before_photo: 'Before photo', after_photo: 'After photo', photo_saved: 'Photo saved', depth: 'Snow depth', depth_required: 'Snow depth (needed on your first stop)',
  services: 'Services', salt: 'Salt', of_done: '{d} of {n} done', of_done_skipped: '{d} done, {s} skipped, of {n}', saved: 'Saved on phone', sending: 'Sending', synced: 'Synced',
  no_service: 'Tick what you did here first. With nothing ticked, this visit can\'t be billed.', problem_note: 'What happened? (optional)', send_problem_kind: 'Send: {k}', priority_of: 'Priority {p} of 5 (1 goes first)',
  remaining: 'Remaining stops', here_arrive: "You're here. Arrive?", all_done: 'All stops done. Thanks.', blocked: 'Blocked', breakdown: 'Breakdown',
  skip: 'Skip', damage: 'Damage', other: 'Other', voice_note: 'Voice note', stop_recording: 'Stop recording', back: 'Back', send_problem: 'Send',
  link_dead_title: 'This link is no longer active', link_dead_body: 'Ask your dispatcher for a new link.', link_dead_sending: 'Your finished work is still being sent. Keep this page open until it says Synced.', service_plow: 'Plow', service_salt: 'Salt', service_walks: 'Walks', service_haul: 'Haul', no_after_photo: 'No after photo yet. This bill will be flagged for review.', window: 'Open by', priority: 'Priority', notes: 'Notes',
  moved: 'Your route changed.', problem_sent: 'Problem sent', problem_reported: 'Problem reported. Tap to go back to it.', stop_taken: 'Someone else on this route is already doing this stop.', photo_not_image: 'That file is not a photo. Take the photo again.', photo_too_big: 'That photo is too big. Take it again.', photo_again: 'Photo added. This stop has {n} now.', storm_closed_title: 'This storm is closed', storm_closed_body: 'Work you already did is sent. Do not start new stops. Call the office if you think this is a mistake.', undone: 'Undone', set_next: 'Do this one next', offline_loading: 'No signal and this route is not saved yet. Open it once with signal.',
  save_failed: 'Could not save on this phone. Free up storage and tap again.',
  keep_open: 'Keep this page open until it says Synced, so the office gets your last stop.',
  call_office: 'Call office', away_mi: '{d} mi away', away_ft: '{d} ft away', stop_n: 'Stop {i} of {n}',
  language: 'Español', status_open: 'Open', status_done: 'Done', status_skipped: 'Skipped', status_problem: 'Problem', status_onsite: 'On site', status_enroute: 'On the way',
};

const es: typeof en = {
  next_stop: 'Siguiente parada', navigate: 'Navegar', arrive: 'Llegué', done: 'Terminado', problem: 'Problema', undo_last: 'Deshacer',
  before_photo: 'Foto antes', after_photo: 'Foto después', photo_saved: 'Foto guardada', depth: 'Profundidad de nieve', depth_required: 'Profundidad de nieve (requerida en la primera parada)',
  services: 'Servicios', salt: 'Sal', of_done: '{d} de {n} listas', of_done_skipped: '{d} listas, {s} omitidas, de {n}', saved: 'Guardado en el teléfono', sending: 'Enviando', synced: 'Sincronizado',
  no_service: 'Marca lo que hiciste aquí primero. Sin nada marcado, esta visita no se puede cobrar.', problem_note: '¿Qué pasó? (opcional)', send_problem_kind: 'Enviar: {k}', priority_of: 'Prioridad {p} de 5 (1 va primero)',
  remaining: 'Paradas restantes', here_arrive: 'Ya llegaste. ¿Marcar llegada?', all_done: 'Todas las paradas listas. Gracias.', blocked: 'Bloqueado', breakdown: 'Avería',
  skip: 'Omitir', damage: 'Daño', other: 'Otro', voice_note: 'Nota de voz', stop_recording: 'Detener', back: 'Atrás', send_problem: 'Enviar',
  link_dead_title: 'Este enlace ya no está activo', link_dead_body: 'Pide un enlace nuevo a tu despachador.', link_dead_sending: 'Tu trabajo terminado aún se está enviando. Mantén esta página abierta hasta que diga Sincronizado.', service_plow: 'Arado', service_salt: 'Sal', service_walks: 'Aceras', service_haul: 'Acarreo', no_after_photo: 'Aún no hay foto después. Esta factura se marcará para revisión.', window: 'Abrir antes de', priority: 'Prioridad', notes: 'Notas',
  moved: 'Tu ruta cambió.', problem_sent: 'Problema enviado', problem_reported: 'Problema reportado. Toca para volver a esta.', stop_taken: 'Otra persona en esta ruta ya está haciendo esta parada.', photo_not_image: 'Ese archivo no es una foto. Toma la foto otra vez.', photo_too_big: 'Esa foto es demasiado grande. Tómala otra vez.', photo_again: 'Foto agregada. Esta parada ya tiene {n}.', storm_closed_title: 'Esta tormenta está cerrada', storm_closed_body: 'El trabajo que ya hiciste se envía. No empieces paradas nuevas. Llama a la oficina si crees que es un error.', undone: 'Deshecho', set_next: 'Hacer esta ahora', offline_loading: 'Sin señal y esta ruta aún no está guardada. Ábrela una vez con señal.',
  save_failed: 'No se pudo guardar en este teléfono. Libera espacio y vuelve a tocar.',
  keep_open: 'Mantén esta página abierta hasta que diga Sincronizado, para que la oficina reciba tu última parada.',
  call_office: 'Llamar a la oficina', away_mi: 'a {d} mi', away_ft: 'a {d} pies', stop_n: 'Parada {i} de {n}',
  language: 'English', status_open: 'Abierta', status_done: 'Lista', status_skipped: 'Omitida', status_problem: 'Problema', status_onsite: 'En sitio', status_enroute: 'En camino',
};

export const DICT: Record<Lang, typeof en> = { en, es };
export type DictKey = keyof typeof en;
export function t(lang: Lang, key: DictKey, vars?: Record<string, string | number>): string {
  let s = DICT[lang][key];
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
  return s;
}
