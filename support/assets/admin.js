// Page admin : connexion, liste et traitement des tickets, messages de contact, sauvegarde.

const $ = (id) => document.getElementById(id);
STATUS_LABELS.attente_client = 'Attente client';

const OPEN_STATUSES = ['nouveau', 'en_cours', 'attente_client'];
const SEVERITY_ORDER = { bloquante: 0, haute: 1, normale: 2, basse: 3 };

let tickets = [];
let contacts = [];
let selectedId = null;

// --- Connexion ---------------------------------------------------------------

async function init() {
  const status = await api('admin_status').catch((err) => {
    showMessage($('login-hint'), err.message);
    return { logged: false, configured: true };
  });
  if (status.logged) return showApp();
  if (!status.configured) {
    showMessage($('login-hint'), 'Mot de passe pas encore défini : modifie « admin_password » dans support/config.php.');
  }
  $('login-form').hidden = false;
  $('password').focus();
}

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitting(e.target, $('login-feedback'), async () => {
    await api('admin_login', { password: $('password').value });
    $('password').value = '';
    showApp();
  });
});

$('logout-btn').addEventListener('click', async () => {
  await api('admin_logout').catch(() => {});
  location.reload();
});

async function showApp() {
  $('login-form').hidden = true;
  $('app').hidden = false;
  $('top-actions').hidden = false;
  await refresh();
}

// Toute erreur « connexion requise » renvoie vers l'écran de connexion.
async function adminCall(action, data) {
  try {
    return await api(action, data);
  } catch (err) {
    if (/Connexion admin requise/.test(err.message)) location.reload();
    throw err;
  }
}

// --- Données -----------------------------------------------------------------

async function refresh() {
  const res = await adminCall('admin_list');
  tickets = res.tickets;
  contacts = res.contacts;
  renderStats();
  renderTickets();
  renderContacts();
}

$('refresh-btn').addEventListener('click', () => refresh().catch((err) => alert(err.message)));
$('search').addEventListener('input', renderTickets);
$('filter-status').addEventListener('change', renderTickets);

// Filtre par statut : options ajoutées dynamiquement après « ouverts / tous ».
for (const [value, label] of Object.entries(STATUS_LABELS)) {
  $('filter-status').append(el('option', { value }, label));
}

function renderStats() {
  const count = (s) => tickets.filter((t) => t.status === s).length;
  const unreadContacts = contacts.filter((c) => !c.read).length;
  $('stats').replaceChildren(
    el('div', { class: 'stat' }, el('b', {}, count('nouveau')), 'nouveaux'),
    el('div', { class: 'stat' }, el('b', {}, count('en_cours')), 'en cours'),
    el('div', { class: 'stat' }, el('b', {}, count('attente_client')), 'en attente client'),
    el('div', { class: 'stat' }, el('b', {}, tickets.filter((t) => t.unread).length), 'non lus'),
    el('div', { class: 'stat' }, el('b', {}, unreadContacts), 'contacts non lus'),
  );
  $('tab-contacts').textContent = `Messages de contact${unreadContacts ? ` (${unreadContacts})` : ''}`;
}

