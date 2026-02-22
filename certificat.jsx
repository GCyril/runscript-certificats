// certificat.jsx — Script InDesign pour générer le certificat (2 champs)
// Champs : <<Nom>> et <<Date>>
#target indesign

// ── Récupération des arguments ──────────────────────────────────────────────
var recipientName = "";
var certDate      = "";

if (app.scriptArgs.isDefined("Nom")) {
    recipientName = app.scriptArgs.getValue("Nom");
}
if (app.scriptArgs.isDefined("Date")) {
    certDate = app.scriptArgs.getValue("Date");
}

$.writeln("=== Démarrage du script certificat.jsx ===");
$.writeln("Nom  : " + recipientName);
$.writeln("Date : " + certDate);

try {
    // ── Ouverture du document ──────────────────────────────────────────────
    var doc = app.open(File("Commendation-mountains.indd"));
    $.writeln("✅ Document ouvert : " + doc.name);

    // ── Remplacement de <<Nom>> ────────────────────────────────────────────
    app.findGrepPreferences  = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;

    app.findGrepPreferences.findWhat   = "<<Nom>>";
    app.changeGrepPreferences.changeTo = recipientName;
    var foundNames = doc.changeGrep();
    $.writeln("✅ <<Nom>>  → " + recipientName + "  (" + foundNames.length + " remplacement(s))");

    // ── Remplacement de <<Date>> ───────────────────────────────────────────
    app.findGrepPreferences  = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;

    app.findGrepPreferences.findWhat   = "<<Date>>";
    app.changeGrepPreferences.changeTo = certDate;
    var foundDates = doc.changeGrep();
    $.writeln("✅ <<Date>> → " + certDate + "  (" + foundDates.length + " remplacement(s))");

    // ── Export PDF ────────────────────────────────────────────────────────
    var pdfPreset = app.pdfExportPresets.item("[High Quality Print]");
    if (!pdfPreset.isValid) {
        pdfPreset = app.pdfExportPresets.item("[Press Quality]");
        $.writeln("⚠️  Préréglage '[High Quality Print]' introuvable → utilisation de '[Press Quality]'");
    }

    var pdfFile = new File("certificat.pdf");
    doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, pdfPreset);
    $.writeln("✅ PDF exporté : " + pdfFile.fsName);

    // ── Fermeture sans sauvegarde ─────────────────────────────────────────
    doc.close(SaveOptions.NO);
    $.writeln("✅ Document fermé. Script terminé avec succès.");

} catch (error) {
    $.writeln("❌ Erreur dans certificat.jsx : " + error.toString());
    // Le throw indique à RunScript de marquer le job comme "failed"
    throw error;
}
