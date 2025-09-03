// eotm.jsx - Script InDesign pour générer le certificat
#target indesign

// Récupérer le nom passé en argument
var recipientName = "";
if (app.scriptArgs.isDefined("Name")) {
    recipientName = app.scriptArgs.getValue("Name");
}
$.writeln("✅ Nom du destinataire reçu: " + recipientName);

try {
    // Ouvrir le document InDesign
    var doc = app.open(File("eotm.indd"));
    $.writeln("✅ Document InDesign ouvert: " + doc.name);

    // Rechercher et remplacer le placeholder
    app.findGrepPreferences = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;
    
    app.findGrepPreferences.findWhat = "<<Name>>";
    app.changeGrepPreferences.changeTo = recipientName;
    var foundItems = doc.changeGrep();
    $.writeln("✅ Placeholder remplacé. Nombre de remplacements: " + foundItems.length);

    // Exporter en PDF
    var pdfPreset = app.pdfExportPresets.item("[High Quality Print]");
    if (!pdfPreset.isValid) {
        pdfPreset = app.pdfExportPresets.item("[Press Quality]");
        $.writeln("⚠️ Préréglage PDF '[High Quality Print]' non trouvé, utilisation de '[Press Quality]' à la place.");
    }
    
    var pdfFile = new File("certificate.pdf");
    doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, pdfPreset);
    $.writeln("✅ Fichier PDF exporté avec succès sous: " + pdfFile.fsName);
    
    // Fermer sans sauvegarder
    doc.close(SaveOptions.NO);
    $.writeln("✅ Document fermé.");
    
} catch (error) {
    $.writeln("❌ Erreur dans le script JSX: " + error.toString());
    // Le throw est important pour que Typefi marque le job comme "failed"
    throw error;
}
