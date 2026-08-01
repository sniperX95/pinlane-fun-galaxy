import { Config } from '@remotion/cli/config';

// LES REGLAGES DE RENDU, CHACUN MESURE.
//
// Protocole : on rend l'image 240 (un carton charge en texte bleu sur fond
// clair, le cas le plus exigeant du film), on la compare a une verite terrain
// obtenue en rendant a 3x puis en reduisant, et on lit le SSIM. Refaire ce
// protocole avant de changer une de ces valeurs.

// PNG ET NON JPEG POUR LES IMAGES INTERMEDIAIRES.
//
// C'etait `jpeg`, donc chaque image passait par une quantification JPEG AVANT
// l'encodage video : deux pertes au lieu d'une. Mesure sur 40 images :
//
//   jpeg   SSIM 0,9832   PSNR 39,15 dB   7,78 Mo
//   png    SSIM 0,9926   PSNR 42,28 dB   7,43 Mo
//
// PNG gagne 3,1 dB ET produit un fichier PLUS PETIT : le bruit de quantification
// du JPEG devait ensuite etre encode par H.264. Le seul cout est le disque
// temporaire pendant le rendu.
Config.setVideoImageFormat('png');

// SUR-ECHANTILLONNAGE 2x, PUIS REDUCTION A LA LIVRAISON.
//
// Un rendu direct en 1920 crenelle les traits fins et les bords de texte. Mesure
// de fidelite contre la verite terrain :
//
//   rendu direct 1920        SSIM 0,99441
//   rendu 3840 puis reduit   SSIM 0,99649   (37 % d'erreur en moins)
//
// Le cout est bien inferieur a ce que la surface laisse croire : 16 s contre
// 10 s pour 40 images, soit 1,6x et non 4x, parce que le goulot n'est pas le
// remplissage de pixels.
//
// La reduction se fait a l'encodage final, en lanczos.
Config.setScale(2);

Config.setOverwriteOutput(true);

// `angle` et non `swiftshader` : le rendu logiciel change le resultat des
// filtres CSS (flou, ombres) et il est plus lent.
Config.setChromiumOpenGlRenderer('angle');

// 22 coeurs sur cette machine. Au-dela de ~8 le gain se tasse et la memoire
// devient le facteur limitant : en 2x, chaque onglet Chromium porte une page de
// 3840x2160.
Config.setConcurrency(8);