function renderTickets() {
  const query = $('search').value.trim().toLowerCase();
  const filter = $('filter-status').value;
  const visible = tickets
    .filter((t) => (filter === 'ouverts' ? OPEN_STATUSES.includes(t.status) : !filter || t.status === filter))
    .filter((t) => !query || [t.id, t.subject, t.name, t.email, t.software].join(' ').toLowerCase().includes(query))
    // Non lus d'abord, puis par gravité, puis les plus récents.
    .sort((a, b) => (b.unread - a.unread)
      || (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
      || b.updated.localeCompare(a.updated));

  if (!visible.length) {
    $('ticket-list').replaceChildren(el('div', { class: 'card empty' }, 'Aucun ticket.'));
    return;
  }
  $('ticket-list').replaceChildren(...visible.map((t) => el('button', {
    type: 'button',
    class: `item${t.unread ? ' unread' : ''}${t.id === selectedId ? ' active' : ''}`,
    onclick: () => openTicket(t.id),
  },
  el('div', { class: 'line1' }, el('span', {}, `${t.id} · ${t.software}`), el('span', {}, formatDate(t.updated))),
  el('div', { class: 'subject' }, t.subject),
  el('div', { class: 'meta' }, statusBadge(t.status), severityBadge(t.severity),
    el('span', { class: 'muted small' }, t.name)))));
}

// --- Détail d'un ticket ------------------------------------------------------

async function openTicket(id) {
  selectedId = id;
  try {
    const res = await adminCall('admin_ticket', { id });
    const summary = tickets.find((t) => t.id === id);
    if (summary) summary.unread = false;
    renderStats();
    renderTickets();
    renderDetail(res.ticket);
  } catch (err) {
    alert(err.message);
  }
}

function renderDetail(ticket) {
  const feedback = el('div');
  const statusSelect = el('select', { name: 'status', style: 'width: auto' },
    Object.entries(STATUS_LABELS).map(([value, label]) =>
      el('option', { value, selected: value === ticket.status }, label)));

  const form = el('form', {},
    el('label', { for: 'a-reply' }, 'Réponse au client'),
    el('textarea', { id: 'a-reply', name: 'message', maxlength: 10000, placeholder: 'Laisse vide pour changer seulement le statut.' }),
    feedback,
    el('div', { class: 'actions' },
      el('span', {}, 'Statut :'), statusSelect,
      el('button', { type: 'submit' }, 'Enregistrer'),
      el('button', {
        type: 'button',
        class: 'secondary',
        onclick: () => {
          form.elements.message.value ||= 'Votre demande est traitée. N\'hésitez pas à répondre si le problème persiste.';
          statusSelect.value = 'resolu';
        },
      }, 'Marquer résolu'),
      el('button', { type: 'button', class: 'danger', onclick: () => deleteTicket(ticket) }, 'Supprimer')));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, feedback, async () => {
      const { message } = formData(form);
      const status = statusSelect.value === ticket.status ? '' : statusSelect.value;
      const res = await adminCall('admin_reply', { id: ticket.id, message, status });
      renderDetail(res.ticket);
      await refresh();
    });
  });

  $('ticket-detail').replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'ticket-head' },
      el('div', {},
        el('h2', {}, ticket.subject),
        el('div', { class: 'muted small' }, `${ticket.id} · ${ticket.software} · ouvert le ${formatDate(ticket.created)}`),
        el('div', { class: 'small' }, `${ticket.name} — `,
          el('a', { href: `mailto:${ticket.email}?subject=${encodeURIComponent(`[${ticket.id}] ${ticket.subject}`)}` }, ticket.email))),
      el('div', { class: 'meta' }, severityBadge(ticket.severity), statusBadge(ticket.status))),
    renderThread(ticket, 'support'),
    form));
}

async function deleteTicket(ticket) {
  if (!confirm(`Supprimer définitivement le ticket ${ticket.id} ?`)) return;
  try {
    await adminCall('admin_delete_ticket', { id: ticket.id });
    selectedId = null;
    $('ticket-detail').replaceChildren(el('div', { class: 'card empty' }, 'Ticket supprimé.'));
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

// --- Messages de contact -----------------------------------------------------

function renderContacts() {
  if (!contacts.length) {
    $('contact-list').replaceChildren(el('div', { class: 'card empty' }, 'Aucun message.'));
    return;
  }
  $('contact-list').replaceChildren(...contacts.map((c) => el('div', { class: 'card' },
    el('div', { class: 'ticket-head' },
      el('div', {},
        el('h2', {}, `${c.read ? '' : '● '}${c.subject}`),
        el('div', { class: 'small' }, `${c.name} — `,
          el('a', { href: `mailto:${c.email}?subject=${encodeURIComponent(`Re: ${c.subject}`)}` }, c.email),
          el('span', { class: 'muted' }, ` · ${formatDate(c.at)}`))),
      el('div', { class: 'actions', style: 'margin: 0' },
        el('button', { type: 'button', class: 'secondary', onclick: () => contactOp(c, c.read ? 'unread' : 'read') },
          c.read ? 'Marquer non lu' : 'Marquer lu'),
        el('button', {
          type: 'button',
          class: 'danger',
          onclick: () => confirm('Supprimer ce message ?') && contactOp(c, 'delete'),
        }, 'Supprimer'))),
    el('p', { style: 'white-space: pre-wrap; overflow-wrap: anywhere; margin-bottom: 0' }, c.message))));
}

async function contactOp(contact, op) {
  try {
    await adminCall('admin_contact', { id: contact.id, op });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

// --- Onglets & sauvegarde ----------------------------------------------------

function showTab(name) {
  for (const tab of ['tickets', 'contacts']) {
    $(`tab-${tab}`).setAttribute('aria-selected', String(tab === name));
    $(`panel-${tab}`).hidden = tab !== name;
  }
}
$('tab-tickets').addEventListener('click', () => showTab('tickets'));
$('tab-contacts').addEventListener('click', () => showTab('contacts'));

// Télécharge toute la base en un fichier JSON (sauvegarde ou archivage).
$('export-btn').addEventListener('click', async () => {
  try {
    const { backup } = await adminCall('admin_export');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const link = el('a', {
      href: URL.createObjectURL(blob),
      download: `support-expsoft-${new Date().toISOString().slice(0, 10)}.json`,
    });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  } catch (err) {
    alert(err.message);
  }
});

init();
