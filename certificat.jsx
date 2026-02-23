// certificat.jsx — Script InDesign pour générer le certificat (2 champs)
// Champs : <<Nom>> et <<Date>>
// NOTE : pas de directive #target ici — le script tourne déjà dans InDesign Server
// via l'API RunScript. #target indesign provoque un conflit (recommandation Typefi).

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
app.consoleout("InDesign version : " + app.version);

// ── Mode serveur : supprimer TOUS les dialogues InDesign ──────────────────
// Sans ça, une alerte "lien manquant" ou "police manquante" bloque le serveur
// et l'export échoue silencieusement sans lancer d'exception catchable.
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

try {
    // ── Ouverture du document IDML ─────────────────────────────────────────
    // IDML (InDesign Markup Language) est un format XML indépendant de la version.
    // Contrairement au .indd, un fichier IDML créé dans InDesign 2025 peut être
    // ouvert par n'importe quelle version antérieure d'InDesign Server.
    // RunScript utilise InDesign 2024 (v20.x) — le .indd v21 était incompatible.
    var idmlFile = File("Commendation-mountains.idml");
    app.consoleout("Chemin IDML    : " + idmlFile.fsName);
    app.consoleout("Fichier existe : " + idmlFile.exists);

    if (!idmlFile.exists) {
        throw new Error("IDML introuvable : " + idmlFile.fsName);
    }

    var doc = app.open(idmlFile);
    app.consoleout("Document ouvert : " + doc.name);

    // ── Dossier de travail ────────────────────────────────────────────────
    // Avec IDML, le document ouvert est "Untitled" (pas encore enregistré),
    // donc doc.fullName n'est pas fiable. On utilise idmlFile.parent qui pointe
    // directement vers le dossier où RunScript a téléchargé tous les inputs.
    var docFolder = idmlFile.parent;
    app.consoleout("Dossier de travail : " + docFolder.fsName);
    app.consoleout("Nombre de liens    : " + doc.links.length);

    // ── Relink de tous les assets depuis le dossier de travail RunScript ──
    // RunScript place l'IDML et tous les assets dans le même dossier.
    // InDesign cherche d'abord au chemin d'origine (Mac local) → introuvable.
    // On force le relink vers le dossier de l'IDML sur le serveur.
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
    // Chemin absolu dans le dossier de travail (même répertoire que l'IDML).
    var pdfFile = new File(docFolder.fsName + "/certificat.pdf");
    app.consoleout("PDF cible : " + pdfFile.fsName);

    // Désactiver l'ouverture automatique du PDF après export
    app.pdfExportPreferences.viewDocumentAfterExport = false;

    // Export sans preset dédié — utilisation des préférences courantes.
    // Recommandation Typefi : créer un preset nommé "CertificatPDF" dans InDesign,
    // l'embarquer dans l'IDML, et décommenter les lignes ci-dessous.
    // var pdfPreset = app.pdfExportPresets.item("CertificatPDF");
    // if (pdfPreset.isValid) {
    //     doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, pdfPreset);
    // } else {
    //     doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
    // }
    doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);

    app.consoleout("PDF exporté : " + pdfFile.fsName);
    app.consoleout("PDF existe  : " + pdfFile.exists);

    // ── Vérification CRITIQUE : le PDF doit exister ───────────────────────
    if (!pdfFile.exists) {
        throw new Error("EXPORT ECHOUE : " + pdfFile.fsName
            + " n'existe pas apres doc.exportFile()."
            + " Verifiez les polices, l'image liee et la version InDesign.");
    }

    // ── Fermeture sans sauvegarde ─────────────────────────────────────────
    doc.close(SaveOptions.NO);
    app.consoleout("=== Script termine avec succes ===");

} catch (error) {
    app.consoleout("ERREUR : " + error.toString());
    app.consoleout("Ligne  : " + error.line);
    throw error;
}
