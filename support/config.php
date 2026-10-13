<?php
// Configuration du support ExpSoft.
// Ce fichier n'est jamais affiché par le serveur (c'est du PHP), le mot de passe reste privé.
return [
    // Mot de passe de l'espace admin (admin.html).
    // Tant qu'il vaut 'change-moi', la connexion admin est refusée : modifie-le avant la mise en ligne.
    'admin_password' => 'change-moi',

    // E-mail qui reçoit une notification à chaque nouveau ticket, réponse client ou message de contact.
    // Laisse vide ('') pour désactiver les e-mails.
    'notify_email' => '',

    // Expéditeur des e-mails de notification (idéalement une adresse de ton domaine).
    'mail_from' => 'support@nicolas-riquier.com',

    // Fuseau horaire des dates des tickets.
    'timezone' => 'Europe/Paris',

    // Nom affiché dans les pages.
    'site_name' => 'ExpSoft Support',

    // Logiciels proposés dans le formulaire de ticket.
    'softwares' => [
        'CivitAI Manager',
        'CivitAI Grabber',
        'Training Factory',
        'DTV Player',
        'Autre',
    ],

    // Catégories du forum : identifiant => [nom, description].
    // 'staff' => true : seul ExpSoft (connecté en admin) peut y ouvrir un sujet ; tout le monde peut répondre.
    'forum_categories' => [
        'annonces'  => ['name' => 'Annonces', 'description' => 'Nouveautés et mises à jour des logiciels ExpSoft.', 'staff' => true],
        'questions' => ['name' => 'Questions & aide', 'description' => 'Une question sur un logiciel ? Posez-la ici.'],
        'idees'     => ['name' => 'Idées & suggestions', 'description' => 'Proposez des améliorations ou de nouvelles fonctions.'],
        'general'   => ['name' => 'Discussion générale', 'description' => 'Tout le reste.'],
    ],
];
