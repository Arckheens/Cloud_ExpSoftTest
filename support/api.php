<?php
// Le « gardien » : seul point d'écriture du support.
// Il reçoit les demandes de l'interface HTML/JS, les vérifie, puis lit/écrit les fichiers de data/.
declare(strict_types=1);

$config = require __DIR__ . '/config.php';
date_default_timezone_set($config['timezone'] ?? 'Europe/Paris');

const DATA_DIR = __DIR__ . '/data';
// Chaque fichier de base commence par cette ligne : si quelqu'un tente de l'ouvrir depuis le web,
// PHP l'exécute et renvoie une 404 au lieu du contenu. La suite du fichier est du JSON pur.
const GUARD = "<?php http_response_code(404); exit; ?>\n";

const STATUSES   = ['nouveau', 'en_cours', 'attente_client', 'resolu', 'ferme'];
const SEVERITIES = ['basse', 'normale', 'haute', 'bloquante'];

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

// ---------------------------------------------------------------------------
// Base de données en fichiers
// ---------------------------------------------------------------------------

function db_file(string $name): string
{
    return DATA_DIR . '/' . $name . '.db.php';
}

function db_load(string $name): array
{
    $file = db_file($name);
    if (!is_file($file)) {
        return [];
    }
    $raw = (string) file_get_contents($file);
    $json = substr($raw, strlen(GUARD));
    $data = json_decode($json, true);
    return is_array($data) ? $data : [];
}

function db_save(string $name, array $data): void
{
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = db_file($name) . '.tmp';
    if (file_put_contents($tmp, GUARD . $json) === false || !rename($tmp, db_file($name))) {
        fail('Écriture impossible dans data/ (droits du dossier ?)', 500);
    }
}

// Toutes les lectures/écritures passent par un verrou unique : deux tickets envoyés
// à la même seconde ne s'écrasent pas.
function with_lock(bool $write, callable $fn)
{
    if (!is_dir(DATA_DIR) && !mkdir(DATA_DIR, 0755, true)) {
        fail('Dossier data/ introuvable', 500);
    }
    $lock = fopen(DATA_DIR . '/.lock', 'c');
    if ($lock === false) {
        fail('Verrou impossible dans data/ (droits du dossier ?)', 500);
    }
    flock($lock, $write ? LOCK_EX : LOCK_SH);
    try {
        return $fn();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

function respond(array $payload): never
{
    echo json_encode(['ok' => true] + $payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $code = 400): never
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

function now(): string
{
    return date('c');
}

function text(array $in, string $key, int $max, bool $required = true): string
{
    $value = trim((string) ($in[$key] ?? ''));
    if ($required && $value === '') {
        fail("Champ manquant : $key");
    }
    if (mb_strlen($value) > $max) {
        fail("Champ trop long : $key ($max caractères max)");
    }
    return $value;
}

function email(array $in): string
{
    $value = text($in, 'email', 200);
    if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
        fail('Adresse e-mail invalide');
    }
    return $value;
}

function client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? 'inconnue';
}

// Limite le nombre d'actions par IP sur une fenêtre de temps (anti-spam, anti-force brute).
function rate_limit(string $bucket, int $max, int $seconds): void
{
    with_lock(true, function () use ($bucket, $max, $seconds) {
        $limits = db_load('ratelimit');
        $now = time();
        foreach ($limits as $key => $hits) {
            $limits[$key] = array_values(array_filter($hits, fn ($t) => $t > $now - 86400));
            if (!$limits[$key]) {
                unset($limits[$key]);
            }
        }
        $key = $bucket . '|' . hash('sha256', client_ip());
        $recent = array_filter($limits[$key] ?? [], fn ($t) => $t > $now - $seconds);
        if (count($recent) >= $max) {
            db_save('ratelimit', $limits);
            fail('Trop de tentatives, réessaie dans quelques minutes.', 429);
        }
        $limits[$key][] = $now;
        db_save('ratelimit', $limits);
    });
}

function notify(string $subject, string $body): void
{
    global $config;
    if (($config['notify_email'] ?? '') === '') {
        return;
    }
    $headers = 'From: ' . $config['mail_from'] . "\r\n"
        . "Content-Type: text/plain; charset=utf-8\r\n";
    @mail($config['notify_email'], mb_encode_mimeheader('[Support] ' . $subject, 'UTF-8'), $body, $headers);
}

// Code d'accès donné au client : sans caractères ambigus (0/O, 1/I/l).
function access_code(): string
{
    $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    $code = '';
    for ($i = 0; $i < 10; $i++) {
        $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    return $code;
}

// Version d'un ticket visible par le client (sans le hash du code).
function public_ticket(array $t): array
{
    unset($t['code_hash'], $t['ip']);
    return $t;
}

function find_ticket(array $tickets, string $id): int
{
    foreach ($tickets as $i => $t) {
        if ($t['id'] === $id) {
            return $i;
        }
    }
    fail('Ticket introuvable', 404);
}

// Renvoie l'index du ticket si le couple numéro + code est bon, sinon null.
function client_ticket_index(array $tickets, array $in): ?int
{
    $id = strtoupper(text($in, 'id', 30));
    $code = strtoupper(str_replace([' ', '-'], '', text($in, 'code', 30)));
    foreach ($tickets as $i => $t) {
        if ($t['id'] === $id && password_verify($code, $t['code_hash'])) {
            return $i;
        }
    }
    return null;
}

// À appeler hors verrou : compte l'échec (anti force brute) puis refuse.
function bad_credentials(): never
{
    rate_limit('view_fail', 20, 900);
    fail('Numéro de ticket ou code incorrect', 403);
}

function require_admin(): void
{
    if (empty($_SESSION['admin'])) {
        fail('Connexion admin requise', 401);
    }
}

// ---------------------------------------------------------------------------
// Requête
// ---------------------------------------------------------------------------

session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Strict',
    'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
]);
session_name('expsoft_support');
session_start();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $in = ['action' => $_GET['action'] ?? ''];
} else {
    // Seul le JSON est accepté : un autre site ne peut pas envoyer ce type de requête
    // avec les cookies de l'admin sans autorisation du navigateur.
    if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
        fail('Format de requête invalide', 415);
    }
    $in = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($in)) {
        fail('Requête illisible');
    }
}

