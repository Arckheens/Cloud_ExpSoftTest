// Page client : créer un ticket, suivre un ticket, répondre au support.

const $ = (id) => document.getElementById(id);
const SAVED_KEY = 'expsoft_tickets';

// --- Onglets -----------------------------------------------------------------

function showTab(name) {
  for (const tab of ['new', 'track']) {
    $(`tab-${tab}`).setAttribute('aria-selected', String(tab === name));
    $(`panel-${tab}`).hidden = tab !== name;
  }
  if (name === 'track') renderSaved();
}
$('tab-new').addEventListener('click', () => showTab('new'));
$('tab-track').addEventListener('click', () => showTab('track'));

// --- Tickets mémorisés dans le navigateur (simple confort, facultatif) --------

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTicket(id, code, subject) {
  const list = loadSaved().filter((t) => t.id !== id);
  list.unshift({ id, code, subject });
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    // Stockage indisponible (navigation privée…) : on continue sans.
  }
}

function renderSaved() {
  const list = loadSaved();
  $('saved').hidden = list.length === 0;
  $('saved-list').replaceChildren(...list.map((t) => el('li', {},
    el('button', {
      type: 'button',
      class: 'secondary',
      title: t.subject,
      onclick: () => openTicket(t.id, t.code),
    }, t.id))));
}

// --- Création d'un ticket ----------------------------------------------------

let lastCreated = null;

$('new-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  submitting(form, $('new-feedback'), async () => {
    const data = formData(form);
    const res = await api('create_ticket', data);
    lastCreated = { id: res.id, code: res.code };
    saveTicket(res.id, res.code, data.subject);
    $('r-id').textContent = res.id;
    $('r-code').textContent = res.code;
    form.hidden = true;
    $('new-result').hidden = false;
    $('new-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

$('r-copy').addEventListener('click', async () => {
  const text = `Ticket ExpSoft ${lastCreated.id} — code d'accès : ${lastCreated.code}`;
  try {
    await navigator.clipboard.writeText(text);
    $('r-copy').textContent = 'Copié ✔';
  } catch {
    $('r-copy').textContent = 'Copie impossible';
  }
  setTimeout(() => { $('r-copy').textContent = 'Copier'; }, 2000);
});

$('r-open').addEventListener('click', () => openTicket(lastCreated.id, lastCreated.code));

$('r-another').addEventListener('click', () => {
  const form = $('new-form');
  form.reset();
  form.hidden = false;
  $('new-result').hidden = true;
});

// --- Suivi d'un ticket -------------------------------------------------------

let current = null; // { id, code }

function openTicket(id, code) {
  $('t-id').value = id;
  $('t-code').value = code;
  showTab('track');
  $('track-form').requestSubmit();
}

$('track-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  submitting(form, $('track-feedback'), async () => {
    const { id, code } = formData(form);
    const res = await api('view_ticket', { id, code });
    current = { id: res.ticket.id, code };
    saveTicket(res.ticket.id, code, res.ticket.subject);
    renderSaved();
    renderTicket(res.ticket);
  });
});

function renderTicket(ticket) {
  const feedback = el('div');
  const replyForm = ticket.status === 'ferme'
    ? el('p', { class: 'muted' }, 'Ce ticket est fermé. Si le problème revient, ouvrez un nouveau ticket.')
    : el('form', {},
      el('label', { for: 'reply' }, 'Votre réponse'),
      el('textarea', { id: 'reply', name: 'message', required: true, maxlength: 10000 }),
      feedback,
      el('div', { class: 'actions' }, el('button', { type: 'submit' }, 'Envoyer la réponse')));

  if (replyForm.tagName === 'FORM') {
    replyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitting(replyForm, feedback, async () => {
        const res = await api('client_reply', { ...current, message: formData(replyForm).message });
        renderTicket(res.ticket);
      });
    });
  }

  $('ticket-view').replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'ticket-head' },
      el('div', {},
        el('h2', {}, ticket.subject),
        el('div', { class: 'muted small' }, `${ticket.id} · ${ticket.software} · ouvert le ${formatDate(ticket.created)}`)),
      el('div', { class: 'meta' }, severityBadge(ticket.severity), statusBadge(ticket.status))),
    renderThread(ticket, 'client'),
    replyForm));
  $('ticket-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Démarrage ---------------------------------------------------------------

setupContactDialog($('contact-btn'));

api('config').then((cfg) => {
  $('n-software').replaceChildren(...cfg.softwares.map((s) => el('option', { value: s }, s)));
  document.title = cfg.site_name;
}).catch((err) => showMessage($('new-feedback'), err.message));

// Lien direct possible : index.html#suivi ou index.html#contact
if (location.hash === '#suivi') showTab('track');
if (location.hash === '#contact') $('contact-btn').click();
