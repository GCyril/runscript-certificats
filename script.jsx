var recipientName = "";
if (app.scriptArgs.isDefined("Name")) {
    recipientName = app.scriptArgs.getValue("Name");
}
$.writeln("✅ Nom du destinataire reçu: " + recipientName);

try {
    // Ouvrir le document InDesign
    var doc = app.open(File("eotm.indd"));
    $.writeln("✅ Document InDesign ouvert: " + doc.name);
    for (var i = 0; i < doc.links.length; i++) {
    var link = doc.links[i];
    link.update(); // ensures InDesign uses the full file, not preview
}

    // Rechercher et remplacer le placeholder
    app.findGrepPreferences = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;

    app.findGrepPreferences.findWhat = "<<Name>>";
    app.changeGrepPreferences.changeTo = recipientName;
    var foundItems = doc.changeGrep();
    $.writeln("✅ Placeholder remplacé. Nombre de remplacements: " + foundItems.length);

    // Exporter avec preset correct
    doc.exportFile(
        ExportFormat.PDF_TYPE,
        new File("certificate.pdf"),
        app.pdfExportPresets.itemByName('[High Quality Print]')
    );
    $.writeln("✅ PDF exporté avec succès.");

    // Fermer sans sauvegarder
    doc.close(SaveOptions.NO);
    $.writeln("✅ Document fermé.");

} catch (error) {
    $.writeln("❌ Erreur dans le script JSX: " + error.toString());
    throw error;
}