$action = (string) ($in['action'] ?? '');
$adminOnly = str_starts_with($action, 'admin_') && !in_array($action, ['admin_status', 'admin_login'], true);
if ($adminOnly) {
    require_admin();
}
if (!in_array($action, ['admin_login', 'admin_logout'], true)) {
    // Libère la session (lecture seule ensuite) pour ne pas bloquer les autres requêtes du navigateur.
    session_write_close();
}

switch ($action) {

    case 'config':
        respond([
            'site_name'  => $config['site_name'],
            'softwares'  => $config['softwares'],
            'severities' => SEVERITIES,
            'statuses'   => STATUSES,
        ]);

    // ----- Côté client -----------------------------------------------------

    case 'create_ticket':
        if (($in['website'] ?? '') !== '') {
            fail('Requête refusée');  // champ piège rempli = robot
        }
        $name = text($in, 'name', 100);
        $mail = email($in);
        $software = text($in, 'software', 100);
        if (!in_array($software, $config['softwares'], true)) {
            fail('Logiciel inconnu');
        }
        $severity = text($in, 'severity', 20);
        if (!in_array($severity, SEVERITIES, true)) {
            fail('Gravité inconnue');
        }
        $subject = text($in, 'subject', 150);
        $message = text($in, 'message', 10000);
        rate_limit('create', 5, 3600);

        $code = access_code();
        $ticket = with_lock(true, function () use ($name, $mail, $software, $severity, $subject, $message, $code) {
            $tickets = db_load('tickets');
            $meta = db_load('meta');
            $year = date('Y');
            $seq = (($meta['seq'][$year] ?? 0) + 1);
            $meta['seq'][$year] = $seq;
            $ticket = [
                'id'        => sprintf('EXP-%s-%04d', $year, $seq),
                'created'   => now(),
                'updated'   => now(),
                'status'    => 'nouveau',
                'severity'  => $severity,
                'software'  => $software,
                'subject'   => $subject,
                'name'      => $name,
                'email'     => $mail,
                'code_hash' => password_hash($code, PASSWORD_DEFAULT),
                'unread'    => true,
                'messages'  => [['from' => 'client', 'at' => now(), 'text' => $message]],
            ];
            $tickets[] = $ticket;
            db_save('meta', $meta);
            db_save('tickets', $tickets);
            return $ticket;
        });
        notify("Nouveau ticket {$ticket['id']} : $subject",
            "De : $name <$mail>\nLogiciel : $software\nGravité : $severity\n\n$message");
        respond(['id' => $ticket['id'], 'code' => $code]);

    case 'view_ticket':
        $ticket = with_lock(false, function () use ($in) {
            $tickets = db_load('tickets');
            $i = client_ticket_index($tickets, $in);
            return $i === null ? null : $tickets[$i];
        });
        $ticket ?? bad_credentials();
        respond(['ticket' => public_ticket($ticket)]);

    case 'client_reply':
        $message = text($in, 'message', 10000);
        $ticket = with_lock(true, function () use ($in, $message) {
            $tickets = db_load('tickets');
            $i = client_ticket_index($tickets, $in);
            if ($i === null) {
                return null;
            }
            if ($tickets[$i]['status'] === 'ferme') {
                fail('Ce ticket est fermé. Ouvre un nouveau ticket si besoin.');
            }
            $tickets[$i]['messages'][] = ['from' => 'client', 'at' => now(), 'text' => $message];
            if (in_array($tickets[$i]['status'], ['attente_client', 'resolu'], true)) {
                $tickets[$i]['status'] = 'en_cours';
            }
            $tickets[$i]['updated'] = now();
            $tickets[$i]['unread'] = true;
            db_save('tickets', $tickets);
            return $tickets[$i];
        });
        $ticket ?? bad_credentials();
        notify("Réponse client sur {$ticket['id']}", $message);
        respond(['ticket' => public_ticket($ticket)]);

    case 'contact':
        if (($in['website'] ?? '') !== '') {
            fail('Requête refusée');
        }
        $name = text($in, 'name', 100);
        $mail = email($in);
        $subject = text($in, 'subject', 150);
        $message = text($in, 'message', 10000);
        rate_limit('contact', 5, 3600);
        with_lock(true, function () use ($name, $mail, $subject, $message) {
            $contacts = db_load('contacts');
            $contacts[] = [
                'id'      => bin2hex(random_bytes(8)),
                'at'      => now(),
                'name'    => $name,
                'email'   => $mail,
                'subject' => $subject,
                'message' => $message,
                'read'    => false,
            ];
            db_save('contacts', $contacts);
        });
        notify("Contact : $subject", "De : $name <$mail>\n\n$message");
        respond([]);

    // ----- Côté admin ------------------------------------------------------

    case 'admin_status':
        respond([
            'logged'     => !empty($_SESSION['admin']),
            'configured' => $config['admin_password'] !== 'change-moi' && $config['admin_password'] !== '',
        ]);

    case 'admin_login':
        if ($config['admin_password'] === 'change-moi' || $config['admin_password'] === '') {
            fail('Définis d\'abord un mot de passe dans support/config.php', 403);
        }
        rate_limit('login', 10, 900);
        if (!hash_equals($config['admin_password'], (string) ($in['password'] ?? ''))) {
            fail('Mot de passe incorrect', 403);
        }
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
        respond([]);

    case 'admin_logout':
        $_SESSION = [];
        session_destroy();
        respond([]);

    case 'admin_list':
        [$tickets, $contacts] = with_lock(false, fn () => [db_load('tickets'), db_load('contacts')]);
        $summary = array_map(function ($t) {
            $last = end($t['messages']);
            return [
                'id' => $t['id'], 'created' => $t['created'], 'updated' => $t['updated'],
                'status' => $t['status'], 'severity' => $t['severity'], 'software' => $t['software'],
                'subject' => $t['subject'], 'name' => $t['name'], 'email' => $t['email'],
                'unread' => $t['unread'] ?? false, 'count' => count($t['messages']),
                'last_from' => $last['from'] ?? 'client',
            ];
        }, $tickets);
        respond(['tickets' => array_reverse($summary), 'contacts' => array_reverse($contacts)]);

    case 'admin_ticket':
        $id = text($in, 'id', 30);
        $ticket = with_lock(true, function () use ($id) {
            $tickets = db_load('tickets');
            $i = find_ticket($tickets, $id);
            if (!empty($tickets[$i]['unread'])) {
                $tickets[$i]['unread'] = false;
                db_save('tickets', $tickets);
            }
            return $tickets[$i];
        });
        respond(['ticket' => public_ticket($ticket)]);

    case 'admin_reply':
        $id = text($in, 'id', 30);
        $message = text($in, 'message', 10000, false);
        $status = (string) ($in['status'] ?? '');
        if ($status !== '' && !in_array($status, STATUSES, true)) {
            fail('Statut inconnu');
        }
        if ($message === '' && $status === '') {
            fail('Rien à enregistrer');
        }
        $ticket = with_lock(true, function () use ($id, $message, $status) {
            $tickets = db_load('tickets');
            $i = find_ticket($tickets, $id);
            if ($message !== '') {
                $tickets[$i]['messages'][] = ['from' => 'support', 'at' => now(), 'text' => $message];
            }
            if ($status !== '' && $status !== $tickets[$i]['status']) {
                $tickets[$i]['messages'][] = ['from' => 'system', 'at' => now(), 'text' => 'status:' . $status];
                $tickets[$i]['status'] = $status;
            }
            $tickets[$i]['updated'] = now();
            db_save('tickets', $tickets);
            return $tickets[$i];
        });
        respond(['ticket' => public_ticket($ticket)]);

    case 'admin_delete_ticket':
        $id = text($in, 'id', 30);
        with_lock(true, function () use ($id) {
            $tickets = db_load('tickets');
            array_splice($tickets, find_ticket($tickets, $id), 1);
            db_save('tickets', $tickets);
        });
        respond([]);

    case 'admin_contact':
        $id = text($in, 'id', 30);
        $op = (string) ($in['op'] ?? '');
        with_lock(true, function () use ($id, $op) {
            $contacts = db_load('contacts');
            foreach ($contacts as $i => $c) {
                if ($c['id'] === $id) {
                    if ($op === 'delete') {
                        array_splice($contacts, $i, 1);
                    } else {
                        $contacts[$i]['read'] = $op === 'read';
                    }
                    db_save('contacts', $contacts);
                    return;
                }
            }
            fail('Message introuvable', 404);
        });
        respond([]);

    case 'admin_export':
        $backup = with_lock(false, fn () => [
            'exported' => now(),
            'tickets'  => db_load('tickets'),
            'contacts' => db_load('contacts'),
            'meta'     => db_load('meta'),
        ]);
        respond(['backup' => $backup]);

    default:
        fail('Action inconnue', 404);
}
