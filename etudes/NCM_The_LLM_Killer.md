# NCM: The LLM Killer?

**Étude + cahier des charges — banc d'essai local NCM & HybridAgent**
ExpSoft · Nicolas Riquier · octobre 2026

> **Question posée :** est-ce que ça marche, et peut-on déjà utiliser ces modèles en local
> sur une machine **16 Go de VRAM + 64 Go de RAM** ?
>
> **Réponse courte :**
> - **NCM** : oui, ça tourne sans problème sur ta machine (modèles minuscules), mais **ce n'est pas
>   (encore) un « LLM killer »** : ce sont des prototypes de recherche spécialisés (histoires courtes,
>   résumés, traduction, Sudoku), pas un assistant utilisable. On parle d'un concept prometteur, pas d'un produit.
> - **HybridAgent** : c'est la partie **vraiment utilisable** (agent 8B/14B basé sur Qwen3 qui
>   « pense » en latent et agit en texte). Il tient sur 16 Go de VRAM **à condition de le quantifier
>   en 4 bits** (petite modification du code fourni). Pas compatible Ollama / LM Studio / llama.cpp.

---

## 1. Les sources étudiées

| Source | Ce que c'est | Statut de lecture |
|---|---|---|
| [NCM, arXiv 2610.14162](https://arxiv.org/abs/2610.14162) | Article Hazy Research (Stanford), 9 oct. 2026 | Résumé via moteur de recherche (arXiv bloqué depuis mon environnement) |
| [HazyResearch/ncm](https://github.com/HazyResearch/ncm) | Code + liens vers les modèles | **Code lu et analysé** |
| [Hybrid Reasoning Agents, arXiv 2610.18861](https://arxiv.org/abs/2610.18861) | Article Stanford + Together AI | Résumé via moteur de recherche |
| [togethercomputer/HybridAgent](https://github.com/togethercomputer/HybridAgent) | Code + liens vers les modèles | **Code lu et analysé** |
| [Coconut, arXiv 2412.06769](https://arxiv.org/abs/2412.06769) | Meta FAIR, 2024 : raisonner dans l'espace latent | Connaissance préalable |
| [Google Research — speculative decoding](https://research.google/blog/looking-back-at-speculative-decoding/) | Rétrospective sur le décodage spéculatif | Connaissance préalable (site bloqué) |
| [OpenAI — reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) | Les « reasoning tokens » des modèles o-series / GPT-5 | Connaissance préalable |
| Annonce de Jiaru Zou / réponse de Peter Barnett (X) | Discussion autour de HybridAgent | Non accessible (X bloqué) |

⚠️ **Limites de cette étude** : depuis l'environnement cloud, arxiv.org, huggingface.co et x.com
étaient injoignables. Les chiffres de performance viennent **des auteurs eux-mêmes**
(README, graphiques du dépôt, résumés relayés) et **n'ont pas été reproduits**. Je n'ai pas pu
télécharger les poids ni lancer les modèles (pas de GPU dans le conteneur). Ce qui est affirmé sur la
taille des modèles et la façon de les charger vient en revanche de **la lecture directe du code**.

---

## 2. Le problème commun : générer token par token, c'est lent

Un LLM classique (GPT, Llama, Qwen, Claude…) est **autorégressif** : il produit **un token à la fois**,
et chaque token demande un passage complet dans le réseau. 1 000 tokens = 1 000 passages.
Les modèles « qui réfléchissent » (OpenAI o-series, DeepSeek-R1, Qwen3 thinking…) aggravent le problème :
ils écrivent des milliers de **tokens de raisonnement** avant de répondre, tokens qui sont facturés
et qui prennent du temps (c'est le sujet du guide *reasoning* d'OpenAI).

Trois familles de solutions, que tes liens couvrent :

| Approche | Idée | Exemple |
|---|---|---|
| **Décodage spéculatif** | Un petit modèle devine plusieurs tokens, le gros les valide d'un coup. Même résultat, 2–3× plus rapide. | Rétrospective Google ; déjà dans vLLM, llama.cpp, etc. |
| **Génération parallèle** | Ne plus générer de gauche à droite : produire tout le texte en quelques étapes. | Modèles de diffusion (MDLM, LLaDA…), et **NCM** |
| **Raisonnement latent** | Réfléchir avec des vecteurs internes plutôt qu'avec des mots écrits. | **Coconut** (Meta), puis **HybridAgent** |

---

## 3. NCM — Next-Concept Modeling

### 3.1 Le principe

![Comparaison NTP / diffusion / NCM](https://raw.githubusercontent.com/HazyResearch/ncm/main/assets/overview.png)

1. Un **tokenizer VQ multi-échelle** (un VQ-VAE) compresse une phrase en une **hiérarchie de codes** :
   niveau 1 = 1 code qui résume tout le texte (« l'idée »), niveau 2 = quelques codes, … dernier niveau = un code par token.
2. Un transformer prédit cette hiérarchie **du grossier au fin**. **Toutes les positions d'un niveau sont prédites
   en parallèle** → il faut **un passage par niveau**, soit 9 à 31 passages selon les modèles publiés,
   au lieu d'un passage par token.
3. Le dernier niveau est décodé en texte.

C'est l'équivalent pour le texte de ce que fait VAR (*next-scale prediction*) pour les images :
on esquisse, puis on affine. D'où le nom « next-**concept** » : le modèle pose d'abord le sens, puis les mots.

### 3.2 Résultats annoncés par les auteurs

![Qualité vs temps](https://raw.githubusercontent.com/HazyResearch/ncm/main/assets/quality_speed.png)

- **LM1B** : meilleure perplexité générative que les modèles de diffusion, **21× plus rapide** que la meilleure diffusion.
- **XSum** (résumé) : ROUGE-L ≈ 28, au niveau des meilleurs modèles de diffusion, **31× plus rapide**.
- **Sudoku difficile** : **86,1 %** de grilles résolues en 12 passages, contre 1 % pour un modèle autorégressif
  en 128 passages, 58 % pour la meilleure diffusion « classique » (DUO) et 81 % pour le meilleur concurrent (FMLM+, 16 passages).
- Entraînement annoncé sur **4–5× moins de tokens** que les modèles de diffusion comparés.

### 3.3 Ce qui est réellement publié (vérifié dans le code)

| Modèle | Couches × largeur | Paramètres (estimés) | Longueur max | Usage |
|---|---|---|---|---|
| Sudoku easy/medium/hard | 8 × 512 | ~25 M | 81 cases | Résoudre des Sudoku |
| TinyStories | 12 × 768 | ~85 M | 128 tokens | Petites histoires pour enfants |
| XSum | 12 × 768 | ~85 M | 48 tokens de résumé | Résumé d'articles BBC |
| WMT14 De→En | 12 × 768 | ~85 M | 64 tokens | Traduction allemand → anglais |
| LM1B small / medium / large | 12×768 / 24×1024 / 36×1280 | ~85 M / ~300 M / **~700 M** | 128 tokens | Phrases isolées (tokenizer BERT, minuscules) |
| OpenWebText | 16 × 1024 | ~200 M | 1 024 tokens | Texte web générique |

(Estimation : 12 × couches × largeur², hors embeddings.)

### 3.4 Alors, « LLM killer » ?

**Non, pas aujourd'hui. Peut-être un jour.**

- ✅ **L'idée est solide et élégante** : quelques passages au lieu de milliers, et un vrai gain de raisonnement
  sur des problèmes à contraintes globales (Sudoku) où la génération gauche → droite échoue.
- ❌ **La comparaison est faite contre les modèles de diffusion**, pas contre des LLM autorégressifs de même taille
  sur le texte libre. Or les modèles de diffusion de cette taille sont eux-mêmes en retrait par rapport aux
  autorégressifs : battre la diffusion ne veut pas dire battre les LLM.
- ❌ **Échelle minuscule** : le plus gros modèle fait ~0,7 milliard de paramètres. Les LLM actuels font de 8 à des
  centaines de milliards. Personne ne sait encore si NCM garde son avantage à grande échelle.
- ❌ **Longueur fixe et courte** (48 à 1 024 tokens) : pas de conversation, pas de long document, pas de code.
- ❌ **Aucun modèle chat / instruction**, aucune intégration (transformers, vLLM, Ollama…).
  Le dépôt ne contient qu'un script d'**évaluation** des benchmarks du papier.

> **Verdict NCM** : un résultat de recherche à suivre de très près, qui peut devenir une brique majeure
> si quelqu'un l'entraîne à l'échelle d'un vrai LLM. Pour ExpSoft aujourd'hui : **objet d'expérimentation et de
> veille**, pas un moteur à intégrer dans un logiciel.

---

## 4. HybridAgent — penser en latent, agir en texte

### 4.1 Le principe

- Base : **Qwen3-8B** ou **Qwen3-14B**.
- Un petit module, **HybridLink** (≈ 34 M de paramètres pour le 8B, deux couches linéaires + normalisations),
  renvoie le **dernier état caché** du modèle directement en **entrée** du pas suivant, au lieu de passer par un mot.
  C'est l'idée de **Coconut** (Meta, 2024), industrialisée.
- Le modèle **alterne de lui-même** : il ouvre un bloc `<latent>` pour réfléchir « en silence » (4 à 200 pas par défaut),
  puis revient au **texte** pour appeler des outils (**Python**, **recherche web Tavily**) et répondre.
- Entraînement en deux temps : **HybridSFT** (apprendre le mode latent) puis **HybridRL** (apprendre *quand* l'utiliser).
- Les pensées latentes peuvent être **relues en pseudo-texte** (module *Interpretable Latent Mode*, rapport HTML).

### 4.2 Résultats annoncés

Sur 11 benchmarks et trois tailles de modèles, d'après le résumé de l'article :
**+10,4 %** de performance moyenne par rapport à des agents de pointe,
**35–55 % de tokens en moins**, **1,8–2,6× plus rapide**, **2,7–3,7× moins cher**.

### 4.3 La question de la transparence

La critique récurrente (dont, vraisemblablement, la réponse de Peter Barnett, que je n'ai pas pu lire) :
**un raisonnement en vecteurs ne se lit plus**. Aujourd'hui, on peut surveiller ce qu'un modèle « pense » en lisant
sa chaîne de raisonnement. Avec un raisonnement latent, ce contrôle disparaît en partie. La lecture en pseudo-texte
proposée par les auteurs est une **approximation**, pas une garantie. Pour un usage pro, c'est un vrai sujet.

---

## 5. Faisabilité sur ta machine (16 Go VRAM / 64 Go RAM)

| | NCM | HybridAgent-8B | HybridAgent-14B |
|---|---|---|---|
| Taille des poids (bf16) | < 1,5 Go | **~16,4 Go** | **~29,5 Go** |
| Tient en VRAM tel quel ? | ✅ Oui, largement | ❌ Non (le code charge tout en bf16 sur le GPU) | ❌ Non |
| En 8 bits | — | ✅ ~9 Go | ❌ ~16 Go, trop juste |
| En 4 bits (NF4) | — | ✅ ~6 Go | ✅ **~9–10 Go** |
| Déchargement en RAM (64 Go) | — | ✅ Fonctionne, mais lent | ✅ Fonctionne, très lent |
| Ollama / LM Studio / llama.cpp | ❌ | ❌ (boucle latente non supportée) | ❌ |
| Système | Linux idéal ; Windows probable (PyTorch pur) | Linux idéal ; Windows possible (PyTorch cu128 + bitsandbytes) | idem |
| Clé API nécessaire | Non | Tavily pour la recherche web (sinon outil désactivé) | idem |
| Utilité concrète | Démo / recherche | **Agent de raisonnement maths + recherche** | idem, meilleur |

**Ce qu'il faut modifier pour HybridAgent** : le chargeur (`hybrid_agent/model.py`) appelle
`AutoModelForCausalLM.from_pretrained(..., dtype=bfloat16)` puis `model.to(device)`.
Il faut lui passer une configuration 4 bits et ne plus déplacer le modèle à la main :

```python
from transformers import AutoModelForCausalLM, BitsAndBytesConfig

bnb = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
)
backbone = AutoModelForCausalLM.from_pretrained(
    local, quantization_config=bnb, device_map={"": 0}
)
# HybridLink reste en bf16 et doit être envoyé sur le GPU séparément.
```

**Risque à mesurer** : la boucle latente réinjecte les états cachés pas après pas. L'erreur due à la
quantification peut s'y accumuler. Personne n'a publié de mesure là-dessus : c'est justement ce que le banc
d'essai ci-dessous doit vérifier.

---

## 6. Cahier des charges — Banc d'essai local « NCM / HybridAgent »

### 6.1 Objectif

Disposer sur le poste de développement ExpSoft d'un **banc d'essai reproductible** permettant de :
1. faire tourner les modèles NCM publiés et **constater** leur vitesse et leurs limites ;
2. faire tourner **HybridAgent-8B et 14B en 4 bits** sur 16 Go de VRAM ;
3. **mesurer** si la quantification dégrade le raisonnement latent ;
4. décider, chiffres à l'appui, si une de ces technologies mérite d'être intégrée dans un logiciel ExpSoft.

### 6.2 Périmètre

| Inclus | Exclu |
|---|---|
| Inférence locale (pas d'entraînement) | Ré-entraînement HybridSFT / HybridRL (32 GPU requis) |
| NCM : TinyStories, XSum, WMT14, Sudoku, LM1B, OWT | Entraîner un NCM à grande échelle |
| HybridAgent 8B et 14B, quantifiés 4 bits et 8 bits | Déploiement serveur / multi-utilisateur |
| Outil Python **en bac à sable**, recherche web optionnelle | Intégration dans un produit (phase suivante) |
| Comparaison avec un Qwen3-8B/14B « normal » (Ollama ou transformers) | |

### 6.3 Environnement cible

- **GPU** : 16 Go de VRAM (NVIDIA, CUDA 12.8). **RAM** : 64 Go. **Disque** : ≥ 80 Go libres
  (poids 8B + 14B + modèles de comparaison + datasets).
- **OS** : Linux (Ubuntu 24.04) recommandé, ou **WSL2** sous Windows. Windows natif en option, à valider.
- **Python 3.11**, `torch==2.11.0` (cu128), `transformers` aux versions figées par chaque dépôt,
  `bitsandbytes` pour la quantification.
- **Deux environnements séparés** (conda ou venv) : un pour NCM, un pour HybridAgent, leurs dépendances étant différentes.

### 6.4 Exigences fonctionnelles

| ID | Exigence | Priorité |
|---|---|---|
| F1 | Script d'installation unique par projet (création d'environnement, dépendances, téléchargement des poids) | Haute |
| F2 | NCM : lancer l'évaluation officielle de chaque tâche avec `evaluate.py` sur 1 GPU | Haute |
| F3 | NCM : petit script de **démo interactive** (TinyStories / traduction), avec affichage niveau par niveau, du grossier au fin | Moyenne |
| F4 | HybridAgent : chargeur **4 bits / 8 bits / bf16 + déchargement en RAM** sélectionnable par option | Haute |
| F5 | HybridAgent : exécuter `examples/questions.jsonl` et un jeu maison de 20 questions (maths + recherche) | Haute |
| F6 | HybridAgent : générer le **rapport HTML** des pensées latentes pour chaque question | Moyenne |
| F7 | Outil Python exécuté dans un **bac à sable** (conteneur ou utilisateur restreint, sans réseau) | **Haute (sécurité)** |
| F8 | Recherche web activable/désactivable (clé Tavily dans `.env`, jamais commitée) | Moyenne |
| F9 | Comparaison avec le même Qwen3 de base en mode « thinking » texte classique, sur les mêmes questions | Haute |

### 6.5 Mesures à produire

| Mesure | NCM | HybridAgent |
|---|---|---|
| Temps de génération (s) et tokens/s | ✔ | ✔ |
| VRAM max utilisée | ✔ | ✔ |
| Qualité : métriques officielles (ROUGE, BLEU, % Sudoku, perplexité) | ✔ | — |
| Qualité : % de bonnes réponses (exact match / math-verify) | — | ✔ |
| Pas latents et tokens texte par question | — | ✔ |
| Écart de qualité entre bf16 (déchargement en RAM), 8 bits et 4 bits | — | ✔ **(question clé)** |
| Écart avec Qwen3 « thinking » classique (temps, tokens, justesse) | — | ✔ |

### 6.6 Lots et planning indicatif

| Lot | Contenu | Durée estimée |
|---|---|---|
| L0 | Préparation du poste : pilotes, CUDA, WSL2/Linux, environnements | 0,5 j |
| L1 | NCM : installation, téléchargement, évaluations officielles, démo niveau par niveau | 1 j |
| L2 | HybridAgent : patch du chargeur 4/8 bits, bac à sable Python, premiers essais 8B | 1,5 j |
| L3 | HybridAgent 14B en 4 bits + comparaison bf16 avec déchargement en RAM | 1 j |
| L4 | Comparaison avec Qwen3 thinking classique | 0,5 j |
| L5 | Rapport de résultats + recommandation pour ExpSoft | 0,5 j |
| | **Total** | **≈ 5 jours** |

### 6.7 Critères d'acceptation

- [ ] Les évaluations NCM tournent sur la machine et retrouvent les ordres de grandeur annoncés (± 10 %).
- [ ] HybridAgent-8B **et** 14B tournent en 4 bits sous 16 Go de VRAM sans erreur de mémoire.
- [ ] Le tableau qualité / vitesse / VRAM est rempli pour chaque configuration.
- [ ] L'outil Python ne peut ni accéder au réseau ni écrire hors de son dossier de travail.
- [ ] Une recommandation claire : « intégrer », « surveiller » ou « abandonner », pour chaque technologie.

### 6.8 Risques

| Risque | Impact | Parade |
|---|---|---|
| La quantification 4 bits dégrade fortement la boucle latente | HybridAgent inutilisable en local | Tester 8 bits sur le 8B ; bf16 avec déchargement en RAM comme référence |
| Versions figées (`transformers 5.13`, `torch 2.11`) incompatibles avec bitsandbytes | Blocage de L2 | Environnement dédié ; ajuster les versions de bitsandbytes |
| Windows natif mal supporté | Perte de temps | Passer par WSL2 d'emblée |
| Code exécuté par l'agent (outil Python) dangereux | Sécurité du poste | Bac à sable obligatoire (F7) |
| NCM ne dépasse jamais le stade de la recherche | Pas d'usage produit | Positionnement « veille », coût limité à 1 jour |
| Chiffres des auteurs non reproductibles | Mauvaise décision | Mesures maison (6.5) avant toute décision |

### 6.9 Livrables

1. Scripts d'installation et de lancement (dossier `bench/` de ce dépôt).
2. Patch de chargement quantifié pour HybridAgent.
3. Rapport de mesures (tableaux + rapports HTML des pensées latentes).
4. Note de recommandation pour ExpSoft.

---

## 7. Recommandation

1. **NCM** : un jour de test pour voir la génération du grossier au fin de ses propres yeux, puis **veille**.
   À reconsidérer le jour où un NCM de plusieurs milliards de paramètres, de type « instruct », sera publié.
2. **HybridAgent** : **c'est lui qui mérite le banc d'essai.** Le 14B en 4 bits sur 16 Go est l'option la plus
   intéressante pour un agent local maths + recherche + Python. Point à trancher : la qualité après quantification.
3. **À court terme**, pour accélérer un LLM local dès aujourd'hui sans recherche : le **décodage spéculatif**
   (déjà intégré dans llama.cpp, vLLM, LM Studio) reste le gain le plus sûr et le plus simple.

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
