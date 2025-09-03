// Importation des modules nécessaires
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises; // Utilisation de la version basée sur les promesses pour un code plus propre

// Fonction principale asynchrone pour générer le certificat
async function createCertificate() {
  try {
    // Création d'un nouveau document PDF
    const pdfDoc = await PDFDocument.create();

    // Ajout d'une page au document
    const page = pdfDoc.addPage([600, 400]);

    // Définition de la police et de la taille du texte
    const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontSize = 30;

    // Définition des dimensions de la page
    const { width, height } = page.getSize();

    // Texte à afficher sur le certificat
    const certificateTitle = 'Certificat de Réussite';
    const studentName = 'Nom de l\'Étudiant';
    const completionText = 'Pour avoir terminé le cours avec succès.';

    // Calcul de la position du titre pour le centrer horizontalement
    const textWidth = helveticaBoldFont.widthOfTextAtSize(certificateTitle, fontSize);
    const textX = (width - textWidth) / 2;

    // Dessin du titre sur la page
    page.drawText(certificateTitle, {
      x: textX,
      y: height - 100,
      size: fontSize,
      font: helveticaBoldFont,
      color: rgb(0, 0.53, 0.71), // Couleur bleue
    });

    // Dessin des autres textes
    page.drawText(studentName, {
      x: (width - helveticaBoldFont.widthOfTextAtSize(studentName, 20)) / 2,
      y: height - 200,
      size: 20,
      font: helveticaBoldFont,
    });

    page.drawText(completionText, {
      x: (width - helveticaBoldFont.widthOfTextAtSize(completionText, 15)) / 2,
      y: height - 250,
      size: 15,
      font: helveticaBoldFont,
      color: rgb(0.2, 0.2, 0.2), // Couleur gris foncé
    });

    // Enregistrement du PDF sous forme de tableau de bytes
    const pdfBytes = await pdfDoc.save();

    // Écriture du fichier sur le disque
    await fs.writeFile('certificat.pdf', pdfBytes);

    console.log('Certificat généré avec succès ! Le fichier "certificat.pdf" a été créé.');

  } catch (error) {
    console.error('Erreur lors de la génération du certificat :', error);
  }
}

// Appel de la fonction pour démarrer le script
createCertificate();