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

// ── Mode serveur : supprimer TOUS les dialogues InDesign ──────────────────
// Sans ça, une alerte "lien manquant" ou "police manquante" bloque le serveur
// et l'export échoue silencieusement sans lancer d'exception catchable.
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

try {
    // ── Ouverture du document ──────────────────────────────────────────────
    var inddFile = File("Commendation-mountains.indd");
    app.consoleout("Chemin du fichier : " + inddFile.fsName);
    app.consoleout("Fichier existe    : " + inddFile.exists);

    var doc = app.open(inddFile);
    app.consoleout("Document ouvert   : " + doc.name);

    // ── Relink de tous les assets depuis le dossier de travail RunScript ──
    // RunScript place le .indd et tous les assets dans le même dossier.
    // InDesign cherche d'abord au chemin d'origine (Mac local) → introuvable.
    // On force le relink vers le dossier du .indd sur le serveur.
    var docFolder = File(doc.fullName).parent;
    app.consoleout("Dossier de travail : " + docFolder.fsName);
    app.consoleout("Nombre de liens    : " + doc.links.length);

    for (var i = 0; i < doc.links.length; i++) {
        var lien = doc.links[i];
        var linkedFile = new File(docFolder.fsName + "/" + lien.name);
        app.consoleout("Lien [" + i + "] : " + lien.name
            + " | status=" + lien.status
            + " | fichier local existe=" + linkedFile.exists);
        if (linkedFile.exists) {
            try {
                lien.relink(linkedFile);
                lien.update();
                app.consoleout("  → Relié avec succès");
            } catch (relinkErr) {
                app.consoleout("  → Erreur relink : " + relinkErr.toString());
            }
        } else {
            app.consoleout("  → Fichier introuvable dans le dossier de travail");
        }
    }

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

    // ── Export PDF ────────────────────────────────────────────────────────
    // IMPORTANT : chemin ABSOLU dérivé du dossier du .indd (= dossier de travail
    // RunScript). new File("certificat.pdf") relatif se résoudrait par rapport
    // au répertoire courant d'InDesign — pas forcément le bon.
    var pdfFile = new File(docFolder.fsName + "/certificat.pdf");
    app.consoleout("PDF cible : " + pdfFile.fsName);

    // Désactiver l'ouverture automatique du PDF après export (bloquerait le serveur)
    app.pdfExportPreferences.viewDocumentAfterExport = false;

    // Chercher un preset disponible, sinon utiliser les préférences par défaut
    var presetNames = ["[High Quality Print]", "[Press Quality]",
                       "[PDF/X-4:2008]", "[PDF/X-1a:2001]", "[Smallest File Size]"];
    var pdfPreset = null;
    for (var j = 0; j < presetNames.length; j++) {
        var candidate = app.pdfExportPresets.item(presetNames[j]);
        if (candidate.isValid) {
            pdfPreset = candidate;
            app.consoleout("Preset PDF utilisé : " + presetNames[j]);
            break;
        }
    }

    if (pdfPreset) {
        doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, pdfPreset);
    } else {
        app.consoleout("Aucun preset trouvé — export avec préférences courantes.");
        doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
    }

    app.consoleout("PDF exporté : " + pdfFile.fsName);
    app.consoleout("PDF existe  : " + pdfFile.exists);

    // ── Vérification CRITIQUE : le PDF doit exister ───────────────────────
    if (!pdfFile.exists) {
        throw new Error("EXPORT ÉCHOUÉ : " + pdfFile.fsName
            + " n'existe pas après doc.exportFile()."
            + " Vérifiez les polices, l'image liée et les presets PDF.");
    }

    // ── Fermeture sans sauvegarde ─────────────────────────────────────────
    doc.close(SaveOptions.NO);
    app.consoleout("=== Script terminé avec succès ===");

} catch (error) {
    app.consoleout("ERREUR : " + error.toString());
    app.consoleout("Ligne  : " + error.line);
    throw error;
}
