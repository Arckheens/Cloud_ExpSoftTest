# NCM: The LLM Killer?

**Étude + cahier des charges — IA locale ExpSoft**
ExpSoft · Nicolas Riquier · octobre 2026 · **version 2**

> **Questions posées :** NCM et HybridAgent, ça marche ? Peut-on les utiliser en local sur une machine
> **16 Go de VRAM + 64 Go de RAM** ? Peut-on en faire une app pour discuter, avec la vision et le code ?
>
> **Réponses courtes :**
> - **NCM** n'est **pas (encore) un « LLM killer »**. C'est une nouvelle **façon d'écrire** du texte, très rapide,
>   mais les modèles publiés sont minuscules et ne savent faire qu'une chose chacun. Ils ne sont **pas intelligents**
>   au sens d'un assistant. Ils tournent sur ta machine, comme démo.
> - **HybridAgent 14B** tourne sur 16 Go en 4 bits, mais c'est un **résolveur de questions spécialisé**
>   (maths, culture + Wikipédia + calculs Python), **pas un assistant de discussion** : pas de chat, pas de vision,
>   pas de développement de code.
> - **Pour une app où l'on discute, avec vision et code**, il faut des **modèles généralistes classiques**
>   (`.gguf`) servis par **llama.cpp**. C'est l'objet du cahier des charges (section 7).
>
> **Historique :** v1, étude NCM / HybridAgent et banc d'essai. v2, clarifications (intelligence de NCM,
> limites de HybridAgent, Bonsai et Strata) et nouveau CDC : application de chat IA locale.

---

## 1. Les sources étudiées

