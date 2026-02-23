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

app.consoleout("=== Démarrage certificat.jsx ===");
app.consoleout("Nom  : " + recipientName);
app.consoleout("Date : " + certDate);

try {
    // ── Ouverture du document ──────────────────────────────────────────────
    var inddFile = File("Commendation-mountains.indd");
    app.consoleout("Chemin du fichier : " + inddFile.fsName);
    app.consoleout("Fichier existe    : " + inddFile.exists);

    var doc = app.open(inddFile);
    app.consoleout("Document ouvert   : " + doc.name);

    // ── Remplacement de <<Nom>> ────────────────────────────────────────────
    app.findGrepPreferences  = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat   = "<<Nom>>";
    app.changeGrepPreferences.changeTo = recipientName;
    var foundNames = doc.changeGrep();
    app.consoleout("<<Nom>>  : " + foundNames.length + " remplacement(s)");

    // ── Remplacement de <<Date>> ───────────────────────────────────────────
    app.findGrepPreferences  = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat   = "<<Date>>";
    app.changeGrepPreferences.changeTo = certDate;
    var foundDates = doc.changeGrep();
    app.consoleout("<<Date>> : " + foundDates.length + " remplacement(s)");

    // ── Export PDF (sans dépendre d'un preset nommé) ──────────────────────
    var pdfFile = new File("certificat.pdf");

    // Chercher un preset disponible, sinon utiliser les préférences par défaut
    var presetNames = ["[High Quality Print]", "[Press Quality]",
                       "[PDF/X-4:2008]", "[PDF/X-1a:2001]", "[Smallest File Size]"];
    var pdfPreset = null;
    for (var i = 0; i < presetNames.length; i++) {
        var candidate = app.pdfExportPresets.item(presetNames[i]);
        if (candidate.isValid) {
            pdfPreset = candidate;
            app.consoleout("Preset PDF utilisé : " + presetNames[i]);
            break;
        }
    }

    if (pdfPreset) {
        doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, pdfPreset);
    } else {
        // Fallback : export avec les préférences courantes (pas de preset nommé)
        app.consoleout("Aucun preset trouvé, export avec préférences par défaut.");
        doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
    }

    app.consoleout("PDF exporté : " + pdfFile.fsName);
    app.consoleout("PDF existe  : " + pdfFile.exists);

    // ── Vérification CRITIQUE : le PDF doit exister ───────────────────────
    // Si l'export a échoué silencieusement, on lève une erreur explicite
    // pour que RunScript marque le job comme "failed" (au lieu de "success")
    if (!pdfFile.exists) {
        throw new Error("EXPORT ÉCHOUÉ : certificat.pdf n'existe pas après doc.exportFile(). Vérifiez les polices, l'image liée et les presets PDF.");
    }

    // ── Fermeture sans sauvegarde ─────────────────────────────────────────
    doc.close(SaveOptions.NO);
    app.consoleout("=== Script terminé avec succès ===");

} catch (error) {
    app.consoleout("ERREUR : " + error.toString());
    app.consoleout("Ligne  : " + error.line);
    throw error;
}
