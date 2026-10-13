// Forum public : catégories, sujets, réponses. Navigation par l'URL (#/, #/c/questions, #/t/12).

const $ = (id) => document.getElementById(id);
const AUTHOR_KEY = 'expsoft_forum_author';
const MAX_MESSAGE = 2000;

let data = { categories: [], topics: [], admin: false };

// --- Pseudo mémorisé dans le navigateur (confort, facultatif) -----------------

function savedAuthor() {
  try { return localStorage.getItem(AUTHOR_KEY) || ''; } catch { return ''; }
}

function rememberAuthor(name) {
  try { localStorage.setItem(AUTHOR_KEY, name); } catch { /* stockage indisponible */ }
}

// --- Petits composants -------------------------------------------------------

function authorTag(name, staff) {
  return staff
    ? el('span', { class: 'badge', style: '--c: var(--accent)' }, '✔ ExpSoft')
    : el('b', {}, name);
}

function relative(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 1440) return `il y a ${Math.round(minutes / 60)} h`;
  if (minutes < 10080) return `il y a ${Math.round(minutes / 1440)} j`;
  return formatDate(iso).slice(0, 10);
}

function crumbs(...parts) {
  return el('nav', { class: 'crumbs small' },
    el('a', { href: '#/' }, 'Forum'),
    parts.map((p) => [' › ', p.href ? el('a', { href: p.href }, p.label) : el('span', {}, p.label)]));
}

// Champs communs aux formulaires de sujet et de réponse.
function postFields(placeholder) {
  const counter = el('span', { class: 'muted small' }, `0 / ${MAX_MESSAGE}`);
  const textarea = el('textarea', {
    name: 'message', required: true, maxlength: MAX_MESSAGE, placeholder,
    style: 'min-height: 110px',
    oninput: (e) => { counter.textContent = `${e.target.value.length} / ${MAX_MESSAGE}`; },
  });
  return [
    data.admin
      ? el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'as_staff', checked: true }), ' Poster en tant qu\'ExpSoft')
      : el('div', {},
        el('label', {}, 'Pseudo'),
        el('input', { name: 'author', required: true, maxlength: 40, value: savedAuthor(), autocomplete: 'nickname' })),
    el('label', {}, 'Message'),
    textarea,
    el('div', { style: 'text-align: right' }, counter),
    el('div', { class: 'hp', 'aria-hidden': 'true' }, el('input', { name: 'website', tabindex: '-1', autocomplete: 'off' })),
  ];
}

function postPayload(form) {
  const values = formData(form);
  if (data.admin) {
    values.as_staff = form.elements.as_staff.checked;
    if (!values.as_staff) values.author = 'Admin';
  } else {
    rememberAuthor(values.author);
  }
  return values;
}

// --- Vues --------------------------------------------------------------------

function viewHome() {
  document.title = 'Forum ExpSoft';
  $('view').replaceChildren(
    el('p', { class: 'muted' }, 'Posez vos questions, partagez vos idées, échangez avec ExpSoft et les autres utilisateurs. Pour un bug à corriger, ',
      el('a', { href: 'index.html' }, 'ouvrez plutôt un ticket'), '.'),
    el('div', { class: 'list' }, data.categories.map((c) => {
      const topics = data.topics.filter((t) => t.category === c.slug);
      const last = topics.reduce((a, t) => (!a || t.updated > a.updated ? t : a), null);
      return el('a', { href: `#/c/${c.slug}`, class: 'item cat' },
        el('div', { class: 'subject' }, c.name, c.staff ? el('span', { class: 'muted small' }, '  · ExpSoft uniquement') : ''),
        el('div', { class: 'muted small' }, c.description),
        el('div', { class: 'line1', style: 'margin-top: 6px' },
          el('span', {}, `${topics.length} sujet${topics.length > 1 ? 's' : ''}`),
          el('span', {}, last ? `Dernier : ${last.title.slice(0, 40)} · ${relative(last.updated)}` : 'Aucun sujet')));
    })));
}