| Source | Ce que c'est | Statut de lecture |
|---|---|---|
| [NCM, arXiv 2610.14162](https://arxiv.org/abs/2610.14162) | Article Hazy Research (Stanford), 9 oct. 2026 | Résumé via moteur de recherche (arXiv bloqué depuis mon environnement) |
| [HazyResearch/ncm](https://github.com/HazyResearch/ncm) | Code + liens vers les modèles | **Code lu et analysé** |
| [Hybrid Reasoning Agents, arXiv 2610.18861](https://arxiv.org/abs/2610.18861) | Article Stanford + Together AI | Résumé via moteur de recherche |
| [togethercomputer/HybridAgent](https://github.com/togethercomputer/HybridAgent) | Code + liens vers les modèles | **Code lu et analysé** (y compris le prompt système et les outils) |
| [Coconut, arXiv 2412.06769](https://arxiv.org/abs/2412.06769) | Meta FAIR, 2024 : raisonner dans l'espace latent | Connaissance préalable |
| [Google Research — speculative decoding](https://research.google/blog/looking-back-at-speculative-decoding/) | Rétrospective sur le décodage spéculatif | Connaissance préalable (site bloqué) |
| [OpenAI — reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) | Les « reasoning tokens » | Connaissance préalable |
| Bonsai (PrismML) et Strata | Modèles 1 bit / moteur local pour un gros modèle MoE | Articles et blogs (pas de doc officielle lue) |
| Annonce de Jiaru Zou / réponse de Peter Barnett (X) | Discussion autour de HybridAgent | Non accessible (X bloqué) |

⚠️ **Limites de cette étude** : depuis l'environnement cloud, arxiv.org, huggingface.co et x.com
étaient injoignables. Les chiffres de performance viennent **des auteurs eux-mêmes** et **n'ont pas été reproduits**.
Aucun modèle n'a été lancé (pas de GPU dans le conteneur). Ce qui est dit sur la taille des modèles,
leur chargement et leur format de réponse vient en revanche de **la lecture directe du code**.

---

## 2. Le problème commun : générer token par token, c'est lent

Un LLM classique (GPT, Llama, Qwen, Claude…) est **autorégressif** : il produit **un token à la fois**,
et chaque token demande un passage complet dans le réseau. 1 000 tokens = 1 000 passages.
Les modèles « qui réfléchissent » aggravent le problème : ils écrivent des milliers de **tokens de raisonnement**
avant de répondre (c'est le sujet du guide *reasoning* d'OpenAI).

| Approche | Idée | Exemple |
|---|---|---|
| **Décodage spéculatif** | Un petit modèle devine plusieurs tokens, le gros les valide d'un coup. Même résultat, 2–3× plus rapide. | Rétrospective Google ; déjà dans llama.cpp, vLLM, LM Studio |
| **Génération parallèle** | Ne plus écrire de gauche à droite : produire tout le texte en quelques étapes. | Modèles de diffusion, et **NCM** |
| **Raisonnement latent** | Réfléchir avec des vecteurs internes plutôt qu'avec des mots écrits. | **Coconut** (Meta), puis **HybridAgent** |
| **Compression extrême** | Stocker chaque poids sur 1 bit au lieu de 16 : modèles minuscules et rapides. | **Bonsai** (PrismML) |

---

## 3. NCM — Next-Concept Modeling

### 3.1 Le principe

![Comparaison NTP / diffusion / NCM](https://raw.githubusercontent.com/HazyResearch/ncm/main/assets/overview.png)

1. Un **tokenizer VQ multi-échelle** compresse une phrase en une **hiérarchie de codes** :
   niveau 1 = 1 code qui résume tout le texte (« l'idée »), … dernier niveau = un code par token.
2. Un transformer prédit cette hiérarchie **du grossier au fin**. **Toutes les positions d'un niveau sont prédites
   en parallèle** → **un passage par niveau** (9 à 31 selon les modèles publiés), au lieu d'un par token.
3. Le dernier niveau est décodé en texte.

### 3.2 Résultats annoncés par les auteurs

![Qualité vs temps](https://raw.githubusercontent.com/HazyResearch/ncm/main/assets/quality_speed.png)

- **LM1B** : meilleure perplexité générative que les modèles de diffusion, **21× plus rapide** que la meilleure diffusion.
- **XSum** (résumé) : au niveau des meilleurs modèles de diffusion, **31× plus rapide**.
- **Sudoku difficile** : **86,1 %** de grilles résolues en 12 passages, contre 1 % pour un modèle autorégressif
  en 128 passages, 58 % pour la meilleure diffusion « classique » (DUO) et 81 % pour le meilleur concurrent (FMLM+, 16 passages).
- Entraînement annoncé sur **4–5× moins de tokens** que les modèles de diffusion comparés.

### 3.3 Ce qui est réellement publié (vérifié dans le code)

| Modèle | Paramètres (estimés) | Longueur max | Ce qu'il sait faire | Ce qu'il ne sait pas faire |
|---|---|---|---|---|
| Sudoku easy/medium/hard | ~25 M | 81 cases | Résoudre un Sudoku (très bien) | Rien d'autre |
| TinyStories | ~85 M | 128 tokens | Inventer une histoire courte pour enfant | Répondre à une question |
| XSum | ~85 M | 48 tokens | Résumer un article de la BBC en une phrase | Résumer autre chose correctement |
| WMT14 De→En | ~85 M | 64 tokens | Traduire une phrase courte allemand → anglais | Traduire vers le français |
| LM1B small / medium / large | ~85 M / ~300 M / **~700 M** | 128 tokens | Produire des phrases plausibles au hasard | Avoir un sens suivi |
| OpenWebText | ~200 M | 1 024 tokens | Produire du texte web générique | Suivre une consigne |

(Estimation : 12 × couches × largeur², hors embeddings, d'après les fichiers de configuration du dépôt.)

### 3.4 NCM est-il intelligent ?

**Non, pas les modèles publiés.** Il faut séparer deux choses :

- **Le « comment »** : la façon dont le modèle écrit. C'est là que NCM innove : esquisse, puis affinage, très vite.
- **Le « quoi »** : ce que le modèle sait et comprend. Ça dépend de **sa taille** et de **la quantité de textes**
  vus à l'entraînement, puis d'un apprentissage à suivre des consignes.

> **Image :** NCM est un **nouveau type de moteur** testé sur un **kart**. Le moteur est prometteur, plus rapide
> que les moteurs concurrents testés sur le même kart. Mais ce n'est pas une voiture. Un assistant comme Claude
> ou ChatGPT, c'est la voiture : environ 1 000 fois plus gros que le plus grand NCM, entraîné sur une bonne partie
> d'internet. Personne n'a encore monté ce moteur dans une voiture.

### 3.5 Alors, « LLM killer » ?

**Non, pas aujourd'hui. Peut-être un jour.**

- ✅ **Idée solide et élégante** : quelques passages au lieu de milliers, et un vrai gain sur les problèmes
  à contraintes globales (Sudoku) où l'écriture gauche → droite échoue.
- ❌ **Comparé aux modèles de diffusion**, pas à des LLM autorégressifs de même taille sur le texte libre.
  Or la diffusion est elle-même en retrait : battre la diffusion ne veut pas dire battre les LLM.
- ❌ **Échelle minuscule** (≤ 0,7 milliard de paramètres) : on ne sait pas si l'avantage tient à grande échelle.
- ❌ **Longueur fixe et courte**, **aucun modèle chat**, **aucune intégration** (llama.cpp, Ollama…).

> **Verdict NCM** : à suivre de très près. Il deviendra intéressant pour ExpSoft le jour où un laboratoire
> publiera un NCM de plusieurs milliards de paramètres capable de suivre des consignes.

---

## 4. HybridAgent — penser en latent, agir en texte

### 4.1 Le principe

- Base : **Qwen3-8B** ou **Qwen3-14B** (versions *Base*, ré-entraînées).
- Un petit module, **HybridLink** (≈ 34 M de paramètres pour le 8B), renvoie le **dernier état caché** du modèle
  directement en **entrée** du pas suivant, au lieu de passer par un mot. C'est l'idée de **Coconut**, industrialisée.
- Le modèle **alterne de lui-même** : bloc `<latent>` pour réfléchir « en silence », puis retour au **texte**
  pour appeler ses outils et répondre.
- Entraînement : **HybridSFT** (apprendre le mode latent) puis **HybridRL** (apprendre *quand* l'utiliser).
- Les pensées latentes peuvent être **relues en pseudo-texte** (rapport HTML).

### 4.2 Résultats annoncés

Sur 11 benchmarks : **+10,4 %** de performance moyenne par rapport à des agents de pointe,
**35–55 % de tokens en moins**, **1,8–2,6× plus rapide**, **2,7–3,7× moins cher**.

### 4.3 Ce qu'il sait faire, et ne sait pas faire (vérifié dans le code)

| Question | Réponse | Détail |
|---|---|---|
| **Discuter (chat)** | ❌ Pas vraiment | Entraîné pour un seul format : une question → réflexion, recherche, calcul → une **réponse finale encadrée** (`\boxed{29}`). Pas de conversation suivie ni de rédaction. |
| **Intelligent ?** | ✅ Sur son domaine | Questions de culture, maths et logique. Exemples fournis : « combien de minutes met la lumière du Soleil à la Terre ? », « combien de zéros à la fin de 100! ? » |
| **Outils** | Recherche **Wikipédia** + Python | Le Python sert de **calculatrice**, pas à développer des programmes. |
| **Vision (images)** | ❌ Non | Qwen3 ne lit que du texte. |
| **Coder** | ❌ Pas pour développer | Voir ci-dessus. |
| **Windows** | ⚠️ Via WSL seulement | Son outil Python utilise un module propre à Linux (`resource`). |
| **llama.cpp / Ollama / LM Studio** | ❌ | La boucle « pensée latente » n'existe pas dans ces moteurs. |

### 4.4 La question de la transparence

**Un raisonnement en vecteurs ne se lit plus.** On perd en partie la possibilité de surveiller ce que
le modèle « pense ». La lecture en pseudo-texte proposée par les auteurs est une **approximation**.

> **Verdict HybridAgent** : excellent **objet de laboratoire** pour tester le raisonnement latent,
> mauvais choix comme assistant de tous les jours.

---

## 5. Bonsai et Strata : d'autres pistes, pas des compléments de NCM

On ne peut **pas** combiner NCM avec Bonsai ou Strata. Ce sont trois choses de nature différente :

| | C'est quoi | Image |
|---|---|---|
| **NCM** | Une **façon de construire** un modèle | Un nouveau type de **moteur** |
| **Bonsai** (PrismML, mars 2026) | Des **modèles entraînés directement en 1 bit** : un 8B pèse **1,15 Go** au lieu de 16 Go. Formats GGUF et MLX, licence Apache 2.0 | Une **voiture ultra-légère** |
| **Strata** | Un **logiciel pour faire tourner** un modèle précis, Qwen3.8-Flash-Next (125B, MoE), sur un PC de joueur (≥ 12 Go VRAM, ≥ 32 Go RAM annoncés) | Un **garage** spécialisé |

**Pourquoi « NCM + Bonsai » ne marche pas :** l'intelligence d'un modèle est dans ses poids, appris pour écrire
**mot par mot**. Pour un « NCM intelligent », il faut **entraîner un nouveau modèle de zéro** sur des milliers de
milliards de mots : un projet de laboratoire à plusieurs millions d'euros. Un NCM entraîné en 1 bit serait un
jour une combinaison très intéressante, mais elle doit venir de la recherche.

**Utilisables sur ta machine dès maintenant :**
- **Bonsai 8B** : intelligent, très léger et rapide. Retours : bon en discussion, plus faible en code complexe,
  quelques erreurs factuelles. **À vérifier** : compatibilité avec le llama.cpp officiel.
- **Strata + Qwen3.8-Flash-Next 125B** : beaucoup plus intelligent, ta machine dépasse les minimums annoncés.
  Projet très jeune, sources secondaires uniquement : **à tester avec prudence**.
- Aucune trace d'un « Bonsai 2 » dans les sources trouvées.

---

## 6. Faisabilité sur ta machine (16 Go VRAM / 64 Go RAM)

| | Taille en 4 bits | Tient en VRAM ? | Chat | Vision | Code | llama.cpp |
|---|---|---|---|---|---|---|
| NCM (modèles publiés) | < 1,5 Go (bf16) | ✅ | ❌ | ❌ | ❌ | ❌ |
| HybridAgent-14B | ~9–10 Go (patch requis) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bonsai 8B (1 bit) | 1,15 Go | ✅ | ✅ | ❌ | ⚠️ moyen | ⚠️ à vérifier |
| Qwen3.8-Flash-Next 125B via Strata | — | VRAM + RAM | ✅ | ? | ? | ❌ (Strata) |
| **Généraliste instruct ~14B** (ex. Qwen3-14B) | ~9 Go | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Vision-langage ~8–12B** (ex. Gemma 3 12B, Qwen-VL 7–8B) | ~7–8 Go | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| **Code** (ex. Qwen3-Coder-30B-A3B, Qwen2.5-Coder-14B) | ~18 Go / ~9 Go | VRAM + RAM / ✅ | ✅ | ❌ | ✅✅ | ✅ |

Les modèles cités en exemple sont des familles éprouvées. **La sélection finale se fera au lot L0**,
parmi les modèles les plus récents et les mieux notés au moment du projet.

**Niveau d'intelligence attendu :** un bon 14B local est un assistant **correct et utile** (discuter, résumer,
expliquer, aider à coder), nettement en dessous des grands modèles en ligne (Claude, ChatGPT) sur les tâches
complexes. En échange : **gratuit, privé, hors ligne**.

---

## 7. Cahier des charges — « ExpSoft Local AI »

### 7.1 Objectif

Créer une **application de chat IA 100 % locale** (« ton propre ChatGPT ExpSoft ») qui :
1. permet de **discuter** avec des modèles d'IA tournant **sur le PC**, sans internet ni abonnement ;
2. gère la **vision** (glisser une image dans la conversation) et l'**aide au code** ;
3. permet de **choisir le modèle** selon la tâche (généraliste, vision, code) ;
4. intègre un **onglet Labo** pour tester les technologies de recherche (HybridAgent, Bonsai, NCM, Strata) ;
5. sert de **socle** pour intégrer plus tard l'IA dans les logiciels ExpSoft.

### 7.2 Architecture

```
┌────────────────────────────┐      ┌──────────────────────────┐      ┌───────────────────┐
│ Interface web locale        │ ⇄   │ Backend Python (FastAPI) │ ⇄   │ llama-server       │
│ HTML5 + JS (même style que  │ HTTP │ conversations, modèles,  │ API  │ (llama.cpp, CUDA)  │
│ le support ExpSoft)         │      │ téléchargements, labo    │ type │ + fichiers .gguf   │
└────────────────────────────┘      └──────────────────────────┘ OpenAI└───────────────────┘
```

- **Moteur : `llama-server`** (llama.cpp officiel). Versions Windows CUDA prêtes à l'emploi, API compatible OpenAI,
  vision par fichier `mmproj`, décodage spéculatif intégré. On évite de compiler `llama-cpp-python` avec CUDA
  sous Windows, souvent laborieux.
- **Backend : Python + FastAPI.** Il démarre et arrête `llama-server`, change de modèle, enregistre les conversations
  et télécharge les modèles depuis Hugging Face.
- **Interface : HTML5 + JS**, ouverte dans le navigateur ou dans une fenêtre d'app (`pywebview`).
- **Données en fichiers JSON** dans le dossier de l'app (conversations, réglages) : **portable et zippable**,
  même principe que le support ExpSoft.

### 7.3 Environnement cible

- **PC** : GPU NVIDIA **16 Go de VRAM**, **64 Go de RAM**, ≥ 100 Go de disque libre pour les modèles.
- **OS** : **Windows 10/11 (à confirmer)** pour l'app principale. **WSL2** uniquement pour le Labo HybridAgent.
- **Python 3.11+**, pilotes NVIDIA récents, **llama.cpp** (build CUDA).

### 7.4 Exigences fonctionnelles

| ID | Exigence | Priorité |
|---|---|---|
| F1 | **Chat** avec réponses en direct (texte qui s'affiche au fur et à mesure), bouton Stop | Haute |
| F2 | **Historique** des conversations : créer, renommer, rechercher, supprimer, exporter (Markdown/JSON) | Haute |
| F3 | **Affichage riche** : Markdown, tableaux, **blocs de code colorés avec bouton Copier** | Haute |
| F4 | **Choix du modèle** dans une liste, avec badges (💬 chat, 👁 vision, 💻 code) et VRAM nécessaire | Haute |
| F5 | **Vision** : glisser-déposer ou coller une image (capture d'écran…), envoyée au modèle s'il a la vision | Haute |
| F6 | **Gestionnaire de modèles** : catalogue conseillé, téléchargement avec barre de progression, suppression | Haute |
| F7 | **Profils** : « Assistant », « Développeur », « Rédacteur »… (prompt système + réglages) | Moyenne |
| F8 | **Réglages** : température, longueur de contexte, couches sur GPU ; préréglages auto selon la VRAM | Moyenne |
| F9 | **Joindre des fichiers texte/code** (.txt, .md, .py, .cs, .js…) dans la conversation | Moyenne |
| F10 | **Décodage spéculatif** activable quand un petit modèle compagnon existe | Basse |
| F11 | **Onglet Labo** : HybridAgent 14B en 4 bits (via WSL), Bonsai, démo NCM (texte de l'esquisse aux mots, Sudoku), Strata en veille | Basse |
| F12 | **API locale** compatible OpenAI, pour brancher les futurs logiciels ExpSoft | Moyenne |

### 7.5 Exigences non fonctionnelles

| ID | Exigence |
|---|---|
| N1 | **100 % hors ligne** après téléchargement des modèles. Aucune donnée envoyée à l'extérieur. |
| N2 | Le serveur n'écoute **que sur la machine** (`127.0.0.1`), jamais sur le réseau local par défaut. |
| N3 | Premier mot affiché en **moins de 2 s** sur un modèle déjà chargé (à calibrer au lot L0 selon le GPU). |
| N4 | L'app reste utilisable si un modèle plante : message clair et relance du moteur. |
| N5 | Installation guidée pour un non-spécialiste : un installeur ou un script unique, plus un guide pas à pas. |
| N6 | Code exécuté par un agent du Labo **toujours en bac à sable**, sans accès réseau. |

### 7.6 Lots et planning indicatif

| Lot | Contenu | Durée estimée |
|---|---|---|
| L0 | Poste : pilotes, llama.cpp CUDA, **choix et mesure des modèles** (tokens/s, VRAM, qualité) | 1 j |
| L1 | Backend FastAPI + pilotage de `llama-server` + chat en direct (F1, F3) | 2 j |
| L2 | Historique, profils, réglages (F2, F7, F8) | 1,5 j |
| L3 | Gestionnaire de modèles + changement de modèle (F4, F6) | 1,5 j |
| L4 | Vision et fichiers joints (F5, F9) | 1 j |
| L5 | API locale, décodage spéculatif (F10, F12) | 1 j |
| L6 | Installeur Windows + guide utilisateur (N5) | 1 j |
| L7 | Onglet Labo : HybridAgent 4 bits (WSL), Bonsai, démo NCM (F11) | 2 j |
| | **Total** | **≈ 11 jours** (L0 à L6 = version utilisable ; L7 en option) |

### 7.7 Critères d'acceptation

- [ ] On discute avec un modèle ~14B entièrement en VRAM, réponses affichées en direct, sans internet.
- [ ] On glisse une capture d'écran et le modèle vision la décrit correctement.
- [ ] Un modèle de code produit et explique un programme ; le code s'affiche coloré et se copie en un clic.
- [ ] Changer de modèle se fait depuis l'interface, sans redémarrer l'app.
- [ ] Les conversations survivent à un redémarrage et le dossier de l'app se déplace sans rien casser.
- [ ] Un logiciel externe peut interroger l'API locale au format OpenAI.
- [ ] (Labo) HybridAgent-14B tourne en 4 bits sous 16 Go ; l'écart de qualité 4 bits / bf16 est mesuré.

### 7.8 Risques

| Risque | Impact | Parade |
|---|---|---|
| Modèle choisi trop lent ou trop gros pour la carte | Mauvaise expérience | Mesures au lot L0 ; préréglages selon la VRAM ; versions 8B en secours |
| Vision non supportée par certains modèles dans llama.cpp | F5 limitée | Choisir des modèles vision dont le `mmproj` est publié et testé |
| Bonsai incompatible avec le llama.cpp officiel | Pas de Bonsai dans l'app | Le garder dans le Labo avec le moteur fourni par PrismML |
| HybridAgent dégradé en 4 bits / lourd à installer | Labo limité | Labo optionnel (L7), référence bf16 avec déchargement en RAM |
| Évolution très rapide des modèles | Catalogue vite dépassé | Catalogue dans un fichier JSON mis à jour sans toucher au code |
| Code produit par l'IA exécuté sans contrôle | Sécurité du poste | L'app **n'exécute jamais** de code elle-même (sauf Labo, en bac à sable) |

### 7.9 Livrables

1. Dossier `app/` : application (backend Python + interface web) et catalogue de modèles.
2. Installeur ou script d'installation Windows + **guide pas à pas** pour débutant.
3. Fiche de mesures des modèles retenus (vitesse, VRAM, qualité).
4. (Option) Dossier `labo/` : HybridAgent 4 bits, Bonsai, démo NCM, avec leur rapport de test.

---

## 8. Recommandation

1. **Construire « ExpSoft Local AI »** sur llama.cpp avec des modèles généralistes : c'est utile tout de suite
   et ça sert de socle à l'IA dans les logiciels ExpSoft.
2. **HybridAgent, Bonsai et NCM vont dans le Labo** : on les teste, on mesure, on surveille.
3. **NCM** : à reconsidérer le jour où un NCM de plusieurs milliards de paramètres, capable de suivre des consignes,
   sera publié. Ce jour-là, il pourra être le vrai « LLM killer » de la vitesse.

---

### Sources

- [NCM — arXiv 2610.14162](https://arxiv.org/abs/2610.14162) · [code](https://github.com/HazyResearch/ncm) ·
  [blog Hazy Research](https://hazyresearch.stanford.edu/blog/2026-10-12-ncm) ·
  [annonce de H. Kumbong](https://x.com/KumbongHermann/status/2110437870481834432)
- [Hybrid Reasoning Agents — arXiv 2610.18861](https://arxiv.org/abs/2610.18861) ·
  [code](https://github.com/togethercomputer/HybridAgent) ·
  [modèle 8B](https://huggingface.co/togethercomputer/HybridAgent-8B-Agentic) ·
  [annonce de J. Zou](https://x.com/Jiaru_Zou/status/2110400256647340476)
- [Coconut — arXiv 2412.06769](https://arxiv.org/abs/2412.06769)
- [Google Research — Looking back at speculative decoding](https://research.google/blog/looking-back-at-speculative-decoding/)
- [OpenAI — Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)
- [Réponse de Peter Barnett](https://x.com/peterbarnett_/status/2110511460116005151) (non consultée)
- [Does Out-of-Sight Equal Out-of-Mind in CoT Monitorability? — arXiv 2608.04928](https://arxiv.org/pdf/2608.04928)
- [Monitoring Reasoning Models for Misbehavior — arXiv 2503.11926](https://arxiv.org/pdf/2503.11926)
- Bonsai : [PrismML — Announcing 1-bit Bonsai](https://prismml.com/news/bonsai-8b) ·
  [NYU Shanghai](https://rits.shanghai.nyu.edu/ai/prismmls-1-bit-bonsai-llms-8b-model-in-1-15-gb/) ·
  [getdeploying](https://getdeploying.com/guides/bonsai-1bit-llm)
- Strata : [SmartScope](https://smartscope.blog/en/blog/strata-local-llm-engine-qwen3-8-flash-next-2026/) ·
  [Strata vs llama.cpp (RTX 3060)](https://insiderllm.com/pdfs/strata-vs-llama-cpp-rtx-3060.pdf)
