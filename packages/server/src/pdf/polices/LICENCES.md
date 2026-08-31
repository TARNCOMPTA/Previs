# Polices incorporées au dossier PDF

Le PDF est imprimé par Chromium **sans aucun accès réseau** : ni police distante, ni image
distante. Une police appelée depuis le réseau ne serait donc jamais chargée, et le document
retomberait sur ce que le serveur a en magasin — sur un VPS minimal, une seule famille sans
caractère. Les fichiers sont donc versionnés ici et incorporés en base64 dans le document.

Seul le sous-ensemble **latin** de chaque famille est retenu. Il couvre tout le français
comptable : accents, `Œ œ`, `€`, guillemets français, apostrophe typographique, tirets,
`° % ± ² ³` et l'espace insécable. Deux caractères en sont absents : `≈` et l'espace **fine** insécable (U+202F).

Le second mérite une explication, car `formaterMontant()` s'en sert comme séparateur de
milliers dans tout Previs (`packages/core/src/format.ts`). Chromium ne montre pas de carré
blanc — il retombe silencieusement sur une police du système — mais cette espace de secours
n'a pas l'avance de chasse fixe du monospace : dans une colonne de montants, les chiffres
cessent d'être alignés les uns sous les autres. Vérifié au rendu. Le document remplace donc
U+202F par l'espace insécable **ordinaire** U+00A0, présente dans les huit faces et alignée
sur la grille du monospace. Ce remplacement n'a lieu que dans le PDF : l'interface et le
moteur gardent l'espace fine, qui est la forme typographique juste à l'écran.

Deux caractères décoratifs de la maquette manquent également et sont à tracer en SVG plutôt
qu'à écrire : `▲` (U+25B2) et `→` (U+2192).

## Ce qui est versionné

| Fichier | Famille | Graisse | Emploi |
|---|---|---|---|
| `HankenGrotesk-400-latin.woff2` | Hanken Grotesk | 400 | texte courant, libellés, pied de page |
| `HankenGrotesk-600-latin.woff2` | Hanken Grotesk SemiBold | 600 | en-têtes de tableau, intertitres |
| `HankenGrotesk-700-latin.woff2` | Hanken Grotesk Bold | 700 | `strong` dans les paragraphes |
| `Spectral-400-latin.woff2` | Spectral | 400 | titre de couverture, titres de section |
| `Spectral-600-latin.woff2` | Spectral SemiBold | 600 | titres accentués |
| `IBMPlexMono-400-latin.woff2` | IBM Plex Mono | 400 | chiffres des tableaux |
| `IBMPlexMono-500-latin.woff2` | IBM Plex Mono Medium | 500 | chiffres des totaux |
| `IBMPlexMono-600-latin.woff2` | IBM Plex Mono SemiBold | 600 | chiffres des lignes de résultat |

Les trois faces de Hanken Grotesk sont des **instances statiques** du fichier variable
d'origine (`hanken-grotesk` 3.013, axe `wght` de 100 à 900), découpées par
`fontTools.varLib.instancer` : mêmes contours, mêmes métriques, mêmes 268 glyphes.

Un fichier variable unique aurait évité d'en versionner trois, et c'est ce que faisait la
version précédente. Mais **Chromium ne sait pas incorporer une police variable dans un
PDF** : il dessine chaque glyphe en Type3, une procédure de tracé par caractère. Le dossier
pesait 337 Ko au lieu de 162, avec quinze polices Type3 là où il en faut sept. Mesuré, sur
les trois régimes et de un à dix exercices. Ne jamais remettre de fichier variable ici : le
contrôle est dans `engendrer.mjs`, qui refuse un fichier non déclaré, et la conséquence se
voit dans la taille du document.

## Mentions de droits

Relevées dans la table `name` des fichiers eux-mêmes, non recopiées d'ailleurs :

- **Hanken Grotesk** — Copyright 2021 The Hanken Grotesk Project Authors
  (https://github.com/marcologous/hanken-grotesk), version 3.013
- **Spectral** — Copyright 2017 The Spectral Project Authors
  (https://github.com/productiontype/Spectral), version 2.005
- **IBM Plex Mono** — Copyright 2017 IBM Corp. All rights reserved, version 2.3

Ces trois familles sont publiées sous **SIL Open Font License 1.1**, qui autorise
l'incorporation dans un document et la redistribution des fichiers. Le texte de la licence
n'est pas embarqué dans les fichiers `woff2` : se référer au dépôt de chaque projet, cité
ci-dessus, et à https://openfontlicense.org.

## Provenance et remplacement

Les fichiers proviennent des sous-ensembles Google Fonts embarqués dans la maquette
graphique fournie par le cabinet. Pour en changer, remplacer le `woff2` puis régénérer le
module qui les porte en base64 :

```bash
node packages/server/src/pdf/polices/engendrer.mjs
```