function viewCategory(slug) {
  const cat = data.categories.find((c) => c.slug === slug);
  if (!cat) return viewNotFound();
  document.title = `${cat.name} — Forum ExpSoft`;
  const topics = data.topics
    .filter((t) => t.category === slug)
    .sort((a, b) => (b.pinned - a.pinned) || b.updated.localeCompare(a.updated));

  const canPost = !cat.staff || data.admin;
  const feedback = el('div');
  const form = el('form', { class: 'card', hidden: true },
    el('h2', {}, 'Nouveau sujet'),
    el('label', {}, 'Titre'),
    el('input', { name: 'title', required: true, maxlength: 120 }),
    postFields('Votre message (court et précis)'),
    feedback,
    el('div', { class: 'actions' },
      el('button', { type: 'submit' }, 'Publier'),
      el('button', { type: 'button', class: 'secondary', onclick: () => { form.hidden = true; } }, 'Annuler')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, feedback, async () => {
      const res = await api('forum_new_topic', { ...postPayload(form), category: slug });
      location.hash = `#/t/${res.topic.id}`;
    });
  });

  $('view').replaceChildren(
    crumbs({ label: cat.name }),
    el('div', { class: 'ticket-head', style: 'margin: 8px 0 16px' },
      el('div', {}, el('h2', { style: 'margin: 0' }, cat.name), el('div', { class: 'muted small' }, cat.description)),
      canPost ? el('button', { type: 'button', onclick: () => { form.hidden = false; form.elements.title.focus(); } }, 'Nouveau sujet') : ''),
    form,
    topics.length
      ? el('div', { class: 'list' }, topics.map((t) => el('a', { href: `#/t/${t.id}`, class: 'item' },
        el('div', { class: 'subject' }, t.pinned ? '📌 ' : '', t.locked ? '🔒 ' : '', t.title),
        el('div', { class: 'line1' },
          el('span', {}, 'par ', authorTag(t.author, t.staff), ` · ${relative(t.created)}`),
          el('span', {}, `${t.replies} réponse${t.replies > 1 ? 's' : ''}`,
            t.replies ? [' · dernière par ', authorTag(t.last_author, t.last_staff)] : '')))))
      : el('div', { class: 'card empty' }, canPost ? 'Aucun sujet pour l\'instant : lancez le premier !' : 'Aucun sujet pour l\'instant.'));
}

async function viewTopic(id) {
  const { topic } = await api('forum_topic', { id: Number(id) });
  const cat = data.categories.find((c) => c.slug === topic.category) || { name: topic.category };
  document.title = `${topic.title} — Forum ExpSoft`;

  const modButtons = data.admin ? el('div', { class: 'actions', style: 'margin: 0' },
    el('button', { type: 'button', class: 'secondary', onclick: () => moderate(topic, 'pin') }, topic.pinned ? 'Désépingler' : 'Épingler'),
    el('button', { type: 'button', class: 'secondary', onclick: () => moderate(topic, 'lock') }, topic.locked ? 'Déverrouiller' : 'Verrouiller'),
    el('button', { type: 'button', class: 'danger', onclick: () => moderate(topic, 'delete') }, 'Supprimer le sujet')) : '';

  const posts = topic.posts.map((p, i) => el('article', { class: `card post${p.staff ? ' staff' : ''}` },
    el('div', { class: 'line1 small muted', style: 'display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px' },
      el('span', {}, authorTag(p.author, p.staff), ` · ${formatDate(p.at)}`),
      data.admin && i > 0
        ? el('button', { type: 'button', class: 'link-danger', onclick: () => deletePost(topic, p) }, 'Supprimer')
        : ''),
    el('div', { class: 'post-text' }, p.text)));

  let replyBlock;
  if (topic.locked && !data.admin) {
    replyBlock = el('p', { class: 'muted' }, '🔒 Ce sujet est verrouillé.');
  } else {
    const feedback = el('div');
    replyBlock = el('form', { class: 'card' },
      el('h2', {}, 'Répondre'),
      postFields('Votre réponse'),
      feedback,
      el('div', { class: 'actions' }, el('button', { type: 'submit' }, 'Envoyer')));
    replyBlock.addEventListener('submit', (e) => {
      e.preventDefault();
      submitting(replyBlock, feedback, async () => {
        await api('forum_reply', { ...postPayload(replyBlock), id: topic.id });
        await reload();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      });
    });
  }

  $('view').replaceChildren(
    crumbs({ label: cat.name, href: `#/c/${topic.category}` }, { label: topic.title }),
    el('div', { class: 'ticket-head', style: 'margin: 8px 0 16px' },
      el('h2', { style: 'margin: 0' }, topic.pinned ? '📌 ' : '', topic.locked ? '🔒 ' : '', topic.title),
      modButtons),
    ...posts,
    replyBlock);
}

function viewNotFound() {
  $('view').replaceChildren(el('div', { class: 'card empty' }, 'Page introuvable. ', el('a', { href: '#/' }, 'Retour au forum')));
}

// --- Modération (admin) ------------------------------------------------------

async function moderate(topic, op) {
  if (op === 'delete' && !confirm(`Supprimer le sujet « ${topic.title} » et toutes ses réponses ?`)) return;
  try {
    await api('admin_forum_topic', { id: topic.id, op });
    if (op === 'delete') location.hash = `#/c/${topic.category}`;
    else await reload();
  } catch (err) {
    alert(err.message);
  }
}

async function deletePost(topic, post) {
  if (!confirm(`Supprimer ce message de ${post.author} ?`)) return;
  try {
    await api('admin_forum_delete_post', { id: topic.id, post: post.id });
    await reload();
  } catch (err) {
    alert(err.message);
  }
}

// --- Routage -----------------------------------------------------------------

async function reload() {
  try {
    data = await api('forum_list');
    $('admin-bar').hidden = !data.admin;
    const [, kind, id] = location.hash.split('/');
    if (kind === 'c') viewCategory(id);
    else if (kind === 't') await viewTopic(id);
    else if (!kind) viewHome();
    else viewNotFound();
  } catch (err) {
    $('view').replaceChildren(el('div', { class: 'msg error' }, err.message));
  }
}

window.addEventListener('hashchange', () => { reload(); window.scrollTo(0, 0); });
setupContactDialog($('contact-btn'));
reload();
