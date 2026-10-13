// Outils partagés entre la page client et la page admin.

const API_URL = 'api.php';

const STATUS_LABELS = {
  nouveau: 'Nouveau',
  en_cours: 'En cours',
  attente_client: 'En attente de votre réponse',
  resolu: 'Résolu',
  ferme: 'Fermé',
};

const SEVERITY_LABELS = {
  basse: 'Basse',
  normale: 'Normale',
  haute: 'Haute',
  bloquante: 'Bloquante',
};

// Appel au gardien (api.php). Renvoie la réponse JSON ou lève une erreur lisible.
async function api(action, data = {}) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action, ...data }),
    });
  } catch {
    throw new Error('Serveur injoignable. Vérifie ta connexion.');
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Réponse invalide du serveur (PHP est-il actif ?)');
  }
  if (!json.ok) throw new Error(json.error || 'Erreur inconnue');
  return json;
}

// Crée un élément DOM. Le texte passe toujours par textContent : pas d'injection HTML possible.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function statusBadge(status) {
  return el('span', { class: 'badge', style: `--c: var(--st-${status})` }, STATUS_LABELS[status] || status);
}

function severityBadge(severity) {
  return el('span', { class: 'badge', style: `--c: var(--sev-${severity})` }, SEVERITY_LABELS[severity] || severity);
}

function showMessage(container, text, type = 'error') {
  container.replaceChildren(text ? el('div', { class: `msg ${type}` }, text) : '');
}

// Récupère les champs d'un formulaire sous forme d'objet.
function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Désactive le bouton d'envoi pendant l'appel, affiche l'erreur éventuelle.
async function submitting(form, feedback, fn) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  showMessage(feedback, '');
  try {
    await fn();
  } catch (err) {
    showMessage(feedback, err.message);
  } finally {
    button.disabled = false;
  }
}

// Fil de discussion d'un ticket. `viewer` = 'client' ou 'support' pour nommer les auteurs.
function renderThread(ticket, viewer) {
  return el('div', { class: 'thread' }, ticket.messages.map((m) => {
    if (m.from === 'system') {
      const status = m.text.replace('status:', '');
      return el('div', { class: 'event' }, `${formatDate(m.at)} — statut changé : ${STATUS_LABELS[status] || status}`);
    }
    const who = m.from === 'support'
      ? (viewer === 'support' ? 'Toi (support)' : 'Support ExpSoft')
      : (viewer === 'client' ? 'Vous' : ticket.name);
    return el('div', { class: `bubble ${m.from}` },
      el('div', { class: 'who' }, `${who} · ${formatDate(m.at)}`),
      m.text);
  }));
}

// Boîte de dialogue « Contacter ExpSoft », utilisable depuis n'importe quelle page.
function setupContactDialog(openButton) {
  const feedback = el('div');
  const form = el('form', {},
    el('div', { class: 'row' },
      el('div', {}, el('label', { for: 'c-name' }, 'Nom'), el('input', { id: 'c-name', name: 'name', required: true, maxlength: 100, autocomplete: 'name' })),
      el('div', {}, el('label', { for: 'c-email' }, 'E-mail'), el('input', { id: 'c-email', name: 'email', type: 'email', required: true, maxlength: 200, autocomplete: 'email' })),
    ),
    el('label', { for: 'c-subject' }, 'Sujet'),
    el('input', { id: 'c-subject', name: 'subject', required: true, maxlength: 150 }),
    el('label', { for: 'c-message' }, 'Message'),
    el('textarea', { id: 'c-message', name: 'message', required: true, maxlength: 10000 }),
    el('div', { class: 'hp', 'aria-hidden': 'true' },
      el('input', { name: 'website', tabindex: '-1', autocomplete: 'off' })),
    feedback,
    el('div', { class: 'actions' },
      el('button', { type: 'submit' }, 'Envoyer'),
      el('button', { type: 'button', class: 'secondary', onclick: () => dialog.close() }, 'Annuler')),
  );
  const dialog = el('dialog', { 'aria-labelledby': 'contact-title' },
    el('h2', { id: 'contact-title' }, 'Contacter ExpSoft'),
    el('p', { class: 'muted small' }, 'Une question, un devis, une idée ? Laissez-nous un message, nous vous répondrons par e-mail.'),
    form);
  document.body.append(dialog);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, feedback, async () => {
      await api('contact', formData(form));
      form.reset();
      showMessage(feedback, 'Message envoyé, merci ! Nous revenons vers vous rapidement.', 'success');
    });
  });
  openButton.addEventListener('click', () => {
    showMessage(feedback, '');
    dialog.showModal();
  });
}
